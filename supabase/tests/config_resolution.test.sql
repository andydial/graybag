-- =============================================================================
-- config_resolution.test.sql — E02-10
--
-- Asserts the config resolution chain: platform -> kitchen -> school, where the
-- MOST SPECIFIC non-null value wins ([DM-07], docs/authorization-model.md §7.6).
--
-- The chain is worth its own suite because every value it resolves is one a customer
-- sees or is charged by — the cutoff time that decides whether an order is accepted,
-- the tax rates on the invoice, whether cancellation is allowed. A resolver that
-- silently returns the platform default when a school has overridden it is not a
-- visible bug; it is a quietly wrong price or a quietly missed cutoff.
--
-- Fixtures are created here rather than relying on supabase/seed.sql, so the suite
-- runs identically against a seeded local stack and an empty staging database.
--
--   supabase test db          (local)
--   psql -f this file         (any database with 0001..0004 applied)
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

select plan(17);

-- -----------------------------------------------------------------------------
-- Fixtures: one city, one kitchen, three schools off the same kitchen.
--
--   schoolPlain    — no kitchen override, no school override -> platform values
--   schoolKitchen  — kitchen overrides only                  -> kitchen values
--   schoolBoth     — kitchen AND school override             -> school wins
--
-- Three schools on ONE kitchen is deliberate: it makes "the school overrode it"
-- and "the kitchen overrode it" distinguishable in the same run, which a single
-- school cannot do.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code)
values ('c9000000-0000-0000-0000-000000000001', 'cfgtest_city', 'Config Test City', 'Punjab', '03');

insert into kitchen (id, code, name, city_id)
values ('c9000000-0000-0000-0000-000000000002', 'cfgtest_kitchen', 'Config Test Kitchen',
        'c9000000-0000-0000-0000-000000000001');

insert into school (id, code, name, city_id, kitchen_id, onboarded_at) values
  ('c9000000-0000-0000-0000-00000000000a', 'cfgtest_plain',   'Plain School',   'c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', now()),
  ('c9000000-0000-0000-0000-00000000000b', 'cfgtest_kitchen', 'Kitchen School', 'c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', now()),
  ('c9000000-0000-0000-0000-00000000000c', 'cfgtest_both',    'Both School',    'c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', now());

-- -----------------------------------------------------------------------------
-- 1. No overrides anywhere -> the platform row, whatever it currently holds.
--    Asserted against platform_config itself rather than against literals, so this
--    suite does not have to be edited every time a platform default is retuned.
-- -----------------------------------------------------------------------------
select is(
  (select order_cutoff_time from resolve_effective_config('c9000000-0000-0000-0000-00000000000a')),
  (select order_cutoff_time from platform_config where id = 1),
  'no override anywhere: cutoff falls through to the platform value'
);
select is(
  (select cgst_rate_bps from resolve_effective_config('c9000000-0000-0000-0000-00000000000a')),
  (select cgst_rate_bps from platform_config where id = 1),
  'no override anywhere: tax rate falls through to the platform value'
);
select is(
  (select price_is_tax_inclusive from resolve_effective_config('c9000000-0000-0000-0000-00000000000a')),
  false,
  'prices are GST-exclusive at every level — SC2, and platform-only by design'
);

-- -----------------------------------------------------------------------------
-- 2. Kitchen override wins over platform.
-- -----------------------------------------------------------------------------
insert into kitchen_config (kitchen_id, order_cutoff_time, customer_cancellation_cutoff_minutes)
values ('c9000000-0000-0000-0000-000000000002', '21:30', 45);

select is(
  (select order_cutoff_time from resolve_effective_config('c9000000-0000-0000-0000-00000000000b')),
  '21:30'::time,
  'kitchen override beats the platform default'
);
select is(
  (select customer_cancellation_cutoff_minutes from resolve_effective_config('c9000000-0000-0000-0000-00000000000b')),
  45,
  '…for every column it sets, not just the first'
);
select is(
  (select max_advance_order_days from resolve_effective_config('c9000000-0000-0000-0000-00000000000b')),
  (select max_advance_order_days from platform_config where id = 1),
  'a kitchen override of ONE column does not blank the columns it left null — this is the bug a row-level COALESCE would cause'
);

-- -----------------------------------------------------------------------------
-- 3. School override wins over kitchen, which still wins over platform.
-- -----------------------------------------------------------------------------
insert into school_config (school_id, order_cutoff_time)
values ('c9000000-0000-0000-0000-00000000000c', '19:00');

select is(
  (select order_cutoff_time from resolve_effective_config('c9000000-0000-0000-0000-00000000000c')),
  '19:00'::time,
  'school override beats the kitchen override'
);
select is(
  (select customer_cancellation_cutoff_minutes from resolve_effective_config('c9000000-0000-0000-0000-00000000000c')),
  45,
  '…while a column the school did NOT override still comes from the kitchen, not the platform'
);
select is(
  (select max_advance_order_days from resolve_effective_config('c9000000-0000-0000-0000-00000000000c')),
  (select max_advance_order_days from platform_config where id = 1),
  '…and a column neither overrode still comes from the platform. All three levels resolved in one row'
);

-- -----------------------------------------------------------------------------
-- 4. NULL means "not overridden", and false does NOT.
--
-- The trap: `coalesce(school.x, kitchen.x, platform.x)` is correct for a null, and
-- catastrophically wrong if anyone ever writes `coalesce(nullif(school.x, false), …)`
-- or treats a falsey value as absent. A school that deliberately turns cancellation
-- OFF must not silently inherit the platform's ON.
-- -----------------------------------------------------------------------------
select ok(
  (select customer_cancellation_allowed from platform_config where id = 1),
  'precondition: the platform allows customer cancellation'
);

update school_config set customer_cancellation_allowed = false
 where school_id = 'c9000000-0000-0000-0000-00000000000c';

select is(
  (select customer_cancellation_allowed from resolve_effective_config('c9000000-0000-0000-0000-00000000000c')),
  false,
  'an explicit FALSE override is honoured — false is a value, not an absence'
);

update school_config set customer_cancellation_allowed = null
 where school_id = 'c9000000-0000-0000-0000-00000000000c';

select is(
  (select customer_cancellation_allowed from resolve_effective_config('c9000000-0000-0000-0000-00000000000c')),
  (select customer_cancellation_allowed from platform_config where id = 1),
  '…and setting it back to NULL resumes inheriting'
);

-- -----------------------------------------------------------------------------
-- 5. The customer-facing wrapper (§7.6) returns the same values, minus the
--    commercially sensitive ones.
--
-- [AZ-*]: resolve_effective_config is invoker-rights and joins three config tables
-- no customer may read, so without effective_config_public a customer gets a NULL
-- ROW WITH NO ERROR — cutoff, break times and prices all resolving to nothing.
-- -----------------------------------------------------------------------------
select is(
  (select order_cutoff_time from effective_config_public('c9000000-0000-0000-0000-00000000000c')),
  '19:00'::time,
  'effective_config_public resolves the same chain the internal resolver does'
);
select is(
  (select cgst_rate_bps from effective_config_public('c9000000-0000-0000-0000-00000000000c')),
  (select cgst_rate_bps from platform_config where id = 1),
  '…including the statutory tax rate, because the cart must show CGST 2.5% + SGST 2.5% rather than one lump 5%'
);
-- Asserted against pg_proc's declared OUT parameters rather than with hasnt_column().
-- hasnt_column() takes a relation, and effective_config_public is a function — it would
-- pass vacuously against a relation that does not exist, which is a test that proves
-- nothing while looking green.
select is(
  (select count(*)::int
     from pg_proc p, unnest(p.proargnames) as argname
    where p.proname = 'effective_config_public'
      and argname = 'revenue_share_bps'),
  0,
  'M4: revenue_share_bps is NOT an output column of the customer-facing resolver — the school commercial term is never shipped to a phone'
);
select cmp_ok(
  (select count(*)::int
     from pg_proc p, unnest(p.proargnames) as argname
    where p.proname = 'effective_config_public' and argname = 'cgst_rate_bps'),
  '=', 1,
  '…and the assertion above is not vacuous: the same query does find a column that IS present'
);

-- -----------------------------------------------------------------------------
-- 6. An unknown school resolves to a NULL composite, not to platform defaults.
--    Returning defaults for a school that does not exist would make a typo look
--    like a working configuration.
--
-- Asserted on the SCALAR call, deliberately. `select 1 from resolve_effective_config(...)`
-- returns ONE ROW even for an unknown school, because a composite-returning (non-setof)
-- function in FROM position always yields exactly one row — a null one. So `is_empty`
-- here would fail against correct behaviour, and, much worse, any application code
-- doing `if rows.length > 0` would conclude the config resolved. That is the same
-- silent-null-row hazard §7.6 exists to close, in a second place.
-- -----------------------------------------------------------------------------
select is(
  (select resolve_effective_config('c9000000-0000-0000-0000-0000000000ff')),
  null::effective_config,
  'an unknown school id resolves to a NULL composite, not to platform defaults'
);

select * from finish();
rollback;
