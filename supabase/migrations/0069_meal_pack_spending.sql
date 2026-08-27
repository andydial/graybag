-- Spending and returning meals. `E21-24`.
--
-- `0068` is the shape; this is the only place the balance moves. Two rules hold everywhere below:
--
--   · The balance and the ledger move in the SAME transaction, or neither moves.
--   · Every guard is server-side. A client asking to spend a meal is making a request, not an
--     assertion — Andy: "A client claiming a cart qualifies proves nothing."

begin;

/**
 * Does this order satisfy the pack's meal rule?
 *
 * Evaluated from the order lines AS PERSISTED, never from a flag on the request. The rule is the
 * offer's — `items_per_meal` items, at least one from `required_category_id` — so "two items, one
 * a drink" is configuration rather than something compiled in.
 *
 * Returns null when eligible, or the reason it is not, which the app turns into the prototype's
 * copy ("A pack meal is two items with one drink").
 */
create or replace function meal_pack_ineligibility_reason(p_order_id uuid, p_offer_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_offer      meal_pack_offer;
  v_line_count int;
  v_has_required boolean;
begin
  select * into v_offer from meal_pack_offer where id = p_offer_id;
  if not found then return 'offer_not_found'; end if;

  -- Quantity counts, not row count: two of the same dish on one line is two items.
  select coalesce(sum(ol.quantity), 0) into v_line_count
    from order_line ol where ol.order_id = p_order_id;

  if v_line_count <> v_offer.items_per_meal then
    return 'wrong_item_count';
  end if;

  select exists (
    select 1 from order_line ol
      join dish d on d.id = ol.dish_id
     where ol.order_id = p_order_id
       and d.category_id = v_offer.required_category_id
  ) into v_has_required;

  if not v_has_required then
    return 'missing_required_category';
  end if;

  return null;
end;
$$;

comment on function meal_pack_ineligibility_reason is
  'Server-side eligibility (E21). Reads the persisted order lines and the OFFER''s rule, never a '
  'client flag and never a hardcoded category.';

/**
 * Take `p_meals` from a parent's packs, atomically, oldest-expiring first.
 *
 * ## The concurrency guarantee, and where it lives
 *
 * Two devices confirming plans at the same moment must not spend the same meal twice. The whole
 * guarantee is the `meals_remaining >= p_take` in the UPDATE below.
 *
 * It is safe at READ COMMITTED — which is what PostgREST and the Edge Functions run at — and the
 * reason is worth stating rather than assuming: a second transaction updating the same row BLOCKS
 * on the first one's row lock, and when it unblocks it RE-EVALUATES its `WHERE` against the
 * committed value, not the value it originally read. So the losing device sees the decremented
 * balance and matches zero rows.
 *
 * The `check (meals_remaining >= 0)` in `0068` is a backstop. If it ever fires, this function has
 * a bug and the write must abort loudly rather than quietly proceed.
 *
 * ## Why the lock order is the business rule
 *
 * `order by expires_at, id for update` is simultaneously the deadlock prevention (two sessions
 * take the same rows in the same sequence, so one waits rather than deadlocking) and the
 * oldest-first rule the prototype promises when packs stack. Keeping them as one line is the
 * version least likely to drift apart.
 *
 * Returns one row per pack drawn from, with how many came out of each.
 */
create or replace function spend_meal_pack_meals(p_user_id uuid, p_meals int)
returns table (meal_pack_id uuid, meals_taken int)
language plpgsql
volatile
as $$
declare
  v_pack   record;
  v_needed int := p_meals;
  v_take   int;
  v_after  int;
begin
  if p_meals is null or p_meals <= 0 then
    raise exception 'A plan must spend at least one meal' using errcode = 'P0001';
  end if;

  for v_pack in
    select id, meals_remaining
      from meal_pack
     where customer_user_id = p_user_id
       and status = 'active'
       and expires_at > now()          -- expiry is enforced HERE, not only in the app
       and meals_remaining > 0
     order by expires_at asc, id asc   -- deterministic: deadlock prevention AND oldest-first
       for update
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed, v_pack.meals_remaining);

    update meal_pack
       set meals_remaining = meals_remaining - v_take,
           updated_at      = now()
     where id = v_pack.id
       and status = 'active'
       and expires_at > now()
       and meals_remaining >= v_take   -- ← the entire guarantee
    returning meals_remaining into v_after;

    if not found then
      -- Someone else took them between the lock and here. Not an error worth a special case:
      -- skip this pack and let the loop try the next one, then fail below if short.
      continue;
    end if;

    if v_after = 0 then
      update meal_pack set status = 'exhausted', updated_at = now() where id = v_pack.id;
    end if;

    meal_pack_id := v_pack.id;
    meals_taken  := v_take;
    return next;

    v_needed := v_needed - v_take;
  end loop;

  if v_needed > 0 then
    -- The transaction rolls back, so any partial take above is undone. A plan is all or nothing:
    -- half a plan is worse than a refusal, because the parent cannot see which half.
    raise exception 'Not enough meals: % requested, % short', p_meals, v_needed
      using errcode = 'P0001', hint = 'insufficient_meals';
  end if;
end;
$$;

comment on function spend_meal_pack_meals is
  'THE only way meals leave a pack (E21). Atomic under READ COMMITTED via `meals_remaining >= '
  'p_take`; locks oldest-expiring first, which is both the deadlock prevention and the '
  'oldest-first rule. All or nothing — a short plan raises and rolls back.';

/**
 * Return one meal to its pack when a pack-paid order is cancelled before the cutoff.
 *
 * Guarded on `reversed_at is null` so a double-cancel cannot return two meals from one redemption.
 * The same cutoff rule as a paid order (`E09-38`) is applied by the caller, so a parent does not
 * learn a second set of rules.
 *
 * An expired pack still takes its meal back. The alternative — refusing, because the pack has
 * since expired — would mean a cancellation silently destroys a meal, and the parent cancelled
 * within the rules. The meal returns and expiry deals with it, which keeps the invariant true and
 * the behaviour explainable.
 */
create or replace function return_meal_pack_meal(p_redemption_id uuid, p_reason text)
returns bigint
language plpgsql
volatile
as $$
declare
  v_red  meal_pack_redemption;
  v_pack meal_pack;
begin
  select * into v_red from meal_pack_redemption where id = p_redemption_id for update;
  if not found then
    raise exception 'No such redemption %', p_redemption_id using errcode = 'P0001';
  end if;
  if v_red.reversed_at is not null then
    raise exception 'Redemption % was already returned', p_redemption_id
      using errcode = 'P0001', hint = 'already_returned';
  end if;

  update meal_pack_redemption
     set reversed_at = now(), reversal_reason = p_reason
   where id = p_redemption_id and reversed_at is null;

  if not found then
    raise exception 'Redemption % was returned concurrently', p_redemption_id
      using errcode = 'P0001', hint = 'already_returned';
  end if;

  update meal_pack
     set meals_remaining = meals_remaining + 1,
         -- An exhausted pack becomes spendable again; an expired one does NOT, because its
         -- expiry is a fact about time rather than about the balance.
         status = case when status = 'exhausted' then 'active' else status end,
         updated_at = now()
   where id = v_red.meal_pack_id
  returning * into v_pack;

  -- The caller reverses exactly this much revenue, so the ledger and the balance stay in step.
  return v_red.revenue_paise;
end;
$$;

comment on function return_meal_pack_meal is
  'Returns a meal on cancellation (E21). Guarded on `reversed_at is null` so a double-cancel '
  'cannot return two meals from one redemption. Returns the revenue to reverse.';

/**
 * The invariant, as a function, so it can be asserted after every path and every COMBINATION of
 * paths — and by the nightly reconciliation.
 *
 *   deferred revenue == sum over live packs of floor(net_price * remaining / total)
 *   deferred tax     == the same, for packs stamped `redemption` only
 *
 * False the instant a meal is counted twice, lost, or recognised without being spent. Both halves
 * are checked in both tax modes: under `sale` the tax half is zero on BOTH sides, which is a real
 * assertion rather than a skipped one.
 */
create or replace function check_meal_pack_ledger_invariant()
returns table (leg text, ledger_paise bigint, packs_paise bigint, ok boolean)
language sql
stable
as $$
  -- `ledger_balance` is the one balance function (`0013`, `E06-31`): it reads `normal_balance`
  -- from the account, so a positive result always means "this account holds what it should".
  -- Hand-rolling the sum here would be a second sign convention to keep in step with the first.
  with bal as (
    select
      (select ledger_balance(id) from ledger_account
        where code = 'platform:deferred_revenue:meal_packs') as revenue_bal,
      (select ledger_balance(id) from ledger_account
        where code = 'platform:deferred_tax:meal_packs')     as tax_bal
  )
  select 'deferred_revenue', coalesce(bal.revenue_bal, 0), meal_pack_deferred_revenue_paise(),
         coalesce(bal.revenue_bal, 0) = meal_pack_deferred_revenue_paise() from bal
  union all
  select 'deferred_tax',     coalesce(bal.tax_bal, 0),     meal_pack_deferred_tax_paise(),
         coalesce(bal.tax_bal, 0) = meal_pack_deferred_tax_paise() from bal;
$$;

comment on function check_meal_pack_ledger_invariant is
  'The E21 invariant: deferred-revenue balance equals the liability still owed across live packs, '
  'and likewise for deferred tax. Asserted after every money path in the test suite and by the '
  'nightly reconciliation.';

commit;
