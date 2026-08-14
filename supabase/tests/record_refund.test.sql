-- =============================================================================
-- record_refund.test.sql — a refund issued by hand in the dashboard flows back, ONCE.
-- `E06-46`. T13, §7.3, §8.3.
--
-- **The assertion this file exists for is the second delivery.**
--
-- Razorpay refunds are not idempotent — the `E19` sitting made two real refunds from two
-- identical POSTs — and a webhook is redelivered by design. If each delivery reversed the sale
-- and moved the order, one disbursement would be recorded three times: the mirror image of the
-- provider's defect, and harder to spot because nothing external disagrees with us.
--
-- Everything else here is the supporting cast. The dedupe is the point.
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

create temporary table rr_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as customer_id,
       (select id from school where is_active limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from recipient limit 1) as recipient_id;

-- A settled group: order_group, one paid order, a captured payment and the `sale` posting the
-- reversal has to find. Built by hand rather than through `settle_payment`, because that
-- function needs a Razorpay-shaped world; what is under test is what happens AFTER settlement.
create temporary table rr_ids as
with g as (
  insert into order_group (customer_user_id, idempotency_key, city_id, subtotal_paise,
                           tax_total_paise, payable_paise, status)
  select customer_id, 'rr-1', city_id, 20000, 1000, 21000, 'pending_payment' from rr_ctx
  returning id
)
select id as group_id from g;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select i.group_id, 'RR-0001', gen_random_uuid(), c.customer_id, c.recipient_id,
       s.id, s.kitchen_id, s.city_id, current_date + 7, 'classroom', now() + interval '3 days',
       '{"customer_cancellation_allowed": true, "customer_cancellation_cutoff_minutes": 120,
         "refund_default_destination": "source"}'::jsonb,
       s.name, 'Refund', 'pending_payment', 20000, 500, 500, 21000
  from rr_ids i cross join rr_ctx c join school s on s.id = c.school_id;

-- `create table as` takes a SELECT, not an INSERT — the returning clause has to come out of a
-- CTE. Writing it the obvious way fails with "syntax error at or near insert".
create temporary table rr_pay as
with p as (
  insert into payment (order_group_id, provider, provider_order_id, provider_payment_id,
                       amount_paise, status, captured_at, correlation_id)
  select i.group_id, 'razorpay', 'order_RR1', 'pay_RR1', 21000, 'captured', now(),
         (select correlation_id from "order" where order_group_id = i.group_id limit 1)
    from rr_ids i
  returning id
)
select id from p;

update "order" set status = 'paid' where order_group_id = (select group_id from rr_ids);

-- The sale posting. `settle_payment` writes it as (`sale`, `payment`, payment.id) — the
-- reversal looks it up by exactly that triple, so the fixture must match or the test would
-- prove nothing about the lookup.
select post_ledger_transaction(
  'sale', 'payment', (select id from rr_pay),
  jsonb_build_array(
    jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',  'amount_paise', 21000),
    jsonb_build_object('account', 'platform:revenue',           'direction', 'credit', 'amount_paise', 21000)),
  now(), (select correlation_id from "order" where order_group_id = (select group_id from rr_ids) limit 1),
  'fixture sale', null, null);

-- =============================================================================
-- 1. The first delivery does everything.
-- =============================================================================

create temporary table rr_first as
select record_refund('rfnd_RR1', 'pay_RR1', 21000, 'cancelled by parent') as r;

select is((select (r->>'already_recorded')::boolean from rr_first), false,
          'the first delivery records the refund');

select is(
  (select status::text from refund where provider_refund_id = 'rfnd_RR1'),
  'completed',
  'the refund is completed, not pending — Razorpay says the money has gone');

select is(
  (select o.status::text from "order" o where o.order_group_id = (select group_id from rr_ids)),
  'refunded',
  'T13: the order reaches refunded, via cancelled — a refund with no cancellation loses WHY');

select is(
  (select o.refunded_total_paise from "order" o where o.order_group_id = (select group_id from rr_ids)),
  21000::bigint,
  'and the refunded total is the whole of it');

-- The cancellation was nobody's in the app, so it is recorded as the ADMIN's — a human with
-- dashboard access really did this, and `system` has no paid -> cancelled transition anyway.
select is(
  (select oe.actor_type::text from order_event oe
     join "order" o on o.id = oe.order_id
    where o.order_group_id = (select group_id from rr_ids)
      and oe.to_status = 'cancelled' limit 1),
  'admin',
  'the cancellation is the ADMIN''s — a person in the dashboard, not an automated decision');

-- =============================================================================
-- 2. The ledger: an equal and opposite transaction, never an edit.
-- =============================================================================

select isnt((select (r->>'ledger_reversal_id') from rr_first), null,
            'the sale was reversed');

select is(
  (select lt.reversal_of_transaction_id from ledger_transaction lt
    where lt.id = ((select (r->>'ledger_reversal_id') from rr_first))::uuid),
  (select id from ledger_transaction
    where source_type = 'payment' and source_id = (select id from rr_pay)
      and reason_code = 'sale' and reversal_of_transaction_id is null),
  'and it points at the sale it reverses, so both halves of the correction are found together');

-- The whole reason double entry is here: the reversal balances the original exactly.
select is(
  -- `::bigint` — `sum()` over bigint returns NUMERIC, and pgTAP's `is()` needs both sides the
  -- same type. Same trap as `ledger_posting.test.sql` §5.
  (select sum(case when direction = 'debit' then amount_paise else -amount_paise end)::bigint
     from ledger_entry
    where transaction_id in (
      (select id from ledger_transaction where source_type = 'payment'
         and source_id = (select id from rr_pay) and reversal_of_transaction_id is null),
      ((select (r->>'ledger_reversal_id') from rr_first))::uuid)),
  0::bigint,
  'sale and reversal sum to zero — the money is back where it started');

-- =============================================================================
-- 3. The credit note withdraws the tax invoice, and copies it rather than recomputing.
-- =============================================================================

select is((select (r->>'credit_note_id') from rr_first), null,
          'no tax invoice on this group, so no credit note — and that is not an error');

-- Now with an invoice, on a second group, so the copy can be asserted against a real original.
create temporary table rr_g2 as
with g as (
  insert into order_group (customer_user_id, idempotency_key, city_id, subtotal_paise,
                           tax_total_paise, payable_paise, status)
  select customer_id, 'rr-2', city_id, 20000, 1000, 21000, 'pending_payment' from rr_ctx
  returning id
)
select id as group_id from g;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select i.group_id, 'RR-0002', gen_random_uuid(), c.customer_id, c.recipient_id,
       s.id, s.kitchen_id, s.city_id, current_date + 7, 'classroom', now() + interval '3 days',
       '{"refund_default_destination": "source"}'::jsonb,
       s.name, 'Refund', 'pending_payment', 20000, 500, 500, 21000
  from rr_g2 i cross join rr_ctx c join school s on s.id = c.school_id;

create temporary table rr_pay2 as
with p as (
  insert into payment (order_group_id, provider, provider_order_id, provider_payment_id,
                       amount_paise, status, captured_at, correlation_id)
  select i.group_id, 'razorpay', 'order_RR2', 'pay_RR2', 21000, 'captured', now(),
         (select correlation_id from "order" where order_group_id = i.group_id limit 1)
    from rr_g2 i
  returning id
)
select id from p;

update "order" set status = 'paid' where order_group_id = (select group_id from rr_g2);

create temporary table rr_inv as select issue_invoice((select group_id from rr_g2)) as id;

create temporary table rr_second as
select record_refund('rfnd_RR2', 'pay_RR2', 21000, null) as r;

select isnt((select (r->>'credit_note_id') from rr_second), null,
            'an invoiced group gets a credit note');

select is(
  (select document_type::text from invoice
    where id = ((select (r->>'credit_note_id') from rr_second))::uuid),
  'credit_note',
  'of the right document type — the enum the invoice mailer filters on');

select is(
  (select credit_note_of_invoice_id from invoice
    where id = ((select (r->>'credit_note_id') from rr_second))::uuid),
  (select id from rr_inv),
  'pointing at the invoice it withdraws');

-- §13.2: the pair must agree about what was charged. Recomputing from the orders would read
-- rows that now say `refunded` and could have been touched by anything since.
select is(
  (select array[taxable_value_paise, cgst_paise, sgst_paise, total_paise] from invoice
    where id = ((select (r->>'credit_note_id') from rr_second))::uuid),
  (select array[taxable_value_paise, cgst_paise, sgst_paise, total_paise] from invoice
    where id = (select id from rr_inv)),
  'with the ORIGINAL''s figures copied, not recomputed — the pair must agree about what was charged');

select is(
  (select seller_gstin from invoice
    where id = ((select (r->>'credit_note_id') from rr_second))::uuid),
  (select seller_gstin from invoice where id = (select id from rr_inv)),
  'and the original''s seller identity, which is what was in force at the supply');

select is(
  (select count(*)::int from invoice_line
    where invoice_id = ((select (r->>'credit_note_id') from rr_second))::uuid),
  (select count(*)::int from invoice_line where invoice_id = (select id from rr_inv)),
  'line for line');

-- =============================================================================
-- 4. THE ASSERTION THIS FILE EXISTS FOR: the second delivery changes nothing.
-- =============================================================================

create temporary table rr_before as
select (select count(*)::int from refund) as refunds,
       (select count(*)::int from ledger_transaction) as txns,
       (select count(*)::int from invoice) as invoices,
       (select count(*)::int from ledger_entry) as entries;

create temporary table rr_again as
select record_refund('rfnd_RR2', 'pay_RR2', 21000, null) as r;

select is((select (r->>'already_recorded')::boolean from rr_again), true,
          'a redelivered refund.processed says already_recorded and does nothing');

select is((select count(*)::int from refund), (select refunds from rr_before),
          'no second refund row — Razorpay refunds are NOT idempotent, and we must not compound that');

select is((select count(*)::int from ledger_transaction), (select txns from rr_before),
          'NO SECOND LEDGER REVERSAL — one disbursement, recorded once');

select is((select count(*)::int from ledger_entry), (select entries from rr_before),
          'and no orphan entries');

select is((select count(*)::int from invoice), (select invoices from rr_before),
          'no second credit note, so the gapless series is not burned by a redelivery');

-- A third, because "handles two" and "is idempotent" are different claims and webhooks retry
-- more than once.
select record_refund('rfnd_RR2', 'pay_RR2', 21000, null);
select is((select count(*)::int from ledger_transaction), (select txns from rr_before),
          'and a third delivery is still a no-op');

-- =============================================================================
-- 5. The refusals.
-- =============================================================================

select throws_matching(
  $$ select record_refund('rfnd_X', 'pay_DOES_NOT_EXIST', 100, null) $$,
  'no payment',
  'a refund for a charge this system never took is refused (§10.9 — one test account, several things)');

-- Partial refunds: refused rather than mis-recorded. A full reversal of a part refund would
-- overstate the ledger and issue a credit note for money we did not return — and §13.2 makes
-- that document immutable, so it could never be corrected.
create temporary table rr_g3 as
with g as (
  insert into order_group (customer_user_id, idempotency_key, city_id, subtotal_paise,
                           tax_total_paise, payable_paise, status)
  select customer_id, 'rr-3', city_id, 20000, 1000, 21000, 'pending_payment' from rr_ctx
  returning id
)
select id as group_id from g;

insert into payment (order_group_id, provider, provider_order_id, provider_payment_id,
                     amount_paise, status, captured_at, correlation_id)
select group_id, 'razorpay', 'order_RR3', 'pay_RR3', 21000, 'captured', now(), gen_random_uuid()
  from rr_g3;

select throws_matching(
  $$ select record_refund('rfnd_RR3', 'pay_RR3', 5000, null) $$,
  'partial refund',
  'a PARTIAL refund is refused, not approximated — E06-08, and a wrong credit note is immutable');

select is((select count(*)::int from refund where provider_refund_id = 'rfnd_RR3'), 0,
          'and it recorded nothing at all');

-- =============================================================================
-- 6. Grants, and the actor left as it was found.
-- =============================================================================

select ok(has_function_privilege('service_role', 'record_refund(text,text,bigint,text)', 'execute'),
          'service_role may execute it — the drain''s client');

select ok(not has_function_privilege('anon', 'record_refund(text,text,bigint,text)', 'execute'),
          'anon may not reverse a sale in our ledger');

select is(current_setting('app.actor_type', true), 'system',
          'record_refund put the caller''s actor back — a drain processes several events in one transaction');

select * from finish();
rollback;
