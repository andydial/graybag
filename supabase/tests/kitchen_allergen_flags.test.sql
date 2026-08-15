-- =============================================================================
-- kitchen_allergen_flags.test.sql — E09-33.
--
-- The kitchen screen now shows a child's allergen codes, because the person handing a physical
-- bag to a named child is the last human in the chain and was previously blind. Andy accepted
-- the privacy cost deliberately, on the condition that the scoping is proven:
--
--   "A test must prove a kitchen user at school A cannot read school B's flags, and it must
--    exercise this through an authenticated client, not the service role."
--
-- Nothing here creates a policy. `recipient_allergen_read_fulfilment` already existed and
-- already says the right thing — `orders.view_pii`, granted at the order's own school or the
-- kitchen serving it. This suite is the proof that it does, because a policy nobody has
-- exercised from the outside is a policy nobody has checked.
--
-- WHY THE HARNESS IS ASSERTED FIRST
--
-- `auth.uid()` reads `request.jwt.claims`. If the role never changes, or the claim is malformed,
-- then "sees zero rows" is true because the query ran as `postgres` with RLS bypassed — and
-- every deny passes for the wrong reason. `authorization.test.sql` makes the same point at
-- length. Part 0 below refuses to let that happen quietly.
--
-- Fixture ids carry `7e57` in their **second group**, which is where
-- `scripts/check-test-fixtures.mjs` looks for it. `seed.sql` runs before this suite and may not use it;
-- `scripts/check-test-fixtures.mjs` enforces the split.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;

create schema if not exists tests_tmp;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin
      execute 'create extension pgtap with schema extensions';
    exception when others then
      execute 'create extension pgtap';
    end;
  end if;
end;
$$;

select * from no_plan();

-- -----------------------------------------------------------------------------
-- Fixtures: two schools, two kitchens, a child with an allergen at each.
-- -----------------------------------------------------------------------------

create temporary table k_ctx as
select
  '00000000-7e57-0000-0000-0000000000a1'::uuid as kitchen_a,
  '00000000-7e57-0000-0000-0000000000b1'::uuid as kitchen_b,
  '00000000-7e57-0000-0000-0000000000a2'::uuid as school_a,
  '00000000-7e57-0000-0000-0000000000b2'::uuid as school_b,
  '00000000-7e57-0000-0000-0000000000a3'::uuid as child_a,
  '00000000-7e57-0000-0000-0000000000b3'::uuid as child_b,
  '00000000-7e57-0000-0000-0000000000a4'::uuid as order_a,
  '00000000-7e57-0000-0000-0000000000b4'::uuid as order_b,
  '00000000-7e57-0000-0000-0000000000a5'::uuid as operator_a,
  '00000000-7e57-0000-0000-0000000000a6'::uuid as guardian,
  (select city_id from school limit 1)          as city_id,
  (select id from allergen where code = 'milk')    as milk,
  (select id from allergen where code = 'tree_nut') as tree_nut;

-- The assertions below read `k_ctx` while impersonating an operator, and `authenticated` has no
-- privilege on a table it did not create. Without this the first assertion fails with
-- "permission denied for table k_ctx", the transaction aborts, and the rest of the file reports
-- errors rather than failures — the shape `scripts/test-db.sh` warns about.
grant select on k_ctx to authenticated;

-- `code` is NOT NULL UNIQUE on `kitchen` and was omitted here, so this file aborted on its
-- first insert and every assertion after it reported "current transaction is aborted" — the
-- shape `scripts/test-db.sh` warns about in its header, where a file contributes nothing and
-- no `not ok` appears. The codes are prefixed `7e57_` like the school codes below, so they
-- cannot collide with a real kitchen.
insert into kitchen (id, code, city_id, name, is_active)
select kitchen_a, '7e57_kitchen_a', city_id, 'Test kitchen A', true from k_ctx
union all select kitchen_b, '7e57_kitchen_b', city_id, 'Test kitchen B', true from k_ctx;

insert into school (id, code, name, city_id, kitchen_id, institution_type,
                    address_line1, postcode, contact_name, contact_email, contact_phone, onboarded_at)
select school_a, '7e57_a', 'Test School A', city_id, kitchen_a, 'school'::institution_type,
       'Addr', '160001', 'A Admin', 'a@test.invalid', '+917000000001', now() from k_ctx
union all
select school_b, '7e57_b', 'Test School B', city_id, kitchen_b, 'school'::institution_type,
       'Addr', '160002', 'B Admin', 'b@test.invalid', '+917000000002', now() from k_ctx;

-- The guardian and the operator are real `app_user` rows: the policy joins `app_user` and
-- requires the account to be neither disabled nor deleted.
-- `instance_id` is taken from an existing row rather than written as the all-zero literal:
-- `check-test-fixtures.mjs` reads every UUID in the file as a fixture id, and that one collides
-- with `seed.sql`. Deriving it is also simply more robust than hardcoding a platform constant.
insert into auth.users (id, email, instance_id, aud, role)
select guardian, 'guardian.7e57@test.invalid',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated' from k_ctx
union all
select operator_a, 'operator.7e57@test.invalid',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated' from k_ctx;

-- `app_user` has `first_name` and `last_name`, never a `full_name` — and `0018`'s trigger on
-- `auth.users` has already created both rows by the time we get here, so this describes them
-- rather than creating them. Written as an insert with `full_name` it aborted the transaction,
-- which is why this file never contributed an assertion.
insert into app_user (id, email, first_name, last_name, is_disabled)
select guardian, 'guardian.7e57@test.invalid', 'Test', 'Guardian', false from k_ctx
union all
select operator_a, 'operator.7e57@test.invalid', 'Test', 'Operator A', false from k_ctx
on conflict (id) do update
  set email      = excluded.email,
      first_name = excluded.first_name,
      last_name  = excluded.last_name;

insert into recipient (id, first_name, last_name, school_id, created_by_user_id)
select child_a, 'Child', 'A', school_a, guardian from k_ctx
union all
select child_b, 'Child', 'B', school_b, guardian from k_ctx;

insert into recipient_allergen (recipient_id, allergen_id, severity, recorded_by_user_id, recorded_at)
select child_a, milk, 'allergy'::allergy_severity, guardian, now() from k_ctx
union all
select child_b, tree_nut, 'allergy'::allergy_severity, guardian, now() from k_ctx;

-- `0040`'s trigger refuses an order status change with no `app.actor_type` set, and `0039`
-- refuses one that is not in the §4.1 table. An order cannot be INSERTed as `paid`: the only
-- legal way in is T2 (`(new) -> pending_payment` as `system`) followed by T5
-- (`pending_payment -> paid` as `system`). Both steps are `system`, which is also the honest
-- actor for seeded state — no operator and no customer performed it.
set local app.actor_type = 'system';

-- One paid order each, which is what the policy scopes through.
-- `order.order_group_id` is NOT NULL — the group is the checkout and payment unit ([DM-01]),
-- and an order without one has no path to a payment. One group per order here, which is what a
-- single-child checkout produces anyway.
insert into order_group (id, customer_user_id, idempotency_key, city_id)
select '00000000-7e57-0000-0000-0000000000a7'::uuid, guardian, '7e57-group-a', city_id from k_ctx
union all
select '00000000-7e57-0000-0000-0000000000b7'::uuid, guardian, '7e57-group-b', city_id from k_ctx;

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, status, school_name_snapshot, recipient_name_snapshot,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select order_a, '00000000-7e57-0000-0000-0000000000a7'::uuid, '7E57-A', gen_random_uuid(),
       guardian, child_a, school_a, kitchen_a, city_id,
       current_date, 'classroom'::delivery_mode, now() + interval '1 day',
       '{}'::jsonb, 'pending_payment'::order_status, 'Test School A', 'Child A', 10000, 250, 250, 10500 from k_ctx
union all
select order_b, '00000000-7e57-0000-0000-0000000000b7'::uuid, '7E57-B', gen_random_uuid(),
       guardian, child_b, school_b, kitchen_b, city_id,
       current_date, 'classroom'::delivery_mode, now() + interval '1 day',
       '{}'::jsonb, 'pending_payment'::order_status, 'Test School B', 'Child B', 10000, 250, 250, 10500 from k_ctx;

-- T5. The policy under test scopes through a *paid* order, so the fixture has to reach `paid`
-- by the route the state machine allows rather than by starting there.
update "order" set status = 'paid'
 where id in (select order_a from k_ctx union all select order_b from k_ctx);

-- Operator A is granted at KITCHEN A only. Not platform, not school B.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id, granted_at)
select operator_a, 'orders.view_pii', 'kitchen'::scope_type, kitchen_a, operator_a, now() from k_ctx
union all
select operator_a, 'orders.view', 'kitchen'::scope_type, kitchen_a, operator_a, now() from k_ctx;

-- =============================================================================
-- Part 0. The harness itself. Nothing below is trustworthy until this passes.
-- =============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', (select operator_a from k_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select auth.uid()), (select operator_a from k_ctx),
  'harness: auth.uid() is operator A — if this fails every deny below passes for the wrong reason');

select is(
  (select current_user::text), 'authenticated',
  'harness: the session role really is `authenticated`, so RLS is being enforced, not bypassed');

-- =============================================================================
-- Part 1. Operator A sees their own school's flags.
--
-- Asserted before the deny, deliberately: a suite where the allow silently returns nothing
-- would make every deny below vacuous.
-- =============================================================================

select is(
  (select count(*)::int from recipient_allergen where recipient_id = (select child_a from k_ctx)),
  1,
  'a kitchen operator reads the allergen flags for a child at their own kitchen''s school');

select is(
  (select a.code from recipient_allergen ra join allergen a on a.id = ra.allergen_id
    where ra.recipient_id = (select child_a from k_ctx)),
  'milk',
  'and reads the enumerated code, which is what the badge renders');

-- =============================================================================
-- Part 2. Operator A cannot see school B. This is the assertion Andy asked for.
-- =============================================================================

select is(
  (select count(*)::int from recipient_allergen where recipient_id = (select child_b from k_ctx)),
  0,
  'E09-33: a kitchen operator at school A reads NO allergen flag for a child at school B');

select is(
  (select count(*)::int from recipient where id = (select child_b from k_ctx)),
  0,
  'and cannot read the other school''s child row either, so there is no route in by another join');

-- =============================================================================
-- Part 3. The grant is what opens it, not the login.
-- =============================================================================

set local role postgres;
update permission_grant set revoked_at = now()
 where user_id = (select operator_a from k_ctx) and permission_code = 'orders.view_pii';

select set_config('request.jwt.claims',
  json_build_object('sub', (select operator_a from k_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from recipient_allergen where recipient_id = (select child_a from k_ctx)),
  0,
  'revoking orders.view_pii closes the flags immediately — the grant is the control, not the session');

set local role postgres;
select * from finish();
rollback;
