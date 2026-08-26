-- =============================================================================
-- meal_packs.test.sql — `E21`. The three visibility rules, and the completed invariant.
--
-- Andy, 2026-08-26, setting the three as firm requirements: *"Prove all three with tests, not
-- conventions."*
--
--   1. No pack surface renders unless configuration says so. Default off everywhere.
--   2. Only Andy creates or sees offers — a permission at PLATFORM scope only.
--   3. The kitchen sees nothing pack-related, ever.
--
-- Plus `E21-26`: the order-group totals invariant, now that it knows what a pack purchase is.
-- The point of that section is that the invariant got STRICTER, not looser — so it asserts both
-- that a pack purchase is accepted and that the food rule still catches what it always caught.
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
-- Fixtures
-- -----------------------------------------------------------------------------
insert into auth.users (id) values ('a0000000-7e57-0000-0000-000000000e21');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-000000000e21', 'packs@example.test', 'Packs')
on conflict (id) do update set email = excluded.email;

create temporary table mp as
select (select id from school where is_active and onboarded_at is not null order by name limit 1) as school_id,
       (select id from school where is_active and onboarded_at is not null order by name desc limit 1) as other_school_id,
       (select id from city limit 1) as city_id,
       (select id from dish_category limit 1) as drinks_id,
       'a0000000-7e57-0000-0000-000000000e21'::uuid as parent;

-- An offer that is NOT active and NOT attached to any school. This is the default state of the
-- world, and every "off" assertion below is measured against it.
create temporary table off_id as
with ins as (
  insert into meal_pack_offer
    (name, meals_count, items_per_meal, required_category_id,
     net_price_paise, alacarte_reference_paise, validity_days, is_active)
  select 'E21 test 10-pack', 10, 2, drinks_id, 300000, 337500, 60, false from mp
  returning id
) select id from ins;

-- =============================================================================
-- 1. Default off. `E21-28`.
-- =============================================================================

select is(
  meal_packs_available_at((select school_id from mp)),
  false,
  'DEFAULT OFF: a school with no offer row sees no pack surface at all'
);

-- Switching the school on is not enough while the offer is inactive.
insert into meal_pack_offer_school (offer_id, school_id, is_enabled)
select (select id from off_id), (select school_id from mp), true;

select is(
  meal_packs_available_at((select school_id from mp)),
  false,
  'an ENABLED school with an INACTIVE offer still sees nothing — both halves must be true'
);

update meal_pack_offer set is_active = true where id = (select id from off_id);

select is(
  meal_packs_available_at((select school_id from mp)),
  true,
  'active offer AND enabled school: only now does a pack surface exist'
);

select is(
  meal_packs_available_at((select other_school_id from mp)),
  false,
  'and the OTHER school still sees nothing — the switch is per school, not global'
);

-- The state Andy called out: a school switched off explicitly.
update meal_pack_offer_school set is_enabled = false
 where school_id = (select school_id from mp);

select is(
  meal_packs_available_at((select school_id from mp)),
  false,
  'a school switched OFF sees nothing, even while the offer is live for others'
);

update meal_pack_offer_school set is_enabled = true
 where school_id = (select school_id from mp);

-- =============================================================================
-- 2. Offers are configured at PLATFORM scope only. `E21-27`.
-- =============================================================================

select is(
  (select valid_scope_types::text from permission where code = 'meal_packs.manage'),
  '{platform}',
  'meal_packs.manage is grantable at platform scope ONLY — not kitchen, not school, not support'
);

select is(
  (select is_sensitive from permission where code = 'meal_packs.manage'),
  true,
  'and it is marked sensitive, because it is money taken before food is served'
);

-- The enforcement that matters: a school-scoped grant of this permission must be refused. If
-- `valid_scope_types` were decoration, this would succeed and a school admin could price packs.
select throws_ok(
  format($$select grant_permission(
      p_user_id => %L, p_permission => 'meal_packs.manage',
      p_scope_type => 'school', p_scope_id => %L)$$,
    (select parent from mp), (select school_id from mp)),
  null,
  'a SCHOOL-scoped grant of meal_packs.manage is refused'
);

select throws_ok(
  format($$select grant_permission(
      p_user_id => %L, p_permission => 'meal_packs.manage',
      p_scope_type => 'kitchen', p_scope_id => %L)$$,
    (select parent from mp), (select id from kitchen limit 1)),
  null,
  'and so is a KITCHEN-scoped grant'
);

-- =============================================================================
-- 3. The kitchen sees nothing pack-related, ever. `E21-29`.
-- =============================================================================
--
-- Andy: *"An order paid with a pack meal looks to the kitchen exactly like any other order — the
-- same child, the same food. How it was paid for is none of their business, and it's one more
-- thing that can leak money information into a screen that shouldn't have any."*
--
-- Asserted structurally rather than by reading a screen: there is NO policy granting any
-- pack table to anyone but the owning parent, so no kitchen query can reach one however it is
-- written.

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('meal_pack', 'meal_pack_redemption', 'meal_pack_plan')
      and permissive = 'PERMISSIVE'
      and qual not like '%auth.uid()%'),
  0,
  'no PERMISSIVE policy on any pack table grants access to anyone but the owning parent'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('meal_pack', 'meal_pack_redemption', 'meal_pack_plan')
      and (qual ilike '%kitchen%' or qual ilike '%auth_can(%')),
  0,
  'and none of them mentions a kitchen or a back-office permission at all'
);

-- The kitchen reads orders. A pack-paid order must be indistinguishable there, which means the
-- redemption fact lives on `meal_pack_redemption` and NOT as a column on `order`.
select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'order'
      and (column_name ilike '%pack%' or column_name ilike '%redemption%')),
  0,
  'the `order` table carries NO pack column — the kitchen board cannot show what it cannot read'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'order_line' and column_name ilike '%pack%'),
  0,
  'nor does order_line, which is what the kitchen sheet is built from'
);

-- =============================================================================
-- 4. The totals invariant, COMPLETED rather than weakened. `E21-26`.
-- =============================================================================

create function tests_tmp.mk_pack_group(p_net bigint, p_tax bigint)
returns uuid language plpgsql as $$
declare v_group uuid;
begin
  insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise)
  select parent, 'e21-' || gen_random_uuid(), 'paid', city_id, 'meal_pack_purchase',
         p_net, p_tax, p_net + p_tax
    from mp returning id into v_group;

  insert into meal_pack (customer_user_id, offer_id, order_group_id, meals_total, meals_remaining,
                         net_price_paise, tax_total_paise, cgst_paise, sgst_paise, tax_point,
                         expires_at, correlation_id)
  select parent, (select id from off_id), v_group, 10, 10,
         p_net, p_tax, p_tax / 2, p_tax - p_tax / 2, 'sale',
         now() + interval '60 days', gen_random_uuid()
    from mp;
  return v_group;
end;
$$;

-- The case that failed before 0070: a correct pack purchase with no member food orders.
select lives_ok(
  $$select tests_tmp.mk_pack_group(300000, 15000)$$,
  'a pack purchase with NO member orders is now valid — this is the case 0070 exists for'
);

-- `set constraints all immediate` because the totals assertion is DEFERRABLE INITIALLY DEFERRED
-- and would otherwise fire at COMMIT, invisible to a rollback-based test (docs/learnings.md).
select throws_ok(
  $$
    insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                             subtotal_paise, tax_total_paise, payable_paise)
    select parent, 'e21-nopack-' || gen_random_uuid(), 'paid', city_id, 'meal_pack_purchase',
           300000, 15000, 315000 from mp;
    set constraints all immediate;
  $$,
  null,
  'a group CALLING ITSELF a pack purchase with no pack behind it is refused — a half-written purchase'
);

-- And the completion that matters: the food rule is untouched and still catches what it caught.
select throws_ok(
  $$
    insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                             subtotal_paise, tax_total_paise, payable_paise)
    select parent, 'e21-food-' || gen_random_uuid(), 'paid', city_id, 'food',
           50000, 2500, 52500 from mp;
    set constraints all immediate;
  $$,
  null,
  'a FOOD group whose totals do not match its (zero) orders is STILL refused — not weakened'
);

-- Asserted as a PROPERTY of the column, not by sampling rows: a fresh database has no groups at
-- all, so a row-based version of this passes or fails on whether fixtures happen to exist rather
-- than on whether a group can be of unknown kind. It cannot.
select is(
  (select is_nullable from information_schema.columns
    where table_name = 'order_group' and column_name = 'kind'),
  'NO',
  'kind is NOT NULL — no group can be of unknown type, and there is no nullable escape'
);

select is(
  (select column_default from information_schema.columns
    where table_name = 'order_group' and column_name = 'kind'),
  '''food''::order_group_kind',
  'and it defaults to food, so a group that omits its kind gets the STRICTER, older rule'
);

-- A pack purchase cannot itself be paid with a pack.
select throws_ok(
  $$
    insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                             subtotal_paise, tax_total_paise, pack_applied_paise, payable_paise)
    select parent, 'e21-circular-' || gen_random_uuid(), 'paid', city_id, 'meal_pack_purchase',
           300000, 15000, 315000, 0 from mp;
  $$,
  null,
  'a pack purchase cannot be paid for with a pack'
);

-- =============================================================================
-- 4b. Switching a school off must never strand paid-for meals. `E21-31`.
-- =============================================================================
--
-- Andy: *"Turning an offer off stops selling; it must never strand meals somebody has already
-- paid for. That's real money owed as food."*
--
-- The pack built in section 4 belongs to our parent. Below, the school is switched off — which is
-- what withdrawing an offer looks like — and every assertion is about what MUST still work.

-- The parent can still buy nothing...
select is(
  meal_packs_available_at((select school_id from mp)),
  true,
  'precondition: the school is currently on'
);

update meal_pack_offer_school set is_enabled = false
 where school_id = (select school_id from mp);

select is(
  meal_packs_available_at((select school_id from mp)),
  false,
  'the school is switched off, so nothing may be SOLD there'
);

-- ...but the balance is untouched, and that is the whole point.
select is(
  parent_has_live_meal_pack((select parent from mp)),
  true,
  'THE CASE THAT MATTERS: the parent still holds spendable meals after the offer is withdrawn'
);

select is(
  (select can_buy from meal_pack_surface((select parent from mp), (select school_id from mp))),
  false,
  'meal_pack_surface says they may not buy...'
);

select is(
  (select has_balance from meal_pack_surface((select parent from mp), (select school_id from mp))),
  true,
  '...and that they still have a balance — so the app keeps the balance, planner and cart toggle'
);

-- And they can actually SPEND it, which is the assertion that would catch someone "tidying up"
-- spend_meal_pack_meals by adding a school check.
select lives_ok(
  format($$select * from spend_meal_pack_meals(%L::uuid, 1)$$, (select parent from mp)),
  'and a meal can still be REDEEMED at a school that no longer sells packs'
);

select is(
  (select meals_remaining from meal_pack where customer_user_id = (select parent from mp)),
  9,
  'the meal came out of the balance normally — 10 becomes 9'
);

-- A parent with no pack at a switched-off school sees nothing at all: case 1, no concept.
-- A uuid that belongs to no account at all. It carries the 7e57 fixture marker even though no
-- row is ever created for it: `check-test-fixtures` reads ids out of this file, and the all-zeros
-- uuid it replaced collides with seed.sql — which does not fail one test, it skips the whole file.
select is(
  (select has_balance from meal_pack_surface(
     'a0000000-7e57-0000-0000-000000000e22'::uuid, (select school_id from mp))),
  false,
  'a parent with NO pack at a switched-off school has no balance — case 1, no concept at all'
);

select is(
  (select can_buy or has_balance from meal_pack_surface(
     'a0000000-7e57-0000-0000-000000000e22'::uuid, (select school_id from mp))),
  false,
  'and both answers are false together, which is what "render nothing" requires'
);

update meal_pack_offer_school set is_enabled = true
 where school_id = (select school_id from mp);

-- =============================================================================
-- 5. Rounding: the liability telescopes exactly, even when the price does not divide
-- =============================================================================
--
-- Andy's amendment 3. ₹1,000 over 3 meals is the deliberately indivisible case.

select is(
  pack_liability_paise(100000, 3, 3), 100000::bigint,
  'a full pack owes the whole price'
);
select is(
  pack_liability_paise(100000, 0, 3), 0::bigint,
  'an empty pack owes nothing — no remainder stranded'
);
select is(
  (pack_liability_paise(100000, 3, 3) - pack_liability_paise(100000, 2, 3))
  + (pack_liability_paise(100000, 2, 3) - pack_liability_paise(100000, 1, 3))
  + (pack_liability_paise(100000, 1, 3) - pack_liability_paise(100000, 0, 3)),
  100000::bigint,
  'and the three per-meal amounts sum to the price EXACTLY (33334 + 33333 + 33333)'
);

select is(
  pack_liability_paise(100000, 2, 3), 66666::bigint,
  'the intermediate liability floors, so the pack never owes more than it took'
);

-- =============================================================================
-- 6. Confirming a plan. `E21-45`.
-- =============================================================================
--
-- The properties Andy asked to be proved, in the path that actually spends meals:
-- idempotency on the WHOLE submission, no overdraw, eligibility server-side, expiry server-side,
-- and revenue recognised exactly once.

-- A pack big enough to plan against, with a menu the plan can draw from.
--
-- **Its own parent**, and the reason is a small lesson: `spend_meal_pack_meals` takes from the
-- oldest-expiring of ALL that parent's packs, so reusing the section-4 parent drew meals from the
-- pack created there instead. The function was right and the fixture assumed an isolation it does
-- not have — which is exactly the behaviour the oldest-first rule promises.
insert into auth.users (id) values ('a0000000-7e57-0000-0000-000000000e45');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-000000000e45', 'planner@example.test', 'Planner')
on conflict (id) do update set email = excluded.email;

create temporary table plan_fix as
select (select id from off_id) as offer_id,
       'a0000000-7e57-0000-0000-000000000e45'::uuid as parent,
       (select school_id from mp) as school_id;

create temporary table plan_pack as
with og as (
  insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise)
  select parent, 'e21-plan-' || gen_random_uuid(), 'paid', (select city_id from mp),
         'meal_pack_purchase', 300000, 15000, 315000 from plan_fix
  returning id
), pk as (
  insert into meal_pack (customer_user_id, offer_id, order_group_id, meals_total, meals_remaining,
                         net_price_paise, tax_total_paise, cgst_paise, sgst_paise, tax_point,
                         expires_at, correlation_id)
  select parent, offer_id, og.id, 10, 10, 300000, 15000, 7500, 7500, 'sale',
         now() + interval '60 days', gen_random_uuid()
    from plan_fix, og
  returning id
) select id from pk;

-- **The sale legs, which a fixture that only inserts a `meal_pack` row silently skips.**
--
-- The invariant is "deferred revenue equals what the live packs still owe". A pack conjured
-- straight into the table owes its full price with nothing on the ledger to match, so the
-- invariant is false before a single meal is spent — and the failure looks like a redemption bug
-- rather than a missing sale. Posting it here is what makes the assertion below mean anything.
select post_ledger_transaction(
  p_reason_code => 'meal_pack_sale',
  p_source_type => 'adjustment',
  p_source_id   => (select id from plan_pack),
  p_entries     => jsonb_build_array(
    jsonb_build_object('account','provider:razorpay:clearing','direction','debit', 'amount_paise',315000),
    jsonb_build_object('account','platform:deferred_revenue:meal_packs','direction','credit','amount_paise',300000),
    jsonb_build_object('account','platform:tax_payable:cgst','direction','credit','amount_paise',7500),
    jsonb_build_object('account','platform:tax_payable:sgst','direction','credit','amount_paise',7500)),
  p_memo => 'meal pack sale (fixture)');

-- Two dishes: one in the offer's required category, one not.
create temporary table plan_dish as
with d as (
  insert into dish (kitchen_id, name, category_id, food_type)
  select (select kitchen_id from school where id = (select school_id from plan_fix)),
         'Plan ' || c.display_name, c.id, 'veg'
    from dish_category c
   where c.id = (select required_category_id from meal_pack_offer where id = (select offer_id from plan_fix))
      or c.id = (select id from dish_category
                  where id <> (select required_category_id from meal_pack_offer
                                where id = (select offer_id from plan_fix)) limit 1)
  returning id, category_id
) select * from d;

create temporary table plan_kid as
select (create_recipient(
          p_guardian_user_id => (select parent from plan_fix),
          p_first_name => 'Planner', p_last_name => null,
          p_school_id => (select school_id from plan_fix),
          p_class_label => '5', p_section_label => 'A',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

/** One day of a plan, as the function expects it. */
create function tests_tmp.plan_day(p_date date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'service_date', p_date,
    'recipient_id', (select id from plan_kid),
    'lines', (select jsonb_agg(jsonb_build_object('dish_id', d.id, 'quantity', 1))
                from plan_dish d));
$$;

select lives_ok(
  format($$select confirm_meal_pack_plan(%L::uuid, 'plan-key-1',
            jsonb_build_array(tests_tmp.plan_day(current_date + 2),
                              tests_tmp.plan_day(current_date + 3)))$$,
         (select parent from plan_fix)),
  'a two-day plan confirms'
);

select is(
  (select meals_remaining from meal_pack where id = (select id from plan_pack)),
  8,
  'and takes exactly two meals — 10 becomes 8'
);

select is(
  (select count(*)::int from meal_pack_redemption where meal_pack_id = (select id from plan_pack)),
  2,
  'one redemption per day'
);

-- THE amendment-1 assertion. A retry must return the first result and write nothing.
select is(
  (select (confirm_meal_pack_plan((select parent from plan_fix), 'plan-key-1',
            jsonb_build_array(tests_tmp.plan_day(current_date + 2),
                              tests_tmp.plan_day(current_date + 3))) ->> 'replayed')::boolean),
  true,
  'RETRY: the same key and the same plan replays rather than spending again'
);

select is(
  (select meals_remaining from meal_pack where id = (select id from plan_pack)),
  8,
  'and the balance is UNCHANGED — four days retried is four orders, not eight'
);

select is(
  (select count(*)::int from meal_pack_redemption where meal_pack_id = (select id from plan_pack)),
  2,
  'and no second set of redemptions was written'
);

select throws_ok(
  format($$select confirm_meal_pack_plan(%L::uuid, 'plan-key-1',
            jsonb_build_array(tests_tmp.plan_day(current_date + 4)))$$,
         (select parent from plan_fix)),
  null,
  'the same key with a DIFFERENT plan is refused, not replayed — a parent must not be told they planned something they did not'
);

-- Expiry, server-side.
select throws_ok(
  format($$select confirm_meal_pack_plan(%L::uuid, 'plan-key-expiry',
            jsonb_build_array(tests_tmp.plan_day(current_date + 400)))$$,
         (select parent from plan_fix)),
  null,
  'a day after the pack expires is refused by the SERVER, whatever the app believes'
);

-- The invariant, asserted as a CHANGE rather than an absolute.
--
-- The absolute form is the real invariant and it is right — but it cannot hold in this file,
-- because earlier sections conjure packs straight into the table to test the balance and spend
-- from them directly, with no sale posting and no redemption posting. The whole-ledger check
-- correctly reports that as a mismatch, which is the check working: a pack that exists without
-- its money is exactly what it is for.
--
-- So what is asserted here is the property this section owns: **the ledger moved by exactly what
-- the redemptions recognised, and not a paisa more.** That is fixture-independent, and it is the
-- half that a redemption bug would break. `E21-46` adds the whole-ledger assertion in a file
-- whose fixtures go through the money path.
select is(
  (select ledger_paise from check_meal_pack_ledger_invariant() where leg = 'deferred_revenue'),
  (select sum(pack_liability_paise(net_price_paise, meals_remaining, meals_total))
     from meal_pack where id = (select id from plan_pack))::bigint,
  'deferred revenue equals what the PLAN pack still owes — the sale posted 300000, two meals '
  'recognised 60000, and 240000 remains'
);

select is(
  (select ok from check_meal_pack_ledger_invariant() where leg = 'deferred_tax'),
  true,
  'and the tax leg holds — zero on both sides under tax_point = sale, asserted rather than skipped'
);

select is(
  (select sum(revenue_paise)::bigint from meal_pack_redemption
    where meal_pack_id = (select id from plan_pack)),
  60000::bigint,
  'two meals of a 300000 ten-meal pack recognised exactly 60000 — no rounding lost'
);

select * from finish();
rollback;
