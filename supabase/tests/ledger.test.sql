-- =============================================================================
-- ledger.test.sql — E06-22 and E06-31.
--
-- The ledger's two structural properties, asserted rather than described:
--
--   1. a posting can be written at all (the reason-code vocabulary exists);
--   2. an account's normal balance is a consequence of its type, not a choice — so a
--      balance cannot be read with the wrong sign.
--
-- Both directions are tested throughout. An assertion that only proves refusal passes
-- just as well on a ledger that refuses everything, which is the failure this suite would
-- otherwise ship.
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
-- Fixtures. Two accounts of opposite nature, and one that is neither.
-- -----------------------------------------------------------------------------
-- **Fixture codes, not the real ones.** `0035` seeds `provider:razorpay:clearing` and
-- `platform:revenue` as actual data, and `ledger_account.code` is unique — so a fixture
-- claiming those codes collides and takes the whole file down (which is how this was found).
-- The suite needs *an* account of each type, not the production one, and a test that reuses a
-- real code is a test that breaks whenever the chart of accounts changes.
insert into ledger_account (id, code, owner_type, owner_id, account_type, normal_balance) values
  ('aa000000-7e57-0000-0000-000000000001', 'provider:7e57:clearing', 'provider', null,
   'provider_clearing', 'debit'),
  ('aa000000-7e57-0000-0000-000000000002', 'user:7e57:wallet', 'user',
   'a0000000-7e57-0000-0000-000000000001', 'wallet', 'credit'),
  ('aa000000-7e57-0000-0000-000000000003', 'platform:7e57:revenue', 'platform', null,
   'revenue', 'credit');

-- =============================================================================
-- 1. E06-22 — the vocabulary exists, so a posting is writable
-- =============================================================================

-- `E06-22` says "none of the eight seeded codes names a money movement". That is very
-- nearly true and worth correcting precisely: `0001` did seed exactly one ledger code,
-- `migration_opening_balance`, for the off-system balances `[E00-18]` asks about. It is
-- real and it stays. It covers none of the movements the payment path performs, so the
-- blocker was genuine — a sale, a capture, a fee and a refund all had no legal code.
select set_eq(
  $$ select code from reason_code where category = 'ledger' $$,
  $$ values ('sale'),('provider_fee'),('settlement'),('wallet_hold'),('wallet_hold_reversal'),
            ('refund_to_wallet'),('refund_to_source'),('revenue_share'),
            ('refund_mdr_recovery'),('payout'),('provider_initiated'),
            ('migration_opening_balance') $$,
  'E06-22: exactly the eleven codes docs/payments-design.md §10 names, plus migration_opening_balance which 0001 already seeded — a ledger whose codes disagree with the design is a reconciliation report nobody can read');

select lives_ok(
  $$ insert into ledger_transaction (id, reason_code, source_type, source_id, occurred_at)
     values ('bb000000-7e57-0000-0000-000000000001', 'sale', 'payment', null, now());
     insert into ledger_entry (transaction_id, account_id, direction, amount_paise) values
       ('bb000000-7e57-0000-0000-000000000001','aa000000-7e57-0000-0000-000000000001','debit', 20000),
       ('bb000000-7e57-0000-0000-000000000001','aa000000-7e57-0000-0000-000000000003','credit',20000) $$,
  'E06-22: a balanced posting can actually be written');

-- =============================================================================
-- 2. E06-31 — the sign convention is structural
-- =============================================================================

select throws_ok(
  $$ insert into ledger_account (code, owner_type, owner_id, account_type, normal_balance)
     values ('user:bad:wallet', 'user', 'a0000000-7e57-0000-0000-000000000002', 'wallet', 'debit') $$,
  '23514',
  null,
  'E06-31: a wallet cannot be created debit-normal — it is a liability, and the database refuses rather than trusting whoever wrote the insert');

select throws_ok(
  $$ insert into ledger_account (code, owner_type, owner_id, account_type, normal_balance)
     values ('provider:x:clearing', 'provider', null, 'provider_clearing', 'credit') $$,
  '23514',
  null,
  'E06-31: a provider clearing account cannot be created credit-normal — it is an asset');

select lives_ok(
  $$ insert into ledger_account (code, owner_type, owner_id, account_type, normal_balance)
     values ('school:7e57:payable', 'school', 'c3000000-7e57-0000-0000-000000000001', 'payable', 'credit') $$,
  'E06-31: a payable IS credit-normal, and the constraint permits it — the rule is a mapping, not a ban');

-- The point of the whole exercise: one function, two natures, both positive.
select is(
  ledger_balance('aa000000-7e57-0000-0000-000000000001'), 20000::bigint,
  'E06-31: the clearing account (asset, debit-normal) reads +20000 after a debit');

select is(
  ledger_balance('aa000000-7e57-0000-0000-000000000003'), 20000::bigint,
  'E06-31: the revenue account (income, credit-normal) reads +20000 after a credit — the SAME function, the opposite direction, and neither caller chose a sign');

-- This is the assertion that would fail under a single-signed helper. It is written as one
-- test on purpose: a helper that hardcodes "debits minus credits" gets the first of these
-- right and returns -20000 here, which looks like a number rather than a bug.
select ok(
  ledger_balance('aa000000-7e57-0000-0000-000000000001') > 0
  and ledger_balance('aa000000-7e57-0000-0000-000000000003') > 0,
  'E06-31: both accounts read POSITIVE. A single-signed balance() would make one of them negative and nothing about the output would look wrong');

-- =============================================================================
-- 3. Double entry is enforced, not assumed
-- =============================================================================

select throws_ok(
  $$ insert into ledger_transaction (id, reason_code, source_type, source_id, occurred_at)
     values ('bb000000-7e57-0000-0000-000000000002', 'sale', 'payment', null, now());
     insert into ledger_entry (transaction_id, account_id, direction, amount_paise) values
       ('bb000000-7e57-0000-0000-000000000002','aa000000-7e57-0000-0000-000000000001','debit', 10000),
       ('bb000000-7e57-0000-0000-000000000002','aa000000-7e57-0000-0000-000000000003','credit', 9999);
     set constraints all immediate $$,
  '23514',
  null,
  'I10: a transaction whose entries differ by one paise is refused — the constraint is deferred to commit, so a multi-statement posting is legal in the middle and illegal at the end');

select throws_ok(
  $$ insert into ledger_transaction (id, reason_code, source_type, source_id, occurred_at)
     values ('bb000000-7e57-0000-0000-000000000003', 'sale', 'payment', null, now());
     insert into ledger_entry (transaction_id, account_id, direction, amount_paise) values
       ('bb000000-7e57-0000-0000-000000000003','aa000000-7e57-0000-0000-000000000001','debit', 10000);
     set constraints all immediate $$,
  '23514',
  null,
  'I10: a single-legged posting is refused — double entry means at least two');

-- =============================================================================
-- 4. assert_ledger_integrity() — the nightly job's eyes
-- =============================================================================

select is(
  (select coalesce(sum(failures), 0)::bigint from assert_ledger_integrity()),
  0::bigint,
  'E06-31: a healthy ledger reports zero failures across every check');

select set_eq(
  $$ select check_name from assert_ledger_integrity() $$,
  $$ values ('transaction_balances'),('transaction_has_entries'),('account_normal_balance'),
            ('wallet_matches_ledger'),('wallet_never_negative') $$,
  'E06-31: the nightly assertion runs all five checks — a check silently disappearing is how a nightly job becomes decoration');

-- The integrity function must NOTICE a broken account, not just describe healthy ones.
-- Reached by dropping the constraint, because with it in place the bad row cannot exist —
-- which is the point: the constraint is the guard, and this function is what catches the
-- constraint having been removed.
alter table ledger_account drop constraint ledger_account_normal_balance_matches_type;
update ledger_account set normal_balance = 'debit'
 where id = 'aa000000-7e57-0000-0000-000000000002';

select is(
  (select failures from assert_ledger_integrity() where check_name = 'account_normal_balance'),
  1::bigint,
  'E06-31: with the constraint dropped and a wallet flipped to debit-normal, the nightly check finds it — this is the backstop for the constraint itself being removed');

update ledger_account set normal_balance = 'credit'
 where id = 'aa000000-7e57-0000-0000-000000000002';
-- Put back with `bank` included (`0035`). Restoring the pre-bank definition here would fail
-- outright now that `platform:bank` is seeded — which is a small, useful demonstration that
-- this constraint and the chart of accounts have to be changed together.
alter table ledger_account
  add constraint ledger_account_normal_balance_matches_type check (
    (account_type in ('wallet', 'payable', 'tax_payable', 'revenue') and normal_balance = 'credit')
    or
    (account_type in ('receivable', 'provider_clearing', 'provider_fees', 'suspense', 'bank')
       and normal_balance = 'debit')
  );

-- A wallet that has gone negative is money we do not owe, and it is the one that becomes a
-- support conversation. Written by crediting less than is debited across two transactions,
-- because a single negative entry is already impossible.
insert into ledger_transaction (id, reason_code, source_type, source_id, occurred_at)
  values ('bb000000-7e57-0000-0000-000000000004', 'wallet_hold', 'payment', null, now());
insert into ledger_entry (transaction_id, account_id, direction, amount_paise) values
  ('bb000000-7e57-0000-0000-000000000004','aa000000-7e57-0000-0000-000000000002','debit', 5000),
  ('bb000000-7e57-0000-0000-000000000004','aa000000-7e57-0000-0000-000000000003','credit',5000);

select is(
  (select failures from assert_ledger_integrity() where check_name = 'wallet_never_negative'),
  1::bigint,
  'E06-31 / I8: a wallet debited below zero is caught — a liability account in deficit is money we do not owe and somebody is about to ask about it');

select * from finish();
rollback;
