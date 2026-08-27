-- =============================================================================
-- payments_schema.test.sql — step 1 of `docs/e06-build-plan.md`.
--
-- The schema `E06` cannot be written without: a chart of accounts, a way to record a double
-- charge, and the three timings the payment paths read. None of it moves money; all of it is
-- the ground the ledger stands on, and each piece is here because its absence would have been
-- discovered by whoever was building step 6 under time pressure.
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

-- =============================================================================
-- 1. The chart of accounts. `E06-23`.
-- =============================================================================

select set_eq(
  $$ select code from ledger_account where owner_type in ('platform', 'provider') $$,
  $$ values ('provider:razorpay:clearing'), ('platform:bank'), ('platform:provider_fees'),
            ('platform:revenue'), ('platform:tax_payable:cgst'),
            ('platform:tax_payable:sgst'), ('platform:suspense'),
            -- `E21` meal packs, docs/payments-design.md §10 rows 12–15. Two liabilities and a
            -- breakage revenue account: a pack sale is money in for food not yet served, so it
            -- is owed rather than earned until a meal is actually spent.
            ('platform:deferred_revenue:meal_packs'), ('platform:deferred_tax:meal_packs'),
            ('platform:revenue:breakage') $$,
  'E06-23: every account docs/payments-design.md §10 posts to exists. Before 0035 the table was '
  'EMPTY, so the first ledger_entry would have failed on a foreign key — the same defect 0013 '
  'fixed for reason codes, one level along');

select is(
  (select normal_balance::text from ledger_account where code = 'platform:bank'),
  'debit',
  'E06-23: the cash account is debit-normal. Money we hold is an asset, and M9 pins this with a '
  'CHECK so an account cannot be created on the wrong side of the ledger');

select throws_ok(
  $$ insert into ledger_account (code, owner_type, account_type, normal_balance)
     values ('platform:bank:wrong', 'platform', 'bank', 'credit') $$,
  '23514',
  null,
  'M9 extended to bank: a credit-normal cash account is refused. A single-signed balance helper '
  'is right for half the accounts and PLAUSIBLE for the rest, which is the failure that does not '
  'look like one');

select is(
  (select count(*)::int from ledger_account where account_type = 'tax_payable'),
  2,
  'CGST and SGST are separate accounts. M2 shows them as separate invoice lines, and a combined '
  'account could not be reconciled back to either');

select is_empty(
  $$ select code from ledger_account where code ilike '%igst%' $$,
  'and there is NO IGST account — SC1 is Mohali only and non-negotiable #7 forbids the path. '
  'When there is a second state there is a third row (G4, archived)');

-- =============================================================================
-- 2. A genuine double charge can be recorded. `[OL-05]`, and the reason it matters.
-- =============================================================================

create temporary table p_ctx as
select 'e1000000-7e57-0000-0000-0000000000c1'::uuid as group_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from p_ctx), (select id from app_user limit 1),
       'payments-schema-test', (select id from city limit 1), 20000, 1000, 21000;

insert into payment (id, order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
values ('e3000000-7e57-0000-0000-0000000000c1', (select group_id from p_ctx),
        'razorpay', 'order_test_c1', 21000, 'captured', gen_random_uuid());

select throws_ok(
  format($$ insert into payment (order_group_id, provider, provider_order_id, amount_paise,
                                 status, correlation_id)
            values (%L::uuid, 'razorpay', 'order_test_c2', 21000, 'captured', gen_random_uuid()) $$,
         (select group_id from p_ctx)),
  '23505',
  null,
  'D16 still holds: a SECOND primary capture on one checkout is refused. That guarantee is not '
  'weakened by [OL-05] — it is the reason the index exists');

select lives_ok(
  format($$ insert into payment (order_group_id, provider, provider_order_id, amount_paise,
                                 status, correlation_id, duplicate_of_payment_id)
            values (%L::uuid, 'razorpay', 'order_test_c3', 21000, 'captured', gen_random_uuid(),
                    'e3000000-7e57-0000-0000-0000000000c1') $$,
         (select group_id from p_ctx)),
  '[OL-05]: a capture MARKED AS A DUPLICATE is accepted. When a customer really is charged '
  'twice, the correct response is to record it and refund it — and before 0036 that was the one '
  'thing the schema forbade. Refusing the insert does not put the money back');

select throws_ok(
  $$ update payment set duplicate_of_payment_id = id
      where id = 'e3000000-7e57-0000-0000-0000000000c1' $$,
  '23514',
  null,
  'a payment cannot be its own duplicate — such a row satisfies the partial index and describes '
  'nothing');

-- =============================================================================
-- 3. The three timings. `E06-20`, `L9`, `[OL-03]`.
-- =============================================================================

select is(
  (select (resolve_effective_config(s.id)).payment_in_flight_grace_minutes
     from school s where s.is_active limit 1),
  15,
  'L9: the grace window resolves to 15 minutes. Andy decided this twice and it was written down '
  'neither time, which is why the decision row exists');

select is(
  (select (resolve_effective_config(s.id)).pending_payment_ttl_minutes
     from school s where s.is_active limit 1),
  30,
  '[OL-03]: the pending-payment TTL resolves to 30 — PROVISIONAL, with its floor pending '
  'E19-07 row 3 (how long Razorpay holds a UPI collect). Config so that answer costs an UPDATE');

-- The chain, not just the default: a school override must win over the platform row, or the
-- "a kitchen that cannot absorb late orders sets it to 0" escape in L9 does not exist.
-- The school is pinned in a temp table rather than re-selected with `limit 1`: the seed already
-- has school_config rows, so a second unordered `limit 1` reads back a DIFFERENT school and the
-- assertion silently tests the platform default instead of the override. It failed that way
-- once, which is the only reason this comment exists.
create temporary table p_school as
select id from school where is_active order by id limit 1;

insert into school_config (school_id, payment_in_flight_grace_minutes)
select id, 0 from p_school
on conflict (school_id) do update set payment_in_flight_grace_minutes = 0;

select is(
  (select (resolve_effective_config((select id from p_school))).payment_in_flight_grace_minutes),
  0,
  'L9: a school can set the grace to 0 and get a hard cutoff. That is [OL-02] option (b) as '
  'configuration rather than as a second code path, and it only works if the override resolves');

select throws_ok(
  $$ update platform_config set payment_in_flight_grace_minutes = -1 where id = 1 $$,
  '23514',
  null,
  'a negative tolerance is refused. Zero is meaningful — it is the hard cutoff — but a negative '
  'TTL would sweep a checkout before it was created');

-- =============================================================================
-- 4. The reason codes the sweeper and the grace window need. §15 item 3.
-- =============================================================================

select set_eq(
  $$ select code from reason_code where code in ('checkout_expired', 'cutoff_missed') $$,
  $$ values ('checkout_expired'), ('cutoff_missed') $$,
  'E06-20: both cancellation reasons exist. order.cancel_reason_code is NOT NULL REFERENCES '
  'reason_code, so a sweeper with no code to cite cannot cancel anything');

select is(
  (select bool_and(is_customer_visible) from reason_code
    where code in ('checkout_expired', 'cutoff_missed')),
  true,
  'and both are customer-visible: somebody whose checkout timed out is owed an explanation, and '
  '"cancelled" with no reason reads as us cancelling on them');

-- =============================================================================
-- 5. `E06-24` — a refund to a source that does not exist.
-- =============================================================================

select throws_ok(
  format($$ insert into refund (order_group_id, amount_paise, destination, status, reason_code,
                                correlation_id)
            values (%L::uuid, 1000, 'source', 'pending',
                    (select code from reason_code where category = 'refund' limit 1),
                    gen_random_uuid()) $$,
         (select group_id from p_ctx)),
  '23514',
  null,
  'E06-24 / §9.9: a refund to the original payment method must NAME the payment it reverses. '
  'PY5 splits one logical refund across the wallet and the source, and that split is exactly '
  'where a source row would otherwise be written with nowhere to send the money');

select * from finish();
rollback;
