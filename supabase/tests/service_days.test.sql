-- =============================================================================
-- service_days.test.sql — E10-06
--
-- Service days resolve on the same platform -> kitchen -> school chain as every other
-- setting, and `orderable_calendar` refuses a day the school is not served on.
--
-- Its own file rather than more assertions in `config_resolution.test.sql`, because half
-- of what is worth testing here is the *calendar's* behaviour rather than the resolver's,
-- and the two suites build different fixtures.
--
-- ## The one that matters most
--
-- `not_a_service_day` must beat `cutoff_passed`. Both are true of a Saturday in the past
-- at a Monday-to-Friday school, and the reason string is what the app renders. Getting the
-- precedence backwards tells a parent "you have missed it" about a day that was never open,
-- which reads as "order earlier next Saturday" — advice that will fail again.
--
--   psql -f this file    (any database with 0001..0058 applied)
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
-- Fixtures. Three schools on one kitchen, same shape and the same reasoning as
-- config_resolution.test.sql: one kitchen makes "the school overrode it" and "the
-- kitchen overrode it" distinguishable within a single run.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code)
values ('5d000000-7e57-0000-0000-000000000001', 'svcday_city', 'Service Day City', 'Punjab', '03');

insert into kitchen (id, code, name, city_id)
values ('5d000000-7e57-0000-0000-000000000002', 'svcday_kitchen', 'Service Day Kitchen',
        '5d000000-7e57-0000-0000-000000000001');

insert into school (id, code, name, city_id, kitchen_id, onboarded_at) values
  ('5d000000-7e57-0000-0000-00000000000a', 'svcday_plain',   'Plain School',   '5d000000-7e57-0000-0000-000000000001', '5d000000-7e57-0000-0000-000000000002', now()),
  ('5d000000-7e57-0000-0000-00000000000b', 'svcday_kitchen', 'Kitchen School', '5d000000-7e57-0000-0000-000000000001', '5d000000-7e57-0000-0000-000000000002', now()),
  ('5d000000-7e57-0000-0000-00000000000c', 'svcday_both',    'Both School',    '5d000000-7e57-0000-0000-000000000001', '5d000000-7e57-0000-0000-000000000002', now());

-- -----------------------------------------------------------------------------
-- 1. Inheritance
-- -----------------------------------------------------------------------------

-- Nothing overridden anywhere: the platform default, which 0058 sets to all seven days
-- precisely so that applying it changes nothing.
select is(
  (select service_days from resolve_effective_config('5d000000-7e57-0000-0000-00000000000a')),
  '{1,2,3,4,5,6,7}'::smallint[],
  'no override anywhere resolves to the platform default of all seven days'
);

-- Kitchen only.
insert into kitchen_config (kitchen_id, service_days)
values ('5d000000-7e57-0000-0000-000000000002', '{1,2,3,4,5,6}'::smallint[]);

select is(
  (select service_days from resolve_effective_config('5d000000-7e57-0000-0000-00000000000b')),
  '{1,2,3,4,5,6}'::smallint[],
  'a kitchen override reaches a school with no override of its own'
);

-- School over kitchen.
insert into school_config (school_id, service_days)
values ('5d000000-7e57-0000-0000-00000000000c', '{1,2,3,4,5}'::smallint[]);

select is(
  (select service_days from resolve_effective_config('5d000000-7e57-0000-0000-00000000000c')),
  '{1,2,3,4,5}'::smallint[],
  'a school override beats the kitchen override'
);

-- The other two schools are unmoved by the school-level override on the third. This is the
-- assertion that catches a resolver joining school_config without a school_id predicate.
select is(
  (select service_days from resolve_effective_config('5d000000-7e57-0000-0000-00000000000b')),
  '{1,2,3,4,5,6}'::smallint[],
  'one school''s override does not leak to its sibling on the same kitchen'
);

-- A school_config row that exists but leaves service_days NULL still inherits. NULL means
-- inherit, and a present-but-empty row is the commonest way that gets broken — the row is
-- created to set the cutoff and every other column reads as "overridden to null".
insert into school_config (school_id, order_cutoff_time)
values ('5d000000-7e57-0000-0000-00000000000a', '11:00');

select is(
  (select service_days from resolve_effective_config('5d000000-7e57-0000-0000-00000000000a')),
  '{1,2,3,4,5,6}'::smallint[],
  'a school_config row with a NULL service_days inherits rather than overriding to null'
);

-- -----------------------------------------------------------------------------
-- 2. The constraints
--
-- Empty is refused on all three levels. A school served on no days is expressed by
-- school.is_active, not by an array nobody will think to look at.
-- -----------------------------------------------------------------------------
select throws_ok(
  $$update platform_config set service_days = '{}'::smallint[] where id = 1$$,
  '23514',
  null,
  'platform_config refuses an empty service_days'
);

select throws_ok(
  $$update kitchen_config set service_days = '{}'::smallint[] where kitchen_id = '5d000000-7e57-0000-0000-000000000002'$$,
  '23514',
  null,
  'kitchen_config refuses an empty service_days'
);

select throws_ok(
  $$update school_config set service_days = '{}'::smallint[] where school_id = '5d000000-7e57-0000-0000-00000000000c'$$,
  '23514',
  null,
  'school_config refuses an empty service_days'
);

-- 0 is a valid weekday in the OTHER common encoding (0 = Sunday). Refusing it is what stops
-- the two conventions being mixed, which is the failure the column comment warns about.
select throws_ok(
  $$update school_config set service_days = '{0,1,2}'::smallint[] where school_id = '5d000000-7e57-0000-0000-00000000000c'$$,
  '23514',
  null,
  'a 0 weekday is refused — this schema is ISO, 1 = Monday, and 0 = Sunday elsewhere'
);

select throws_ok(
  $$update school_config set service_days = '{1,8}'::smallint[] where school_id = '5d000000-7e57-0000-0000-00000000000c'$$,
  '23514',
  null,
  'a weekday above 7 is refused'
);

-- NULL is always allowed: it is how inheritance is expressed.
select lives_ok(
  $$update kitchen_config set service_days = null where kitchen_id = '5d000000-7e57-0000-0000-000000000002'$$,
  'NULL is accepted — it is the inherit sentinel, not a missing value'
);
-- Put it back for the calendar assertions below.
update kitchen_config set service_days = '{1,2,3,4,5,6}'::smallint[]
 where kitchen_id = '5d000000-7e57-0000-0000-000000000002';

-- -----------------------------------------------------------------------------
-- 3. The calendar
--
-- Dates are fixed rather than relative to current_date, so these assertions mean the same
-- thing whenever the suite runs. 2026-08-17 is a Monday and 2026-08-22 a Saturday; both are
-- verified by the isodow assertion below rather than asserted from memory.
-- -----------------------------------------------------------------------------
select is(
  extract(isodow from date '2026-08-22')::int, 6,
  'harness: 2026-08-22 really is a Saturday, so the assertions below mean what they say'
);

-- The advance window has to be widened or every one of these days is `too_far_ahead` and
-- the reason precedence is never exercised.
update platform_config set max_advance_order_days = 3650, min_advance_order_days = 0 where id = 1;

-- 'Both School' is Monday to Friday.
select is(
  (select reason from orderable_calendar('5d000000-7e57-0000-0000-00000000000c',
                                         date '2026-08-22', date '2026-08-22')),
  'not_a_service_day',
  'a Saturday at a Monday-to-Friday school is refused as not_a_service_day'
);

select is(
  (select is_orderable from orderable_calendar('5d000000-7e57-0000-0000-00000000000c',
                                               date '2026-08-22', date '2026-08-22')),
  false,
  'and is_orderable is false, not merely reasoned about'
);

-- THE ONE THAT MATTERS. This date is in the past, so its cutoff has certainly passed and
-- `cutoff_passed` is equally true of it. The permanent reason must win.
select is(
  (select reason from orderable_calendar('5d000000-7e57-0000-0000-00000000000c',
                                         date '2020-01-04', date '2020-01-04')),
  'not_a_service_day',
  'not_a_service_day beats cutoff_passed on a past Saturday — the permanent reason wins'
);

-- A school on the platform default is unaffected, which is the property that makes 0058
-- safe to apply to a live database mid-week.
select is(
  (select count(*) from orderable_calendar('5d000000-7e57-0000-0000-00000000000b',
                                           date '2026-08-17', date '2026-08-22')
    where reason is distinct from 'not_a_service_day'),
  6::bigint,
  'Monday to Saturday are all service days at a school inheriting the six-day kitchen'
);

select * from finish();
rollback;
