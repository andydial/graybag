-- Confirming a plan. `E21-45`.
--
-- The whole submission is one transaction: the balance decrement, N orders, N redemptions and
-- the ledger legs either all happen or none do. Andy, approving the plan: *"Planning four days
-- and retrying on a flaky connection must produce four orders, not eight."*
--
-- ## Where each guarantee lives
--
--   · **Idempotency** — `meal_pack_plan`, keyed on the client's key for the WHOLE confirmation.
--     A retry returns the first result and writes nothing (amendment 1).
--   · **No overdraw** — `spend_meal_pack_meals`, one guarded `UPDATE`, all-or-nothing (`E21-25`).
--   · **Eligibility** — `meal_pack_ineligibility_reason`, read from the persisted lines.
--   · **Expiry** — checked per day against the pack, and again inside the decrement.
--   · **Revenue recognised once** — by difference against `pack_liability_paise`, so the amounts
--     across a pack telescope to its price exactly (amendment 3).
--   · **Tax legs follow the STAMPED tax point** (amendment 2), never the live config.

begin;

/**
 * Confirm a plan and spend its meals.
 *
 * `p_days` is `[{"service_date":"2026-09-01","recipient_id":"…","lines":[{"dish_id":"…",
 * "quantity":1}, …]}, …]`.
 *
 * Returns `{ "order_ids": […], "redemption_ids": […], "replayed": bool }`.
 *
 * Raises with a `hint` the app turns into copy: `insufficient_meals`, `pack_expired`,
 * `day_after_expiry`, `cutoff_passed`, `not_eligible`, `key_reused_with_different_plan`.
 */
create or replace function confirm_meal_pack_plan(
  p_user_id         uuid,
  p_idempotency_key text,
  p_days            jsonb,
  p_correlation_id  uuid default gen_random_uuid()
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing      meal_pack_plan;
  v_request_hash  text;
  v_day           jsonb;
  v_count         int;
  v_pack          meal_pack;
  v_order_ids     uuid[] := '{}';
  v_redemption_ids uuid[] := '{}';
  v_taken         record;
  v_order_id      uuid;
  v_redemption_id uuid;
  v_reason        text;
  v_before        int;
  v_revenue       bigint;
  v_tax           bigint;
  v_line          jsonb;
  v_line_no       int;
  v_school        record;
  v_cutoff        timestamptz;
begin
  v_count := jsonb_array_length(coalesce(p_days, '[]'::jsonb));
  if v_count = 0 then
    raise exception 'A plan must contain at least one day' using errcode = 'P0001', hint = 'empty_plan';
  end if;

  -- The hash is over the plan as submitted. A repeat with the same key and a DIFFERENT plan is a
  -- bug in the caller, not a replay, and returning the first plan's orders for it would be worse
  -- than refusing: the parent would believe they had planned something they had not.
  -- `md5`, not `digest`: pgcrypto lives in the `extensions` schema and this function pins
  -- `search_path` to `public, pg_temp`, so `digest` is not reachable — and widening the path to
  -- reach it would weaken a `security definer` function for a hash that is not a security
  -- boundary. This only has to notice that a body DIFFERS, not resist an adversary choosing one.
  v_request_hash := md5(p_days::text);

  -- ── Idempotency, FIRST ────────────────────────────────────────────────────────────────────
  select * into v_existing from meal_pack_plan where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception 'That idempotency key was used for a different plan'
        using errcode = 'P0001', hint = 'key_reused_with_different_plan';
    end if;
    -- The replay. Nothing is written and the first result is returned verbatim.
    return jsonb_build_object(
      'order_ids', to_jsonb(v_existing.order_ids),
      'redemption_ids', to_jsonb(v_existing.redemption_ids),
      'replayed', true);
  end if;

  -- ── Take the meals. Atomic, all-or-nothing, oldest-expiring first ─────────────────────────
  -- Before the orders exist, so a plan that cannot be paid for never creates one.
  create temporary table if not exists plan_taken (meal_pack_id uuid, meals_taken int)
    on commit drop;
  -- `truncate`, not `delete from`: hosted Supabase loads `safeupdate`, which rejects an
  -- unqualified DELETE with `21000`. A local `supabase start` does not, so the first version of
  -- this passed every test here and would have failed on staging — which is precisely what
  -- `check-unqualified-writes` exists to catch (`E05-21`, `E06-38`).
  truncate plan_taken;
  insert into plan_taken select * from spend_meal_pack_meals(p_user_id, v_count);

  -- One pack per confirmation for now: a plan spanning two packs would need per-order revenue
  -- from whichever pack that meal came out of, and the planner offers one balance (`D6`). A plan
  -- larger than the oldest pack is refused rather than silently split across two.
  if (select count(*) from plan_taken) <> 1 then
    raise exception 'A plan must come from one pack; this one spans %', (select count(*) from plan_taken)
      using errcode = 'P0001', hint = 'plan_spans_packs';
  end if;
  select mp.* into v_pack from plan_taken pt join meal_pack mp on mp.id = pt.meal_pack_id;

  -- ── One order and one redemption per day ──────────────────────────────────────────────────
  -- `meals_remaining` has already been decremented by the whole plan, so the liability walk
  -- below starts from where it was BEFORE the take and steps down one meal at a time. That is
  -- what makes each redemption's revenue the difference the pack actually owes.
  v_before := v_pack.meals_remaining + v_count;

  for v_day in select * from jsonb_array_elements(p_days) loop
    -- A day after the pack expires cannot be planned at all. Checked here as well as in the
    -- decrement, because the decrement only knows the pack is live *now* — it says nothing about
    -- a service date three weeks out.
    if (v_day->>'service_date')::date > v_pack.expires_at::date then
      raise exception 'A day after the pack expires cannot be planned (% > %)',
        v_day->>'service_date', v_pack.expires_at::date
        using errcode = 'P0001', hint = 'day_after_expiry';
    end if;

    select s.id, s.kitchen_id, s.city_id, s.name into v_school
      from recipient r join school s on s.id = r.school_id
     where r.id = (v_day->>'recipient_id')::uuid;
    if not found then
      raise exception 'Unknown recipient' using errcode = 'P0001', hint = 'unknown_recipient';
    end if;

    -- `compute_cutoff_at` is the one place the cutoff arithmetic lives (§9.1); recomputing it
    -- here would be a second copy to keep in step. `assert_cutoff_open` is what the ordinary
    -- checkout uses, so a pack meal is held to exactly the same deadline as a paid order.
    v_cutoff := compute_cutoff_at(v_school.id, (v_day->>'service_date')::date);
    if v_cutoff <= now() then
      raise exception 'Ordering has closed for %', v_day->>'service_date'
        using errcode = 'P0001', hint = 'cutoff_passed';
    end if;

    insert into "order" (order_group_id, customer_user_id, recipient_id, school_id, kitchen_id,
                         city_id, service_date, delivery_mode, cutoff_at, config_snapshot,
                         school_name_snapshot, recipient_name_snapshot, status,
                         order_ref, correlation_id)
    select v_pack.order_group_id, p_user_id, (v_day->>'recipient_id')::uuid, v_school.id,
           v_school.kitchen_id, v_school.city_id, (v_day->>'service_date')::date,
           'classroom', v_cutoff, '{}'::jsonb, v_school.name,
           r.first_name, 'pending_payment',
           'PK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
           p_correlation_id
      from recipient r where r.id = (v_day->>'recipient_id')::uuid
    returning id into v_order_id;

    v_line_no := 0;
    for v_line in select * from jsonb_array_elements(v_day->'lines') loop
      v_line_no := v_line_no + 1;
      insert into order_line (order_id, line_no, dish_id, quantity, unit_price_paise,
                              line_subtotal_paise, line_total_paise, dish_name_snapshot)
      select v_order_id, v_line_no, d.id, (v_line->>'quantity')::int, 0, 0, 0, d.name
        from dish d where d.id = (v_line->>'dish_id')::uuid;
    end loop;

    -- Eligibility, from the lines AS PERSISTED. The client's opinion never reaches this.
    v_reason := meal_pack_ineligibility_reason(v_order_id, v_pack.offer_id);
    if v_reason is not null then
      raise exception 'That day is not a valid pack meal (%)', v_reason
        using errcode = 'P0001', hint = 'not_eligible';
    end if;

    -- Revenue for THIS meal, by difference. Telescopes to the pack price exactly.
    v_revenue := pack_liability_paise(v_pack.net_price_paise, v_before, v_pack.meals_total)
               - pack_liability_paise(v_pack.net_price_paise, v_before - 1, v_pack.meals_total);
    v_tax := case when v_pack.tax_point = 'redemption'
                  then pack_liability_paise(v_pack.tax_total_paise, v_before, v_pack.meals_total)
                     - pack_liability_paise(v_pack.tax_total_paise, v_before - 1, v_pack.meals_total)
                  else 0 end;

    insert into meal_pack_redemption (meal_pack_id, order_id, recipient_id, service_date,
                                      revenue_paise, tax_paise, correlation_id)
    values (v_pack.id, v_order_id, (v_day->>'recipient_id')::uuid,
            (v_day->>'service_date')::date, v_revenue, v_tax, p_correlation_id)
    returning id into v_redemption_id;

    -- Recognise the revenue. `post_ledger_transaction` refuses an unbalanced posting, so the
    -- legs below are checked by the same function every other money path uses.
    perform post_ledger_transaction(
      p_reason_code => 'meal_pack_redemption',
      p_source_type => 'adjustment',
      p_source_id   => v_redemption_id,
      p_entries     => case when v_tax = 0 then
          jsonb_build_array(
            jsonb_build_object('account', 'platform:deferred_revenue:meal_packs',
                               'direction', 'debit',  'amount_paise', v_revenue),
            jsonb_build_object('account', 'platform:revenue',
                               'direction', 'credit', 'amount_paise', v_revenue))
        else
          -- `tax_point = 'redemption'`: the tax moves from held to due at the same moment.
          jsonb_build_array(
            jsonb_build_object('account', 'platform:deferred_revenue:meal_packs',
                               'direction', 'debit',  'amount_paise', v_revenue),
            jsonb_build_object('account', 'platform:deferred_tax:meal_packs',
                               'direction', 'debit',  'amount_paise', v_tax),
            jsonb_build_object('account', 'platform:revenue',
                               'direction', 'credit', 'amount_paise', v_revenue),
            jsonb_build_object('account', 'platform:tax_payable:cgst',
                               'direction', 'credit', 'amount_paise', v_tax / 2),
            jsonb_build_object('account', 'platform:tax_payable:sgst',
                               'direction', 'credit', 'amount_paise', v_tax - v_tax / 2))
        end,
      p_correlation_id => p_correlation_id,
      p_memo => 'meal pack redemption',
      p_idempotency_key => p_idempotency_key || ':' || v_redemption_id::text);

    v_order_ids := v_order_ids || v_order_id;
    v_redemption_ids := v_redemption_ids || v_redemption_id;
    v_before := v_before - 1;
  end loop;

  -- ── Record the submission LAST, with its result ───────────────────────────────────────────
  -- Last because everything above can still raise; the transaction rolls back either way, and
  -- writing it first would only matter if this function could partially succeed, which it cannot.
  insert into meal_pack_plan (idempotency_key, customer_user_id, request_hash, meals_requested,
                              order_ids, redemption_ids, correlation_id)
  values (p_idempotency_key, p_user_id, v_request_hash, v_count,
          v_order_ids, v_redemption_ids, p_correlation_id);

  return jsonb_build_object(
    'order_ids', to_jsonb(v_order_ids),
    'redemption_ids', to_jsonb(v_redemption_ids),
    'replayed', false);
end;
$$;

comment on function confirm_meal_pack_plan is
  'Confirms a plan and spends its meals (E21-45). One transaction: decrement, orders, '
  'redemptions and ledger legs together or not at all. Idempotent on the WHOLE submission — a '
  'retry returns the first result and writes nothing. Revenue is recognised by difference so the '
  'amounts telescope to the pack price exactly, and the tax legs follow the pack''s STAMPED tax '
  'point rather than the live config.';

commit;
