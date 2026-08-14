-- =============================================================================
-- ledger_safeupdate.test.sql — `E06-38`. The settlement path survives `safeupdate`.
--
-- **This suite cannot reproduce the failure, and saying so is the point.**
--
-- `post_ledger_transaction` cleared its temp table with an unqualified `delete from tmp_posting;`.
-- Hosted Supabase loads the **`safeupdate`** extension, which rejects that with `21000`; a local
-- `supabase start` does not load it. So every settlement through an Edge Function failed while
-- this suite stayed green — exactly as it did for `E05-21`/`0019`, the first time.
--
-- A behavioural test written here would therefore pass against the broken function, which makes
-- it worthless as a regression guard. What actually guards the class is
-- `scripts/check-unqualified-writes.mjs`, which is static and runs in the smoke test where the
-- guard's absence cannot hide anything.
--
-- What this file adds is the half a static check cannot do: that the *corrected* statement still
-- clears the table, so the fix did not trade a `21000` for a silently accumulating ledger.
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

-- ---------------------------------------------------------------- the source is qualified
--
-- The assertion that would have caught this. It reads the INSTALLED function, so it is true of
-- what actually runs rather than of what a migration file says.
select ok(
  (select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'post_ledger_transaction')
    !~* 'delete\s+from\s+tmp_posting\s*;',
  'post_ledger_transaction has no unqualified DELETE — safeupdate rejects one with 21000');

select ok(
  (select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_checkout')
    !~* 'delete\s+from\s+tmp_checkout_lines\s*;',
  'create_checkout has no unqualified DELETE either — E05-21 must not come back');

-- ---------------------------------------------------------------- the clear still clears
--
-- Two postings in ONE session and therefore one temp table. If the corrected statement failed to
-- clear, the second transaction would carry the first's entries and the amounts would double —
-- a silent wrong number in the ledger, which is worse than the error it replaced.
create temporary table l_ctx as
select (select id from ledger_account where code = 'provider:razorpay:clearing') as clearing,
       (select id from ledger_account where code = 'platform:revenue') as revenue;

select lives_ok($$
  select post_ledger_transaction(
    'sale', 'payment', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',  'amount_paise', 1000),
      jsonb_build_object('account', 'platform:revenue',           'direction', 'credit', 'amount_paise', 1000)),
    now(), gen_random_uuid(), null, null, 'safeupdate-test-1')
$$, 'a first posting succeeds');

select lives_ok($$
  select post_ledger_transaction(
    'sale', 'payment', gen_random_uuid(),
    jsonb_build_array(
      jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',  'amount_paise', 2500),
      jsonb_build_object('account', 'platform:revenue',           'direction', 'credit', 'amount_paise', 2500)),
    now(), gen_random_uuid(), null, null, 'safeupdate-test-2')
$$, 'a second posting in the SAME session succeeds — the temp table was cleared');

select is(
  (select count(*)::int from ledger_entry le
     join ledger_transaction lt on lt.id = le.transaction_id
    where lt.idempotency_key = 'safeupdate-test-2'),
  2,
  'the second transaction has exactly two entries, not four — no carry-over from the first');

select is(
  (select sum(le.amount_paise)::bigint from ledger_entry le
     join ledger_transaction lt on lt.id = le.transaction_id
    where lt.idempotency_key = 'safeupdate-test-2' and le.direction = 'debit'),
  2500::bigint,
  'and its amounts are its own, not the first posting''s');

-- ---------------------------------------------------------------- idempotency, re-asserted
--
-- The drain and the app poller can both reach settlement, so a repeat must write nothing.
select is(
  (select post_ledger_transaction(
     'sale', 'payment', gen_random_uuid(),
     jsonb_build_array(
       jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',  'amount_paise', 1000),
       jsonb_build_object('account', 'platform:revenue',           'direction', 'credit', 'amount_paise', 1000)),
     now(), gen_random_uuid(), null, null, 'safeupdate-test-1')),
  (select id from ledger_transaction where idempotency_key = 'safeupdate-test-1'),
  'a repeat with the same idempotency key returns the existing transaction');

select is(
  (select count(*)::int from ledger_transaction where idempotency_key = 'safeupdate-test-1'),
  1,
  'and writes no second transaction — the drain re-running cannot double-ledger');

select * from finish();
rollback;
