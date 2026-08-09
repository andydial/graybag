-- =============================================================================
-- calendar.test.sql — E05-08
--
-- `orderable_calendar` answers "which of these days can be ordered for" for a whole range in
-- one call. It is ADVISORY (order-lifecycle §9.2 E1): the app greys out closed days with it,
-- and the authoritative refusal is `assert_cutoff_open` inside the checkout transaction. A
-- client clock is not evidence.
--
-- Two things it must get right, both of which are quiet when wrong:
--
--   * **one config resolution for the whole range**, not one per day. `0008` says so in
--     `is_service_date_orderable`'s comment, and a calendar that resolved per day would do
--     fourteen chain walks to draw one month.
--   * **the same cutoff arithmetic as `compute_cutoff_at`**, because a second implementation
--     that drifted by an hour is a whole-day error at the default midnight cutoff (C5).
--     Asserted here by comparing the two directly rather than by restating the formula.
--
--   docker exec -i supabase_db_graybag psql -U postgres -d postgres < this file
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

select plan(13);

-- -----------------------------------------------------------------------------
-- Fixtures. Two kitchens for the same reason cutoff.test.sql needs two: a school on
-- platform defaults must hang off a kitchen that overrides nothing, or it inherits the
-- override and stops testing the defaults.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code, country_code, timezone)
values ('c1000000-7e57-0000-0000-000000000508', 'cal_city', 'Calendar City', 'Punjab', '03', 'IN', 'Asia/Kolkata');

insert into kitchen (id, code, name, city_id, address_line1, postcode, contact_name, contact_email, contact_phone)
values
  ('cc000000-7e57-0000-0000-000000000510', 'cal_kitchen_plain', 'Plain Calendar Kitchen',
   'c1000000-7e57-0000-0000-000000000508', '1 Road', '160055', 'Ops', 'ops@example.test', '9999999999'),
  ('cc000000-7e57-0000-0000-000000000509', 'cal_kitchen', 'Calendar Kitchen',
   'c1000000-7e57-0000-0000-000000000508', '2 Road', '160055', 'Ops', 'ops@example.test', '9999999999');

insert into school (id, code, name, city_id, kitchen_id, institution_type, address_line1, postcode)
values
  ('50000000-7e57-0000-0000-000000000511', 'cal_default', 'Calendar Default School',
   'c1000000-7e57-0000-0000-000000000508', 'cc000000-7e57-0000-0000-000000000510', 'school', '3 Road', '160055'),
  ('50000000-7e57-0000-0000-000000000512', 'cal_window', 'Calendar Window School',
   'c1000000-7e57-0000-0000-000000000508', 'cc000000-7e57-0000-0000-000000000509', 'school', '4 Road', '160055');

-- A narrow horizon and a two-day lead, so the window edges are testable at all.
insert into school_config (school_id, max_advance_order_days, min_advance_order_days)
values ('50000000-7e57-0000-0000-000000000512', 5, 2);

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::int from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date, current_date + 6)),
  7,
  'a seven-day range returns seven rows, inclusive of both ends');

select is(
  (select count(*)::int from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date, current_date)),
  1,
  'a single-day range returns one row');

select is(
  (select count(*)::int from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date + 3, current_date)),
  0,
  'a backwards range returns nothing rather than erroring or looping');

select is(
  (select array_agg(service_date order by service_date)
     from orderable_calendar('50000000-7e57-0000-0000-000000000511', current_date, current_date + 2)),
  array[current_date, current_date + 1, current_date + 2],
  'the dates come back in ascending order');

-- -----------------------------------------------------------------------------
-- It must agree with compute_cutoff_at, rather than reimplementing it.
-- -----------------------------------------------------------------------------
select is(
  (select cutoff_at from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date + 5, current_date + 5)),
  compute_cutoff_at('50000000-7e57-0000-0000-000000000511', current_date + 5),
  'the cutoff it reports is the one compute_cutoff_at computes — one implementation, not two');

select is(
  (select is_orderable from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date + 5, current_date + 5)),
  is_service_date_orderable('50000000-7e57-0000-0000-000000000511', current_date + 5),
  'and it agrees with is_service_date_orderable for a date inside the window');

-- -----------------------------------------------------------------------------
-- C6 / C5. Today is not orderable under the default midnight cutoff, whatever
-- min_advance_order_days says — the two settings are independent.
-- -----------------------------------------------------------------------------
select is(
  (select is_orderable from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date, current_date)),
  false,
  'C6: today is closed under the default midnight cutoff');

select is(
  (select reason from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date, current_date)),
  'cutoff_passed',
  '…and it says so as cutoff_passed, not as a window problem');

select is(
  (select is_orderable from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date + 3, current_date + 3)),
  true,
  'a date comfortably inside the horizon is open');

select is(
  (select reason from orderable_calendar(
     '50000000-7e57-0000-0000-000000000511', current_date + 3, current_date + 3)),
  null,
  'an open day carries no reason — a reason is why something is refused');

-- -----------------------------------------------------------------------------
-- The advance window, on the school that narrows it to min 2 / max 5.
-- -----------------------------------------------------------------------------
select is(
  (select reason from orderable_calendar(
     '50000000-7e57-0000-0000-000000000512', current_date + 1, current_date + 1)),
  'too_soon',
  'inside min_advance_order_days the day is refused as too_soon');

select is(
  (select reason from orderable_calendar(
     '50000000-7e57-0000-0000-000000000512', current_date + 6, current_date + 6)),
  'too_far_ahead',
  'beyond max_advance_order_days the day is refused as too_far_ahead');

-- The cutoff is checked BEFORE the window, because a passed cutoff is the more specific and
-- more actionable fact: "you have missed it" rather than "that is too soon".
select is(
  (select reason from orderable_calendar(
     '50000000-7e57-0000-0000-000000000512', current_date, current_date)),
  'cutoff_passed',
  'a day that is both past its cutoff and too soon reports cutoff_passed');

select finish();
rollback;
