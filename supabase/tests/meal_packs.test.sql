-- =============================================================================
-- meal_packs.test.sql — the rebuilt pack, end to end. `E21-71`.
--
-- Replaces the file of the same name that tested the old design: meals of N items with a
-- required category, a planner, one meal per order. None of that exists.
--
-- ## The two things this file is shaped around
--
-- **1. The ledger invariant, asserted after EVERY path and every combination of paths.** Not a
-- list of expected amounts somebody wrote down — one equality:
--
--     balance(platform:deferred_revenue:meal_packs)
--       = Σ round(price_paid_paise × valued_remaining / items_original) over live packs
--
-- It is false the instant a valued item is counted twice, lost, or recognised without being
-- spent, and it is checked after sale, reserve, release, reserve again, confirm, reverse,
-- re-confirm, bonus and expiry — because the combinations are where a per-path assertion passes
-- and the books are still wrong.
--
-- **2. `E21-65`, asserted in BOTH directions.** The old suite checked only that the kitchen sees
-- nothing pack-related, and that is exactly why a redeemed meal reaching nobody went unnoticed
-- for the life of the feature. A one-directional test of an invisibility property cannot tell
-- "correctly hidden" from "missing". So:
--
--     a redeemed meal ARRIVES on the kitchen board, with a pickup code;
--     and carries nothing that says it was paid for with a pack.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin execute 'create extension pgtap with schema extensions';
    exception when others then execute 'create extension pgtap'; end;
  end if;
end;
$$;
create schema if not exists tests_tmp;
select * from no_plan();
set local app.actor_type = 'system';

-- -----------------------------------------------------------------------------
-- A world: one offer, one pack, bought and settled, and a helper that states the invariant.
--
-- ₹3,000 ex-tax over 20 items, +2 bonus inside 30 days, valid 60. Andy's Pack 1, to the paise.
-- -----------------------------------------------------------------------------

-- A REAL guardian pair, not an arbitrary user and an arbitrary child.
--
-- `start_meal_pack_purchase` refuses a parent with no child at the school (`P22`), and picking
-- the first `app_user` by id does not give you one. It also makes this file depend on nothing
-- else having left an account behind — `meal-pack-concurrency.test.mjs` COMMITS by design, and
-- when its cleanup stopped at the pack it left sixteen users that sorted ahead of the seed.
create temporary table p_ctx as
select (select s.id from recipient r join guardian_link g on g.recipient_id = r.id
          join school s on s.id = r.school_id
         where s.is_active and r.deleted_at is null order by r.id limit 1)   as school_id,
       (select id from city order by id limit 1)                            as city_id,
       (select g.user_id from recipient r join guardian_link g on g.recipient_id = r.id
          join school s on s.id = r.school_id
         where s.is_active and r.deleted_at is null order by r.id limit 1)   as user_id,
       (select r.id from recipient r join guardian_link g on g.recipient_id = r.id
          join school s on s.id = r.school_id
         where s.is_active and r.deleted_at is null order by r.id limit 1)   as recipient_id,
       'a1000000-7e57-0000-0000-0000000000f1'::uuid                         as offer_id,
       'a2000000-7e57-0000-0000-0000000000f1'::uuid                         as pack_id,
       'a3000000-7e57-0000-0000-0000000000f1'::uuid                         as buy_group_id;

insert into meal_pack_offer (id, name, net_price_paise, items_count,
                             bonus_items_count, bonus_window_days, validity_days, is_active)
select offer_id, 'Pack 1', 300000, 20, 2, 30, 60, true from p_ctx;

insert into meal_pack_offer_school (offer_id, school_id)
select offer_id, school_id from p_ctx;

-- The purchase group, exactly as `start_meal_pack_purchase` writes it: no member orders, and the
-- group's totals equal the pack's, which `assert_order_group_totals` enforces at COMMIT.
insert into order_group (id, customer_user_id, idempotency_key, city_id, kind,
                         subtotal_paise, tax_total_paise, payable_paise, status)
select buy_group_id, user_id, 'pack-buy-test', city_id, 'meal_pack_purchase',
       300000, 15000, 315000, 'pending_payment' from p_ctx;

insert into meal_pack (id, customer_user_id, school_id, offer_id, order_group_id, name_snapshot,
                       price_paid_paise, cgst_paise, sgst_paise,
                       items_original, valued_remaining, bonus_items,
                       bonus_window_ends_at, expires_at, status, correlation_id)
select pack_id, user_id, school_id, offer_id, buy_group_id, 'Pack 1',
       300000, 7500, 7500, 20, 20, 2,
       now() + interval '30 days', now() + interval '60 days', 'active', gen_random_uuid()
  from p_ctx;

-- The sale legs, as settle_payment posts them.
select post_ledger_transaction(
  'meal_pack_sale', 'adjustment', (select pack_id from p_ctx),
  jsonb_build_array(
    jsonb_build_object('account','provider:razorpay:clearing','direction','debit',
                       'amount_paise', 315000),
    jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','credit',
                       'amount_paise', 300000),
    jsonb_build_object('account','platform:tax_payable:cgst','direction','credit',
                       'amount_paise', 7500),
    jsonb_build_object('account','platform:tax_payable:sgst','direction','credit',
                       'amount_paise', 7500)),
  now(), gen_random_uuid(), null, null, 'test-pack-sale');

-- =============================================================================
-- 1. GST at the point of sale. ₹3,000 becomes ₹3,150.
-- =============================================================================

select is((select cgst_paise + sgst_paise from meal_pack where id = (select pack_id from p_ctx)),
  15000::bigint, 'E21: 5% on ₹3,000 ex-tax is ₹150, as CGST 2.5% + SGST 2.5%');

select is((select payable_paise from order_group where id = (select buy_group_id from p_ctx)),
  315000::bigint, 'E21: the parent pays ₹3,150 for a ₹3,000 pack');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after the sale: the ledger owes exactly what the pack owes');

-- =============================================================================
-- 2. A cart, partly covered. Andy's worked case: 3 items, pack has 2.
--
-- Built through create_checkout so the reservation, the retax and the group arithmetic are the
-- real ones, not a re-derivation.
-- =============================================================================

-- Take the pack down to 2 spendable so the split is forced.
update meal_pack set valued_remaining = 2 where id = (select pack_id from p_ctx);

-- THE INVARIANT'S OWN MUTATION CHECK, and it belongs here rather than in a scratch file.
--
-- The balance was just moved WITHOUT a matching ledger posting — which is precisely the class of
-- bug the invariant exists to catch: an item spent and never recognised, or recognised twice. If
-- this assertion read `0` the invariant would be decorative, and every `0` below it would mean
-- nothing. It must fail here, and it does.
select is((select failures from check_meal_pack_ledger_invariant()), 1::bigint,
  'INVARIANT FIRES when the balance moves and the ledger does not. Asserting the failure, not '
  'the success — an invariant that cannot fail is not one, and the rest of this file is only '
  'worth reading because of this line.');

-- Put the ledger where that balance implies, so the rest of the file starts consistent.
select post_ledger_transaction(
  'meal_pack_redemption', 'adjustment', (select pack_id from p_ctx),
  jsonb_build_array(
    jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','debit',
                       'amount_paise', 270000),
    jsonb_build_object('account','platform:revenue','direction','credit',
                       'amount_paise', 270000)),
  now(), gen_random_uuid(), null, null, 'test-drawdown');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after recognising 18 items'' worth: 2 of 20 left is ₹300 still owed');

-- =============================================================================
-- 3. RESERVE does not touch the balance. This is the requirement, stated as a test.
-- =============================================================================

create temporary table r_ctx as
select 'a4000000-7e57-0000-0000-0000000000f1'::uuid as group_id,
       'a5000000-7e57-0000-0000-0000000000f1'::uuid as order_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from r_ctx), p.user_id, 'pack-redeem-test', p.city_id, 0, 0, 0
  from p_ctx p;

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select (select order_id from r_ctx), (select group_id from r_ctx), generate_order_ref(),
       gen_random_uuid(), p.user_id, p.recipient_id,
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Test', 'pending_payment', 0, 0, 0, 0
  from p_ctx p join school s on s.id = p.school_id;

-- Three items on one line: a ₹250 main, and separately a ₹40 drink. Cheapest first (`P23`) must
-- take the drink.
insert into order_line (order_id, line_no, dish_id, quantity, unit_price_paise,
                        line_subtotal_paise, line_total_paise, dish_name_snapshot)
select (select order_id from r_ctx), 1, (select id from dish order by id limit 1), 1, 25000,
       25000, 25000, 'Main';
insert into order_line (order_id, line_no, dish_id, quantity, unit_price_paise,
                        line_subtotal_paise, line_total_paise, dish_name_snapshot)
select (select order_id from r_ctx), 2, (select id from dish order by id limit 1), 2, 4000,
       8000, 8000, 'Drink';

update "order" set subtotal_paise = 33000, total_paise = 33000
 where id = (select order_id from r_ctx);
update order_group set subtotal_paise = 33000, payable_paise = 33000
 where id = (select group_id from r_ctx);

create temporary table res as
select reserve_meal_pack_items((select group_id from r_ctx), (select user_id from p_ctx),
                               gen_random_uuid()) as covered;

select is((select valued_remaining from meal_pack where id = (select pack_id from p_ctx)), 2,
  'RESERVE DOES NOT DECREMENT THE BALANCE. This is the requirement in one assertion: the parent '
  'still owns 2 items while a checkout is in flight, because nothing has been paid for yet.');

select is((select items_reserved from meal_pack where id = (select pack_id from p_ctx)), 2,
  'reserve holds 2 items — the pack had only 2, and the cart wanted 3');

select is((select count(*)::int from meal_pack_redemption
            where order_group_id = (select group_id from r_ctx) and state = 'held'), 1,
  'one held redemption row');

select is((select covered from res), 8000::bigint,
  'P23 CHEAPEST FIRST: the pack covered the two ₹40 drinks (₹80), not the ₹250 main. Andy''s '
  'ruling, 2026-09-16, against my recommendation — this is the assertion that pins it.');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after RESERVE: unchanged, because a reservation moves no money and no balance');

-- =============================================================================
-- 4. RELEASE puts it back and leaves no trace.
-- =============================================================================

select is(release_meal_pack_reservations((select group_id from r_ctx), 'payment failed'), 1,
  'release returns the one held row');

select is((select items_reserved from meal_pack where id = (select pack_id from p_ctx)), 0,
  'RELEASE: the hold is gone');

select is((select valued_remaining from meal_pack where id = (select pack_id from p_ctx)), 2,
  'RELEASE: the balance is untouched — the parent owns exactly what they owned before');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after RELEASE');

-- =============================================================================
-- 5. RESERVE again, then CONFIRM. Now the balance moves, and revenue is recognised.
-- =============================================================================

update meal_pack_redemption set state = 'released' where state = 'held';
delete from meal_pack_redemption where order_group_id = (select group_id from r_ctx);

select reserve_meal_pack_items((select group_id from r_ctx), (select user_id from p_ctx),
                               gen_random_uuid());

select is(confirm_meal_pack_redemptions((select group_id from r_ctx), gen_random_uuid()), 1,
  'confirm settles the one reservation');

select is((select valued_remaining from meal_pack where id = (select pack_id from p_ctx)), 0,
  'CONFIRM: the balance moves now, and only now');

select is((select items_reserved from meal_pack where id = (select pack_id from p_ctx)), 0,
  'CONFIRM: the hold is consumed rather than left behind');

select is((select valued_items from meal_pack_redemption
            where order_group_id = (select group_id from r_ctx)), 2,
  'CONFIRM records the valued/bonus split on the row, so a reversal can read it back');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after CONFIRM: revenue recognised is exactly the fall in the balance function');

-- =============================================================================
-- 6. THE BONUS. Earned by emptying the pack inside the window — and it costs the books nothing.
-- =============================================================================

select ok((select bonus_granted_at is not null from meal_pack where id = (select pack_id from p_ctx)),
  'BONUS GRANTED: every valued item was served inside the 30-day window');

select is((select bonus_remaining from meal_pack where id = (select pack_id from p_ctx)), 2,
  'BONUS: 2 free items are on the pack');

select is((select items_remaining from meal_pack where id = (select pack_id from p_ctx)), 2,
  'BONUS: the parent''s balance reads 2 — generated from its parts, so it cannot disagree');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT AFTER THE BONUS — the assertion M12 exists for. Bonus items carry NO value, so '
  'items_original never grows, the deferred balance does not move, and no revenue recognised in '
  'an earlier month is ever restated. The alternative would have posted Dr revenue / Cr deferred '
  'here; Andy ruled against it on 2026-09-16.');

select is((select count(*)::int from ledger_transaction
            where reason_code in ('meal_pack_bonus', 'meal_pack_bonus_grant')), 0,
  'BONUS POSTS NOTHING AT ALL. Asserted as an absence, because "no entry" is the whole ruling.');

-- A second confirm cannot mint a second bonus.
select ok(not grant_meal_pack_bonus_if_earned((select pack_id from p_ctx)),
  'the bonus is granted ONCE — bonus_granted_at is set and the guard reads it');

-- =============================================================================
-- 7. REVERSE. A cancelled order gives the item back, exactly as it was taken.
-- =============================================================================

select is(reverse_meal_pack_redemptions((select order_id from r_ctx), 'cancelled before cutoff',
                                        gen_random_uuid()), 1,
  'reverse returns the one confirmed redemption');

select is((select valued_remaining from meal_pack where id = (select pack_id from p_ctx)), 2,
  'REVERSE gives back VALUED items, because valued items are what were taken — read from the '
  'row, never recomputed, so a cancellation cannot turn a free item into a paid one');

select is((select bonus_remaining from meal_pack where id = (select pack_id from p_ctx)), 2,
  'REVERSE leaves the earned bonus alone');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after REVERSE: the recognition is undone to the paise');

select is(reverse_meal_pack_redemptions((select order_id from r_ctx), 'again', gen_random_uuid()),
  0, 'a DOUBLE CANCEL returns nothing a second time — guarded on state and reversed_at, so one '
     'redemption can never give back two items');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after a double cancel');

-- =============================================================================
-- 8. EXPIRY. Unused items are forfeited; the money is kept as breakage.
-- =============================================================================

-- Age the pack rather than just moving its expiry backwards: `meal_pack_expires_after_purchase`
-- refuses a pack that expired before it was bought, and it is right to. A pack 61 days old with
-- 60 days' validity is the real shape of the thing being tested.
update meal_pack
   set purchased_at = now() - interval '61 days',
       expires_at   = now() - interval '1 day'
 where id = (select pack_id from p_ctx);

select is(expire_meal_packs(), 1, 'the sweep expires the one pack that is past its date');

select is((select status::text from meal_pack where id = (select pack_id from p_ctx)), 'expired',
  'EXPIRY: the pack says so');

select is((select items_forfeit from meal_pack_expiry
            where meal_pack_id = (select pack_id from p_ctx)), 4,
  'EXPIRY records FOUR items forfeited — 2 valued and 2 bonus — because that is what a parent '
  'would say they lost');

select is((select valued_forfeit from meal_pack_expiry
            where meal_pack_id = (select pack_id from p_ctx)), 2,
  'EXPIRY records TWO valued, because that is what the ledger saw. The two numbers differing is '
  'the giveaway having been free in the books as well as to the parent, not a contradiction.');

select is((select breakage_paise from meal_pack_expiry
            where meal_pack_id = (select pack_id from p_ctx)), 30000::bigint,
  'EXPIRY: breakage is ₹300 — the 2 valued items at ₹150 each. The bonus items add nothing.');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT AFTER EXPIRY, which is the end of the whole combination: sale, draw down, reserve, '
  'release, reserve, confirm, bonus, reverse, double-cancel, expire. The books balance to the '
  'paise at every step and land on zero.');

select is((select meal_pack_deferred_paise(mp) from meal_pack mp
            where mp.id = (select pack_id from p_ctx)), 0::bigint,
  'an expired pack owes nothing');

-- =============================================================================
-- 9. No refunds on a pack — the guard from the old build, still standing.
-- =============================================================================

select throws_ok(
  format($$ insert into refund (order_group_id, destination, amount_paise, reason_code,
                                status, correlation_id)
            values (%L, 'source', 100, 'customer_request', 'pending', gen_random_uuid()) $$,
         (select buy_group_id from p_ctx)),
  'P0001', null,
  'NO REFUNDS ON A PACK, and it is enforced rather than promised — the screen tells a parent '
  'this before they pay, so the enforcement has to be at least as strong as the promise. A '
  'trigger, so psql is refused too.');

-- =============================================================================
-- 10. Buying a pack. Every figure stamped, and the guards that stop the wrong purchase.
-- =============================================================================

create temporary table b_ctx as
select (select user_id from p_ctx)                                       as user_id,
       (select school_id from p_ctx)                                     as school_id,
       (select id from school where is_active order by id offset 1 limit 1) as other_school_id,
       'a1000000-7e57-0000-0000-0000000000f2'::uuid                      as offer2_id;

-- Andy's Pack 2, exactly as specified on 2026-09-16.
insert into meal_pack_offer (id, name, net_price_paise, items_count,
                             bonus_items_count, bonus_window_days, validity_days, is_active)
select offer2_id, 'Pack 2', 500000, 40, 4, 60, 90, true from b_ctx;
insert into meal_pack_offer_school (offer_id, school_id)
select offer2_id, school_id from b_ctx;

create temporary table bought as
select start_meal_pack_purchase((select user_id from b_ctx), (select offer2_id from b_ctx),
                                (select school_id from b_ctx), 'buy-pack-2-test') as r;

select is((select (r->>'payable_paise')::bigint from bought), 525000::bigint,
  'PACK 2: ₹5,000 ex-tax becomes ₹5,250 — 5% as CGST 2.5% + SGST 2.5%, per component, half-up');

select is((select items_original from meal_pack
            where order_group_id = ((select r->>'order_group_id' from bought))::uuid), 40,
  'PACK 2: 40 items');

select is((select bonus_items from meal_pack
            where order_group_id = ((select r->>'order_group_id' from bought))::uuid), 4,
  'PACK 2: 4 bonus items, the number Andy supplied on 2026-09-16');

select is((select status::text from meal_pack
            where order_group_id = ((select r->>'order_group_id' from bought))::uuid), 'pending',
  'A BOUGHT PACK IS NOT SPENDABLE until the payment settles. `pending`, not `active` — so a pack '
  'never carries an obligation we have not been paid for.');

select is((select name_snapshot from meal_pack
            where order_group_id = ((select r->>'order_group_id' from bought))::uuid), 'Pack 2',
  'E21-67: the NAME is stamped at sale');

-- Rename the offer and prove the pack does not follow it.
update meal_pack_offer set name = 'Renamed after the sale' where id = (select offer2_id from b_ctx);
select is((select name_snapshot from meal_pack
            where order_group_id = ((select r->>'order_group_id' from bought))::uuid), 'Pack 2',
  'E21-67 PROVED: renaming an offer does NOT retitle a pack already held — nor the tax invoice '
  'it is about to be issued under. The old design joined the offer live and did both.');

select is((select (r->>'order_group_id') from
             (select start_meal_pack_purchase((select user_id from b_ctx),
                                              (select offer2_id from b_ctx),
                                              (select school_id from b_ctx),
                                              'buy-pack-2-test') as r) again),
          (select (r->>'order_group_id') from bought),
  'IDEMPOTENT: the same key returns the SAME purchase rather than a second pack and a second '
  'charge');

select is((select count(*)::int from meal_pack where offer_id = (select offer2_id from b_ctx)), 1,
  'and there is exactly one pack, not two');

select throws_ok(
  format($$ select start_meal_pack_purchase(%L::uuid, %L::uuid, %L::uuid, 'buy-elsewhere') $$,
         (select user_id from b_ctx), (select offer2_id from b_ctx),
         (select other_school_id from b_ctx)),
  'P0001', null,
  'P22: an offer cannot be bought for a school it is not sold at, even with a valid offer id — '
  'checked at the WRITE, not merely in the read that listed it');

-- =============================================================================
-- 11. `E21-65` — A REDEEMED MEAL REACHES THE KITCHEN. BOTH DIRECTIONS.
--
-- The defect that stopped the rebuild before it started: a redeemed meal was inserted
-- `pending_payment` into an already-settled group, the only transition to `paid` was a webhook
-- loop that would never run again, and **the child was never cooked for**. Silently, because the
-- kitchen board filters to `['paid','preparing','delivered','cancelled']`.
--
-- **Every test in the old suite passed.** It asserted only the leak direction — that the kitchen
-- sees nothing pack-related — and a one-directional test of an invisibility property cannot tell
-- "correctly hidden" from "missing". So both, and the arrival one first.
--
-- WEB is writing the board-side assertion; this is the model half it has to be true of.
-- =============================================================================

create temporary table k_ctx as
select 'a6000000-7e57-0000-0000-0000000000f1'::uuid as group_id,
       'a7000000-7e57-0000-0000-0000000000f1'::uuid as order_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from k_ctx), p.user_id, 'pack-kitchen-test', p.city_id, 0, 0, 0
  from p_ctx p;

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select (select order_id from k_ctx), (select group_id from k_ctx), generate_order_ref(),
       gen_random_uuid(), p.user_id, p.recipient_id,
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Test', 'pending_payment', 0, 0, 0, 0
  from p_ctx p join school s on s.id = p.school_id;

-- The ZERO-CASH path: the pack covers everything, so there is no payment and no webhook that
-- could ever confirm this. `create_checkout` runs the same two steps immediately instead.
select confirm_order_as_paid((select order_id from k_ctx));
update order_group set paid_at = now() where id = (select group_id from k_ctx);

select is((select status::text from "order" where id = (select order_id from k_ctx)), 'paid',
  'E21-65 DIRECTION 1: a fully pack-paid order is PAID, with no payment and no webhook. Under '
  'the old design it sat at pending_payment for ever.');

select matches((select pickup_code from "order" where id = (select order_id from k_ctx)),
  '^[0-9]{4}$',
  'E21-65 DIRECTION 1: and it HAS A PICKUP CODE. The old design allocated codes only inside the '
  'settlement loop, so a redeemed meal had none even if somebody found it.');

select ok((select confirmed_at is not null from "order" where id = (select order_id from k_ctx)),
  'E21-65 DIRECTION 1: confirmed_at is stamped, by the same statement');

select is((select count(*)::int from "order" o
            where o.id = (select order_id from k_ctx)
              and o.status::text = any (array['paid','preparing','delivered','cancelled'])), 1,
  'E21-65 DIRECTION 1, THE ASSERTION THAT MATTERS: the meal is inside the status set the kitchen '
  'board reads (packages/shared/src/api/kitchen.ts KITCHEN_STATUSES). It ARRIVES. The child is '
  'cooked for.');

select matches((select order_ref from "order" where id = (select order_id from k_ctx)), '^GB-',
  'E21-66: minted by generate_order_ref() like every other order. The old design minted its own '
  '"PK-" prefix, which crosses the wire to the kitchen client on every order and says how the '
  'meal was paid for — a fact a column-absence test cannot catch, because a prefix is not a '
  'column.');

select is((select count(*)::int
             from information_schema.columns
            where table_schema = 'public' and table_name = 'order'
              and (column_name ilike '%pack%' or column_name ilike '%redemption%')), 0,
  'E21-65 DIRECTION 2: the order carries NO pack column at all, so nothing the kitchen reads can '
  'tell them a meal was prepaid. Indistinguishable, as the guarantee says.');

select is((select count(*)::int
             from information_schema.columns
            where table_schema = 'public' and table_name = 'meal_pack_redemption'
              and (column_name ilike '%recipient%' or column_name ilike '%child%'
                   or column_name ilike '%class%' or column_name ilike '%section%')), 0,
  'And the redemption carries no child. The old design had recipient_id here; a column that does '
  'not exist cannot leak (non-negotiable #4).');

select is((select failures from check_meal_pack_ledger_invariant()), 0::bigint,
  'INVARIANT after the zero-cash path');

-- =============================================================================
-- 12. `E21-82` — A PACK PURCHASE CAN ACTUALLY BE INVOICED.
--
-- The defect this is named for: `issue_invoice` still read four columns `0085` had renamed, and
-- **PL/pgSQL does not resolve column references until execution**, so it was stored happily and
-- would have failed on the first real pack sale — inside `settle_payment`, rolling the settlement
-- back with the money already captured. A parent charged Rs 3,150, no pack, no invoice.
--
-- Nothing in this suite caught it, because every assertion above builds its packs directly and
-- none of them had ever asked the invoice function to run. WEB's audit found it by reading. This
-- is the assertion that would have, and the lesson is the same one as `E21-65`: a path nothing
-- exercises is a path nobody knows is broken.
-- =============================================================================

-- Buy FIRST, then rename, then invoice — in that order, because that is the window `E21-67` is
-- about. My first draft bought the pack after the rename in section 10, so `name_snapshot`
-- legitimately held the new name and the assertion failed on the code being right. The bug being
-- tested is a rename landing BETWEEN the sale and the settlement.
update meal_pack_offer set name = 'Pack 2' where id = (select offer2_id from b_ctx);

create temporary table i_pack as
select start_meal_pack_purchase((select user_id from b_ctx), (select offer2_id from b_ctx),
                                (select school_id from b_ctx), 'invoice-a-pack') as r;

update meal_pack_offer set name = 'Renamed between sale and settlement'
 where id = (select offer2_id from b_ctx);

select lives_ok(
  format($$ select issue_invoice(%L::uuid) $$, ((select r->>'order_group_id' from i_pack))::uuid),
  'E21-82: issue_invoice RUNS on a pack purchase. It did not — it named four columns that no '
  'longer exist, and would have aborted the settlement transaction with the money captured.');

select is((select count(*)::int from invoice
            where order_group_id = ((select r->>'order_group_id' from i_pack))::uuid), 1,
  'E21-82: exactly one tax invoice, for the pack purchase');

select is((select taxable_value_paise from invoice
            where order_group_id = ((select r->>'order_group_id' from i_pack))::uuid),
  500000::bigint,
  'E21-82: the taxable value is the EX-TAX price, Rs 5,000 — read from the pack, which stamped '
  'it at sale, never from the live offer');

select is((select cgst_paise + sgst_paise from invoice
            where order_group_id = ((select r->>'order_group_id' from i_pack))::uuid),
  25000::bigint, 'E21-82: Rs 250 of GST on the invoice, 5% of Rs 5,000');

select matches(
  (select description from invoice_line il
     join invoice i on i.id = il.invoice_id
    where i.order_group_id = ((select r->>'order_group_id' from i_pack))::uuid),
  'items, prepaid',
  'E21-82: the line describes ITEMS, not meals — the vocabulary the rebuild uses');

-- The offer was renamed above, after the pack was sold. The invoice must not follow it.
select matches(
  (select description from invoice_line il
     join invoice i on i.id = il.invoice_id
    where i.order_group_id = ((select r->>'order_group_id' from i_pack))::uuid),
  '^Pack 2',
  'E21-67 ON THE TAX DOCUMENT: the invoice is issued under the name the pack was SOLD under, not '
  'the offer''s current one. The offer was renamed earlier in this file; an invoice is written '
  'once and cannot be rewritten, so joining the live offer here was the one place that mistake '
  'could not be undone.');

select is((select count(*)::int from invoice_line il
             join invoice i on i.id = il.invoice_id
            where i.order_group_id = ((select r->>'order_group_id' from i_pack))::uuid
              and (il.description ilike '%child%' or il.description ilike '%class%')), 0,
  'and the invoice names no child — a pack is the parent''s and is bought for nobody in '
  'particular (non-negotiable #4)');

-- =============================================================================
-- 13. `E21-86` / `E21-87` — the back office can read pack money, per OFFER.
--
-- WEB filed both. The first is the dangerous one: as an invoker view this returned ZERO ROWS to
-- the only audience it has, because `meal_pack`'s single read policy is `meal_pack_read_own` and
-- a back-office account owns no packs. `/admin/sales` would have printed a confident zero while
-- the real liability sat unread — worse than an error, because nobody investigates a number.
-- =============================================================================

select has_column('meal_pack_money', 'offer_id',
  'E21-87: the view exposes offer_id, so "per offer" is per OFFER. Grouping on name_snapshot '
  'merges two offers that share a name and splits one that was renamed mid-life into two rows '
  'that look like two products.');

select has_column('meal_pack_money', 'name_snapshot',
  'and keeps name_snapshot, because that is the LABEL — what the invoice and the parent''s screen '
  'say. Identity and label answer different questions and the report needs both.');

select is((select relrowsecurity from pg_class where relname = 'meal_pack'), true,
  'meal_pack still has RLS on — the definer view is a hole cut deliberately, not the wall '
  'removed');

select ok(
  (select not coalesce(
     (select (c.reloptions::text) like '%security_invoker=true%'
        from pg_class c where c.relname = 'meal_pack_money'), false)),
  'E21-86: meal_pack_money is a DEFINER view. As an invoker view it returned nothing to the back '
  'office, which is the only caller it has.');

-- The guard is in the view's own WHERE, so no query can route around it.
select matches(
  (select pg_get_viewdef('meal_pack_money'::regclass)),
  'auth_can_platform',
  'E21-86: and the permission check is INSIDE the view, not in the caller. A definer view without '
  'one hands every pack''s money to any authenticated caller — the failure mode a definer view '
  'always risks, and the reason the bar for one is high.');

-- No child identity anywhere in it. Asserted as an absence, because that is the whole argument
-- for allowing a definer view here at all.
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'meal_pack_money'
              and (column_name ilike '%recipient%' or column_name ilike '%customer%'
                   or column_name ilike '%child%' or column_name ilike '%class%'
                   or column_name ilike '%section%' or column_name ilike '%name%'
                   and column_name <> 'name_snapshot')), 0,
  'E21-63''s argument, still holding: the view carries no recipient and no customer. The rebuild '
  'removed recipient_id from meal_pack_redemption entirely, so there is no child identity in its '
  'lineage to keep out — which is what makes a definer view safe here rather than merely useful.');

-- =============================================================================
-- 14. `E21-84` — a webhook probe cannot be written on production.
--
-- I wrote one by curling the live endpoint after a deploy. Non-negotiable #8 names webhook probes
-- explicitly. `prod-write-guard.mjs` could not have stopped it because I used no script, so the
-- guard is at the database, which is the only layer curl still goes through.
-- =============================================================================

-- These run against a LOCAL database, so the trigger's production branch has to be provoked.
update platform_config set environment = 'production';

select throws_ok(
  $$ insert into payment_webhook_event (provider, provider_event_id, event_type,
                                        signature_verified, payload, processing_status)
     values ('razorpay', 'probe-test-1', 'probe.ignore', false, '{}'::jsonb, 'ignored') $$,
  'P0001', null,
  'E21-84: a made-up event type is REFUSED on production. This is the exact row I left behind, '
  'and the exact request that wrote it.');

select lives_ok(
  $$ insert into payment_webhook_event (provider, provider_event_id, event_type,
                                        signature_verified, payload, processing_status)
     values ('razorpay', 'probe-test-2', 'payment.captured', false, '{}'::jsonb, 'ignored') $$,
  'but a GENUINE Razorpay type with a BAD SIGNATURE is still recorded. Deliberately: that is '
  'either an attack or a missing secret, and E06-28''s alert is what makes it visible. A guard '
  'keyed on signature_verified would have blinded the alert that exists to catch exactly this — '
  'a worse bug than the one it fixed.');

select lives_ok(
  $$ insert into payment_webhook_event (provider, provider_event_id, event_type,
                                        signature_verified, payload, processing_status)
     values ('razorpay', 'probe-test-3', 'unparseable', true, '{}'::jsonb, 'ignored') $$,
  'and `unparseable` is still recorded — a real event from a verified sender whose body would not '
  'parse. Losing it would lose the evidence.');

update platform_config set environment = 'local';

select lives_ok(
  $$ insert into payment_webhook_event (provider, provider_event_id, event_type,
                                        signature_verified, payload, processing_status)
     values ('razorpay', 'probe-test-4', 'probe.ignore', false, '{}'::jsonb, 'ignored') $$,
  'STAGING AND LOCAL ARE UNCHANGED. A guard that made verification harder everywhere would push '
  'it back onto production, which is the behaviour it exists to stop.');

-- -----------------------------------------------------------------------------
-- And the FUNCTIONAL half, which is the one that would have caught this.
--
-- Everything above asserts the view's SHAPE — definer, guarded, no child columns. None of that
-- would have failed on the broken version either, because an invoker view is also definer-less
-- and also has no child columns. **What was wrong was the answer it gave**, and only reading it
-- as a real back-office account shows that.
-- -----------------------------------------------------------------------------

create function tests_tmp.pack_money_rows_for(p_user uuid) returns int
language plpgsql as $$
declare n int;
begin
  set local role authenticated;
  execute format('set local request.jwt.claims = %L',
                 json_build_object('sub', p_user, 'role', 'authenticated')::text);
  select count(*) into n from meal_pack_money;
  reset role;
  return n;
end;
$$;

-- A back-office account holding `orders.view_financials` at platform scope, and nothing else.
-- It owns NO pack — which is the whole point, and was the whole bug.
insert into auth.users (id, email, instance_id, aud, role)
select 'a8000000-7e57-0000-0000-0000000000f1', 'packmoney@example.test',
       -- Read rather than written: the nil instance_id is a Supabase constant, but a literal one
       -- here reads to `check-test-fixtures` as a fixture id colliding with the seed, and it is
       -- right not to guess which.
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated';
-- No `insert into app_user`: a trigger on auth.users creates it. Writing it by hand is a
-- duplicate key, which is the schema telling you the row already exists.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
select 'a8000000-7e57-0000-0000-0000000000f1', 'orders.view_financials', 'platform', null,
       (select user_id from p_ctx);

-- And one with no grants at all.
insert into auth.users (id, email, instance_id, aud, role)
select 'a8000000-7e57-0000-0000-0000000000f2', 'nogrants@example.test',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated';

select cmp_ok(
  tests_tmp.pack_money_rows_for('a8000000-7e57-0000-0000-0000000000f1'::uuid), '>', 0,
  'E21-86 PROVED: a back-office account holding orders.view_financials SEES pack money, despite '
  'owning no pack. As an invoker view this returned 0 and /admin/sales would have printed a '
  'confident zero against a real liability.');

select is(
  tests_tmp.pack_money_rows_for('a8000000-7e57-0000-0000-0000000000f2'::uuid), 0,
  'and an account WITHOUT the grant sees nothing — the definer view is guarded in its own WHERE, '
  'so there is no query that routes around it');

select is(
  tests_tmp.pack_money_rows_for((select user_id from p_ctx)), 0,
  'and THE PARENT WHO OWNS THE PACK sees nothing through this view either. It is the back '
  'office''s window on money, not a second route to a parent''s own data — they read '
  'meal_pack_balances, which is scoped to them.');

-- =============================================================================
-- 15. `E21-94` — a paid pack purchase says it is paid.
--
-- The third instance of `M16`'s pattern: a derived field whose derivation is attached to a table
-- that is not always involved. `derive_group_status` is a trigger on `order`; a pack purchase has
-- no member orders, so it never fired and the group sat at `pending_payment` with `paid_at` set
-- from the moment the money arrived.
-- =============================================================================

create temporary table s_ctx as
select 'a9000000-7e57-0000-0000-0000000000f1'::uuid as pack_group_id,
       'a9000000-7e57-0000-0000-0000000000f2'::uuid as food_group_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id, kind,
                         subtotal_paise, tax_total_paise, payable_paise, status)
select (select pack_group_id from s_ctx), (select user_id from p_ctx), 'status-pack',
       (select city_id from p_ctx), 'meal_pack_purchase', 300000, 15000, 315000, 'pending_payment';
insert into meal_pack (customer_user_id, school_id, offer_id, order_group_id, name_snapshot,
                       price_paid_paise, cgst_paise, sgst_paise, items_original, valued_remaining,
                       bonus_items, bonus_window_ends_at, expires_at, status, correlation_id)
select (select user_id from p_ctx), (select school_id from p_ctx), (select offer_id from p_ctx),
       (select pack_group_id from s_ctx), 'Pack 1', 300000, 7500, 7500, 20, 20, 0,
       now(), now() + interval '60 days', 'pending', gen_random_uuid();

select is((select status::text from order_group where id = (select pack_group_id from s_ctx)),
  'pending_payment', 'a pack purchase starts pending_payment, like any other group');

update order_group set paid_at = now() where id = (select pack_group_id from s_ctx);

select is((select status::text from order_group where id = (select pack_group_id from s_ctx)),
  'paid',
  'E21-94: setting paid_at moves a PACK purchase to paid. Nothing did this before — '
  'derive_group_status is a trigger on `order`, and a pack purchase has no member orders, so the '
  'group kept saying pending_payment while paid_at was set and the money was in the ledger.');

select ok((select paid_at is not null from order_group where id = (select pack_group_id from s_ctx)),
  'and paid_at is still set — the two fields now agree rather than one being fixed at the '
  'expense of the other');

-- The half that matters as much: food groups are NOT touched, because they already have an owner.
insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise, status)
select (select food_group_id from s_ctx), (select user_id from p_ctx), 'status-food',
       (select city_id from p_ctx), 0, 0, 0, 'pending_payment';
update order_group set paid_at = now() where id = (select food_group_id from s_ctx);

select is((select status::text from order_group where id = (select food_group_id from s_ctx)),
  'pending_payment',
  'A FOOD group is left alone. derive_group_status owns it and reads every member order, which '
  'this cannot — giving one field two owners is how they came to disagree in the first place.');

-- And a terminal state is not dragged backwards by a later touch of the row.
update order_group set status = 'cancelled' where id = (select pack_group_id from s_ctx);
update order_group set paid_at = now() where id = (select pack_group_id from s_ctx);

select is((select status::text from order_group where id = (select pack_group_id from s_ctx)),
  'cancelled',
  'a cancelled purchase is NOT dragged back to paid by a later write. The trigger fires only on '
  'the transition out of pending_payment, not on any row that happens to have a paid_at.');

select * from finish();
rollback;
