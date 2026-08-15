-- =============================================================================
-- food_type_guard.test.sql — a dish reaches a menu marked, or not at all. `E10-21`.
-- =============================================================================
--
-- `0059`. Production had `food_type` null on all 79 dishes with 83 menu items offering them, so
-- this guard is not hypothetical — it is the rule that stops that recurring.
--
-- The two assertions that carry the design are the ones about **inactive** rows. `is_active` is
-- how this schema says "on the menu but not offered", and blocking a parked dish would stop
-- somebody preparing next term's menu before its details are complete. Getting that wrong turns a
-- safety rule into an obstruction, and an obstruction gets dropped.
--
--   psql -f this file    (any database with 0001..0059 applied)
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

select plan(8);

insert into city (id, code, name, state_name, gst_state_code)
values ('f1000000-7e57-0000-0000-000000000001', 'ftg_city', 'FTG City', 'Punjab', '03');

insert into kitchen (id, code, name, city_id)
values ('f1000000-7e57-0000-0000-000000000002', 'ftg_kitchen', 'FTG Kitchen',
        'f1000000-7e57-0000-0000-000000000001');

insert into menu (id, kitchen_id, name, status)
values ('f1000000-7e57-0000-0000-000000000003', 'f1000000-7e57-0000-0000-000000000002', 'FTG Menu', 'active');

insert into dish (id, kitchen_id, name, category_id, food_type) values
  ('f1000000-7e57-0000-0000-00000000000a', 'f1000000-7e57-0000-0000-000000000002',
   'FTG Marked',   (select id from dish_category limit 1), 'veg'),
  ('f1000000-7e57-0000-0000-00000000000b', 'f1000000-7e57-0000-0000-000000000002',
   'FTG Unmarked', (select id from dish_category limit 1), null);

-- -----------------------------------------------------------------------------
-- What is allowed
-- -----------------------------------------------------------------------------

select lives_ok(
  $$ insert into menu_item (menu_id, dish_id, price_paise, is_active)
     values ('f1000000-7e57-0000-0000-000000000003','f1000000-7e57-0000-0000-00000000000a', 4500, true) $$,
  'a MARKED dish may be offered'
);

select lives_ok(
  $$ insert into menu_item (menu_id, dish_id, price_paise, is_active)
     values ('f1000000-7e57-0000-0000-000000000003','f1000000-7e57-0000-0000-00000000000b', 4500, false) $$,
  'an UNMARKED dish may sit on a menu inactive — parked is not offered, and next term''s menu '
  'has to be preparable'
);

-- A dish with no food type may exist. `[DM-17]` keeps the column nullable because the source
-- Excel had no such field, and this guard does not change that.
select lives_ok(
  $$ insert into dish (kitchen_id, name, category_id)
     values ('f1000000-7e57-0000-0000-000000000002', 'FTG Catalogue Only',
             (select id from dish_category limit 1)) $$,
  'an unmarked dish may still be CREATED — the guard is on the offer, not on the column'
);

-- -----------------------------------------------------------------------------
-- What is refused
-- -----------------------------------------------------------------------------

select throws_ok(
  $$ insert into menu_item (menu_id, dish_id, price_paise, is_active)
     values ('f1000000-7e57-0000-0000-000000000003','f1000000-7e57-0000-0000-00000000000b', 4500, true) $$,
  '23514', null,
  'an UNMARKED dish cannot be offered — INSERT'
);

-- The half a check constraint on insert alone would miss: parking it and then switching it on.
select throws_ok(
  $$ update menu_item set is_active = true
      where dish_id = 'f1000000-7e57-0000-0000-00000000000b' $$,
  '23514', null,
  'and cannot be switched on later — UPDATE is guarded too'
);

-- `is_active` defaults to true, so an insert that says nothing about it is an OFFER.
select throws_ok(
  $$ insert into menu_item (menu_id, dish_id, price_paise)
     values ('f1000000-7e57-0000-0000-000000000003','f1000000-7e57-0000-0000-00000000000b', 4500) $$,
  '23514', null,
  'omitting is_active means offered, because the column defaults to true'
);

-- -----------------------------------------------------------------------------
-- The message, because it is the whole point on an import day
-- -----------------------------------------------------------------------------

select throws_like(
  $$ insert into menu_item (menu_id, dish_id, price_paise, is_active)
     values ('f1000000-7e57-0000-0000-000000000003','f1000000-7e57-0000-0000-00000000000b', 4500, true) $$,
  '%FTG Unmarked%',
  'the refusal names the DISH, not its uuid — somebody reading it mid-import has to know which'
);

-- Marking it lets the parked row be switched on. Written as the UPDATE rather than a fresh
-- INSERT because the dish already has a row on this menu from the "parked" case above, and
-- `menu_item` is unique on `(menu_id, dish_id)` — an insert here would fail on the unique index
-- and look like the guard still refusing, which is the wrong reason to pass or fail.
update dish set food_type = 'egg' where id = 'f1000000-7e57-0000-0000-00000000000b';
select lives_ok(
  $$ update menu_item set is_active = true
      where dish_id = 'f1000000-7e57-0000-0000-00000000000b' $$,
  'marking the dish lets it be offered — the stated fix is the real one'
);

select * from finish();
rollback;
