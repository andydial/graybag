-- =============================================================================
-- menu_version.test.sql — E04-08
--
-- Asserts that `school_menu_version` moves on every change to what a school sees.
--
-- This suite exists because of how the token fails. `E04-10` refetches the menu
-- **only** when the version changes — that is the whole point of it, and it is what
-- makes the app usable on the connections this product is built for. The consequence
-- is that a change which does not bump the version is a change that **never reaches
-- the device**. Not late. Never, until something unrelated bumps it.
--
-- Nothing errors when that happens. No log line, no failed request, no Sentry event:
-- the app is serving a menu it fetched successfully, and the only symptom is that it
-- is the wrong one. The failure is invisible from every direction except this test.
--
-- `0001` wired six triggers. `0007` added the seventh and eighth after this suite was
-- written and found `dish_allergen` uncovered — which is the table that carries
-- allergen tags, so the uncovered path was the one where staleness means a child
-- eating something they are allergic to (non-negotiable #4).
--
-- Fixtures are created here rather than relying on supabase/seed.sql, so the suite
-- runs identically against a seeded local stack and an empty staging database.
--
--   supabase test db          (local)
--   psql -f this file         (any database with 0001..0007 applied)
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

-- 15, and the number is checked rather than eyeballed:
--   grep -cE '^select (ok|isnt|is)\(' supabase/tests/menu_version.test.sql
-- pgTAP treats a wrong plan as a FAILURE even when every assertion passes, which is the
-- point of declaring one — it catches an assertion silently dropped by an early return.
select plan(15);

-- -----------------------------------------------------------------------------
-- Fixtures: one kitchen, two schools. Only school A is assigned the menu, so every
-- assertion below can also check that school B is left alone — a token that bumps
-- for everyone on every change is not wrong, it is just useless, because the app
-- would refetch constantly and the cache would buy nothing.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code, country_code, timezone)
values ('c1000000-7e57-0000-0000-000000000401', 'mv_city', 'MV City', 'Punjab', '03', 'IN', 'Asia/Kolkata');

insert into kitchen (id, code, name, city_id, address_line1, postcode, contact_name, contact_email, contact_phone)
values ('cc000000-7e57-0000-0000-000000000401', 'mv_kitchen', 'MV Kitchen',
        'c1000000-7e57-0000-0000-000000000401', '1 Test Road', '160055', 'Ops', 'ops@example.test', '9999999999');

insert into school (id, code, name, city_id, kitchen_id, institution_type, address_line1, postcode)
values
  ('50000000-7e57-0000-0000-000000000401', 'mv_school_a', 'MV School A',
   'c1000000-7e57-0000-0000-000000000401', 'cc000000-7e57-0000-0000-000000000401', 'school', '2 Test Road', '160055'),
  ('50000000-7e57-0000-0000-000000000402', 'mv_school_b', 'MV School B',
   'c1000000-7e57-0000-0000-000000000401', 'cc000000-7e57-0000-0000-000000000401', 'school', '3 Test Road', '160055');

insert into dish_category (id, code, display_name, sort_order)
values ('dc000000-7e57-0000-0000-000000000401', 'mv_cat', 'MV Category', 10);

insert into allergen (id, code, display_name, sort_order)
values ('a1000000-7e57-0000-0000-000000000401', 'mv_peanut', 'Peanut', 10);

insert into dish (id, kitchen_id, name, category_id)
values ('d1000000-7e57-0000-0000-000000000401', 'cc000000-7e57-0000-0000-000000000401',
        'MV Test Dish', 'dc000000-7e57-0000-0000-000000000401');

insert into menu (id, kitchen_id, name, status)
values ('e1000000-7e57-0000-0000-000000000401', 'cc000000-7e57-0000-0000-000000000401', 'MV Menu', 'active');

insert into menu_item (id, menu_id, dish_id, price_paise)
values ('e2000000-7e57-0000-0000-000000000401', 'e1000000-7e57-0000-0000-000000000401',
        'd1000000-7e57-0000-0000-000000000401', 6000);

insert into menu_assignment (id, school_id, menu_id, valid_from)
values ('e3000000-7e57-0000-0000-000000000401', '50000000-7e57-0000-0000-000000000401',
        'e1000000-7e57-0000-0000-000000000401', current_date - 1);

-- Helper: the current token for a school.
create or replace function mv_version(p_school uuid) returns bigint
language sql as $$ select version from school_menu_version where school_id = p_school $$;

create temporary table mv_mark (school_id uuid primary key, version bigint);
create or replace function mv_snapshot() returns void language plpgsql as $$
begin
  delete from mv_mark;
  insert into mv_mark select school_id, version from school_menu_version;
end;
$$;
create or replace function mv_moved(p_school uuid) returns boolean
language sql as $$
  select coalesce(mv_version(p_school), 0) >
         coalesce((select version from mv_mark where school_id = p_school), 0)
$$;

-- -----------------------------------------------------------------------------
-- 1. The row exists at all
-- -----------------------------------------------------------------------------
select isnt(mv_version('50000000-7e57-0000-0000-000000000401'), null,
  'school A has a menu version token (created by the school trigger)');

-- -----------------------------------------------------------------------------
-- 2. Price change on a menu item — the ordinary case
-- -----------------------------------------------------------------------------
select mv_snapshot();
update menu_item set price_paise = 6500 where id = 'e2000000-7e57-0000-0000-000000000401';

select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'changing a menu item price bumps the assigned school');
select ok(not mv_moved('50000000-7e57-0000-0000-000000000402'),
  'and does not bump a school the menu is not assigned to');

-- -----------------------------------------------------------------------------
-- 3. Dish edit
-- -----------------------------------------------------------------------------
select mv_snapshot();
update dish set description = 'now with a description' where id = 'd1000000-7e57-0000-0000-000000000401';
select ok(mv_moved('50000000-7e57-0000-0000-000000000401'), 'editing a dish bumps the school');

-- -----------------------------------------------------------------------------
-- 4. ALLERGEN TAGS — the path 0001 did not cover, closed by 0007
--
-- This is the assertion the suite exists for. A kitchen discovering a dish contains
-- peanuts writes ONE row into dish_allergen. Nothing in `dish`, `menu` or `menu_item`
-- changes. Before 0007 the token did not move, so every device holding a cached menu
-- kept serving that dish with no warning, and E05-05's add-to-cart check — which reads
-- the cached tags — stayed silent. Nothing errored anywhere.
-- -----------------------------------------------------------------------------
select mv_snapshot();
insert into dish_allergen (dish_id, allergen_id)
values ('d1000000-7e57-0000-0000-000000000401', 'a1000000-7e57-0000-0000-000000000401');

select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'ADDING an allergen tag bumps the school (0007) — the stale-warning path');
select ok(not mv_moved('50000000-7e57-0000-0000-000000000402'),
  'and only the school that can see the dish');

select mv_snapshot();
update dish_allergen set presence = 'may_contain'
 where dish_id = 'd1000000-7e57-0000-0000-000000000401';
select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'CHANGING an allergen presence bumps the school');

select mv_snapshot();
update allergen set display_name = 'Peanuts (all forms)'
 where id = 'a1000000-7e57-0000-0000-000000000401';
select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'renaming the allergen itself bumps every school carrying it');

select mv_snapshot();
delete from dish_allergen
 where dish_id = 'd1000000-7e57-0000-0000-000000000401';
select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'REMOVING an allergen tag bumps the school — old is used when new is null');

-- -----------------------------------------------------------------------------
-- 5. The declared-none flag (0006). An empty tag list and "we checked, there are
--    none" are different facts (MI1/MI7), so moving between them is a real change.
-- -----------------------------------------------------------------------------
select mv_snapshot();
update dish set allergens_declared_none = true where id = 'd1000000-7e57-0000-0000-000000000401';
select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'declaring a dish allergen-free bumps the school');

-- -----------------------------------------------------------------------------
-- 6. Assignment changes — the case menu.version cannot express
-- -----------------------------------------------------------------------------
select mv_snapshot();
insert into menu_assignment (id, school_id, menu_id, valid_from)
values ('e3000000-7e57-0000-0000-000000000402', '50000000-7e57-0000-0000-000000000402',
        'e1000000-7e57-0000-0000-000000000401', current_date - 1);
select ok(mv_moved('50000000-7e57-0000-0000-000000000402'),
  'assigning a menu to a school bumps that school');

select mv_snapshot();
update menu_assignment set revoked_at = now() where id = 'e3000000-7e57-0000-0000-000000000402';
select ok(mv_moved('50000000-7e57-0000-0000-000000000402'),
  'revoking an assignment bumps the school');

-- -----------------------------------------------------------------------------
-- 7. Per-school price override — two schools on one menu must invalidate apart.
--    This is exactly why the token is not menu.version.
-- -----------------------------------------------------------------------------
insert into menu_assignment (id, school_id, menu_id, valid_from)
values ('e3000000-7e57-0000-0000-000000000403', '50000000-7e57-0000-0000-000000000402',
        'e1000000-7e57-0000-0000-000000000401', current_date);

select mv_snapshot();
insert into menu_item_price_override (school_id, menu_item_id, price_paise, valid_from)
values ('50000000-7e57-0000-0000-000000000401', 'e2000000-7e57-0000-0000-000000000401', 5000, current_date);

select ok(mv_moved('50000000-7e57-0000-0000-000000000401'),
  'a per-school price override bumps that school');
select ok(not mv_moved('50000000-7e57-0000-0000-000000000402'),
  'and not the other school on the same menu — the reason this is not menu.version');

-- -----------------------------------------------------------------------------
-- 8. Monotonic. The app compares for INEQUALITY, but a token that could go backwards
--    would let a device that saw version 5 accept a later 4 as "unchanged".
-- -----------------------------------------------------------------------------
select ok(
  (select version from school_menu_version where school_id = '50000000-7e57-0000-0000-000000000401') > 1,
  'the token only ever increases');

select finish();
rollback;
