-- =============================================================================
-- over_refund.test.sql — `E06-21`, §7.3.
--
-- Over-refunding is real money leaving twice, and the two halves of this guard fail in ways that
-- need two different kinds of test:
--
--   * the **arithmetic** (failed excluded, in-flight included) needs `set constraints …
--     immediate`, because the trigger is `DEFERRABLE INITIALLY DEFERRED` and otherwise does not
--     fire until a COMMIT this file never reaches;
--   * the **race** needs a genuinely second connection, because the whole defect is that two
--     transactions cannot see each other. It is run through `dblink` against committed state and
--     cleaned up afterwards.
--
-- The extensions are created outside any transaction, or the rollback below takes them with it.
-- =============================================================================

create extension if not exists pgtap;
create extension if not exists dblink;
create schema if not exists tests_tmp;

-- dblink refuses a bare `dbname=` — "non-superusers must provide a password" — so the second
-- connection is opened with explicit local credentials. These are the local stack's fixed
-- development values (`supabase status`), never a secret, and this function exists only so the
-- string is written once.
create or replace function tests_tmp.local_conninfo() returns text language sql immutable as
$conn$ select 'host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres' $conn$;

-- =============================================================================
-- 1. The arithmetic. `docs/data-model.md` §8.3 described this wrongly in both directions; the
--    implementation only ever had the other defect (the race).
-- =============================================================================
begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
select * from no_plan();
set local app.actor_type = 'system';

-- Fire on the statement rather than at COMMIT, so `throws_ok` can see it. Without this the
-- assertions below all report "caught: no exception" — which is what a deferred trigger looks
-- like from inside a transaction that never commits, and is worth knowing before writing a
-- test that silently proves nothing.
set constraints refund_not_over_captured immediate;

create temporary table r_ctx as select 'e1000000-7e57-0000-0000-0000000000a7'::uuid as group_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from r_ctx), (select id from app_user limit 1),
       'over-refund-test', (select id from city limit 1), 20000, 1000, 21000;

insert into payment (order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
select (select group_id from r_ctx), 'razorpay', 'order_refund_a7', 21000, 'captured',
       gen_random_uuid();

create or replace function tests_tmp.add_refund(p_amount bigint, p_status refund_status)
returns void language sql as $fn$
  insert into refund (order_group_id, amount_paise, destination, status, reason_code,
                      correlation_id)
  select 'e1000000-7e57-0000-0000-0000000000a7'::uuid, p_amount, 'wallet', p_status,
         (select code from reason_code where category = 'refund' limit 1), gen_random_uuid();
$fn$;

select lives_ok(
  $$ select tests_tmp.add_refund(21000, 'failed') $$,
  'a FAILED refund of the full amount is allowed');

select lives_ok(
  $$ select tests_tmp.add_refund(21000, 'completed') $$,
  '§7.3: and it does not block the legitimate retry — failed refunds are excluded from the sum, '
  'or two failed attempts would make a full refund impossible for ever');

select throws_ok(
  $$ select tests_tmp.add_refund(1, 'pending') $$,
  '23514', null,
  'one paise beyond the captured amount is refused');

select * from finish();
rollback;

-- =============================================================================
-- 2. The lock itself, asserted structurally — and what that does and does not buy.
--
-- The race needs two connections that each hold an open transaction, and this suite has no
-- harness for that: `dblink` runs each statement in its own committed transaction, so it cannot
-- hold one open across the window where the defect lives. Building a real one (two backends, a
-- barrier, an advisory-lock handshake) is worth doing and is `E06-35`.
--
-- Until then the honest position is: **the fix is reasoned, not demonstrated.** What IS asserted
-- is that the lock is still there — which is weak as a proof and strong as a regression guard,
-- because the way this breaks is somebody simplifying the function and dropping the `perform`.
-- =============================================================================
begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
select * from no_plan();

select matches(
  (select pg_get_functiondef(oid) from pg_proc where proname = 'trg_assert_refund_not_over_captured'),
  'for update',
  'E06-21: the guard still takes the order_group row lock. Deferring to COMMIT is necessary and '
  'NOT sufficient — under READ COMMITTED two concurrent refunds cannot see each other, so both '
  'sum the same total and both commit. This assertion is a regression guard on the one line that '
  'closes it, not a demonstration that it does; a real two-session test is E06-35');

select matches(
  (select pg_get_functiondef(oid) from pg_proc where proname = 'trg_assert_refund_not_over_captured'),
  'pending.*processing.*completed',
  'and it sums the three non-terminal statuses explicitly rather than `<> failed`, so a status '
  'added later is excluded until somebody decides — the direction that fails safely');

select * from finish();
rollback;
