-- Every live pack, not just the next one. `E21-49`.
--
-- Andy, 2026-08-27, extending `D6`: *"if a parent holds two packs, show both, each with its own
-- expiry, and be explicit that meals are spent oldest first. A single summed number can't answer
-- 'when do I lose these', but neither can showing only one pack when they own two."*
--
-- He is right, and the original reasoning was half an argument. `meal_pack_balance` returns the
-- pack the next order draws from, which is the correct answer to *what happens next* and a wrong
-- answer to *what do I own*. A parent holding a 3-meal pack expiring Friday and a 10-meal pack
-- expiring in October needs to see both rows and the order between them, or the Friday deadline
-- is invisible until it has passed.
--
-- `meal_pack_balance` stays: the cart strip genuinely wants one pack — the one this order would
-- draw from — and asking it to choose from a list would put the oldest-first rule in the app.

begin;

create or replace function meal_pack_balances(p_user_id uuid)
returns table (
  meal_pack_id           uuid,
  pack_name              text,
  meals_total            int,
  meals_remaining        int,
  purchased_at           timestamptz,
  expires_at             timestamptz,
  expired                boolean,
  items_per_meal         int,
  required_category_id   uuid,
  -- 1 for the pack the next meal comes out of, 2 for the one after it, and so on. The app renders
  -- the order rather than recomputing it, so "spent oldest first" is stated by the server that
  -- actually does the spending.
  spend_order            int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select mp.id, o.name, mp.meals_total, mp.meals_remaining,
         mp.purchased_at, mp.expires_at, mp.expires_at <= now(),
         o.items_per_meal, o.required_category_id,
         row_number() over (
           -- The SAME ordering `spend_meal_pack_meals` takes them in. Written once here and read
           -- by the app, because two copies of an ordering rule is one copy too many.
           order by (mp.expires_at > now() and mp.meals_remaining > 0) desc,
                    mp.expires_at asc, mp.id asc
         )::int
    from meal_pack mp
    join meal_pack_offer o on o.id = mp.offer_id
   where mp.customer_user_id = p_user_id
     and mp.status in ('active', 'exhausted')
   -- Repeated rather than `order by spend_order`: a window function's alias is not in scope for
   -- the query's own ORDER BY. Same expression, and the comment above is the single statement of
   -- the rule.
   order by (mp.expires_at > now() and mp.meals_remaining > 0) desc,
            mp.expires_at asc, mp.id asc;
$$;

comment on function meal_pack_balances is
  'Every live pack a parent holds, in the order meals will be taken from them (E21-49). '
  '`meal_pack_balance` (singular) still answers "which pack does the NEXT order draw from", which '
  'is what the cart strip needs; this answers "what do I own", which is what the balance screen '
  'needs. Asks nothing about schools: a balance survives its school being switched off.';

commit;
