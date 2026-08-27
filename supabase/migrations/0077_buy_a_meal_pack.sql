-- Buying a pack. `E21-48`.
--
-- Andy chose the existing payment path over a second one: *"duplicating the payment path means
-- duplicating settlement, the webhook, the drain and reconciliation — the most fragile code we
-- own, and the place every serious bug this month has lived."* So a purchase creates an
-- `order_group` of kind `meal_pack_purchase` and then goes through `payments-create-order`,
-- `settle_payment` and the webhook **exactly as a food order does**.
--
-- ## The pack exists before it is paid for, and is not spendable
--
-- `assert_order_group_totals` requires a `meal_pack_purchase` group to have a pack behind it
-- (`0070`), so the row is written at purchase. It must not be spendable until the money arrives,
-- which needs a state the balance functions ignore.
--
-- `pending` is that state. Every liability, balance and spend function already filters on
-- `status in ('active','exhausted')` or `status = 'active'`, so a pending pack contributes
-- nothing to the ledger invariant and cannot be drawn from — without a single one of them
-- changing. That is the check on whether the state was added in the right place.
--
-- ## The sale legs post at SETTLEMENT, not at purchase
--
-- Money that has not arrived is not a liability. `activate_paid_meal_pack` is called from
-- `settle_payment`, so the pack becomes spendable and the ledger records the obligation at the
-- same instant, in the same transaction — the ledger and the balance move together or neither
-- moves, which is the rule the rest of `E21` already follows.

begin;

alter type meal_pack_status add value if not exists 'pending';

commit;
begin;

comment on column meal_pack.status is
  'pending — bought, not yet paid for: not spendable, and contributes nothing to the deferred '
  'revenue liability. active — spendable. exhausted — no meals left. expired — past its date. '
  'void — cancelled before payment. Every balance and spend function filters on active/exhausted, '
  'so `pending` needed no changes to any of them (E21-48).';

/**
 * Start a pack purchase. Returns the order group to take payment against.
 *
 * Writes the pack as `pending` and the group as `meal_pack_purchase`, with the group's totals
 * equal to the pack's stamped price — which `assert_order_group_totals` verifies at COMMIT.
 *
 * **The tax is stamped here, at sale**, from `platform_config`. Settled 2026-08-27: a pack is
 * taxed in full at purchase (`E21-53`). The value is copied onto the pack rather than read later,
 * so a future change to the config applies to future sales and never rewrites this one.
 *
 * Idempotent on the client's key, like checkout: a retry returns the same group rather than a
 * second pack.
 */
create or replace function start_meal_pack_purchase(
  p_user_id         uuid,
  p_offer_id        uuid,
  p_school_id       uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer    meal_pack_offer;
  v_cfg      platform_config;
  v_existing meal_pack;
  v_group_id uuid;
  v_pack_id  uuid;
  v_tax      bigint;
  v_cgst     bigint;
  v_city     uuid;
begin
  -- A retry returns the first purchase. Checked before anything is written, and keyed on the
  -- group's idempotency key so this shares the mechanism checkout already uses.
  select mp.* into v_existing
    from meal_pack mp
    join order_group og on og.id = mp.order_group_id
   where og.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_group_id', v_existing.order_group_id,
      'meal_pack_id', v_existing.id,
      'payable_paise', v_existing.net_price_paise + v_existing.tax_total_paise,
      'replayed', true);
  end if;

  select * into v_offer from meal_pack_offer where id = p_offer_id;
  if not found then
    raise exception 'No such offer' using errcode = 'P0001', hint = 'unknown_offer';
  end if;
  if not v_offer.is_active then
    raise exception 'That pack is not on sale' using errcode = 'P0001', hint = 'offer_not_active';
  end if;

  -- The school switch, checked server-side. A client asking to buy at a school we do not sell to
  -- proves nothing (`E21-27`).
  if not exists (
    select 1 from meal_pack_offer_school
     where offer_id = p_offer_id and school_id = p_school_id and is_enabled
  ) then
    raise exception 'Packs are not offered at that school'
      using errcode = 'P0001', hint = 'not_offered_here';
  end if;

  select * into v_cfg from platform_config where id = 1;
  select city_id into v_city from school where id = p_school_id;

  -- GST-exclusive prices, 5% flat as CGST 2.5% + SGST 2.5%, half-up, Mohali only
  -- (non-negotiable #7). `gst_split_bps` is not used here because the pack is a single line and
  -- the split is the whole of it.
  v_tax  := round(v_offer.net_price_paise * (v_cfg.cgst_rate_bps + v_cfg.sgst_rate_bps) / 10000.0);
  v_cgst := round(v_offer.net_price_paise * v_cfg.cgst_rate_bps / 10000.0);

  insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise)
  values (p_user_id, p_idempotency_key, 'pending_payment', v_city, 'meal_pack_purchase',
          v_offer.net_price_paise, v_tax, v_offer.net_price_paise + v_tax)
  returning id into v_group_id;

  insert into meal_pack (customer_user_id, offer_id, order_group_id, meals_total, meals_remaining,
                         net_price_paise, tax_total_paise, cgst_paise, sgst_paise, tax_point,
                         expires_at, status, correlation_id)
  values (p_user_id, p_offer_id, v_group_id, v_offer.meals_count, v_offer.meals_count,
          v_offer.net_price_paise, v_tax, v_cgst, v_tax - v_cgst,
          -- STAMPED. See `E21-22`: a later config change must not rewrite a pack already sold.
          v_cfg.pack_tax_point,
          -- Validity runs from PURCHASE, and purchase is when the money arrives. Set here from
          -- `now()` and reset at settlement, so a parent who pays an hour later gets the full
          -- window rather than an hour less of it.
          now() + make_interval(days => v_offer.validity_days),
          'pending', gen_random_uuid())
  returning id into v_pack_id;

  return jsonb_build_object(
    'order_group_id', v_group_id,
    'meal_pack_id', v_pack_id,
    'payable_paise', v_offer.net_price_paise + v_tax,
    'replayed', false);
end;
$$;

comment on function start_meal_pack_purchase is
  'Begins a pack purchase (E21-48). Writes the pack as `pending` and a `meal_pack_purchase` group '
  'to take payment against through the EXISTING Razorpay path. Idempotent on the client''s key.';

/**
 * Make a paid pack spendable, and record the obligation.
 *
 * Called from `settle_payment`, so this and the group becoming `paid` are the same transaction:
 * a pack is never spendable without its ledger entry, and never carries a liability it has not
 * been paid for.
 *
 * Returns silently for a group that is not a pack purchase, which is what lets `settle_payment`
 * call it unconditionally.
 */
create or replace function activate_paid_meal_pack(p_order_group_id uuid, p_correlation_id uuid)
returns void
language plpgsql
volatile
as $$
declare
  v_pack meal_pack;
begin
  select * into v_pack from meal_pack where order_group_id = p_order_group_id for update;
  if not found then return; end if;
  -- Settlement is delivered more than once — a webhook and the drain both arrive.
  --
  -- **This guard does not protect the ledger.** Established by mutation rather than assumed:
  -- removing it changes nothing, because `post_ledger_transaction` refuses the second posting on
  -- the idempotency key below. What it protects is the ROW — without it the UPDATE re-runs and
  -- recomputes `expires_at` from `now()`, so a webhook redelivered days later would silently hand
  -- a parent that much extra validity.
  if v_pack.status <> 'pending' then return; end if;

  update meal_pack
     set status = 'active',
         purchased_at = now(),
         -- The window starts when the money arrives, not when the sheet opened.
         expires_at = now() + (v_pack.expires_at - v_pack.created_at),
         updated_at = now()
   where id = v_pack.id;

  -- **The sale is NOT revenue.** Cash against an obligation to serve food; revenue is recognised
  -- meal by meal in `confirm_meal_pack_plan`. Counting it here and again there is the double-count
  -- `E21-46` exists to make impossible.
  --
  -- `tax_point = 'sale'` (settled 2026-08-27) puts the GST straight to tax_payable. The
  -- `redemption` branch is kept because the invariant asserts the deferred-tax leg is zero on
  -- both sides under `sale`, and that is only a real assertion while the other side can be
  -- non-zero.
  perform post_ledger_transaction(
    p_reason_code => 'meal_pack_sale',
    p_source_type => 'payment',
    p_source_id   => v_pack.id,
    p_entries     => case when v_pack.tax_point = 'sale' then
        jsonb_build_array(
          jsonb_build_object('account','provider:razorpay:clearing','direction','debit',
                             'amount_paise', v_pack.net_price_paise + v_pack.tax_total_paise),
          jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','credit',
                             'amount_paise', v_pack.net_price_paise),
          jsonb_build_object('account','platform:tax_payable:cgst','direction','credit',
                             'amount_paise', v_pack.cgst_paise),
          jsonb_build_object('account','platform:tax_payable:sgst','direction','credit',
                             'amount_paise', v_pack.sgst_paise))
      else
        jsonb_build_array(
          jsonb_build_object('account','provider:razorpay:clearing','direction','debit',
                             'amount_paise', v_pack.net_price_paise + v_pack.tax_total_paise),
          jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','credit',
                             'amount_paise', v_pack.net_price_paise),
          jsonb_build_object('account','platform:deferred_tax:meal_packs','direction','credit',
                             'amount_paise', v_pack.tax_total_paise))
      end,
    p_correlation_id => p_correlation_id,
    p_memo => 'meal pack sale',
    -- **This is what stops the sale being posted twice**, not the status check above — a
    -- redelivered webhook reaches the ledger with the same key and is refused there.
    p_idempotency_key => 'meal_pack_sale:' || v_pack.id::text);
end;
$$;

comment on function activate_paid_meal_pack is
  'Makes a paid pack spendable and records the obligation (E21-48). Called from settle_payment so '
  'the balance and the ledger move in one transaction. A redelivered settlement is refused by the '
  'LEDGER''s idempotency key; the `status = pending` check guards the row, so a late redelivery '
  'cannot recompute expires_at and hand a parent extra validity.';

commit;
