-- =============================================================================
-- invoice_buyer_name.test.sql — `E07-22`, migration `0031`.
--
-- The buyer's name is optional on a GrayBag invoice, and optional **exactly as far as CGST
-- Rule 46 says it is**. Both halves are asserted here, because either one alone is a defect:
--
--   * `not null` was stricter than the law, and since nothing writes `app_user.first_name` and
--     `P18`'s capture is skippable, it would have refused every invoice we will ever issue —
--     in production, after the money was taken;
--   * simply dropping it would say "a name is never required", which is equally false. Rule
--     46(e) makes it mandatory at ₹50,000 or more.
--
-- ₹50,000 = 5,000,000 paise. Non-negotiable #3: integer paise, everywhere.
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

-- An invoice needs an `order_group`, and the seed has none — it deliberately carries no orders
-- and no money (`SD2`). So this makes one, with only the columns that are `not null` and have
-- no default. It is not an order anyone could have placed and does not need to be: this suite
-- is about one CHECK constraint, and a fixture that reconstructs a whole checkout to test it is
-- a fixture that breaks every time checkout changes.
--
-- The marker (`7e57`) is `check-test-fixtures`' requirement — a fixture id must be
-- distinguishable from a real one at a glance.
-- **Three** of them, because `uq_invoice_one_tax_invoice_per_group` allows exactly one tax
-- invoice per group — which is `M3`/`G8` doing its job, and means every assertion that expects
-- an insert to SUCCEED needs its own group. The two that expect a refusal can share, since they
-- never get as far as the unique index.
insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select g.id::uuid,
       (select id from app_user limit 1),
       g.key,
       (select id from city limit 1),
       20000, 1000, 21000
  from (values
    ('e1000000-7e57-0000-0000-0000000000b1', 'invoice-buyer-name-test-1'),
    ('e1000000-7e57-0000-0000-0000000000b2', 'invoice-buyer-name-test-2'),
    ('e1000000-7e57-0000-0000-0000000000b3', 'invoice-buyer-name-test-3')
  ) as g(id, key);

create temporary table i_ctx as
select 'e1000000-7e57-0000-0000-0000000000b1'::uuid as group_id,
       'e1000000-7e57-0000-0000-0000000000b2'::uuid as group_id_2,
       'e1000000-7e57-0000-0000-0000000000b3'::uuid as group_id_3;

insert into invoice_sequence (financial_year, last_sequence_no) values ('2099-00', 0)
on conflict (financial_year) do nothing;

-- -----------------------------------------------------------------------------
-- 1. The ordinary case: a lunch order, no name, and it is accepted.
-- -----------------------------------------------------------------------------

select lives_ok(
  format($$ insert into invoice (invoice_number, financial_year, sequence_no, order_group_id,
              seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code,
              sac_code, buyer_name_snapshot, taxable_value_paise, cgst_rate_bps, cgst_paise,
              sgst_rate_bps, sgst_paise, total_paise)
            values ('GB/2099-00/000001', '2099-00', 1, %L::uuid,
              'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331',
              NULL, 20000, 250, 500, 250, 500, 21000) $$,
         (select group_id from i_ctx)),
  'E07-22 / Rule 46(f): a ₹210 invoice with NO buyer name is accepted — every account in the '
  'system has a null name, and the not-null constraint would have refused every invoice we '
  'will ever issue, after the money was taken');

-- -----------------------------------------------------------------------------
-- 2. The other half of the rule. Rule 46(e): mandatory at fifty thousand or more.
-- -----------------------------------------------------------------------------

select throws_ok(
  format($$ insert into invoice (invoice_number, financial_year, sequence_no, order_group_id,
              seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code,
              sac_code, buyer_name_snapshot, taxable_value_paise, cgst_rate_bps, cgst_paise,
              sgst_rate_bps, sgst_paise, total_paise)
            values ('GB/2099-00/000002', '2099-00', 2, %L::uuid,
              'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331',
              NULL, 4800000, 250, 120000, 250, 120000, 5040000) $$,
         (select group_id from i_ctx)),
  '23514',
  null,
  'Rule 46(e): at ₹50,400 the name is MANDATORY, and an invoice without one is refused at write '
  'time rather than reaching a customer as a non-compliant document');

-- The boundary itself, because "or more" is where an off-by-one lives.
select throws_ok(
  format($$ insert into invoice (invoice_number, financial_year, sequence_no, order_group_id,
              seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code,
              sac_code, buyer_name_snapshot, taxable_value_paise, cgst_rate_bps, cgst_paise,
              sgst_rate_bps, sgst_paise, total_paise)
            values ('GB/2099-00/000003', '2099-00', 3, %L::uuid,
              'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331',
              NULL, 5000000, 250, 0, 250, 0, 5000000) $$,
         (select group_id from i_ctx)),
  '23514',
  null,
  'exactly ₹50,000 is "fifty thousand rupees OR MORE" — the constraint is >=, and a > here '
  'would issue one non-compliant invoice at precisely the threshold');

select lives_ok(
  format($$ insert into invoice (invoice_number, financial_year, sequence_no, order_group_id,
              seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code,
              sac_code, buyer_name_snapshot, taxable_value_paise, cgst_rate_bps, cgst_paise,
              sgst_rate_bps, sgst_paise, total_paise)
            values ('GB/2099-00/000004', '2099-00', 4, %L::uuid,
              'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331',
              NULL, 4999999, 250, 0, 250, 0, 4999999) $$,
         (select group_id_2 from i_ctx)),
  'one paise below the threshold is still below it');

-- -----------------------------------------------------------------------------
-- 3. A name above the threshold is accepted — the constraint bounds the ABSENCE of a name,
--    not the value.
-- -----------------------------------------------------------------------------

select lives_ok(
  format($$ insert into invoice (invoice_number, financial_year, sequence_no, order_group_id,
              seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code,
              sac_code, buyer_name_snapshot, taxable_value_paise, cgst_rate_bps, cgst_paise,
              sgst_rate_bps, sgst_paise, total_paise)
            values ('GB/2099-00/000005', '2099-00', 5, %L::uuid,
              'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331',
              'Priya Sharma', 6000000, 250, 0, 250, 0, 6000000) $$,
         (select group_id_3 from i_ctx)),
  'a large invoice WITH a name is fine — the rule is about what must be recorded, not a cap');

-- -----------------------------------------------------------------------------
-- 4. The column comment is the instruction not to fabricate, and it is load-bearing.
--    Whoever writes the invoice generator reads this before they reach for a fallback.
-- -----------------------------------------------------------------------------

select matches(
  (select col_description('invoice'::regclass, attnum)
     from pg_attribute
    where attrelid = 'invoice'::regclass and attname = 'buyer_name_snapshot'),
  'NEVER write a placeholder',
  'the column says outright not to fabricate a buyer name — the email local-part is a username, '
  '"GrayBag customer" is a label, and the recipient''s name is a minor in the buyer field of a '
  'record we keep after erasure');

select * from finish();
rollback;
