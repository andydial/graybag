-- =============================================================================
-- ledger_posting.test.sql — `E06-07`, step 2 of docs/e06-build-plan.md.
--
-- The ledger's guarantees were already there (`0001`'s append-only and zero-sum triggers,
-- `0013`'s sign convention). What `0038` adds is the only way in, and what is worth testing is
-- every posting it REFUSES — because a ledger's value is entirely in what it would not let you
-- write.
--
-- No Razorpay appears in this file, exactly as step 2 says. Everything here is testable without
-- a provider, which is why it is built before one exists.
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

-- A wallet to post against. The platform and provider accounts come from `0035`; a wallet
-- belongs to a person, so it is made here (`0035`'s header says why wallets are never seeded).
insert into ledger_account (id, code, owner_type, owner_id, account_type, normal_balance)
select 'aa000000-7e57-0000-0000-0000000000d1', 'user:7e57:d1:wallet', 'user',
       (select id from app_user limit 1), 'wallet', 'credit';

-- =============================================================================
-- 1. The happy path, and the balance that comes out of it.
-- =============================================================================

create temporary table lp_sale as
select post_ledger_transaction(
  'sale', 'payment', null,
  '[{"account": "provider:razorpay:clearing", "direction": "debit",  "amount_paise": 21000},
    {"account": "platform:revenue",           "direction": "credit", "amount_paise": 20000},
    {"account": "platform:tax_payable:cgst",  "direction": "credit", "amount_paise": 500},
    {"account": "platform:tax_payable:sgst",  "direction": "credit", "amount_paise": 500}]'::jsonb
) as id;

select ok((select id is not null from lp_sale), 'E06-07: a balanced four-entry sale posts');

select is(
  (select count(*)::int from ledger_entry where transaction_id = (select id from lp_sale)),
  4,
  'all four entries are written in the same transaction as the header — a posting is atomic or '
  'it is a half-recorded movement of money');

-- The two sides of the sign convention in one assertion. `provider_clearing` is an asset and
-- `revenue` is a liability-side account; a single-signed balance helper is right for one of
-- these and plausibly wrong for the other, which is the failure M9 designed out.
select is(
  ledger_balance((select id from ledger_account where code = 'provider:razorpay:clearing')),
  21000::bigint,
  'M9: the debit-normal clearing account reads +21000 after a debit');

select is(
  ledger_balance((select id from ledger_account where code = 'platform:revenue')),
  20000::bigint,
  'and the credit-normal revenue account reads +20000 after a credit — opposite directions, '
  'both positive, because ledger_balance() consults the account rather than picking a sign');

-- =============================================================================
-- 2. Everything it refuses. This is the actual subject of the file.
-- =============================================================================

select throws_ok(
  $$ select post_ledger_transaction('sale', 'payment', null,
       '[{"account": "provider:razorpay:clearing", "direction": "debit",  "amount_paise": 21000},
         {"account": "platform:revenue",           "direction": "credit", "amount_paise": 20000}]'::jsonb) $$,
  'P0001', null,
  'an unbalanced posting is refused BY THE FUNCTION, naming both totals. The deferred trigger '
  'would also catch it — at COMMIT, with the statement that caused it long gone');

select throws_ok(
  $$ select post_ledger_transaction('sale', 'payment', null,
       '[{"account": "platform:revenue", "direction": "credit", "amount_paise": 100}]'::jsonb) $$,
  'P0001', null,
  'a single-entry transaction is refused: that is not double-entry bookkeeping, it is a note');

select throws_ok(
  $$ select post_ledger_transaction('sale', 'payment', null,
       '[{"account": "provider:razorpay:clearing", "direction": "debit",  "amount_paise": -100},
         {"account": "platform:revenue",           "direction": "credit", "amount_paise": -100}]'::jsonb) $$,
  'P0001', null,
  'a NEGATIVE amount is refused even though it balances. Direction carries the sign and is the '
  'only thing that does — a negative credit is a debit written by somebody who did not know '
  'that, and the zero-sum trigger would have let it through');

select throws_ok(
  $$ select post_ledger_transaction('sale', 'payment', null,
       '[{"account": "platform:nonexistent", "direction": "debit",  "amount_paise": 100},
         {"account": "platform:revenue",     "direction": "credit", "amount_paise": 100}]'::jsonb) $$,
  'P0001', null,
  'an unknown account is refused, and the message names WHICH one');

select throws_ok(
  $$ select post_ledger_transaction('customer_request', 'payment', null,
       '[{"account": "provider:razorpay:clearing", "direction": "debit",  "amount_paise": 100},
         {"account": "platform:revenue",           "direction": "credit", "amount_paise": 100}]'::jsonb) $$,
  'P0001', null,
  'a CANCELLATION reason on a money movement is refused. ledger_transaction.reason_code '
  'references reason_code(code) generally, so the foreign key alone would have accepted it');

-- An inactive account is not a usable one, and this is the case that arrives quietly: an
-- account is deactivated in the back office and a nightly job keeps posting to it.
update ledger_account set is_active = false where code = 'platform:suspense';
select throws_ok(
  $$ select post_ledger_transaction('sale', 'payment', null,
       '[{"account": "platform:suspense", "direction": "debit",  "amount_paise": 100},
         {"account": "platform:revenue",  "direction": "credit", "amount_paise": 100}]'::jsonb) $$,
  'P0001', null,
  'a DEACTIVATED account is refused — otherwise money keeps landing in an account somebody '
  'switched off, and nothing says so until a reconciliation months later');
update ledger_account set is_active = true where code = 'platform:suspense';

-- =============================================================================
-- 3. Idempotency. A webhook is delivered more than once; that is normal, not an error.
-- =============================================================================

create temporary table lp_once as
select post_ledger_transaction(
  'settlement', 'payment', null,
  '[{"account": "platform:bank",              "direction": "debit",  "amount_paise": 5000},
    {"account": "provider:razorpay:clearing", "direction": "credit", "amount_paise": 5000}]'::jsonb,
  now(), null, null, null, 'rzp_settlement_7e57_001') as id;

create temporary table lp_twice as
select post_ledger_transaction(
  'settlement', 'payment', null,
  '[{"account": "platform:bank",              "direction": "debit",  "amount_paise": 5000},
    {"account": "provider:razorpay:clearing", "direction": "credit", "amount_paise": 5000}]'::jsonb,
  now(), null, null, null, 'rzp_settlement_7e57_001') as id;

select is(
  (select id from lp_twice), (select id from lp_once),
  'E06-07: a repeat with the same idempotency key returns the FIRST transaction and does not '
  'raise. A retried webhook is not an error, and a handler forced to tell "already done" from '
  '"failed" will get it wrong');

select is(
  (select count(*)::int from ledger_entry where transaction_id = (select id from lp_once)),
  2,
  'and writes nothing the second time — money counted twice is the failure the key exists for');

-- The dangerous version: same key, different money. It must return the first posting rather
-- than the second, because a retry that could rewrite history is not append-only.
create temporary table lp_conflict as
select post_ledger_transaction(
  'settlement', 'payment', null,
  '[{"account": "platform:bank",              "direction": "debit",  "amount_paise": 999999},
    {"account": "provider:razorpay:clearing", "direction": "credit", "amount_paise": 999999}]'::jsonb,
  now(), null, null, null, 'rzp_settlement_7e57_001') as id;

select is(
  ledger_balance((select id from ledger_account where code = 'platform:bank')),
  5000::bigint,
  'the same key with DIFFERENT amounts still returns the first posting — the ledger is '
  'append-only, so a retry must never be able to rewrite it. A wrong amount is found by '
  'reconciliation; nothing here can tell it from a retry');

-- =============================================================================
-- 4. Corrections are reversals, because entries cannot be edited.
-- =============================================================================

create temporary table lp_reversal as
select reverse_ledger_transaction((select id from lp_sale)) as id;

select is(
  ledger_balance((select id from ledger_account where code = 'platform:revenue')),
  0::bigint,
  'E06-07: reversing the sale returns revenue to zero — by POSTING THE OPPOSITE, not by '
  'deleting anything. ledger_entry is append-only and the trigger enforces it');

select is(
  (select reversal_of_transaction_id from ledger_transaction where id = (select id from lp_reversal)),
  (select id from lp_sale),
  'and the reversal names what it reverses, so both halves of one correction are found together');

select is(
  (select reason_code from ledger_transaction where id = (select id from lp_reversal)),
  'sale',
  'keeping the original reason code: the reversal of a sale is part of the story of that sale');

select throws_ok(
  format($$ select reverse_ledger_transaction(%L::uuid) $$, (select id from lp_sale)),
  'P0001', null,
  'reversing the same transaction twice is refused — otherwise a double-click writes the money '
  'back twice, in the opposite direction');

select throws_ok(
  format($$ select reverse_ledger_transaction(%L::uuid) $$, (select id from lp_reversal)),
  'P0001', null,
  'and a reversal cannot itself be reversed: that is a re-posting, and should be written as one '
  'so the intent is legible');

-- =============================================================================
-- 5. The nightly checks still pass over everything this file wrote.
-- =============================================================================

select is(
  -- `sum()` over bigint returns NUMERIC, and pgTAP's `is()` needs both sides the same type.
  (select sum(failures)::bigint from assert_ledger_integrity()),
  0::bigint,
  'E06-31: after a sale, a settlement, a reversal and six refused postings, every nightly check '
  'reports zero failures');

select * from finish();
rollback;
