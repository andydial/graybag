-- =============================================================================
-- kitchen_order_contact.test.sql — `E09-46`.
--
-- `0095` shipped a guard that refused the person who asked for the feature. Andy, Super Admin with
-- `orders.view_pii` at **platform** scope, saw "Ordered by — not shown" on every card; Vivek's
-- kitchen-scoped account saw every one. Confirmed on production by asking the view as each account:
--
--   ANDY  (orders.view_pii @ platform) -> 0 rows
--   VIVEK (orders.view_pii @ kitchen)  -> 43 rows
--   NOBODY (no grant)                  -> 0 rows
--
-- The cause was that `0095` **reimplemented** the grant check as an `EXISTS` over
-- `permission_grant` testing only the `school` and `kitchen` scopes, instead of calling
-- `auth_can`. `auth_has_permission` already implements platform-satisfies-any-scope, the platform
-- owner (who holds no grant rows at all — `E02-39`), and city/kitchen → school inheritance. The
-- copy reproduced two branches of that and dropped the rest.
--
-- **The existing suite could not have caught it.** `authorization.test.sql` §12 asserts the view's
-- *shape* — definer, restates `auth_is_live_user`, two columns, guard in its own WHERE — and every
-- one of those passed while the feature showed nothing to anybody who mattered. A shape is not a
-- behaviour. This file asks the view, as three different real accounts, what it actually returns.
--
-- WHY THE HARNESS IS ASSERTED FIRST
--
-- `auth.uid()` reads `request.jwt.claims`. If the role never changes or the claim is malformed,
-- "sees zero rows" is true because the query ran as `postgres` with RLS bypassed — and every deny
-- passes for the wrong reason. Part 0 refuses to let that happen quietly. That matters more than
-- usual here, because the bug being tested for IS "sees zero rows".
--
-- Fixture ids carry `7e57` in their **second group**, where `scripts/check-test-fixtures.mjs`
-- looks for it.
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
-- Fixtures: two kitchens, two schools, one paid order each, three operators.
-- -----------------------------------------------------------------------------

create temporary table c_ctx as
select
  '00000000-7e57-0001-0000-0000000000a1'::uuid as kitchen_a,
  '00000000-7e57-0001-0000-0000000000b1'::uuid as kitchen_b,
  '00000000-7e57-0001-0000-0000000000a2'::uuid as school_a,
  '00000000-7e57-0001-0000-0000000000b2'::uuid as school_b,
  '00000000-7e57-0001-0000-0000000000a3'::uuid as child_a,
  '00000000-7e57-0001-0000-0000000000b3'::uuid as child_b,
  '00000000-7e57-0001-0000-0000000000a4'::uuid as order_a,
  '00000000-7e57-0001-0000-0000000000b4'::uuid as order_b,
  '00000000-7e57-0001-0000-0000000000a5'::uuid as kitchen_op,   -- kitchen A only
  '00000000-7e57-0001-0000-0000000000a8'::uuid as platform_op,  -- platform scope
  '00000000-7e57-0001-0000-0000000000a9'::uuid as no_grant_op,  -- nothing at all
  '00000000-7e57-0001-0000-0000000000a6'::uuid as guardian,
  (select city_id from school limit 1)         as city_id;

grant select on c_ctx to authenticated;

insert into kitchen (id, code, city_id, name, is_active)
select kitchen_a, '7e57_c_kitchen_a', city_id, 'Contact kitchen A', true from c_ctx
union all select kitchen_b, '7e57_c_kitchen_b', city_id, 'Contact kitchen B', true from c_ctx;

insert into school (id, code, name, city_id, kitchen_id, institution_type,
                    address_line1, postcode, contact_name, contact_email, contact_phone, onboarded_at)
select school_a, '7e57_c_a', 'Contact School A', city_id, kitchen_a, 'school'::institution_type,
       'Addr', '160001', 'A Admin', 'ca@test.invalid', '+917000000011', now() from c_ctx
union all
select school_b, '7e57_c_b', 'Contact School B', city_id, kitchen_b, 'school'::institution_type,
       'Addr', '160002', 'B Admin', 'cb@test.invalid', '+917000000012', now() from c_ctx;

insert into auth.users (id, email, instance_id, aud, role)
select guardian, 'c.guardian.7e57@test.invalid',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated' from c_ctx
union all
select kitchen_op, 'c.kitchen.7e57@test.invalid',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated' from c_ctx
union all
select platform_op, 'c.platform.7e57@test.invalid',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated' from c_ctx
union all
select no_grant_op, 'c.nogrant.7e57@test.invalid',
       (select instance_id from auth.users limit 1), 'authenticated', 'authenticated' from c_ctx;

-- `0018`'s trigger has already created these; this describes them.
insert into app_user (id, email, first_name, last_name, is_disabled)
select guardian, 'c.guardian.7e57@test.invalid', 'Contact', 'Guardian', false from c_ctx
union all select kitchen_op, 'c.kitchen.7e57@test.invalid', 'Contact', 'Kitchen Op', false from c_ctx
union all select platform_op, 'c.platform.7e57@test.invalid', 'Contact', 'Platform Op', false from c_ctx
union all select no_grant_op, 'c.nogrant.7e57@test.invalid', 'Contact', 'No Grant', false from c_ctx
on conflict (id) do update
  set email = excluded.email, first_name = excluded.first_name,
      last_name = excluded.last_name, is_disabled = excluded.is_disabled;

insert into recipient (id, first_name, last_name, school_id, created_by_user_id)
select child_a, 'Contact', 'ChildA', school_a, guardian from c_ctx
union all select child_b, 'Contact', 'ChildB', school_b, guardian from c_ctx;

set local app.actor_type = 'system';

insert into order_group (id, customer_user_id, idempotency_key, city_id)
select '00000000-7e57-0001-0000-0000000000a7'::uuid, guardian, '7e57-c-group-a', city_id from c_ctx
union all
select '00000000-7e57-0001-0000-0000000000b7'::uuid, guardian, '7e57-c-group-b', city_id from c_ctx;

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, status, school_name_snapshot, recipient_name_snapshot,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select order_a, '00000000-7e57-0001-0000-0000000000a7'::uuid, '7E57-CA', gen_random_uuid(),
       guardian, child_a, school_a, kitchen_a, city_id,
       current_date, 'classroom'::delivery_mode, now() + interval '1 day',
       '{}'::jsonb, 'pending_payment'::order_status, 'Contact School A', 'ChildA', 10000, 250, 250, 10500 from c_ctx
union all
select order_b, '00000000-7e57-0001-0000-0000000000b7'::uuid, '7E57-CB', gen_random_uuid(),
       guardian, child_b, school_b, kitchen_b, city_id,
       current_date, 'classroom'::delivery_mode, now() + interval '1 day',
       '{}'::jsonb, 'pending_payment'::order_status, 'Contact School B', 'ChildB', 10000, 250, 250, 10500 from c_ctx;

update "order" set status = 'paid'
 where id in (select order_a from c_ctx union all select order_b from c_ctx);

-- The kitchen operator is granted at KITCHEN A only. The platform operator at PLATFORM.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id, granted_at)
select kitchen_op, 'orders.view_pii', 'kitchen'::scope_type, kitchen_a, kitchen_op, now() from c_ctx
union all
select platform_op, 'orders.view_pii', 'platform'::scope_type, null, platform_op, now() from c_ctx;

-- =============================================================================
-- Part 0. The harness. Nothing below is trustworthy until this passes.
-- =============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', (select kitchen_op from c_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select auth.uid()), (select kitchen_op from c_ctx),
  'harness: auth.uid() is the kitchen operator — if this fails, every "sees nothing" below passes for the wrong reason, which is exactly the bug under test');

-- =============================================================================
-- Part 1. A kitchen-scoped grant sees its own kitchen's orders, and only those.
-- =============================================================================

select is(
  (select count(*)::int from kitchen_order_contact where order_id = (select order_a from c_ctx)),
  1, 'a kitchen-scoped orders.view_pii reads the email for an order at ITS OWN kitchen');

select is(
  (select count(*)::int from kitchen_order_contact where order_id = (select order_b from c_ctx)),
  0, 'and reads nothing for an order at another kitchen — the scoping Andy required proven, not assumed');

select is(
  (select customer_email from kitchen_order_contact where order_id = (select order_a from c_ctx)),
  'c.guardian.7e57@test.invalid',
  'and the email it reads is the parent who placed that order');

-- =============================================================================
-- Part 2. A PLATFORM-scoped grant sees every order. This is the `0095` regression.
-- =============================================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select platform_op from c_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select auth.uid()), (select platform_op from c_ctx),
  'harness: auth.uid() is the platform operator');

/*
 * The assertion that `0095` failed in production. It held `orders.view_pii` at platform scope and
 * read NOTHING, because the hand-rolled guard tested only `scope_type = 'school'` and
 * `'kitchen'`. Every Super Admin saw "not shown" on every card.
 */
select is(
  (select count(*)::int from kitchen_order_contact where order_id = (select order_a from c_ctx)),
  1, 'a PLATFORM-scoped orders.view_pii reads kitchen A''s order — the exact case 0095 refused');

select is(
  (select count(*)::int from kitchen_order_contact where order_id = (select order_b from c_ctx)),
  1, 'and kitchen B''s too, because platform scope satisfies every scope');

-- =============================================================================
-- Part 3. No grant, no emails.
-- =============================================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select no_grant_op from c_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from kitchen_order_contact
    where order_id in (select order_a from c_ctx union all select order_b from c_ctx)),
  0, 'an account with no orders.view_pii reads no emails at all — the screen shows "not shown"');

-- =============================================================================
-- Part 4. A disabled account reads nothing, whatever it was granted.
-- =============================================================================

reset role;
update app_user set is_disabled = true where id = (select platform_op from c_ctx);

select set_config('request.jwt.claims',
  json_build_object('sub', (select platform_op from c_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

/*
 * `auth_is_live_user()` is restated inside the view precisely because being a definer view lets it
 * bypass `deny_dead_accounts`. §12 holds the other two exceptions to the same bargain; this proves
 * this one keeps it, rather than asserting the string is present.
 */
select is(
  (select count(*)::int from kitchen_order_contact),
  0, 'a DISABLED platform admin reads nothing — the definer view restates the restriction it bypasses');

reset role;

select * from finish();
rollback;
