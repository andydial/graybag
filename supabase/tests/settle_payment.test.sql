-- =============================================================================
-- settle_payment.test.sql — `E06-06`. A capture becomes a confirmed order.
--
-- The assertions that matter are the second-run ones. `settle_payment` is idempotent **without a
-- flag** — §7.1 layers 5-8 refuse every write of a repeat — and the way to test that is to replay
-- the whole function rather than to check a boolean, which is what §7.1 says outright.
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

create temporary table s_ctx as
select 'e1000000-7e57-0000-0000-0000000000c9'::uuid as group_id,
       (select id from school where is_active limit 1) as school_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from s_ctx), (select id from app_user limit 1),
       'settle-test', (select id from city limit 1), 20000, 1000, 21000;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select (select group_id from s_ctx), 'ST-1', gen_random_uuid(),
       (select id from app_user limit 1), (select id from recipient limit 1),
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Test', 'pending_payment', 20000, 500, 500, 21000
  from school s where s.id = (select school_id from s_ctx);

insert into payment (order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
select (select group_id from s_ctx), 'razorpay', 'order_settle_c9', 21000, 'created',
       gen_random_uuid();

-- =============================================================================
-- 1. The happy path.
-- =============================================================================

create temporary table s_first as
select settle_payment('order_settle_c9', 'pay_settle_c9', 21000) as r;

select is((select (r->>'already_settled')::boolean from s_first), false,
  'E06-06: the first settlement reports itself as the first');

select is((select status::text from payment where provider_order_id = 'order_settle_c9'),
  'captured', 'the payment is captured');

select is((select status::text from "order" where order_group_id = (select group_id from s_ctx)),
  'paid', 'T5: the order is paid — and via the transition trigger, as `system`');

select matches((select pickup_code from "order" where order_group_id = (select group_id from s_ctx)),
  '^[0-9]{4}$',
  '§9.4: a four-digit pickup code is allocated ON CAPTURE. OrderPlacedScreen refuses to render '
  'without one, treating its absence as a second witness that money did not move');

select ok((select confirmed_at is not null from "order"
            where order_group_id = (select group_id from s_ctx)),
  'and confirmed_at is stamped');

select is((select status::text from order_group where id = (select group_id from s_ctx)),
  'paid', 'G7: the group derives to paid');

-- The money, both sides of it.
select is(ledger_balance((select id from ledger_account where code = 'provider:razorpay:clearing')),
  21000::bigint,
  'the whole captured amount is debited to the clearing account — it is money Razorpay holds for '
  'us until settlement');

select is(ledger_balance((select id from ledger_account where code = 'platform:revenue')),
  20000::bigint, 'revenue is credited the taxable value, exclusive of GST');

select is(ledger_balance((select id from ledger_account where code = 'platform:tax_payable:cgst'))
        + ledger_balance((select id from ledger_account where code = 'platform:tax_payable:sgst')),
  1000::bigint, 'and the tax is credited to the two tax accounts, not lumped into revenue');

-- =============================================================================
-- 2. The replay. This is the subject of the file.
-- =============================================================================

create temporary table s_again as
select settle_payment('order_settle_c9', 'pay_settle_c9', 21000) as r;

select is((select (r->>'already_settled')::boolean from s_again), true,
  '§7.1: a second delivery of the same event settles nothing and says so. Razorpay retries by '
  'design, so this is the ordinary case rather than an error');

select is(ledger_balance((select id from ledger_account where code = 'platform:revenue')),
  20000::bigint,
  'and the money is NOT counted twice — the assertion the whole idempotency design exists for');

select is((select (r->>'pickup_code') from s_again), (select (r->>'pickup_code') from s_first),
  'the replay returns the SAME pickup code — a second one would be a second thing to quote at a '
  'counter');

select is((select count(*)::int from ledger_transaction where reason_code = 'sale'), 1,
  'one sale posting, not two');

-- =============================================================================
-- 3. What it refuses.
-- =============================================================================

select throws_ok(
  $$ select settle_payment('order_does_not_exist', 'pay_x', 21000) $$,
  'P0001', null,
  '§10.9: a payment we have no record of is refused rather than invented — almost always the '
  'other environment talking to us');

select * from finish();
rollback;
