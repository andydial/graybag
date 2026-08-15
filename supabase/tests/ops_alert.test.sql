-- =============================================================================
-- ops_alert.test.sql — the one alert's dedupe and its blast radius. `E06-39`.
--
-- The table is trivial. The two things worth asserting are the ones that would fail in
-- production and nowhere else:
--
--   1. **The unique index really deduplicates**, because the whole design rests on the sender
--      claiming by INSERT and reading `23505` as "already sent today". If the index does not
--      bite, an hourly cron sends 24 identical emails and everybody learns to ignore the sender.
--   2. **No parent can read it.** It names payment ids and failure counts.
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

insert into ops_alert (kind, alert_date, summary)
values ('settlement_stuck', date '2026-08-16', '2 events stuck');

select is((select count(*)::int from ops_alert where alert_date = date '2026-08-16'), 1,
          'the first alert of the day is recorded');

-- THE assertion. The sender treats this failure as success ("already sent today"), so if the
-- index were missing every drain would send another email and nothing would look wrong.
select throws_ok(
  $$ insert into ops_alert (kind, alert_date, summary)
     values ('settlement_stuck', date '2026-08-16', 'still 2 events stuck') $$,
  '23505', null,
  'a second alert of the SAME kind on the SAME day is refused — this is the whole dedupe, and '
  'the sender reads the refusal as "already sent"');

select is((select count(*)::int from ops_alert), 1,
          'and nothing was written by the refused insert');

-- A different money path on the same day is a different problem and must still get through.
insert into ops_alert (kind, alert_date, summary)
values ('partial_refund_refused', date '2026-08-16', 'a partial refund was refused');

select is((select count(*)::int from ops_alert where alert_date = date '2026-08-16'), 2,
          'a DIFFERENT kind on the same day still sends — one stuck settlement must not '
          'suppress news of an unrecorded refund');

-- Tomorrow the same problem is worth saying again: nobody fixed it.
insert into ops_alert (kind, alert_date, summary)
values ('settlement_stuck', date '2026-08-17', 'still stuck, a day later');

select is((select count(*)::int from ops_alert where kind = 'settlement_stuck'), 2,
          'and the same kind on the NEXT day sends again — an unfixed money problem should '
          'keep saying so');

-- =============================================================================
-- Blast radius. RLS is on and no policy exists, so every non-service role reads nothing.
-- =============================================================================

select ok(
  (select relrowsecurity from pg_class where relname = 'ops_alert'),
  'row level security is enabled');

select is(
  (select count(*)::int from pg_policies where tablename = 'ops_alert'),
  0,
  'and NO policy grants anybody access — default-deny (non-negotiable #2), so service_role, '
  'which bypasses RLS, is the only reader');

-- **`42501`, not an empty result**, and the difference is worth asserting rather than smoothing
-- over. `0005` states table privileges explicitly instead of inheriting Supabase's defaults
-- (`E02-25`), and `ops_alert` was created without granting anything — so a parent is stopped by
-- the privilege system before RLS is ever consulted. That is one layer stronger than a policy
-- that filters every row away, and it is what should be true of an operational table.
-- The status check FIRST, while still the session role. `set local role` inside a `throws_ok`
-- body persists for the rest of the transaction even when the statement raises, so the role
-- switches below would otherwise turn this into a second privilege error — which passed as a
-- throw and asserted nothing about the constraint.
select throws_ok(
  $$ insert into ops_alert (kind, alert_date, summary, status)
     values ('settlement_stuck', date '2026-08-18', 'x', 'delivered') $$,
  '23514', null,
  'an unknown status is refused rather than stored — a typo must not become a state nothing '
  'handles');

set local role authenticated;
select throws_ok(
  $$ select 1 from ops_alert $$,
  '42501', null,
  'a signed-in parent is refused at the PRIVILEGE layer, before RLS — these rows name payment '
  'ids and failure counts');
reset role;

set local role anon;
select throws_ok($$ select 1 from ops_alert $$, '42501', null, 'and so is anon');
reset role;

select * from finish();
rollback;
