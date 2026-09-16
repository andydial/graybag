-- The pack redemption machine. `E21-70`.
--
-- `0085` built the tables; this builds what moves items between their states, and nothing here
-- touches the ordering path — that is `0087`, deliberately separate so it can be reverted alone.
--
-- ## The state machine, in one picture
--
--        create_checkout                              settle_payment (webhook)
--   (none) ──reserve──► held ──confirm──► confirmed ──reverse──► reversed
--                         │                                          ▲
--                         └──release──► released              cancel-order
--
--   reserve   items_reserved +n                            no ledger entry
--   confirm   items_reserved -n, valued/bonus -n           Dr deferred / Cr revenue
--   release   items_reserved -n                            no ledger entry
--   reverse                 valued/bonus +n                Dr revenue / Cr deferred
--
-- **The balance a parent is told they have is never changed by anything that has not happened.**
-- That is the whole reason `held` is a state rather than a decrement with a note attached.
--
-- ## Where the concurrency guarantee lives, and why it moved
--
-- Andy asked for a single atomic statement, never a read-then-write. The statement is on the
-- RESERVE, not the decrement, because that is where the race actually is: two devices checking
-- out at the same moment are both at reserve, and only one webhook can ever arrive for a given
-- order group. The confirm is never contended.
--
--     update meal_pack set items_reserved = items_reserved + n
--      where id = ... and valued_remaining + bonus_remaining - items_reserved >= n
--
-- Safe at READ COMMITTED — which is what PostgREST and our Edge Functions run at — because a
-- second transaction updating the same row blocks on the first one's row lock and then
-- **re-evaluates its WHERE against the committed value**, not the one it read. The loser matches
-- zero rows. The `check` constraints in `0085` are backstops, not the mechanism.

begin;

-- =============================================================================
-- 1. The deferred balance, as a FUNCTION. `M11`.
--
-- Never an accumulated column. Every ledger posting is the difference of this function before and
-- after, so the balance cannot drift and the last valued item always lands on exactly zero.
-- `round()` on numeric is half-up in Postgres, which is the same rule `docs/gst-invoicing.md`
-- §6.2 states and the same idiom `create_checkout` already uses for tax. No float touches money.
-- =============================================================================

create or replace function meal_pack_deferred_paise(p_pack meal_pack)
returns bigint
language sql
immutable
as $$
  select round(p_pack.price_paid_paise::numeric * p_pack.valued_remaining
                 / p_pack.items_original)::bigint;
$$;

comment on function meal_pack_deferred_paise is
  'What this pack still owes, in paise. Bonus items are NOT in it: they carry no value (M10), so '
  'items_original is the denominator for the life of the pack and never grows.';

-- =============================================================================
-- 2. What a parent may see and buy.
--
-- `meal_pack_surface` and `meal_pack_offers_for_school` keep the EXACT signatures and return
-- shapes the old build had. That is not laziness — it is what lets migrations ship ahead of the
-- OTA: a phone on the old bundle calls them, gets a truthful "no packs here" while no offer is
-- live, and shows an app with no such concept. The client's try/catch is the floor; this is
-- the plan.
-- =============================================================================

create or replace function meal_pack_offers_for_school(p_school_id uuid)
returns table (
  id uuid, name text, net_price_paise bigint, items_count int,
  bonus_items_count int, bonus_window_days int, validity_days int,
  -- Kept so an old bundle's parser, which requires them, does not throw. They describe the old
  -- product and are meaningless now: one item is one item.
  meals_count int, items_per_meal int, required_category_id uuid, alacarte_reference_paise bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.net_price_paise, o.items_count,
         o.bonus_items_count, o.bonus_window_days, o.validity_days,
         o.items_count as meals_count, 1 as items_per_meal,
         null::uuid as required_category_id, 0::bigint as alacarte_reference_paise
    from meal_pack_offer o
    join meal_pack_offer_school os on os.offer_id = o.id
   where o.is_active
     and os.school_id = p_school_id
     and os.is_enabled
   order by o.sort_order, o.net_price_paise;
$$;

comment on function meal_pack_offers_for_school is
  'What is for sale at this school. security definer because meal_pack_offer has NO parent-facing '
  'policy at all — the database decides what exists there, and no query a client could write sees '
  'more. Absence of a meal_pack_offer_school row means not sold, which is the default for a new '
  'school and half the release gate.';

create or replace function meal_pack_surface(p_user_id uuid, p_school_id uuid)
returns table (can_buy boolean, has_balance boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from meal_pack_offers_for_school(p_school_id)),
    -- `canBuy` is a business decision; `hasBalance` is a DEBT. Withdrawing an offer must stop the
    -- first and must never touch the second (E21-31). They are computed from different things
    -- here so that no future edit can accidentally derive one from the other.
    exists (select 1 from meal_pack mp
             where mp.customer_user_id = p_user_id
               and mp.school_id = p_school_id
               and mp.status = 'active'
               and mp.expires_at > now()
               and mp.valued_remaining + mp.bonus_remaining > 0);
$$;

create or replace function meal_pack_balances(p_user_id uuid)
returns table (
  id uuid, school_id uuid, school_name text, name text,
  items_total int, items_remaining int, items_reserved int,
  valued_remaining int, bonus_remaining int, bonus_items int,
  bonus_granted boolean, bonus_window_ends_at timestamptz, bonus_still_possible boolean,
  purchased_at timestamptz, expires_at timestamptz, status text,
  price_paid_paise bigint, cgst_paise bigint, sgst_paise bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select mp.id, mp.school_id, s.name, mp.name_snapshot,
         mp.items_original + case when mp.bonus_granted_at is null then 0 else mp.bonus_items end,
         mp.items_remaining, mp.items_reserved,
         mp.valued_remaining, mp.bonus_remaining, mp.bonus_items,
         mp.bonus_granted_at is not null,
         mp.bonus_window_ends_at,
         -- "still possible" is the honest three-way answer the balance screen needs: earned, can
         -- still be earned, or the window has closed. Computed here so two screens cannot
         -- disagree about it.
         (mp.bonus_granted_at is null and mp.bonus_items > 0 and now() <= mp.bonus_window_ends_at),
         mp.purchased_at, mp.expires_at, mp.status::text,
         mp.price_paid_paise, mp.cgst_paise, mp.sgst_paise
    from meal_pack mp
    join school s on s.id = mp.school_id
   where mp.customer_user_id = p_user_id
     and mp.status <> 'pending'
   -- Spend order, and the same order everywhere: earliest expiry first.
   order by mp.expires_at asc, mp.id asc;
$$;

comment on function meal_pack_balances is
  'Every pack this parent holds, in SPEND ORDER. Carries no recipient, no child name, no class '
  'and no section — there is no column here that could (non-negotiable #4).';

-- =============================================================================
-- 3. RESERVE. The contended statement, and the one that decides what the cart shows.
-- =============================================================================

create or replace function reserve_meal_pack_items(
  p_order_group_id  uuid,
  p_customer_user_id uuid,
  p_correlation_id  uuid
) returns bigint
language plpgsql
volatile
as $$
declare
  v_order        record;
  v_line         record;
  v_pack         record;
  v_want         int;
  v_take         int;
  v_reserved     int;
  v_covered      bigint := 0;
  v_cfg          effective_config;
begin
  for v_order in
    select o.id, o.school_id, o.service_date from "order" o
     where o.order_group_id = p_order_group_id
     order by o.id
  loop
    -- Eligible packs for THIS order's school. `P22`: bought at a school, spent there.
    --
    -- `for update` in a deterministic order is the deadlock prevention, and it is the same line
    -- as the business rule — the pack that expires soonest is spent first — so correctness and
    -- concurrency control cannot drift apart. Two different parents never contend at all.
    --
    -- `expires_at > service_date` and not merely `> now()`: a pack must be alive on the day the
    -- food is served, otherwise a parent reserves today against a meal the pack cannot cover.
    for v_pack in
      select mp.id,
             mp.valued_remaining + mp.bonus_remaining - mp.items_reserved as spendable
        from meal_pack mp
       where mp.customer_user_id = p_customer_user_id
         and mp.school_id = v_order.school_id
         and mp.status = 'active'
         and mp.expires_at > now()
         and mp.expires_at::date >= v_order.service_date
         and mp.valued_remaining + mp.bonus_remaining > mp.items_reserved
       order by mp.expires_at asc, mp.id asc
         for update
    loop
      exit when v_pack.spendable <= 0;

      -- CHEAPEST FIRST (`P23`, Andy's ruling). Whole lines wherever possible, so a split only
      -- ever happens on the single line where the pack runs out — at most one per order, and
      -- usually none. `line_no` breaks ties so the choice is deterministic across replays.
      for v_line in
        select ol.id, ol.quantity, ol.unit_price_paise,
               coalesce((select sum(r.items) from meal_pack_redemption r
                          where r.order_line_id = ol.id and r.state in ('held','confirmed')), 0)
                 as already_covered
          from order_line ol
         where ol.order_id = v_order.id
         order by ol.unit_price_paise asc, ol.line_no asc
      loop
        exit when v_pack.spendable <= 0;

        v_want := v_line.quantity - v_line.already_covered;
        continue when v_want <= 0;

        v_take := least(v_want, v_pack.spendable);

        -- THE GUARANTEE IS ON THE WHERE CLAUSE. One statement, no prior SELECT of the value
        -- being changed. Zero rows back means another device got there first.
        update meal_pack
           set items_reserved = items_reserved + v_take
         where id = v_pack.id
           and status = 'active'
           and expires_at > now()
           and valued_remaining + bonus_remaining - items_reserved >= v_take
        returning valued_remaining + bonus_remaining - items_reserved into v_reserved;

        if not found then
          -- Lost the race, or the pack moved underneath us. Take nothing from this pack and let
          -- the next one try. The parent pays cash for what is left, which is always a safe
          -- outcome — the unsafe one would be spending an item that is not there.
          exit;
        end if;

        insert into meal_pack_redemption (
          meal_pack_id, order_group_id, order_id, order_line_id,
          items, valued_items, bonus_used, covered_subtotal_paise, state, correlation_id
        ) values (
          v_pack.id, p_order_group_id, v_order.id, v_line.id,
          v_take,
          -- The valued/bonus split is decided at CONFIRM, not here: a reservation does not know
          -- what the balance will look like when it settles. Zeroes until then.
          0, 0,
          v_line.unit_price_paise * v_take, 'held', p_correlation_id
        );

        v_covered := v_covered + (v_line.unit_price_paise * v_take);
        v_pack.spendable := v_pack.spendable - v_take;
      end loop;
    end loop;

    -- Retax the order: a covered item is not a taxable supply on this invoice, because its tax
    -- was charged at the point of sale of the pack. Per line, per component, from the UNCOVERED
    -- quantity — `G1`/`G2`, never 5% halved and never a proportion of a total.
    --
    -- `line_subtotal_paise` is left at full value, because `order_line_subtotal_arithmetic`
    -- requires it to equal unit_price × quantity and because the food really is worth that. What
    -- the pack paid for is expressed once, on the group, as `pack_applied_paise`.
    v_cfg := resolve_effective_config(v_order.school_id);

    update order_line ol
       set tax_cgst_paise   = cov.cgst,
           tax_sgst_paise   = cov.sgst,
           line_total_paise = ol.line_subtotal_paise + cov.cgst + cov.sgst
      from (
        select l.id,
               round((l.unit_price_paise * (l.quantity - coalesce(c.covered, 0)))::numeric
                       * v_cfg.cgst_rate_bps / 10000)::bigint as cgst,
               round((l.unit_price_paise * (l.quantity - coalesce(c.covered, 0)))::numeric
                       * v_cfg.sgst_rate_bps / 10000)::bigint as sgst
          from order_line l
          left join (select r.order_line_id, sum(r.items) as covered
                       from meal_pack_redemption r
                      where r.state in ('held', 'confirmed')
                      group by r.order_line_id) c on c.order_line_id = l.id
         where l.order_id = v_order.id
      ) cov
     where ol.id = cov.id;

    update "order" o
       set tax_cgst_paise = agg.cgst,
           tax_sgst_paise = agg.sgst,
           total_paise    = o.subtotal_paise + agg.cgst + agg.sgst
      from (select coalesce(sum(tax_cgst_paise), 0) cgst,
                   coalesce(sum(tax_sgst_paise), 0) sgst
              from order_line where order_id = v_order.id) agg
     where o.id = v_order.id;
  end loop;

  return v_covered;
end;
$$;

comment on function reserve_meal_pack_items is
  'Holds pack items against a checkout WITHOUT touching the balance. Returns the ex-tax value '
  'covered, which the caller writes to order_group.pack_applied_paise — the column that already '
  'existed for exactly this, in payable = subtotal + tax - discount - wallet - pack_applied.';

-- =============================================================================
-- 4. CONFIRM. The webhook has said the money moved.
-- =============================================================================

create or replace function confirm_meal_pack_redemptions(
  p_order_group_id uuid,
  p_correlation_id uuid
) returns int
language plpgsql
volatile
as $$
declare
  v_r          record;
  v_pack       meal_pack%rowtype;
  v_before     bigint;
  v_after      bigint;
  v_recognise  bigint;
  v_valued     int;
  v_bonus      int;
  v_count      int := 0;
begin
  for v_r in
    select * from meal_pack_redemption
     where order_group_id = p_order_group_id and state = 'held'
     order by meal_pack_id, order_line_id
  loop
    select * into v_pack from meal_pack where id = v_r.meal_pack_id for update;
    v_before := meal_pack_deferred_paise(v_pack);

    -- VALUED ITEMS ARE SPENT FIRST, and the split is computed inside the statement rather than by
    -- a SELECT beforehand, so this stays one statement even though it is never raced. Bonus items
    -- can normally only be reached once every valued item is gone — that is what earns them — so
    -- the order matters in exactly one case: a cancellation has returned a valued item to a pack
    -- that already has its bonus. Spending valued first there recognises revenue sooner and
    -- leaves only worthless items to be forfeited, which is the conservative answer.
    update meal_pack
       set valued_remaining = valued_remaining - least(v_r.items, valued_remaining),
           bonus_remaining  = bonus_remaining  - (v_r.items - least(v_r.items, valued_remaining)),
           items_reserved   = items_reserved   - v_r.items
     where id = v_r.meal_pack_id
       and items_reserved >= v_r.items
       and valued_remaining + bonus_remaining >= v_r.items;

    if not found then
      raise exception 'meal pack % cannot confirm % items', v_r.meal_pack_id, v_r.items
        using errcode = 'P0001', hint = 'pack_confirm_failed';
    end if;

    v_valued := least(v_r.items, v_pack.valued_remaining);
    v_bonus  := v_r.items - v_valued;

    update meal_pack_redemption
       set state = 'confirmed', settled_at = now(),
           valued_items = v_valued, bonus_used = v_bonus
     where id = v_r.id;

    select * into v_pack from meal_pack where id = v_r.meal_pack_id;
    v_after := meal_pack_deferred_paise(v_pack);
    v_recognise := v_before - v_after;

    -- Revenue is recognised as the DIFFERENCE of the balance function, never as a stored
    -- per-item value. Spending a bonus item moves nothing, because valued_remaining did not move.
    if v_recognise <> 0 then
      perform post_ledger_transaction(
        'meal_pack_redemption', 'adjustment', v_r.id,
        jsonb_build_array(
          jsonb_build_object('account', 'platform:deferred_revenue:meal_packs',
                             'direction', 'debit',  'amount_paise', v_recognise),
          jsonb_build_object('account', 'platform:revenue',
                             'direction', 'credit', 'amount_paise', v_recognise)
        ),
        now(), p_correlation_id, null, null,
        'pack-redeem:' || v_r.id::text
      );
    end if;

    perform grant_meal_pack_bonus_if_earned(v_r.meal_pack_id);

    -- Nothing left and nothing more to earn: say so, rather than leaving a dead pack reading
    -- `active` on the balance screen for the rest of its validity.
    update meal_pack
       set status = 'exhausted'
     where id = v_r.meal_pack_id
       and status = 'active'
       and valued_remaining = 0 and bonus_remaining = 0
       and (bonus_granted_at is not null or bonus_items = 0 or now() > bonus_window_ends_at);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- =============================================================================
-- 5. The bonus. Arithmetic, not a scheduled job.
--
-- Evaluated in the same transaction as the confirm that empties the pack, so there is no window
-- to miss and no pack waiting on a cron for something it has already earned. A window that closes
-- unearned needs no action at all: the condition simply stops being true.
--
-- NO LEDGER POSTING. Bonus items are a giveaway and carry no value (`M10`, Andy's ruling) — so
-- items_original does not move, the deferred balance does not move, and no revenue recognised in
-- an earlier month is ever restated.
-- =============================================================================

create or replace function grant_meal_pack_bonus_if_earned(p_pack_id uuid)
returns boolean
language plpgsql
volatile
as $$
declare
  v_granted boolean := false;
begin
  update meal_pack
     set bonus_remaining  = bonus_items,
         bonus_granted_at = now()
   where id = p_pack_id
     and bonus_granted_at is null       -- granted once, ever
     and bonus_items > 0
     and valued_remaining = 0           -- every item the MONEY bought has been served
     and now() <= bonus_window_ends_at
  returning true into v_granted;

  return coalesce(v_granted, false);
end;
$$;

comment on function grant_meal_pack_bonus_if_earned is
  'A reversal that lifts valued_remaining back above zero after a grant does NOT un-grant it, and '
  'cannot mint a second one: bonus_granted_at is set once and this reads it. Nor can a '
  'cancellation re-open a window that has closed — the time check is evaluated at the moment of '
  'the grant, not at the moment of the cancellation.';

-- =============================================================================
-- 6. RELEASE and REVERSE.
-- =============================================================================

create or replace function release_meal_pack_reservations(
  p_order_group_id uuid,
  p_reason text
) returns int
language plpgsql
volatile
as $$
declare
  v_r     record;
  v_count int := 0;
begin
  for v_r in
    select * from meal_pack_redemption
     where order_group_id = p_order_group_id and state = 'held'
  loop
    update meal_pack
       set items_reserved = items_reserved - v_r.items
     where id = v_r.meal_pack_id and items_reserved >= v_r.items;

    update meal_pack_redemption
       set state = 'released', settled_at = now(), reversal_reason = p_reason
     where id = v_r.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function release_meal_pack_reservations is
  'The payment never happened, so the hold goes back. Touches NO ledger account and NO balance — '
  'a released reservation leaves the pack exactly as it was found, which is the point.';

create or replace function reverse_meal_pack_redemptions(
  p_order_id uuid,
  p_reason   text,
  p_correlation_id uuid
) returns int
language plpgsql
volatile
as $$
declare
  v_r         record;
  v_pack      meal_pack%rowtype;
  v_before    bigint;
  v_after     bigint;
  v_give_back bigint;
  v_count     int := 0;
begin
  for v_r in
    select * from meal_pack_redemption
     where order_id = p_order_id and state = 'confirmed'
     -- `reversed_at is null` is implied by state = 'confirmed' and asserted again here, because a
     -- double cancel returning two items from one redemption is the failure to design against.
       and reversed_at is null
  loop
    select * into v_pack from meal_pack where id = v_r.meal_pack_id for update;
    v_before := meal_pack_deferred_paise(v_pack);

    -- Give back EXACTLY what was taken, read from the row rather than recomputed — so a
    -- cancellation cannot turn a free bonus item into a valued one or the other way round.
    update meal_pack
       set valued_remaining = valued_remaining + v_r.valued_items,
           bonus_remaining  = bonus_remaining  + v_r.bonus_used,
           status = case when status = 'exhausted' and expires_at > now() then 'active'
                         else status end
     where id = v_r.meal_pack_id;

    update meal_pack_redemption
       set state = 'reversed', reversed_at = now(), reversal_reason = p_reason
     where id = v_r.id;

    select * into v_pack from meal_pack where id = v_r.meal_pack_id;
    v_after := meal_pack_deferred_paise(v_pack);
    v_give_back := v_after - v_before;

    if v_give_back <> 0 then
      perform post_ledger_transaction(
        'meal_pack_return', 'adjustment', v_r.id,
        jsonb_build_array(
          jsonb_build_object('account', 'platform:revenue',
                             'direction', 'debit',  'amount_paise', v_give_back),
          jsonb_build_object('account', 'platform:deferred_revenue:meal_packs',
                             'direction', 'credit', 'amount_paise', v_give_back)
        ),
        now(), p_correlation_id, null, null,
        'pack-reverse:' || v_r.id::text
      );
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =============================================================================
-- 7. Expiry. Unused items are forfeited and the money is kept as breakage.
--
-- Run from `ops-monitor.yml`, the scheduler that already exists. There is no `pg_cron` on this
-- project — checked, not assumed.
--
-- The ledger invariant holds CONTINUOUSLY across a pack expiring before the sweep notices, which
-- is the property that makes a scheduled job safe here: an unswept pack is still `active` with
-- its balance intact, and the sweep moves the status, the items and the ledger in one
-- transaction. The sweep is bookkeeping being timely, not correctness being restored. A pack past
-- expiry still cannot be SPENT, because the reserve statement checks `expires_at > now()`.
-- =============================================================================

create or replace function expire_meal_packs()
returns int
language plpgsql
volatile
as $$
declare
  v_pack     meal_pack%rowtype;
  v_breakage bigint;
  v_count    int := 0;
begin
  for v_pack in
    select * from meal_pack
     where status in ('active', 'exhausted') and expires_at <= now()
     order by id
       for update
  loop
    v_breakage := meal_pack_deferred_paise(v_pack);

    if v_breakage <> 0 then
      perform post_ledger_transaction(
        'meal_pack_expiry', 'adjustment', v_pack.id,
        jsonb_build_array(
          jsonb_build_object('account', 'platform:deferred_revenue:meal_packs',
                             'direction', 'debit',  'amount_paise', v_breakage),
          jsonb_build_object('account', 'platform:revenue:breakage',
                             'direction', 'credit', 'amount_paise', v_breakage)
        ),
        now(), v_pack.correlation_id, null, null,
        'pack-expire:' || v_pack.id::text
      );
    end if;

    insert into meal_pack_expiry (meal_pack_id, breakage_paise, items_forfeit, valued_forfeit)
    values (v_pack.id, v_breakage,
            v_pack.valued_remaining + v_pack.bonus_remaining, v_pack.valued_remaining)
    on conflict (meal_pack_id) do nothing;

    update meal_pack
       set valued_remaining = 0, bonus_remaining = 0, items_reserved = 0, status = 'expired'
     where id = v_pack.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =============================================================================
-- 8. The invariant. One equality, checkable at any instant.
--
-- False the moment a valued item is counted twice, lost, or recognised without being spent. It
-- runs after every path in the pgTAP suite and nightly beside assert_ledger_integrity().
-- =============================================================================

create or replace function check_meal_pack_ledger_invariant()
returns table (check_name text, failures bigint, detail text)
language sql
stable
as $$
  with owed as (
    select coalesce(sum(meal_pack_deferred_paise(mp)), 0) as packs_owe
      from meal_pack mp
     where mp.status in ('active', 'exhausted')
  ),
  booked as (
    select ledger_balance((select id from ledger_account
                            where code = 'platform:deferred_revenue:meal_packs')) as ledger_owes
  )
  select 'meal_pack_deferred_revenue',
         case when o.packs_owe = b.ledger_owes then 0 else 1 end::bigint,
         format('packs owe %s paise, ledger owes %s paise', o.packs_owe, b.ledger_owes)
    from owed o, booked b;
$$;

comment on function check_meal_pack_ledger_invariant is
  'At any instant, the deferred-revenue account equals the sum over live packs of '
  'round(price_paid_paise * valued_remaining / items_original). Bonus items are absent from both '
  'sides by construction, which is what makes the giveaway free in the books as well as to the '
  'parent.';

-- =============================================================================
-- 9. `assert_order_group_totals` learns the new column names.
--
-- Its meal-pack branch read `meal_pack.net_price_paise` and `meal_pack.tax_total_paise`, which
-- `0085` renamed to `price_paid_paise` and split into `cgst_paise` + `sgst_paise`. Left alone it
-- raises `column does not exist` on every pack purchase — and, because the trigger is DEFERRED to
-- COMMIT, it does so at the end of the transaction rather than at the statement, which makes it
-- read like a mystery rather than a rename.
--
-- Everything else in the function is byte-identical to what is live. The `food` branch in
-- particular is untouched: it is the rule that has held since `0001` and nothing about packs is a
-- reason to relax it.
-- =============================================================================

create or replace function assert_order_group_totals(p_group_id uuid)
returns void
language plpgsql
as $$
declare
  g order_group%rowtype;
  s record;
  p record;
  v_order_count int;
begin
  select * into g from order_group where id = p_group_id;
  if not found then
    return;   -- the group was deleted in this same transaction; nothing to assert
  end if;

  if g.kind = 'meal_pack_purchase' then
    select count(*) into v_order_count from "order" o where o.order_group_id = p_group_id;
    if v_order_count <> 0 then
      raise exception
        'order_group % is a meal pack purchase and must have no member orders, but has %',
        p_group_id, v_order_count
        using errcode = 'check_violation';
    end if;

    select price_paid_paise as net_price_paise,
           cgst_paise + sgst_paise as tax_total_paise
      into p
      from meal_pack where order_group_id = p_group_id;

    if not found then
      -- The pack is written in the same transaction as the group, and this trigger is DEFERRED to
      -- COMMIT, so by the time it runs the pack must exist. A group calling itself a pack purchase
      -- with no pack is a half-written purchase, which is worse than either whole state.
      raise exception
        'order_group % is a meal pack purchase but no meal_pack references it', p_group_id
        using errcode = 'check_violation';
    end if;

    if g.subtotal_paise <> p.net_price_paise
       or g.tax_total_paise <> p.tax_total_paise
       or g.discount_paise <> 0 then
      raise exception
        'order_group % totals do not match its pack: group (subtotal %, tax %, discount %) vs pack (net %, tax %)',
        p_group_id, g.subtotal_paise, g.tax_total_paise, g.discount_paise,
        p.net_price_paise, p.tax_total_paise
        using errcode = 'check_violation';
    end if;

    return;
  end if;

  -- `food`: unchanged, deliberately. This is the rule that has held since 0001 and nothing about
  -- packs is a reason to relax it. Note it does NOT include pack_applied_paise: that column is
  -- the group's alone, because a pack pays for part of a cart without being part of any order.
  select coalesce(sum(o.subtotal_paise), 0)                                       as subtotal,
         coalesce(sum(o.tax_cgst_paise + o.tax_sgst_paise + o.tax_igst_paise), 0) as tax,
         coalesce(sum(o.discount_paise), 0)                                       as discount
    into s
    from "order" o
   where o.order_group_id = p_group_id;

  if g.subtotal_paise <> s.subtotal
     or g.tax_total_paise <> s.tax
     or g.discount_paise <> s.discount then
    raise exception
      'order_group % totals do not match its orders: group (subtotal %, tax %, discount %) vs orders (subtotal %, tax %, discount %)',
      p_group_id, g.subtotal_paise, g.tax_total_paise, g.discount_paise, s.subtotal, s.tax, s.discount
      using errcode = 'check_violation';
  end if;
end;
$$;

commit;
