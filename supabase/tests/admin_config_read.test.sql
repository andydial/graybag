-- =============================================================================
-- admin_config_read.test.sql — E10-06
--
-- The config screen's reads, exercised **as the role that will actually use them**.
--
-- Andy's rule, 2026-08-15: every back-office read is tested through an authenticated client
-- as the role that will perform it, never as the service role. The service role bypasses RLS
-- entirely, so a suite written against it proves the columns exist and proves nothing at all
-- about who can see them — and `[AUTH-01]` is that every authorization failure must be loud
-- rather than looking like ordinary empty data.
--
-- These assertions run under `set local role authenticated` with `request.jwt.claims` set to a
-- specific user, which is what PostgREST does for a signed-in caller. A broken harness makes
-- every deny pass for the wrong reason, so the first assertion checks the harness itself.
--
-- ## The one that matters
--
-- An operator **without** the config grants must read **zero rows, with no error**. That is not
-- a bug, it is how `0002` is written and how PostgREST behaves — and it is exactly why
-- `fetchSchoolConfig` in `packages/shared/src/api/admin-config.ts` refuses on an empty
-- `platform_config` rather than rendering defaults. A screen that draws every setting as an
-- inherited platform default when the truth is "you cannot see this configuration" is the
-- failure `[AUTH-01]` names, and it would look completely normal.
--
-- ## On fixtures that grant permissions
--
-- The grants below are test fixtures inside a transaction that ends in `rollback`. Nothing here
-- changes who can do what in any real environment.
--
--   psql -f this file    (any database with 0001..0056 applied)
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

select plan(11);

-- -----------------------------------------------------------------------------
-- Fixtures: one kitchen, one school, and three people.
--
--   admin   — holds config.platform_edit, kitchen.config_edit, school.config_edit
--   kitchOp — holds orders.view only, the grant a kitchen porter actually has
--   granter — exists solely to satisfy permission_grant.granted_by_user_id NOT NULL
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code)
values ('cf000000-7e57-0000-0000-000000000001', 'cfgread_city', 'Config Read City', 'Punjab', '03');

insert into kitchen (id, code, name, city_id)
values ('cf000000-7e57-0000-0000-000000000002', 'cfgread_kitchen', 'Config Read Kitchen',
        'cf000000-7e57-0000-0000-000000000001');

insert into school (id, code, name, city_id, kitchen_id, onboarded_at)
values ('cf000000-7e57-0000-0000-00000000000a', 'cfgread_school', 'Config Read School',
        'cf000000-7e57-0000-0000-000000000001', 'cf000000-7e57-0000-0000-000000000002', now());

-- auth.users first — app_user.id references it. Only `id` is supplied: every other column in
-- the gotrue schema is nullable or defaulted, and touching more of it would couple this suite
-- to a gotrue version.
insert into auth.users (id) values
  ('cf000000-7e57-0000-0000-0000000000f0'),   -- granter, exists only for granted_by_user_id
  ('cf000000-7e57-0000-0000-0000000000f1'),   -- admin,  holds the three config grants
  ('cf000000-7e57-0000-0000-0000000000f2');   -- porter, holds orders.view and nothing else

-- `0018` put a trigger on `auth.users`, so the app_user rows already exist by now. This
-- describes them rather than creating them — an `insert` here fails on the primary key.
insert into app_user (id, phone_e164, first_name, last_name) values
  ('cf000000-7e57-0000-0000-0000000000f0', '+917571000000', 'Granter', 'Fixture'),
  ('cf000000-7e57-0000-0000-0000000000f1', '+917571000001', 'Admin',   'Fixture'),
  ('cf000000-7e57-0000-0000-0000000000f2', '+917571000002', 'Porter',  'Fixture')
on conflict (id) do update
  set phone_e164 = excluded.phone_e164,
      first_name = excluded.first_name,
      last_name  = excluded.last_name;

insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id) values
  ('cf000000-7e57-0000-0000-0000000000f1', 'config.platform_edit', 'platform', null, 'cf000000-7e57-0000-0000-0000000000f0'),
  ('cf000000-7e57-0000-0000-0000000000f1', 'kitchen.config_edit',  'platform', null, 'cf000000-7e57-0000-0000-0000000000f0'),
  ('cf000000-7e57-0000-0000-0000000000f1', 'school.config_edit',   'platform', null, 'cf000000-7e57-0000-0000-0000000000f0'),
  ('cf000000-7e57-0000-0000-0000000000f2', 'orders.view', 'kitchen', 'cf000000-7e57-0000-0000-000000000002', 'cf000000-7e57-0000-0000-0000000000f0');

-- The school override the screen must be able to see and attribute.
insert into school_config (school_id, order_cutoff_time, service_days)
values ('cf000000-7e57-0000-0000-00000000000a', '11:00', '{1,2,3,4,5}'::smallint[]);

insert into kitchen_config (kitchen_id, max_advance_order_days)
values ('cf000000-7e57-0000-0000-000000000002', 7);

-- Scratch tables for what each persona saw. Written under `role authenticated` and read back
-- after `reset role`, because pgTAP's own assertions need to run as the owner.
--
-- Created and granted **before** any `set local role`: `authenticated` may not create a table
-- and may not write to one it was not granted, and either failure aborts the transaction, which
-- turns the whole file into a run of "current transaction is aborted" with no `not ok` in it.
-- That is the exact shape `scripts/test-db.sh` warns about in its header.
--
-- Values are stored as text so one table holds a time, an array and an integer. The assertions
-- cast back, so a wrong type still fails.
create temporary table seen (persona text, tbl text, n bigint) on commit drop;
create temporary table seen_values (k text, v text) on commit drop;
grant select, insert on seen, seen_values to authenticated;

-- -----------------------------------------------------------------------------
-- The harness itself. A BROKEN SETUP MAKES EVERY DENY BELOW PASS FOR THE WRONG REASON.
-- -----------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cf000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true); end $$;
set local role authenticated;
select is((select auth.uid()), 'cf000000-7e57-0000-0000-0000000000f1'::uuid,
  'harness: auth.uid() reads the impersonated admin, so the reads below are really scoped');
reset role;

-- -----------------------------------------------------------------------------
-- PART 1 — the operator who will use the screen
-- -----------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cf000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into seen values
  ('admin', 'platform_config', (select count(*) from platform_config where id = 1)),
  ('admin', 'kitchen_config',  (select count(*) from kitchen_config  where kitchen_id = 'cf000000-7e57-0000-0000-000000000002')),
  ('admin', 'school_config',   (select count(*) from school_config   where school_id  = 'cf000000-7e57-0000-0000-00000000000a')),
  ('admin', 'school',          (select count(*) from school          where id         = 'cf000000-7e57-0000-0000-00000000000a'));
reset role;

select is((select n from seen where persona='admin' and tbl='platform_config'), 1::bigint,
  'an operator with config.platform_edit reads the platform defaults');
select is((select n from seen where persona='admin' and tbl='kitchen_config'), 1::bigint,
  'an operator with kitchen.config_edit reads the kitchen overrides');
select is((select n from seen where persona='admin' and tbl='school_config'), 1::bigint,
  'an operator with school.config_edit reads the school overrides');
select is((select n from seen where persona='admin' and tbl='school'), 1::bigint,
  'and the school row itself, which is where the kitchen_id comes from');

-- The values, not merely the row counts. A policy that returned the row but a resolver reading
-- the wrong school would still pass a count assertion.
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cf000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into seen_values values
  ('school_cutoff',   (select order_cutoff_time::text      from school_config  where school_id  = 'cf000000-7e57-0000-0000-00000000000a')),
  ('school_days',     (select service_days::text           from school_config  where school_id  = 'cf000000-7e57-0000-0000-00000000000a')),
  ('kitchen_advance', (select max_advance_order_days::text from kitchen_config where kitchen_id = 'cf000000-7e57-0000-0000-000000000002')),
  ('platform_cutoff', (select order_cutoff_time::text      from platform_config where id = 1));
reset role;

select is((select v from seen_values where k='school_cutoff')::time, '11:00'::time,
  'the school override reads back as the value that was set, under the caller''s own role');
select is((select v from seen_values where k='school_days')::smallint[], '{1,2,3,4,5}'::smallint[],
  'and so does service_days, which E10-06 added');
select is((select v from seen_values where k='kitchen_advance')::smallint, 7::smallint,
  'the kitchen override is readable and distinguishable from the school''s');
select isnt((select v from seen_values where k='platform_cutoff'), null,
  'the platform default is readable — it is what an un-overridden setting resolves to');

-- -----------------------------------------------------------------------------
-- PART 2 — the operator who must NOT see this, and what that looks like
--
-- `revenue_share_bps` (M4) is on the same row as the cutoff, and RLS filters rows, not columns.
-- That is the whole reason config is shut to kitchen staff rather than column-redacted.
-- -----------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims',
  '{"sub":"cf000000-7e57-0000-0000-0000000000f2","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into seen values
  ('porter', 'platform_config', (select count(*) from platform_config)),
  ('porter', 'kitchen_config',  (select count(*) from kitchen_config)),
  ('porter', 'school_config',   (select count(*) from school_config));
reset role;

select is(
  (select sum(n)::bigint from seen where persona = 'porter'),
  0::bigint,
  'a kitchen operator reads NOTHING from any config table — revenue_share_bps sits beside the cutoff'
);

-- THE ONE THAT MATTERS. Zero rows and NO ERROR. `fetchSchoolConfig` refuses on this rather than
-- rendering platform defaults, because an unreadable configuration and an unconfigured school
-- are indistinguishable from the client and must not render the same.
select lives_ok(
  $$ set local role authenticated;
     select count(*) from platform_config;
     reset role; $$,
  'and it is a silent empty result, not an error — which is why the client refuses on it'
);

select * from finish();
rollback;
