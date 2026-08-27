-- The balance a parent actually sees. `E21-37`.
--
-- `parent_has_live_meal_pack` answers yes/no, which is enough to decide whether a surface renders
-- and deliberately not enough to render it. This returns the numbers.
--
-- ## Why the oldest-expiring pack, and not a sum
--
-- A parent may hold several packs. The prototype shows **one** balance — "7 of 10, expires 11 Oct"
-- — and that is right rather than a simplification: meals are spent oldest-first
-- (`spend_meal_pack_meals`), so the pack that matters to the next order is the one expiring
-- soonest. A summed "17 meals" across two packs with different expiry dates would be a number
-- that is true and useless, because it cannot answer *when do I lose these*.
--
-- `meals_across_all_packs` is returned alongside for the day a screen wants the total, so nobody
-- has to sum it client-side and get the expiry wrong.

begin;

create or replace function meal_pack_balance(p_user_id uuid)
returns table (
  meal_pack_id           uuid,
  pack_name              text,
  meals_total            int,
  meals_remaining        int,
  purchased_at           timestamptz,
  expires_at             timestamptz,
  expired                boolean,
  meals_across_all_packs int,
  -- The OFFER's meal rule, carried with the balance. The app needs it to say why a cart cannot
  -- use a meal *before* the parent taps, and reading it from the pack's own offer is what keeps
  -- "two items, one a drink" configuration rather than something compiled into the app.
  items_per_meal         int,
  required_category_id   uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select mp.*, o.name as offer_name, o.items_per_meal, o.required_category_id
      from meal_pack mp
      join meal_pack_offer o on o.id = mp.offer_id
     where mp.customer_user_id = p_user_id
       and mp.status in ('active', 'exhausted')
  )
  select l.id, l.offer_name, l.meals_total, l.meals_remaining,
         l.purchased_at, l.expires_at,
         l.expires_at <= now(),
         (select coalesce(sum(x.meals_remaining), 0)::int from live x where x.expires_at > now()),
         l.items_per_meal, l.required_category_id
    from live l
   -- Spendable packs first, then oldest-expiring: the same order meals are actually taken in, so
   -- the balance on screen is the balance the next order will draw from.
   order by (l.expires_at > now() and l.meals_remaining > 0) desc, l.expires_at asc, l.id asc
   limit 1;
$$;

comment on function meal_pack_balance is
  'The balance a parent sees (E21-37). Returns the pack the NEXT order would draw from — '
  'oldest-expiring and spendable first, matching spend_meal_pack_meals — rather than a sum across '
  'packs, which cannot answer "when do I lose these". Asks nothing about schools: a balance '
  'survives its school being switched off (E21-31).';

commit;
