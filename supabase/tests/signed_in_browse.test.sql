-- =============================================================================
-- signed_in_browse.test.sql — signing in must never show you LESS than signing out. `E02-33`
--
-- The defect this file exists to prevent, found on production on 2026-08-15:
--
--   menu items visible to an anonymous visitor   119
--   menu items visible one second after sign-in    0
--
-- `anon_*` browse policies are addressed `to anon`. PostgREST serves a request carrying a JWT as
-- `authenticated`, and a role that is not `anon` cannot match a policy addressed to `anon`. What
-- was left were the `*_read_customer` policies, scoped to schools the parent has a child at — so
-- a parent who had not added a child yet was scoped to nothing, and the menu went blank.
--
-- ## Why no existing test caught it
--
-- `authorization.test.sql` asserts what `anon` may read, thoroughly, and what a *customer* may
-- read **at their own school**, thoroughly. Both passed. Nothing asserted the case in between:
-- a real, signed-in, live account with **no children yet** — which is every parent in the
-- minutes between signing up and adding a child, and the exact window `AR7` protects.
--
-- The fixtures are built here rather than leaning on seed data, so this runs identically against
-- a seeded local stack, a fresh CI database and staging.
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

-- -----------------------------------------------------------------------------
-- Fixtures. One school, one live menu with one active dish, and beside it the two
-- things that must STAY hidden: an inactive item, and an item on a draft menu.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code, country_code, timezone)
values ('c1000000-7e57-0000-0000-000000000601', 'sb_city', 'SB City', 'Punjab', '03', 'IN', 'Asia/Kolkata');

insert into kitchen (id, code, name, city_id, address_line1, postcode, contact_name, contact_email, contact_phone)
values ('cc000000-7e57-0000-0000-000000000601', 'sb_kitchen', 'SB Kitchen',
        'c1000000-7e57-0000-0000-000000000601', '1 Test Road', '160055', 'Ops', 'ops@example.test', '9999999999');

insert into school (id, code, name, city_id, kitchen_id, institution_type, address_line1, postcode,
                    onboarded_at, is_active)
values ('50000000-7e57-0000-0000-000000000601', 'sb_school', 'SB School',
        'c1000000-7e57-0000-0000-000000000601', 'cc000000-7e57-0000-0000-000000000601', 'school',
        '2 Test Road', '160055', now() - interval '30 days', true);

insert into dish_category (id, code, display_name, sort_order)
values ('dc000000-7e57-0000-0000-000000000601', 'sb_cat', 'SB Category', 10);

insert into allergen (id, code, display_name, sort_order)
values ('a1000000-7e57-0000-0000-000000000601', 'sb_peanut', 'Peanut', 10);

insert into dish (id, kitchen_id, name, category_id, food_type)
values ('d1000000-7e57-0000-0000-000000000601', 'cc000000-7e57-0000-0000-000000000601',
        'SB Visible Dish', 'dc000000-7e57-0000-0000-000000000601', 'veg'),
       ('d1000000-7e57-0000-0000-000000000602', 'cc000000-7e57-0000-0000-000000000601',
        'SB Draft-Menu Dish', 'dc000000-7e57-0000-0000-000000000601', 'veg');

-- Allergen tag on the visible dish. Non-negotiable #4: a dish that renders with no allergen tags
-- reads as "contains nothing", so this being readable is a safety property, not a nicety.
insert into dish_allergen (dish_id, allergen_id)
values ('d1000000-7e57-0000-0000-000000000601', 'a1000000-7e57-0000-0000-000000000601');

insert into menu (id, kitchen_id, name, status)
values ('e1000000-7e57-0000-0000-000000000601', 'cc000000-7e57-0000-0000-000000000601', 'SB Live Menu', 'active'),
       ('e1000000-7e57-0000-0000-000000000602', 'cc000000-7e57-0000-0000-000000000601', 'SB Draft Menu', 'draft');

insert into menu_item (id, menu_id, dish_id, price_paise, is_active)
values ('e2000000-7e57-0000-0000-000000000601', 'e1000000-7e57-0000-0000-000000000601',
        'd1000000-7e57-0000-0000-000000000601', 6000, true),
       -- Same live menu, switched off. Must stay hidden from everyone.
       ('e2000000-7e57-0000-0000-000000000602', 'e1000000-7e57-0000-0000-000000000601',
        'd1000000-7e57-0000-0000-000000000602', 7000, false),
       -- Active item on a DRAFT menu. Must stay hidden from everyone.
       ('e2000000-7e57-0000-0000-000000000603', 'e1000000-7e57-0000-0000-000000000602',
        'd1000000-7e57-0000-0000-000000000602', 8000, true);

insert into menu_item_price_override (menu_item_id, school_id, price_paise, valid_from)
values ('e2000000-7e57-0000-0000-000000000601', '50000000-7e57-0000-0000-000000000601',
        5500, current_date - 1);

insert into menu_assignment (id, school_id, menu_id, valid_from)
values ('e3000000-7e57-0000-0000-000000000601', '50000000-7e57-0000-0000-000000000601',
        'e1000000-7e57-0000-0000-000000000601', current_date - 1);

-- The parent at the centre of this: real, live, signed in, and **no child yet**.
--
-- `auth.users` first — `app_user.id` references it, and `0018`'s trigger creates the `app_user`
-- row from it, so the upsert below *describes* an account rather than creating one. Same
-- convention as `authorization.test.sql` and `recipient_school.test.sql`.
insert into auth.users (id) values
  ('a0000000-7e57-0000-0000-000000000601'),
  ('a0000000-7e57-0000-0000-000000000602');

insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-000000000601', 'sb-childless@example.test', 'Childless')
on conflict (id) do update set email = excluded.email, first_name = excluded.first_name;

-- And a dead one, to prove the restrictive policy still wins over the widened permissive ones.
insert into app_user (id, email, first_name, is_disabled)
values ('a0000000-7e57-0000-0000-000000000602', 'sb-disabled@example.test', 'Disabled', true)
on conflict (id) do update set email = excluded.email, first_name = excluded.first_name,
                               is_disabled = excluded.is_disabled;

select is(
  (select count(*)::int from guardian_link
    where user_id = 'a0000000-7e57-0000-0000-000000000601' and revoked_at is null),
  0,
  'fixture: the parent really has no child — which is the whole condition under test');

-- =============================================================================
-- 1. The baseline: what an anonymous visitor sees.
-- =============================================================================

set local role anon;

select is(
  (select count(*)::int from public_menu where school_id = '50000000-7e57-0000-0000-000000000601'),
  1,
  'anon browses the school menu and finds the one live dish');

reset role;

-- =============================================================================
-- 2. THE REGRESSION. The same read, signed in, with no child.
-- =============================================================================

do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a0000000-7e57-0000-0000-000000000601', 'role', 'authenticated')::text,
    true);
end $$;
set local role authenticated;

select is((select auth.uid()), 'a0000000-7e57-0000-0000-000000000601'::uuid,
          'harness: we are the childless parent, so the reads below mean something');

select is(
  (select count(*)::int from public_menu where school_id = '50000000-7e57-0000-0000-000000000601'),
  1,
  'AR7: a signed-in parent with no child sees the SAME menu as a visitor — signing in must never '
  'show you less than signing out');

select is(
  (select count(*)::int from school_menu_version
    where school_id = '50000000-7e57-0000-0000-000000000601'),
  1,
  'and can read the menu version — without it the cache cannot tell a refused read from an empty '
  'menu, and caches the refusal for ever (MenuUnreadableError)');

select is(
  (select count(*)::int from dish where id = 'd1000000-7e57-0000-0000-000000000601'),
  1,
  'the dish itself is readable');

select is(
  (select count(*)::int from dish_allergen
    where dish_id = 'd1000000-7e57-0000-0000-000000000601'),
  1,
  'and its allergen tags are — a dish rendered without them reads as "contains nothing"');

select is(
  (select price_paise::int from menu_item_price_override
    where menu_item_id = 'e2000000-7e57-0000-0000-000000000601'),
  5500,
  'and the school price override is visible: without it the parent is quoted the base price, '
  'which is a wrong invoice rather than a degraded experience');

-- =============================================================================
-- 3. Widened, not opened. Everything hidden from anon is still hidden here.
-- =============================================================================

select is(
  (select count(*)::int from menu_item where id = 'e2000000-7e57-0000-0000-000000000602'),
  0,
  'an inactive item on a live menu stays hidden — the predicates were not relaxed, only the role '
  'list was widened');

select is(
  (select count(*)::int from menu_item where id = 'e2000000-7e57-0000-0000-000000000603'),
  0,
  'and an active item on a DRAFT menu stays hidden');

select is(
  (select count(*)::int from menu where id = 'e1000000-7e57-0000-0000-000000000602'),
  0,
  'and the draft menu itself is not readable');

reset role;

-- =============================================================================
-- 4. `deny_dead_accounts` is RESTRICTIVE and still ANDs over all of it.
--
-- This is the assertion that makes widening a permissive policy safe to do at all: `D15` chose
-- RESTRICTIVE precisely so that no permissive policy added later could defeat account deletion.
-- =============================================================================

do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a0000000-7e57-0000-0000-000000000602', 'role', 'authenticated')::text,
    true);
end $$;
set local role authenticated;

select is(
  (select count(*)::int from public_menu where school_id = '50000000-7e57-0000-0000-000000000601'),
  0,
  'a disabled account browses nothing — widening a PERMISSIVE policy cannot defeat the '
  'RESTRICTIVE one, which is exactly why D15 made it restrictive');

reset role;

select * from finish();
rollback;
