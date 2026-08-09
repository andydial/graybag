-- =============================================================================
-- cutoff.test.sql — E05-07 (risk: critical)
--
-- The cutoff is what protects the kitchen's lead time. Getting it wrong in one direction
-- means a kitchen discovers at 6am that it owes lunches it never counted; in the other it
-- means refusing orders a parent could legitimately have placed, on the one screen the whole
-- product exists to serve.
--
-- The arithmetic is also **easy to be a whole day wrong about**, which is C5 below and the
-- reason this suite leads with it.
--
--   supabase test db          (local)
--   psql -f this file         (any database with 0001..0008 applied)
-- =============================================================================
begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension pgtap with schema extensions';
    else
      execute 'create extension pgtap';
    end if;
  end if;
end;
$$;

set local search_path = public, extensions, pg_catalog;

select plan(16);

-- -----------------------------------------------------------------------------
-- Fixtures: one kitchen, three schools — platform defaults, a kitchen override,
-- and a school override — so the config chain (D5) is exercised, not just the arithmetic.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code, country_code, timezone)
values ('c1000000-7e57-0000-0000-000000000507', 'co_city', 'Cutoff City', 'Punjab', '03', 'IN', 'Asia/Kolkata');

-- TWO kitchens, deliberately. The "platform defaults" school must hang off a kitchen that
-- overrides NOTHING, or it inherits the override under D5 and stops testing the defaults —
-- which is the second bug this fixture had: with all three schools on one kitchen, giving that
-- kitchen a 09:00 cutoff silently moved the default school to 09:00 too.
insert into kitchen (id, code, name, city_id, address_line1, postcode, contact_name, contact_email, contact_phone)
values
  ('cc000000-7e57-0000-0000-000000000508', 'co_kitchen_plain', 'Plain Cutoff Kitchen',
   'c1000000-7e57-0000-0000-000000000507', '1 Road', '160055', 'Ops', 'ops@example.test', '9999999999'),
  ('cc000000-7e57-0000-0000-000000000507', 'co_kitchen', 'Cutoff Kitchen',
   'c1000000-7e57-0000-0000-000000000507', '1 Road', '160055', 'Ops', 'ops@example.test', '9999999999');

insert into school (id, code, name, city_id, kitchen_id, institution_type, address_line1, postcode)
values
  -- On the plain kitchen: inherits the platform defaults all the way down.
  ('50000000-7e57-0000-0000-000000000501', 'co_default', 'Default School',
   'c1000000-7e57-0000-0000-000000000507', 'cc000000-7e57-0000-0000-000000000508', 'school', '2 Road', '160055'),
  -- On the overriding kitchen, with no school override of its own.
  ('50000000-7e57-0000-0000-000000000502', 'co_kitchen_ovr', 'Kitchen Override School',
   'c1000000-7e57-0000-0000-000000000507', 'cc000000-7e57-0000-0000-000000000507', 'school', '3 Road', '160055'),
  -- Also on the overriding kitchen, so its own override has something to beat.
  ('50000000-7e57-0000-0000-000000000503', 'co_school_ovr', 'School Override School',
   'c1000000-7e57-0000-0000-000000000507', 'cc000000-7e57-0000-0000-000000000507', 'school', '4 Road', '160055');

-- INSERT, NOT UPDATE. Creating a kitchen or a school does NOT create its config row — the
-- override tables are sparse, which is the whole basis of the D5 chain (a missing row means
-- "inherit", and `config_resolution.test.sql` builds its fixtures the same way).
--
-- An `update ... where kitchen_id = ...` against a row that does not exist matches zero rows
-- and reports success. Every assertion below then silently measures the platform default
-- instead of the override, and the suite passes while testing nothing — which is exactly what
-- this fixture did before it was corrected.

-- Kitchen says 09:00 same day. A kitchen that prepares to order rather than in advance.
insert into kitchen_config (kitchen_id, order_cutoff_time, order_cutoff_days_before)
values ('cc000000-7e57-0000-0000-000000000507', '09:00', 0);

-- School says 16:00 the day before — the most specific value wins (D5).
insert into school_config (school_id, order_cutoff_time, order_cutoff_days_before)
values ('50000000-7e57-0000-0000-000000000503', '16:00', 1);

-- -----------------------------------------------------------------------------
-- C5. THE ONE THAT IS EASY TO BE A WHOLE DAY WRONG ABOUT.
--
-- The defaults are `order_cutoff_time = '00:00'` and `order_cutoff_days_before = 0`. So the
-- cutoff for MONDAY's lunch is 00:00 ON MONDAY — you must order by Sunday night. It reads
-- naturally as "23:59 on the service day", which would be a full day later and would have
-- the kitchen cooking for orders it learned about that morning.
--
-- 2026-08-10 is a Monday. Midnight IST on that day is 2026-08-09 18:30 UTC.
-- -----------------------------------------------------------------------------
select is(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000501', date '2026-08-10'),
  timestamptz '2026-08-09 18:30:00+00',
  'C5: the default cutoff for Monday is MIDNIGHT ON MONDAY — order by Sunday night');

select is(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000501', date '2026-08-10') at time zone 'Asia/Kolkata',
  timestamp '2026-08-10 00:00:00',
  'C5 restated in the school''s own timezone: 00:00 on the service date');

-- -----------------------------------------------------------------------------
-- C3. Named timezone, not a fixed offset.
-- -----------------------------------------------------------------------------
select is(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000502', date '2026-08-10'),
  timestamptz '2026-08-10 03:30:00+00',
  'kitchen override: 09:00 IST on the service day = 03:30 UTC');

select is(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000503', date '2026-08-10'),
  timestamptz '2026-08-09 10:30:00+00',
  'school override wins over kitchen (D5): 16:00 IST the day before');

-- A date on the far side of a UK/US DST change, to prove the arithmetic is done in the
-- school's zone and is not picking up the server's.
select is(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000501', date '2026-01-15'),
  timestamptz '2026-01-14 18:30:00+00',
  'January is the same offset as August — India has no DST, and the zone is named not fixed');

-- -----------------------------------------------------------------------------
-- The config chain resolves, rather than the function reading platform_config directly
-- -----------------------------------------------------------------------------
select isnt(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000502', date '2026-08-10'),
  compute_cutoff_at('50000000-7e57-0000-0000-000000000501', date '2026-08-10'),
  'a kitchen override changes the answer');

select isnt(
  compute_cutoff_at('50000000-7e57-0000-0000-000000000503', date '2026-08-10'),
  compute_cutoff_at('50000000-7e57-0000-0000-000000000502', date '2026-08-10'),
  'a school override beats its kitchen''s');

-- -----------------------------------------------------------------------------
-- An unknown school must RAISE, not return a cutoff computed from nulls.
--
-- `resolve_effective_config` returns a NULL composite for an unknown school and a
-- composite-returning function in FROM position yields one row regardless, so "no config"
-- and "config full of nulls" are indistinguishable to a careless caller. A cutoff computed
-- from nulls would be null, `now() < null` is null, and a null guard lets everything past.
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ select compute_cutoff_at('50000000-7e57-0000-0000-000000000999', date '2026-08-10') $$,
  'P0002',
  null,
  'an unknown school raises rather than returning a cutoff built from nulls');

-- -----------------------------------------------------------------------------
-- C1. The boundary is STRICT: exactly at the cutoff, ordering is closed.
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ select assert_cutoff_open(now() + interval '1 second') $$,
  'one second before the cutoff, ordering is open');

select throws_ok(
  $$ select assert_cutoff_open(now()) $$,
  '23514',
  null,
  'C1: EXACTLY at the cutoff, ordering is CLOSED — the comparison is strict');

select throws_ok(
  $$ select assert_cutoff_open(now() - interval '1 second') $$,
  '23514',
  null,
  'one second after the cutoff, ordering is closed');

-- -----------------------------------------------------------------------------
-- §9.2 E5 — cancellation closes `customer_cancellation_cutoff_minutes` EARLIER.
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ select assert_cutoff_open(now() + interval '31 minutes', 30) $$,
  'cancellation is open 31 minutes before a cutoff with a 30-minute grace');

select throws_ok(
  $$ select assert_cutoff_open(now() + interval '29 minutes', 30) $$,
  '23514',
  null,
  'cancellation is CLOSED 29 minutes before that cutoff, though ordering would still be open');

-- C11: the default grace is 0, so cancellation closes at exactly the same instant as
-- ordering — the last minute before cutoff is both orderable and cancellable, and one second
-- later neither.
select throws_ok(
  $$ select assert_cutoff_open(now(), 0) $$,
  '23514',
  null,
  'C11: with the default 0-minute grace, cancellation closes exactly when ordering does');

-- -----------------------------------------------------------------------------
-- The calendar helper (E05-08). Advisory only — §9.2 E1.
-- -----------------------------------------------------------------------------
select is(
  is_service_date_orderable('50000000-7e57-0000-0000-000000000501', current_date + 30),
  true,
  'a date a month out is orderable');

-- C6: `min_advance_order_days = 0` is DEAD CONFIG under the default cutoff. Same-day
-- ordering needs `now() < today 00:00`, which is never true. Not a bug — the two settings
-- are independent — but nobody should read the 0 default as "same-day ordering is on".
select is(
  is_service_date_orderable('50000000-7e57-0000-0000-000000000501', current_date),
  false,
  'C6: today is NOT orderable under the default midnight cutoff, whatever min_advance says');

select finish();
rollback;
