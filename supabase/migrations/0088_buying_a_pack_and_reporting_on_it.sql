-- Buying a pack, releasing a dead reservation, and the numbers the back office needs. `E21-78`.

begin;

-- =============================================================================
-- 1. Starting a purchase.
--
-- Creates the group and the pack, both `pending`. **Nothing is spendable yet**: `settle_payment`
-- moves the pack to `active` in the same transaction that posts the sale to the ledger, so a pack
-- is never spendable without its ledger entry and never carries an obligation we have not been
-- paid for.
--
-- Every figure the pack is sold on is STAMPED here — the name, the price, the tax, the item
-- counts, the bonus rule, both dates. `E21-67` was the old design reading the offer live, so
-- renaming an offer retitled packs parents already held and could retitle a tax invoice between
-- sale and settlement. A snapshot fixes the balance screen and the invoice together, and shrinks
-- the set of columns an admin must be prevented from editing to nothing.
-- =============================================================================

create or replace function start_meal_pack_purchase(
  p_user_id          uuid,
  p_offer_id         uuid,
  p_school_id        uuid,
  p_idempotency_key  text
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_offer    meal_pack_offer%rowtype;
  v_existing record;
  v_group_id uuid;
  v_pack_id  uuid;
  v_cgst     bigint;
  v_sgst     bigint;
  v_corr     uuid := gen_random_uuid();
  v_result   jsonb;
begin
  -- Idempotency first, and before any money exists. `E05-12`'s pattern: a retry after a lost
  -- response returns the SAME purchase rather than making a second one.
  select * into v_existing from idempotency_key
   where scope = 'meal_pack_purchase' and key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from (p_offer_id::text || ':' || p_school_id::text) then
      raise exception 'idempotency key reused for a different purchase'
        using errcode = 'P0001', hint = 'idempotency_key_reused';
    end if;
    return v_existing.response_body;
  end if;

  select * into v_offer from meal_pack_offer where id = p_offer_id;
  if not found or not v_offer.is_active then
    raise exception 'offer % is not on sale', p_offer_id
      using errcode = 'P0001', hint = 'offer_not_available';
  end if;

  -- The school switch, checked HERE and not merely in the read that listed the offers. A client
  -- that kept an offer id from yesterday, or from another school, must not be able to buy it.
  if not exists (select 1 from meal_pack_offer_school os
                  where os.offer_id = p_offer_id and os.school_id = p_school_id
                    and os.is_enabled) then
    raise exception 'offer % is not sold at school %', p_offer_id, p_school_id
      using errcode = 'P0001', hint = 'not_sold_at_this_school';
  end if;

  -- And that the parent actually has a child there. `P22`: a pack is bought at one school and
  -- spent there, so buying one for a school you have no child at buys something unusable.
  if not exists (select 1 from recipient r
                  join guardian_link g on g.recipient_id = r.id
                 where g.user_id = p_user_id
                   and r.school_id = p_school_id
                   and r.deleted_at is null) then
    raise exception 'user % has no recipient at school %', p_user_id, p_school_id
      using errcode = 'P0001', hint = 'no_child_at_this_school';
  end if;

  -- Per component, half-up, from the school's own configured rates — never 5% halved, and never
  -- a float (non-negotiable #3, `G1`/`G2`).
  v_cgst := round(v_offer.net_price_paise::numeric
                    * (select cgst_rate_bps from resolve_effective_config(p_school_id)) / 10000);
  v_sgst := round(v_offer.net_price_paise::numeric
                    * (select sgst_rate_bps from resolve_effective_config(p_school_id)) / 10000);

  insert into order_group (customer_user_id, idempotency_key, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise, status, placed_at)
  select p_user_id, p_idempotency_key, s.city_id, 'meal_pack_purchase',
         v_offer.net_price_paise, v_cgst + v_sgst,
         v_offer.net_price_paise + v_cgst + v_sgst, 'pending_payment', now()
    from school s where s.id = p_school_id
  returning id into v_group_id;

  insert into meal_pack (
    customer_user_id, school_id, offer_id, order_group_id, name_snapshot,
    price_paid_paise, cgst_paise, sgst_paise,
    items_original, valued_remaining,
    bonus_items, bonus_window_ends_at,
    purchased_at, expires_at, status, correlation_id
  ) values (
    p_user_id, p_school_id, p_offer_id, v_group_id, v_offer.name,
    v_offer.net_price_paise, v_cgst, v_sgst,
    v_offer.items_count, v_offer.items_count,
    v_offer.bonus_items_count, now() + make_interval(days => v_offer.bonus_window_days),
    now(), now() + make_interval(days => v_offer.validity_days), 'pending', v_corr
  ) returning id into v_pack_id;

  v_result := jsonb_build_object(
    'order_group_id',   v_group_id,
    'meal_pack_id',     v_pack_id,
    'payable_paise',    v_offer.net_price_paise + v_cgst + v_sgst,
    'net_price_paise',  v_offer.net_price_paise,
    'cgst_paise',       v_cgst,
    'sgst_paise',       v_sgst
  );

  -- A 24-hour TTL, purged by job (§12.3) — the same convention `create_checkout` uses, so both
  -- retry windows are the same length and neither needs its own explanation.
  insert into idempotency_key (scope, key, user_id, request_hash, resource_type, resource_id,
                               response_status, response_body, expires_at)
  values ('meal_pack_purchase', p_idempotency_key, p_user_id,
          p_offer_id::text || ':' || p_school_id::text, 'order_group', v_group_id, 200, v_result,
          now() + interval '24 hours');

  return v_result;
end;
$$;

comment on function start_meal_pack_purchase is
  'Creates the purchase group and a PENDING pack. Every figure is stamped at sale (E21-67), so '
  'editing an offer afterwards cannot reach a pack already bought — which is why no column on '
  'meal_pack_offer needs freezing once it has sold.';

-- =============================================================================
-- 2. The group-kind guard, rebuilt against the new table.
-- =============================================================================

create or replace function assert_meal_pack_group_kind()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from order_group g
                  where g.id = new.order_group_id and g.kind = 'meal_pack_purchase') then
    raise exception 'meal_pack % must reference an order_group of kind meal_pack_purchase', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create constraint trigger trg_assert_meal_pack_group_kind
  after insert or update of order_group_id on meal_pack
  deferrable initially deferred
  for each row execute function assert_meal_pack_group_kind();

-- =============================================================================
-- 3. Releasing a reservation the payment never came for.
--
-- A parent who abandons checkout sends nothing, so something must release the hold or their own
-- items are stranded from them.
--
-- **A clock alone is the wrong instrument, and the failure is asymmetric.** Release too early and
-- a payment genuinely in flight settles against a pack that no longer has the balance — a parent
-- who paid the cash portion expecting the pack to cover the rest. Release too late and a parent
-- cannot spend items they own. The second is recoverable by waiting; the first is a support
-- ticket about money.
--
-- So this releases only what is provably dead: a group still `pending_payment` whose payment row
-- is `failed`, or one old enough that Razorpay's own order has expired. The caller
-- (`payments-drain`, from `ops-monitor.yml`) is what knows the Razorpay side; this is the
-- database half, and it is deliberately conservative about the clock — 24 hours, not 30 minutes,
-- because nothing is lost by being slow and a parent's money is at stake in being fast.
-- =============================================================================

create or replace function release_dead_meal_pack_reservations(p_older_than interval default '24 hours')
returns int
language plpgsql
volatile
as $$
declare
  v_group record;
  v_total int := 0;
begin
  for v_group in
    select distinct r.order_group_id
      from meal_pack_redemption r
      join order_group g on g.id = r.order_group_id
     where r.state = 'held'
       and g.paid_at is null
       and (
         -- Provably dead: the payment attempt failed.
         exists (select 1 from payment p
                  where p.order_group_id = g.id and p.status = 'failed')
         -- Or old enough that no live Razorpay order could still settle it.
         or r.held_at < now() - p_older_than
       )
  loop
    v_total := v_total + release_meal_pack_reservations(v_group.order_group_id, 'payment_never_came');
  end loop;
  return v_total;
end;
$$;

-- =============================================================================
-- 4. What the back office needs to read.
--
-- Andy, 2026-09-16: *"report bonus granted/redeemed separately so the giveaway cost stays
-- visible."*
--
-- **The giveaway is reported in ITEMS, not in money, and that is not a shortcut.** There is no
-- cost basis anywhere in this schema to value it with: no COGS account exists (the chart of
-- accounts is wallet, revenue, receivable, payable, tax_payable, provider_clearing, provider_fees,
-- suspense, bank, deferred_revenue, deferred_tax), and **no dish carries a cost column** — checked
-- across every table, not assumed. Cost of goods is not tracked for a cash order either, so a COGS
-- line covering only bonus meals would be a number nobody could use and everybody would misread.
--
-- Counts are the honest measure, and `meal_pack_redemption.bonus_used` records exactly what a
-- future cost model would need, so nothing is lost by waiting.
--
-- **NO RECIPIENT, and that is why this is a view rather than a policy** — the same argument
-- `E21-63` made for `meal_pack_redemption_money`, except the rebuild removes the problem instead
-- of hiding it: `meal_pack_redemption` has no `recipient_id` at all. Which child ate is a
-- property of the order. This view carries order references, dates and numbers, and there is no
-- column in it that could name a person.
-- =============================================================================

create or replace view meal_pack_money
with (security_invoker = true)
as
select
  mp.id                                  as meal_pack_id,
  mp.school_id,
  mp.name_snapshot,
  mp.purchased_at,
  mp.expires_at,
  mp.status,
  mp.price_paid_paise,
  mp.cgst_paise + mp.sgst_paise          as tax_paise,
  mp.items_original,
  mp.valued_remaining,
  meal_pack_deferred_paise(mp)           as deferred_paise,

  -- The giveaway, in items and separately from everything else.
  mp.bonus_items                         as bonus_items_offered,
  (mp.bonus_granted_at is not null)      as bonus_granted,
  mp.bonus_granted_at,
  coalesce((select sum(r.bonus_used) from meal_pack_redemption r
             where r.meal_pack_id = mp.id and r.state = 'confirmed'), 0) as bonus_items_redeemed,
  mp.bonus_remaining                     as bonus_items_outstanding,

  -- Revenue recognised so far is what the money bought less what is still owed. One subtraction,
  -- not a sum over postings, so it cannot disagree with the ledger while the invariant holds.
  mp.price_paid_paise - meal_pack_deferred_paise(mp) as revenue_recognised_paise,
  coalesce((select sum(r.valued_items) from meal_pack_redemption r
             where r.meal_pack_id = mp.id and r.state = 'confirmed'), 0) as valued_items_redeemed,
  coalesce(e.breakage_paise, 0)          as breakage_paise
from meal_pack mp
left join meal_pack_expiry e on e.meal_pack_id = mp.id
where mp.status <> 'pending';

comment on view meal_pack_money is
  'Pack money for the back office. security_invoker, so the caller''s grants decide what they '
  'see — no definer exception is needed here, unlike E21-63''s view, because there is no child '
  'identity to keep out of it: meal_pack_redemption has no recipient column at all. Bonus items '
  'are reported as COUNTS because no cost basis exists in this schema to value them with, for a '
  'pack meal or a cash one.';

grant select on meal_pack_money to authenticated;

commit;
