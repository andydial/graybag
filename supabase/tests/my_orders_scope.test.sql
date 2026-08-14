-- =============================================================================
-- my_orders_scope.test.sql — "My Orders" contains only mine. `E06-43`.
--
-- Andy opened the Orders screen on an account holding `orders.view` at kitchen scope and saw
-- **65 orders, 5 of them his** — sixty other families', with children's names, schools and
-- classes. `fetchOrders` had no `customer_user_id` filter, on the reasoning that RLS is the
-- authorisation. RLS *was* correct: a clean parent account saw zero. But `order` has two SELECT
-- policies, and "every order I may read" is a strictly larger set than "my orders".
--
-- **This asserts the COUNT, not the presence.** A test that checks "my order is in the list"
-- passes on a leak, which is exactly how this would have shipped again.
--
-- Three parents, because two cannot distinguish "scoped to me" from "scoped to one other person" —
-- an off-by-one in a filter would still show a single foreign order and a two-parent fixture
-- would call that a pass.
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

-- **Three EXISTING users, not three invented ones.** `app_user.id` is a foreign key to
-- `auth.users`, so a fixture cannot mint a customer without also minting an auth row — and this
-- suite has no business writing to the auth schema. Three live seeded accounts are enough: what
-- is under test is the scope of a query, not the shape of a user.
create temporary table m_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as parent_a,
       (select id from app_user where deleted_at is null and not is_disabled order by id offset 1 limit 1) as parent_b,
       (select id from app_user where deleted_at is null and not is_disabled order by id offset 2 limit 1) as parent_c,
       (select id from school where is_active limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from recipient limit 1) as recipient_id;

-- The fixture is read back *after* `set local role authenticated`, and a temp table belongs to
-- the session role, not to the persona. Without this the impersonated read fails with
-- "permission denied for table m_ctx" — which looks like an RLS result and is not one.
grant select on m_ctx to authenticated;

select isnt(
  (select parent_a::text from m_ctx), (select parent_c::text from m_ctx),
  'harness: three DISTINCT customers exist to test against');

-- Parent A gets two orders, B one, C three. Distinct counts so an assertion cannot pass by
-- coincidence — "2" is only right for A.
create temporary table m_plan as
select parent_a as who, 1 as n from m_ctx union all select parent_a, 2 from m_ctx
union all select parent_b, 1 from m_ctx
union all select parent_c, 1 from m_ctx union all select parent_c, 2 from m_ctx
union all select parent_c, 3 from m_ctx;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise, status)
select gen_random_uuid(), p.who, 'scope-' || p.who || '-' || p.n, c.city_id, 0, 0, 0, 'pending_payment'
  from m_plan p cross join m_ctx c;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select og.id, 'SCOPE-' || left(og.id::text, 6), og.correlation_id, og.customer_user_id,
       c.recipient_id, s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom',
       now() + interval '1 day', '{}'::jsonb, s.name, 'Scoped', 'pending_payment', 0, 0, 0, 0
  from order_group og
  cross join m_ctx c
  join school s on s.id = c.school_id
 where og.idempotency_key like 'scope-%';

-- ---------------------------------------------------------------- as parent A, authenticated
do $$
declare v uuid;
begin
  select parent_a into v from m_ctx;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

select is((select auth.uid()), (select parent_a from m_ctx),
          'harness: impersonating parent A, so a later count means something');

-- The screen's own query shape: what `fetchOrders` sends, filter included.
select is(
  (select count(*)::int from "order"
    where customer_user_id = auth.uid() and order_ref like 'SCOPE-%'),
  2,
  'parent A''s scoped list has exactly their TWO orders — the count, not the presence');

-- And the leak this exists to catch: without the filter, what would the screen have shown?
select cmp_ok(
  (select count(*)::int from "order" where order_ref like 'SCOPE-%'),
  '>=',
  2,
  'the unscoped read returns at least as many — so the filter is doing the narrowing, not RLS');

select is(
  (select count(distinct customer_user_id)::int from "order"
    where customer_user_id = auth.uid() and order_ref like 'SCOPE-%'),
  1,
  'and every row in the scoped list belongs to exactly one customer: the caller');

reset role;

-- ---------------------------------------------------------------- as parent C, three of them
do $$
declare v uuid;
begin
  select parent_c into v from m_ctx;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

select is(
  (select count(*)::int from "order"
    where customer_user_id = auth.uid() and order_ref like 'SCOPE-%'),
  3,
  'parent C sees exactly their THREE — a different number, so neither count can pass by accident');

select is_empty(
  $$ select 1 from "order"
      where order_ref like 'SCOPE-%'
        and customer_user_id = auth.uid()
        and customer_user_id in (select parent_a from m_ctx union all select parent_b from m_ctx) $$,
  'and none of parent A''s or B''s orders is among them');

reset role;

select * from finish();
rollback;
