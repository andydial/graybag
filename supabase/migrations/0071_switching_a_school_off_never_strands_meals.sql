-- Switching a school off stops SELLING. It must never strand meals already paid for. `E21-31`.
--
-- Andy, 2026-08-26: *"a parent who already owns a pack at a school we then switch off… must keep
-- their balance and keep being able to spend it. Turning an offer off stops selling; it must never
-- strand meals somebody has already paid for. That's real money owed as food."*
--
-- `0070` gave one answer — `meal_packs_available_at` — and the app was going to gate every pack
-- surface on it. That would have been wrong in exactly this case: the balance screen, the planner
-- and the cart toggle would all vanish the moment an offer was withdrawn, taking a paid-for
-- balance with them. The parent would still own the meals; they simply could not see or reach
-- them, which is the worst of both.
--
-- So there are TWO questions, and they have different answers:
--
--   · **Can this parent BUY?** — `meal_packs_available_at(school)`. Configuration decides.
--   · **Does this parent HAVE meals?** — `parent_has_live_meal_pack(user)`. Their balance decides,
--     and no configuration change can make the answer no.
--
-- Selling is a business decision. A balance is a debt.

begin;

/**
 * Does this parent hold meals they can still spend?
 *
 * Deliberately asks NOTHING about a school, an offer, or whether packs are still sold anywhere.
 * The only inputs are the parent's own packs: active, unexpired, with meals left.
 *
 * This is what gates the balance screen, the planner and the cart toggle — so withdrawing an
 * offer removes the shop and leaves the wallet.
 */
create or replace function parent_has_live_meal_pack(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from meal_pack
     where customer_user_id = p_user_id
       and status = 'active'
       and expires_at > now()
       and meals_remaining > 0
  );
$$;

comment on function parent_has_live_meal_pack is
  'Whether a parent holds spendable meals (E21-31). Asks nothing about schools or offers: '
  'withdrawing an offer stops selling and must never strand meals already paid for.';

/**
 * The whole pack surface for one parent at one school, as one answer.
 *
 * The app asks once and renders from the result, rather than assembling the rule from two calls
 * and getting the combination wrong. The three cases Andy named map onto it directly:
 *
 *   · `can_buy = false, has_balance = false` — **no concept.** No nav entry, no banner, no empty
 *     state. Nothing in the app suggests packs exist.
 *   · `can_buy = true` — the offers surface is reachable and advertised.
 *   · `has_balance = true` — the balance, the planner and the cart toggle are reachable **whatever
 *     `can_buy` says**. This is the case that must survive a school being switched off.
 *
 * The fallback screen — the prototype's "Meal packs aren't offered at this school" — is for
 * someone who reaches the route anyway, from a stale link or a bookmark. It is not an entry point
 * and nothing in the app navigates to it.
 */
create or replace function meal_pack_surface(p_user_id uuid, p_school_id uuid)
returns table (can_buy boolean, has_balance boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select meal_packs_available_at(p_school_id), parent_has_live_meal_pack(p_user_id);
$$;

comment on function meal_pack_surface is
  'The one question the app asks about packs (E21-31). `can_buy` is configuration; `has_balance` '
  'is a debt owed to this parent. Rendering nothing requires BOTH to be false.';

/**
 * `spend_meal_pack_meals` is deliberately NOT changed here, and that is the point of this file.
 *
 * It has never asked which school a meal is being spent at — it takes from the parent's packs,
 * oldest-expiring first. So a parent whose school was switched off can still plan and still
 * redeem, with no code change required. This comment exists so that nobody later "tidies up" by
 * adding a school check to it, which would silently strand paid-for meals.
 *
 * `meal_packs.test.sql` asserts this by switching the school off and then spending.
 */
comment on function spend_meal_pack_meals is
  'THE only way meals leave a pack (E21). Atomic under READ COMMITTED via `meals_remaining >= '
  'p_take`; locks oldest-expiring first, which is both the deadlock prevention and the '
  'oldest-first rule. All or nothing — a short plan raises and rolls back. '
  'It asks NOTHING about schools ON PURPOSE (E21-31): withdrawing an offer stops selling and must '
  'never strand meals already paid for. Do not add a school check here.';

commit;
