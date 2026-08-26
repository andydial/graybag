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

select * from finish();
rollback;
