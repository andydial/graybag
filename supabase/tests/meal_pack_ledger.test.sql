-- =============================================================================
-- meal_pack_ledger.test.sql — `E21-46`. The invariant, absolutely.
--
-- Andy: *"Money must not be double-counted. A pack sale is money in; a redemption is food out.
-- Whatever the ledger does, a redeemed meal must never appear as revenue a second time. Show me
-- how the ledger balances across sale, redemption, cancellation and expiry."*
--
-- `meal_packs.test.sql` asserts the **change** in deferred revenue, because its earlier sections
-- conjure packs into the table to test balance mechanics and spend from them directly — so the
-- whole-ledger check correctly reports a mismatch there. That is the check working, and it also
-- means the strongest form of the assertion had no home.
--
-- This file is that home. **Exactly one pack exists, its sale is posted, and every meal leaves it
-- through `confirm_meal_pack_plan`.** So the absolute invariant must hold at every step:
--
--     balance of platform:deferred_revenue:meal_packs
--       == sum over live packs of floor(net_price * meals_remaining / meals_total)
--
-- It is asserted after the sale, after a redemption, after a cancellation and after expiry —
-- because a double-count would show up in exactly one of those and not the others.
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
-- One parent, one pack, one sale posted. Nothing else touches these accounts.
-- -----------------------------------------------------------------------------
insert into auth.users (id) values ('a0000000-7e57-0000-0000-000000000e46');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-000000000e46', 'ledger@example.test', 'Ledger')
on conflict (id) do update set email = excluded.email;

create temporary table lf as
select 'a0000000-7e57-0000-0000-000000000e46'::uuid as parent,
       (select id from school where is_active and onboarded_at is not null order by name limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from dish_category limit 1) as drinks_id;

create temporary table lf_offer as
with ins as (
  insert into meal_pack_offer (name, meals_count, items_per_meal, required_category_id,
                               net_price_paise, alacarte_reference_paise, validity_days, is_active)
  select 'Ledger 10-pack', 10, 2, drinks_id, 300000, 337500, 60, true from lf
  returning id
) select id from ins;

create temporary table lf_pack as
with og as (
  insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise)
  select parent, 'e46-' || gen_random_uuid(), 'paid', city_id, 'meal_pack_purchase',
         300000, 15000, 315000 from lf
  returning id
), pk as (
  insert into meal_pack (customer_user_id, offer_id, order_group_id, meals_total, meals_remaining,
                         net_price_paise, tax_total_paise, cgst_paise, sgst_paise, tax_point,
                         expires_at, correlation_id)
  select parent, (select id from lf_offer), og.id, 10, 10, 300000, 15000, 7500, 7500, 'sale',
         now() + interval '60 days', gen_random_uuid()
    from lf, og
  returning id
) select id from pk;

/**
 * The sale. **Money in, and NOT revenue.**
 *
 * This is the posting that makes the whole design work: ₹3,000 goes to a liability, not to
 * `platform:revenue`. If it went to revenue here, the redemption below would credit revenue a
 * second time for the same food — which is the double-count Andy asked to be made impossible.
 */
select post_ledger_transaction(
  p_reason_code => 'meal_pack_sale',
  p_source_type => 'adjustment',
  p_source_id   => (select id from lf_pack),
  p_entries     => jsonb_build_array(
    jsonb_build_object('account','provider:razorpay:clearing','direction','debit', 'amount_paise',315000),
    jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','credit','amount_paise',300000),
    jsonb_build_object('account','platform:tax_payable:cgst','direction','credit','amount_paise',7500),
    jsonb_build_object('account','platform:tax_payable:sgst','direction','credit','amount_paise',7500)),
  p_memo => 'meal pack sale');

-- =============================================================================
-- 1. After the sale
-- =============================================================================

select is(
  (select ledger_paise from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  300000::bigint,
  'the whole price is a LIABILITY after the sale — not a paisa of revenue yet'
);

select is(
  (select ok from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  true,
  'and the invariant holds: the ledger owes exactly what the pack owes'
);

select is(
  (select ledger_balance(id) from ledger_account where code = 'platform:revenue'),
  0::bigint,
  'REVENUE IS ZERO. Money has been taken and no food has been served'
);

-- =============================================================================
-- 2. After a redemption
-- =============================================================================

create temporary table lf_dish as
with d as (
  insert into dish (kitchen_id, name, category_id, food_type)
  select (select kitchen_id from school where id = (select school_id from lf)),
         'Ledger ' || c.display_name, c.id, 'veg'
    from dish_category c
   where c.id = (select drinks_id from lf)
      or c.id = (select id from dish_category where id <> (select drinks_id from lf) limit 1)
  returning id
) select id from d;

create temporary table lf_kid as
select (create_recipient(
          p_guardian_user_id => (select parent from lf),
          p_first_name => 'Ledger', p_last_name => null,
          p_school_id => (select school_id from lf),
          p_class_label => '5', p_section_label => 'A',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

select lives_ok(
  format($$select confirm_meal_pack_plan(%L::uuid, 'e46-plan-1',
      jsonb_build_array(jsonb_build_object(
        'service_date', (current_date + 2)::text,
        'recipient_id', %L::uuid,
        'lines', (select jsonb_agg(jsonb_build_object('dish_id', id, 'quantity', 1)) from lf_dish))))$$,
    (select parent from lf), (select id from lf_kid)),
  'one meal is redeemed through the real function'
);

select is(
  (select ledger_balance(id) from ledger_account where code = 'platform:revenue'),
  30000::bigint,
  'ONE meal served recognises exactly one tenth of the pack as revenue'
);

select is(
  (select ledger_paise from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  270000::bigint,
  'and the liability drops by the same amount — nothing appears twice, nothing vanishes'
);

select is(
  (select ok from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  true,
  'the invariant still holds after a redemption'
);

-- The double-count, asked directly: revenue plus what is still owed must equal what was taken.
select is(
  (select ledger_balance(id) from ledger_account where code = 'platform:revenue')
    + (select ledger_paise from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  300000::bigint,
  'RECOGNISED + STILL OWED = THE PRICE. A redeemed meal cannot appear as revenue twice without breaking this'
);

-- =============================================================================
-- 3. After a cancellation — the meal comes back
-- =============================================================================

create temporary table lf_red as
select id, revenue_paise from meal_pack_redemption
 where meal_pack_id = (select id from lf_pack) limit 1;

select lives_ok(
  format($$select return_meal_pack_meal(%L::uuid, 'cancelled before cutoff')$$,
         (select id from lf_red)),
  'the meal is returned when the order is cancelled'
);

-- The caller reverses the revenue; `return_meal_pack_meal` hands back the amount to reverse.
select post_ledger_transaction(
  p_reason_code => 'meal_pack_return',
  p_source_type => 'adjustment',
  p_source_id   => (select id from lf_red),
  p_entries     => jsonb_build_array(
    jsonb_build_object('account','platform:revenue','direction','debit',
                       'amount_paise',(select revenue_paise from lf_red)),
    jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','credit',
                       'amount_paise',(select revenue_paise from lf_red))),
  p_memo => 'meal pack return');

select is(
  (select meals_remaining from meal_pack where id = (select id from lf_pack)),
  10,
  'the balance is whole again'
);

select is(
  (select ledger_balance(id) from ledger_account where code = 'platform:revenue'),
  0::bigint,
  'and the revenue recognition is reversed EXACTLY — back to zero, not approximately'
);

select is(
  (select ok from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  true,
  'the invariant holds after a cancellation'
);

-- =============================================================================
-- 4. After expiry — breakage
-- =============================================================================
--
-- The obligation ends and the money is kept. The liability must be cleared, or the ledger would
-- claim forever that we owe food to a pack nobody can spend.

update meal_pack set status = 'expired', expires_at = now() - interval '1 day'
 where id = (select id from lf_pack);

select post_ledger_transaction(
  p_reason_code => 'meal_pack_expiry',
  p_source_type => 'adjustment',
  p_source_id   => (select id from lf_pack),
  p_entries     => jsonb_build_array(
    jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','debit',
                       'amount_paise',300000),
    jsonb_build_object('account','platform:revenue:breakage','direction','credit',
                       'amount_paise',300000)),
  p_memo => 'meal pack expiry');

select is(
  (select ledger_paise from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  0::bigint,
  'nothing is owed once the pack has expired'
);

select is(
  (select packs_paise from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  0::bigint,
  'and an expired pack contributes nothing to the liability — it is out of `status in (active, exhausted)`'
);

select is(
  (select ok from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  true,
  'the invariant holds after expiry — zero on both sides, which is a real assertion here'
);

select is(
  (select ledger_balance(id) from ledger_account where code = 'platform:revenue:breakage'),
  300000::bigint,
  'the unspent meals are recognised as breakage, once'
);

-- =============================================================================
-- 5. The whole ledger still balances
-- =============================================================================

select is(
  (select coalesce(sum(failures), 0)::bigint from assert_ledger_integrity()),
  0::bigint,
  'and every nightly check passes across the sale, the redemption, the return and the expiry'
);

select * from finish();
rollback;
