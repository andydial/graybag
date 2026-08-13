-- =============================================================================
-- begin_payment.test.sql — `E06-02`. A Razorpay order is recorded against a priced group.
--
-- The interesting assertions are the refusals. A writer that records what it is told is trivial;
-- what earns this function its existence is that it will not record a payment against somebody
-- else's order, against an order already paid, or for an amount that disagrees with what we
-- priced. Each of those is a way a customer gets charged wrongly, and none of them is visible
-- from the row afterwards.
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

create temporary table b_ctx as
select 'e1000000-7e57-0000-0000-0000000000d1'::uuid as group_id,
       'e1000000-7e57-0000-0000-0000000000d2'::uuid as other_group_id,
       (select id from app_user order by id limit 1) as owner_id,
       (select id from app_user order by id desc limit 1) as stranger_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise, status)
select (select group_id from b_ctx), (select owner_id from b_ctx),
       'begin-payment-test', (select id from city limit 1), 20000, 1000, 21000, 'pending_payment';

-- ---------------------------------------------------------------- the happy path
select is(
  (select count(*)::int from begin_payment(
     (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP001', 21000)),
  1,
  'records one payment for a priced, owned, payable group');

select is(
  (select p.status::text from payment p where p.provider_order_id = 'order_TESTRZP001'),
  'created',
  'the payment starts at created, not authorized');

select is(
  (select p.amount_paise from payment p where p.provider_order_id = 'order_TESTRZP001'),
  21000::bigint,
  'stores OUR priced figure');

select is(
  (select p.correlation_id from payment p where p.provider_order_id = 'order_TESTRZP001'),
  (select og.correlation_id from order_group og where og.id = (select group_id from b_ctx)),
  'copies the group''s correlation id rather than minting a new one (§13.6)');

select is(
  (select p.attempt_no from payment p where p.provider_order_id = 'order_TESTRZP001'),
  1::smallint,
  'the first attempt is numbered 1');

-- ---------------------------------------------------------------- a second attempt
--
-- Legitimate and required: a parent whose card is declined taps Pay again. The abandoned row must
-- survive, because §10's reconcilers read it.
select is(
  (select attempt_no from begin_payment(
     (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP002', 21000)),
  2::smallint,
  'a second attempt is allowed and numbered 2');

select is(
  (select count(*)::int from payment where order_group_id = (select group_id from b_ctx)),
  2,
  'the abandoned first attempt is still there');

-- ---------------------------------------------------------------- ownership
select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select stranger_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP003', 21000),
  '%not authorized%',
  'refuses a caller who does not own the group');

select is(
  (select count(*)::int from payment where provider_order_id = 'order_TESTRZP003'),
  0,
  'and writes nothing when it refuses');

-- ---------------------------------------------------------------- the amount
--
-- The argument is what we asked Razorpay for. If it disagrees with what we priced, the customer
-- is being charged something we did not calculate, and the right outcome is no payment row.
select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP004', 19999),
  '%amount disagrees%',
  'refuses an amount that is not the priced payable');

select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP005', 2100000),
  '%amount disagrees%',
  'refuses an amount that is too HIGH, not only too low');

-- ---------------------------------------------------------------- required argument
select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select group_id from b_ctx), '   ', 21000),
  '%provider_order_id is required%',
  'refuses a blank provider order id rather than storing whitespace');

-- ---------------------------------------------------------------- unknown group
select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), 'e1000000-7e57-0000-0000-00000000dead', 'order_X', 21000),
  '%no such order group%',
  'refuses an order group that does not exist');

-- ---------------------------------------------------------------- already settled
update order_group set status = 'paid' where id = (select group_id from b_ctx);

select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP006', 21000),
  '%already paid%',
  'refuses a second provider order on a group that has already settled');

update order_group set status = 'cancelled' where id = (select group_id from b_ctx);
select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP007', 21000),
  '%no longer be paid%',
  'refuses a cancelled group');

update order_group set status = 'refunded' where id = (select group_id from b_ctx);
select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP008', 21000),
  '%no longer be paid%',
  'refuses a refunded group — settled money in the other direction is still settled');

-- `payment_failed` is deliberately payable: a declined card is the commonest reason to tap Pay
-- again, and refusing the retry strands the order with no way forward but a new cart.
update order_group set status = 'payment_failed' where id = (select group_id from b_ctx);
select is(
  (select count(*)::int from begin_payment(
     (select owner_id from b_ctx), (select group_id from b_ctx), 'order_TESTRZP009', 21000)),
  1,
  'ALLOWS a retry after payment_failed');

-- ---------------------------------------------------------------- nothing to pay
insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise, status)
select (select other_group_id from b_ctx), (select owner_id from b_ctx),
       'begin-payment-zero', (select id from city limit 1), 0, 0, 0, 'pending_payment';

select throws_ilike(
  format('select * from begin_payment(%L, %L, %L, %s)',
         (select owner_id from b_ctx), (select other_group_id from b_ctx), 'order_TESTRZP010', 0),
  '%nothing to pay%',
  'refuses a zero payable rather than asking Razorpay for nothing (E06-10 wallet-only)');

-- ---------------------------------------------------------------- privileges
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_name = 'begin_payment' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0,
  'is not executable by anon or authenticated — the user id parameter would be an escalation');

select * from finish();
rollback;
