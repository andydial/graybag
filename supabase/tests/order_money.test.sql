-- =============================================================================
-- order_money.test.sql — `E02-36` step 1. The view, and who its predicate admits.
--
-- The hole: RLS filters rows, not columns, so a kitchen operator correctly denied another
-- kitchen's orders is still served every money column on their own. There is exactly one
-- `authenticated` role, shared by parents, admins and kitchen staff, so no policy and no column
-- grant can express "this authenticated user but not that one". A `where` clause can, and this
-- file is about whether that clause is the right one.
--
-- **Step 3 — the `revoke select` — has NOT landed**, so nothing here asserts that a kitchen
-- operator is blocked from the base table. That is deliberate: `kitchen-scope.test.mjs` asserts
-- the gap as it currently behaves and must keep passing until step 3, when inverting it is step 4.
-- What is asserted here is that the view is ready to be the only path when that day comes.
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
-- The shape, before the behaviour. A view that is invoker rather than definer would return
-- nothing to everybody the moment step 3 lands, and would do it silently.
-- -----------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class where relname = 'order_money' and relkind = 'v'),
  1,
  'the view exists'
);

select is(
  (select coalesce(c.reloptions::text, '') like '%security_invoker%'
     from pg_class c where c.relname = 'order_money'),
  false,
  'it is DEFINER — an invoker view would hit the step-3 revoke and return nothing to everyone'
);

select is(
  (select has_table_privilege('authenticated', 'order_money', 'select')),
  true,
  'and `authenticated` may select from it'
);

-- Every money column the proposal names is present. A column left out of the view is a column
-- that becomes unreadable to everybody at step 3 — the failure would be a blank total on a
-- parent''s order screen, and it would not surface until the revoke landed.
select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'order_money'
      and column_name in ('subtotal_paise','tax_cgst_paise','tax_sgst_paise','tax_igst_paise',
                          'discount_paise','total_paise','refunded_total_paise')),
  7,
  'it carries all seven money columns — one missing becomes unreadable to everybody at step 3'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'order_money' and column_name = 'id'),
  1,
  'and `id`, which is what the client joins on'
);

-- **No PII.** The view exists to widen access to money; it must not widen access to anything else.
select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'order_money'
      and (column_name ilike '%name%' or column_name ilike '%recipient%'
        or column_name ilike '%email%' or column_name ilike '%phone%')),
  0,
  'and NOTHING else — no name, no recipient, no contact. This widens access to money, not to a child'
);

-- -----------------------------------------------------------------------------
-- The predicate: a parent sees their own order's money and no one else's.
-- -----------------------------------------------------------------------------

insert into auth.users (id) values ('a0000000-7e57-0000-0000-000000000236');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-000000000236', 'money@example.test', 'Money')
on conflict (id) do update set email = excluded.email;

insert into auth.users (id) values ('a0000000-7e57-0000-0000-000000000237');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-000000000237', 'other@example.test', 'Other')
on conflict (id) do update set email = excluded.email;

create temporary table om as
select 'a0000000-7e57-0000-0000-000000000236'::uuid as mine,
       'a0000000-7e57-0000-0000-000000000237'::uuid as theirs,
       (select id from school where is_active and onboarded_at is not null order by name limit 1) as school_id,
       (select id from city limit 1) as city_id;

create temporary table om_kid as
select (create_recipient(
          p_guardian_user_id => (select mine from om),
          p_first_name => 'Money', p_last_name => null,
          p_school_id => (select school_id from om),
          p_class_label => '4', p_section_label => 'A',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

create temporary table om_order as
with og as (
  insert into order_group (customer_user_id, idempotency_key, status, city_id,
                           subtotal_paise, tax_total_paise, payable_paise)
  select mine, 'om-' || gen_random_uuid(), 'paid', city_id, 6000, 300, 6300 from om
  returning id
), o as (
  insert into "order" (order_group_id, customer_user_id, recipient_id, school_id, kitchen_id,
                       city_id, service_date, delivery_mode, cutoff_at, config_snapshot,
                       school_name_snapshot, recipient_name_snapshot, status, order_ref,
                       correlation_id, subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
  select og.id, om.mine, (select id from om_kid), om.school_id,
         (select kitchen_id from school where id = om.school_id), om.city_id,
         current_date + 1, 'classroom', now() + interval '1 day', '{}'::jsonb,
         'Money School', 'Money', 'pending_payment',
         'OM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)), gen_random_uuid(),
         6000, 150, 150, 6300
    from og, om
  returning id
) select id from o;

-- The order group's totals must equal the sum of its orders (`0070`), so square them up.
update order_group set subtotal_paise = 6000, tax_total_paise = 300, payable_paise = 6300
 where id = (select order_group_id from "order" where id = (select id from om_order));

/**
 * Read `order_money` as a given user, exactly as PostgREST would.
 *
 * The order id is a PARAMETER rather than a lookup inside the function: `authenticated` has no
 * privileges on this file's temp tables, so querying `om_order` after the role switch fails with
 * `permission denied` — which looks like the view refusing the caller and is not.
 */
create function tests_tmp.money_rows_for(p_user uuid, p_order uuid) returns int
language plpgsql as $$
declare n int;
begin
  set local role authenticated;
  execute format('set local request.jwt.claims = %L',
                 json_build_object('sub', p_user, 'role', 'authenticated')::text);
  select count(*) into n from order_money where id = p_order;
  reset role;
  return n;
end;
$$;

select is(
  tests_tmp.money_rows_for((select mine from om), (select id from om_order)),
  1,
  'THE PARENT WHO PAID sees their own order''s money'
);

select is(
  tests_tmp.money_rows_for((select theirs from om), (select id from om_order)),
  0,
  'ANOTHER PARENT sees nothing — the predicate is the rule, not a column list in a client'
);

select is(
  tests_tmp.money_rows_for('a0000000-7e57-0000-0000-0000000002ff'::uuid, (select id from om_order)),
  0,
  'and an account that does not exist sees nothing'
);

-- -----------------------------------------------------------------------------
-- The kitchen operator: the persona this ticket is about.
-- -----------------------------------------------------------------------------
--
-- `orders.view_financials` is what the predicate admits. A kitchen operator holding only
-- `orders.view`, `orders.view_pii` and `orders.mark_delivered` does NOT hold it, so the view
-- refuses them — which is the whole point, and is true today even though the base table still
-- serves them the columns.

-- Granted by inserting into `permission_grant`, which is how the authorization suite does it —
-- there is no `grant_permission()` RPC in the database, only the admin Edge Function.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
select (select theirs from om), 'orders.view', 'kitchen'::scope_type,
       (select kitchen_id from school where id = (select school_id from om)),
       (select mine from om);

select is(
  tests_tmp.money_rows_for((select theirs from om), (select id from om_order)),
  0,
  'THE KITCHEN OPERATOR STILL SEES NO MONEY through the view — they hold orders.view, not orders.view_financials'
);

insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
select (select theirs from om), 'orders.view_financials', 'kitchen'::scope_type,
       (select kitchen_id from school where id = (select school_id from om)),
       (select mine from om);

select is(
  tests_tmp.money_rows_for((select theirs from om), (select id from om_order)),
  1,
  '...the view admits them — so the back office keeps working when step 3 lands'
);

-- -----------------------------------------------------------------------------
-- A DEFINER view bypasses RLS, so it must restate every restriction it skips.
-- -----------------------------------------------------------------------------
--
-- `"order"` carries a RESTRICTIVE `deny_dead_accounts` policy. A definer view does not see it, so
-- without `auth_is_live_user()` in the predicate a disabled account would read its own order money
-- through the view while RLS refuses it on the table. `authorization.test.sql` is what pointed
-- this out — its rule that every view be `security_invoker` exists for exactly this reason, and
-- this view is a reasoned exception that has to pay the price of being one.

update app_user set is_disabled = true where id = (select mine from om);

select is(
  tests_tmp.money_rows_for((select mine from om), (select id from om_order)),
  0,
  'A DISABLED ACCOUNT reads nothing through the view — the restriction the definer bypasses is restated in the predicate'
);

update app_user set is_disabled = false where id = (select mine from om);

select is(
  tests_tmp.money_rows_for((select mine from om), (select id from om_order)),
  1,
  'and comes back when the account does — the clause gates on liveness, not on having ever been disabled'
);

select * from finish();
rollback;
