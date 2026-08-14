-- =============================================================================
-- issue_invoice.test.sql — `E07-01`, `E07-02`, `M3`, `D14`.
--
-- The receipt. Settlement issues it in the same transaction, so the assertions below settle a
-- payment and then look at what the customer would receive.
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

-- A real seller identity: `E07-20`'s guard and this function's own layer-3 refusal both key off
-- the placeholders, and here we are testing the issuing path rather than the refusal.
update platform_config
   set seller_gstin = '03AABCG1234M1Z5',
       seller_legal_name = 'GrayBag Foods Private Limited',
       seller_address = 'Sector 82, Mohali, Punjab 160055'
 where id = 1;

create temporary table i_ctx as
select 'e1000000-7e57-0000-0000-0000000000d5'::uuid as group_id,
       (select id from school where is_active limit 1) as school_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from i_ctx), (select id from app_user limit 1),
       'invoice-test', (select id from city limit 1), 20000, 1000, 21000;

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select 'e2000000-7e57-0000-0000-0000000000d5', (select group_id from i_ctx), 'IN-1',
       gen_random_uuid(), (select id from app_user limit 1), (select id from recipient limit 1),
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Aarav Sharma', 'pending_payment', 20000, 500, 500, 21000
  from school s where s.id = (select school_id from i_ctx);

insert into order_line (order_id, line_no, menu_item_id, dish_id, quantity, unit_price_paise,
                        line_subtotal_paise, tax_cgst_paise, tax_sgst_paise, line_total_paise,
                        dish_name_snapshot)
select 'e2000000-7e57-0000-0000-0000000000d5', 1, mi.id, mi.dish_id, 1, 20000, 20000, 500, 500,
       21000, 'Paneer Wrap'
  from menu_item mi limit 1;

insert into payment (order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
select (select group_id from i_ctx), 'razorpay', 'order_inv_d5', 21000, 'created',
       gen_random_uuid();

create temporary table i_settled as
select settle_payment('order_inv_d5', 'pay_inv_d5', 21000) as r;

-- =============================================================================
-- 1. The invoice exists because the settlement did — D14, one transaction.
-- =============================================================================

select is((select count(*)::int from invoice where order_group_id = (select group_id from i_ctx)),
  1,
  'D14: settling a payment issues the invoice in the SAME transaction. A paid order with no tax '
  'document, or a number burned out of the series with no settlement, is unrepairable afterwards');

select matches(
  (select invoice_number from invoice where order_group_id = (select group_id from i_ctx)),
  '^GB/[0-9]{2}-[0-9]{2}/[0-9]{6}$',
  'E07-01: the number renders as GB/26-27/000001');

select cmp_ok(
  (select length(invoice_number) from invoice where order_group_id = (select group_id from i_ctx)),
  '<=', 16,
  'Rule 46 caps the serial at 16 characters. The format in the original schema comment — '
  'GB/2026-27/000417 — is SEVENTEEN and would not have complied');

-- =============================================================================
-- 2. The money on it, and the seller snapshot.
-- =============================================================================

select is((select taxable_value_paise || '/' || cgst_paise || '/' || sgst_paise || '/' || total_paise
             from invoice where order_group_id = (select group_id from i_ctx)),
  '20000/500/500/21000',
  'M2: taxable value, CGST and SGST as separate figures, totalling what was captured');

select is((select seller_gstin from invoice where order_group_id = (select group_id from i_ctx)),
  '03AABCG1234M1Z5',
  '§13.2: the seller identity is SNAPSHOTTED onto the row, not read at render time — a reprint '
  'must be byte-identical, so a wrong value cannot be quietly fixed by editing config');

select is((select place_of_supply_state_code from invoice
            where order_group_id = (select group_id from i_ctx)),
  '03',
  'and the place of supply is Punjab — printed always, per Rule 46, not only for inter-state');

-- =============================================================================
-- 3. The line, and the rule that protects the child.
-- =============================================================================

select is((select description from invoice_line il
             join invoice i on i.id = il.invoice_id
            where i.order_group_id = (select group_id from i_ctx)),
  'Paneer Wrap — Aarav',
  '§4.3 / G7: the line carries the child''s FIRST NAME ONLY. The recipient is "Aarav Sharma" and '
  'the surname does not appear — this is a document a parent forwards to an employer');

select ok(
  (select description not like '%Sharma%' from invoice_line il join invoice i on i.id = il.invoice_id
    where i.order_group_id = (select group_id from i_ctx)),
  'and the surname is genuinely absent, not merely unasserted');

-- =============================================================================
-- 4. The buyer name may be absent, and nothing is invented — E07-22, Rule 46(f).
-- =============================================================================

-- Both directions, because the interesting one is the absence. The seeded fixture user HAS a
-- name — the first draft of this test assumed otherwise and failed, which is the good kind of
-- failure: it proves the column is really being populated from the account rather than always
-- being null for want of a writer.
select is(
  (select buyer_name_snapshot from invoice where order_group_id = (select group_id from i_ctx)),
  (select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '')
     from app_user where id = (select customer_user_id from order_group
                                where id = (select group_id from i_ctx))),
  'the buyer name is taken from the account holder when they have one');

-- And with no name at all, which is every account in the system until P18's prompt is answered.
update app_user set first_name = null, last_name = null
 where id = (select customer_user_id from order_group where id = (select group_id from i_ctx));

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select 'e1000000-7e57-0000-0000-0000000000d6'::uuid,
       (select customer_user_id from order_group where id = (select group_id from i_ctx)),
       'invoice-test-noname', (select id from city limit 1), 0, 0, 0;

-- Issued into a temp table first: calling the function inside a WHERE against a table with no
-- matching row means Postgres never evaluates it, and the assertion reads NULL rather than
-- failing — a test that proves nothing while looking like it ran.
create temporary table i_noname as
select issue_invoice('e1000000-7e57-0000-0000-0000000000d6'::uuid) as id;

select ok(
  (select buyer_name_snapshot is null from invoice where id = (select id from i_noname)),
  'E07-22: with no name on the account the invoice carries NONE. Rule 46(f) requires it below '
  '₹50,000 only if the recipient asks, and nothing is fabricated to fill the column');

-- =============================================================================
-- 5. Gapless, and idempotent. §7.1 layer 7.
-- =============================================================================

select is((select issue_invoice((select group_id from i_ctx))),
          (select id from invoice where order_group_id = (select group_id from i_ctx)),
  '§7.1 layer 7: re-issuing returns the EXISTING invoice rather than burning a second number. A '
  'gap in the series is the thing that cannot be explained to an auditor');

select is((select count(*)::int from invoice where order_group_id = (select group_id from i_ctx)),
  1, 'and there is still exactly one');

select is((select pickup_codes[1]::text from invoice where order_group_id = (select group_id from i_ctx)),
  (select pickup_code::text from "order" where id = 'e2000000-7e57-0000-0000-0000000000d5'),
  'P4: the pickup code is on the invoice as well as in the email, so a child with no phone can '
  'still collect');

-- ---------------------------------------------------------------- the value the mailer filters on
--
-- `E07-04`'s `loadInvoice` selects `document_type = 'tax_invoice'`. It shipped with `'invoice'`,
-- which is not in the enum, so it matched nothing and every confirmation fell back to a bare
-- text message — the compliant invoice body was never sent to anybody, and 29 renderer assertions
-- stayed green because they render rather than query.
--
-- Asserted here rather than in the mailer's own tests because this is the fact the mailer depends
-- on: rename the enum label and this fails, which is the only place that can see both sides.
-- **This block was appended after `finish(); rollback;` first**, so it ran outside the
-- transaction — where the `set local search_path` no longer applied and NO pgTAP function
-- resolved at all. The error said `set_eq does not exist`, then `is`, then `ok`, and each cast I
-- added chased the wrong thing: the arguments were never the problem, the location was.
--
-- `ok(... = ...)` rather than `is(...)`: the `is` overload trap is already in
-- `docs/learnings.md`, and `ok` takes a plain boolean so it cannot be tripped by it.
select ok(
  (select string_agg(e.enumlabel::text, ',' order by e.enumlabel)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'invoice_document_type') = 'credit_note,tax_invoice',
  'invoice_document_type is exactly (tax_invoice, credit_note) — the mailer filters on the first');

select * from finish();
rollback;