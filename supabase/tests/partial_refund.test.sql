-- =============================================================================
-- partial_refund.test.sql — a part refund reconciles. `E06-08`.
--
-- The three things Andy asked to become proportional, and one property that holds them together:
--
--   1. **The ledger balances and is proportional.** An unbalanced posting is refused by
--      `post_ledger_transaction`, so the rounding remainder has to land somewhere deliberate.
--   2. **The credit note totals the money that actually moved** — not the invoice, and not a
--      recomputation from the rate that could disagree with the invoice by a paise.
--   3. **The order is `partially_refunded`, not `cancelled`.** The food is still coming.
--
--   4. And: **two partials that together return everything close the order**, which is the case a
--      full-or-partial branch keyed on one refund's amount gets wrong.
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

create temporary table pf_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as customer_id,
       (select id from school where is_active limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from recipient limit 1) as recipient_id;

-- A settled group: 21000 paise = 20000 taxable + 500 CGST + 500 SGST. Chosen so a 5000-paise
-- part refund does NOT divide cleanly — 5000/21000 of 500 is 119.047…, which is exactly the
-- rounding the credit note and the ledger both have to handle without disagreeing with the bank.
create temporary table pf_g as
with g as (
  insert into order_group (customer_user_id, idempotency_key, city_id, subtotal_paise,
                           tax_total_paise, payable_paise, status)
  select customer_id, 'pf-1', city_id, 20000, 1000, 21000, 'pending_payment' from pf_ctx
  returning id
)
select id as group_id from g;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select i.group_id, 'PF-0001', gen_random_uuid(), c.customer_id, c.recipient_id,
       s.id, s.kitchen_id, s.city_id, current_date + 7, 'classroom', now() + interval '3 days',
       '{"refund_default_destination": "source"}'::jsonb,
       s.name, 'Partial', 'pending_payment', 20000, 500, 500, 21000
  from pf_g i cross join pf_ctx c join school s on s.id = c.school_id;

create temporary table pf_pay as
with p as (
  insert into payment (order_group_id, provider, provider_order_id, provider_payment_id,
                       amount_paise, status, captured_at, correlation_id)
  select i.group_id, 'razorpay', 'order_PF1', 'pay_PF1', 21000, 'captured', now(),
         (select correlation_id from "order" where order_group_id = i.group_id limit 1)
    from pf_g i
  returning id
)
select id from p;

update "order" set status = 'paid' where order_group_id = (select group_id from pf_g);

-- The sale, exactly as `settle_payment` posts it: four entries, real `source_id`.
select post_ledger_transaction(
  'sale', 'payment', (select id from pf_pay),
  '[{"account": "provider:razorpay:clearing", "direction": "debit",  "amount_paise": 21000},
    {"account": "platform:revenue",           "direction": "credit", "amount_paise": 20000},
    {"account": "platform:tax_payable:cgst",  "direction": "credit", "amount_paise": 500},
    {"account": "platform:tax_payable:sgst",  "direction": "credit", "amount_paise": 500}]'::jsonb,
  now(), (select correlation_id from "order" where order_group_id = (select group_id from pf_g) limit 1),
  'fixture sale', null, null);

create temporary table pf_inv as select issue_invoice((select group_id from pf_g)) as id;

-- =============================================================================
-- 1. A 5000-paise part refund is ACCEPTED. `0054` refused this outright.
-- =============================================================================

create temporary table pf_r1 as
select record_refund('rfnd_PF_A', 'pay_PF1', 5000, 'one dish unavailable') as r;

select is((select (r->>'is_full_refund')::boolean from pf_r1), false,
          'a 5000-of-21000 refund is recorded as PARTIAL');

select is((select (r->>'refunded_total_paise')::bigint from pf_r1), 5000::bigint,
          'and the running total is the amount returned');

-- =============================================================================
-- 2. The order is partially refunded, and is NOT cancelled. The food is still coming.
-- =============================================================================

select is(
  (select o.status::text from "order" o where o.order_group_id = (select group_id from pf_g)),
  'paid',
  'the ORDER is still paid — a part refund is a money fact, not a decision that lunch is off');

select is(
  (select og.status::text from order_group og where og.id = (select group_id from pf_g)),
  'partially_refunded',
  'and the GROUP derives partially_refunded through 0044 G6 — the state that distinguishes '
  'this from cancelled');

select is(
  (select o.refunded_total_paise from "order" o where o.order_group_id = (select group_id from pf_g)),
  5000::bigint,
  'refunded_total_paise carries the money, which is where a part refund actually lives');

-- =============================================================================
-- 3. The ledger: proportional, balanced, and NOT a reversal.
-- =============================================================================

select is(
  (select count(*)::int from ledger_transaction
    where source_type = 'refund'
      and source_id = ((select (r->>'refund_id') from pf_r1))::uuid),
  1,
  'the refund posted its own transaction, sourced on the refund row');

select is(
  (select reversal_of_transaction_id from ledger_transaction
    where source_type = 'refund' and source_id = ((select (r->>'refund_id') from pf_r1))::uuid),
  null::uuid,
  'and it is NOT a reversal — a refund is a second economic event, not an unsaying of the sale');

select is(
  (select reason_code from ledger_transaction
    where source_type = 'refund' and source_id = ((select (r->>'refund_id') from pf_r1))::uuid),
  'refund_to_source',
  'with the reason code 0013 seeded for exactly this');

-- **The assertion the rounding exists for.** 5000/21000 of each entry does not divide cleanly,
-- and `post_ledger_transaction` refuses an unbalanced posting — so if the remainder were not
-- placed deliberately, the whole call would have raised rather than mis-posted. It balancing is
-- therefore evidence the apportionment ran, not merely that nothing crashed.
select is(
  (select sum(case when direction = 'debit' then amount_paise else -amount_paise end)::bigint
     from ledger_entry
    where transaction_id = (select id from ledger_transaction
                             where source_type = 'refund'
                               and source_id = ((select (r->>'refund_id') from pf_r1))::uuid)),
  0::bigint,
  'the refund posting balances exactly, after the rounding remainder is placed');

-- The clearing account is credited 5000 — the money leaving us. Whole-rupee here by construction
-- (21000 x 5000/21000 = 5000), which is what makes it a safe anchor for the proportionality.
select is(
  (select e.amount_paise from ledger_entry e
     join ledger_account la on la.id = e.account_id
    where la.code = 'provider:razorpay:clearing'
      and e.transaction_id = (select id from ledger_transaction
                               where source_type = 'refund'
                                 and source_id = ((select (r->>'refund_id') from pf_r1))::uuid)),
  5000::bigint,
  'the provider clearing account gives back exactly the 5000 that left the account');

select is(
  (select e.direction::text from ledger_entry e
     join ledger_account la on la.id = e.account_id
    where la.code = 'provider:razorpay:clearing'
      and e.transaction_id = (select id from ledger_transaction
                               where source_type = 'refund'
                                 and source_id = ((select (r->>'refund_id') from pf_r1))::uuid)),
  'credit',
  'in the opposite direction to the sale, which debited it');

-- =============================================================================
-- 4. The credit note: the amount actually returned, one line, no invented attribution.
-- =============================================================================

select is(
  (select total_paise from invoice
    where id = ((select (r->>'credit_note_id') from pf_r1))::uuid),
  5000::bigint,
  'the credit note totals the money that moved — not the invoice, and not a recomputation');

select is(
  (select taxable_value_paise + cgst_paise + sgst_paise + igst_paise + round_off_paise
     from invoice where id = ((select (r->>'credit_note_id') from pf_r1))::uuid),
  5000::bigint,
  'and its own components sum to that total — round_off_paise absorbs the paise the '
  'proportional split cannot place, which is what the column is for');

select cmp_ok(
  (select abs(round_off_paise) from invoice
    where id = ((select (r->>'credit_note_id') from pf_r1))::uuid),
  '<=', 2::bigint,
  'the round-off is a rounding artefact, not a hole — more than a couple of paise means the '
  'split is wrong rather than imprecise');

select is(
  (select count(*)::int from invoice_line
    where invoice_id = ((select (r->>'credit_note_id') from pf_r1))::uuid),
  1,
  'ONE line: a hand-issued refund carries no line attribution, and inventing one would say '
  'which dish was refunded when nobody knows');

select is(
  (select order_line_id from invoice_line
    where invoice_id = ((select (r->>'credit_note_id') from pf_r1))::uuid),
  null::bigint,
  'and it points at no order line, rather than at an arbitrary one');

select is(
  (select document_type::text from invoice
    where id = ((select (r->>'credit_note_id') from pf_r1))::uuid),
  'credit_note',
  'of the right document type');

-- =============================================================================
-- 5. A SECOND partial gets its OWN credit note. `0054` keyed on the invoice and would have
--    returned the first note again, leaving the second refund undocumented.
-- =============================================================================

create temporary table pf_r2 as
select record_refund('rfnd_PF_B', 'pay_PF1', 6000, null) as r;

select isnt(
  (select (r->>'credit_note_id') from pf_r2),
  (select (r->>'credit_note_id') from pf_r1),
  'the second partial refund gets its OWN credit note — two returns of money are two documents');

select is(
  (select total_paise from invoice
    where id = ((select (r->>'credit_note_id') from pf_r2))::uuid),
  6000::bigint,
  'for its own amount');

select is((select (r->>'refunded_total_paise')::bigint from pf_r2), 11000::bigint,
          'and the running total accumulates across both');

select is(
  (select og.status::text from order_group og where og.id = (select group_id from pf_g)),
  'partially_refunded',
  'still partially refunded at 11000 of 21000');

-- =============================================================================
-- 6. THE CASE A NAIVE BRANCH GETS WRONG: the refund that completes the total.
--
-- 10000 is not the captured amount, so `p_amount_paise = payment.amount_paise` would call this
-- partial — and the order would sit `paid` for ever having been fully refunded.
-- =============================================================================

create temporary table pf_r3 as
select record_refund('rfnd_PF_C', 'pay_PF1', 10000, null) as r;

select is((select (r->>'is_full_refund')::boolean from pf_r3), true,
          'the refund that brings the total to the captured amount is FULL, though its own '
          'amount is not — the branch reads the group, not one refund');

select is(
  (select o.status::text from "order" o where o.order_group_id = (select group_id from pf_g)),
  'refunded',
  'so the order finally reaches refunded, via cancelled — T13');

select is(
  (select og.status::text from order_group og where og.id = (select group_id from pf_g)),
  'refunded',
  'and the group is refunded, not partially_refunded — G5 over G6');

-- Every paise that came in has gone back out, across three postings.
select is(
  (select sum(case when e.direction = 'credit' then e.amount_paise else -e.amount_paise end)::bigint
     from ledger_entry e
     join ledger_account la on la.id = e.account_id
     join ledger_transaction lt on lt.id = e.transaction_id
    where la.code = 'provider:razorpay:clearing'
      and lt.source_type = 'refund'),
  21000::bigint,
  'the three refund postings return exactly the 21000 that was captured — no paise lost to '
  'rounding across a sequence of partials');

-- =============================================================================
-- 7. The guards.
-- =============================================================================

select throws_matching(
  $$ select record_refund('rfnd_PF_D', 'pay_PF1', 1, null) $$,
  'refunds would total',
  'a refund past the captured total is refused by name, before 0043''s trigger has to');

select throws_matching(
  $$ select record_refund('rfnd_PF_E', 'pay_PF1', 0, null) $$,
  'is not a refund',
  'and a zero-paise refund is refused rather than posting an empty transaction');

-- The dedupe from `E06-46` still holds across the new branch.
select is(
  ((select record_refund('rfnd_PF_A', 'pay_PF1', 5000, null))->>'already_recorded')::boolean,
  true,
  'and a redelivered partial is still a no-op — the dedupe survived the rewrite');

select * from finish();
rollback;
