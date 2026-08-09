-- =============================================================================
-- 0007_bump_menu_version_from_allergens.sql
--
-- Closes the one path by which a school's menu could change without its cache
-- token changing — and it is the path that carries allergen data (E04-08).
-- =============================================================================
--
-- THE DEFECT
--
-- `E04-08` requires `school_menu_version` to move on **any** change to what a school
-- sees, and `0001` implements that thoroughly: triggers on `menu`, `menu_item`,
-- `menu_assignment`, `menu_item_price_override`, `dish` and `asset`, plus
-- `refresh_school_menu_versions()` for future-dated assignments that roll over on a
-- day with no DML.
--
-- **`dish_allergen` has no trigger.** It is a separate table — `dish` carries the
-- name, price context and image, and the allergen tags are rows in `dish_allergen`
-- (§6.2). `0002` grants back office insert, update *and* delete on it, so changing a
-- dish's allergens is a supported, expected operation that touches `dish` not at all.
--
-- WHY THIS ONE MATTERS MORE THAN A STALE PRICE WOULD
--
-- `E04-10` is explicit that the app refetches the menu **only** on a version change.
-- That is the whole point of the token: it is what makes the app fast on the
-- unreliable connections this product is built for. It also means a change that does
-- not bump the version is a change that **never reaches the device** — not "arrives
-- late", never, until something unrelated happens to bump it.
--
-- So the sequence that this migration prevents is:
--
--   1. A kitchen discovers a dish contains peanuts and adds the tag. One INSERT into
--      `dish_allergen`. No row in `dish`, `menu` or `menu_item` changes.
--   2. `school_menu_version` does not move.
--   3. Every device that has already cached that menu keeps serving the dish with no
--      peanut warning. `E05-05`'s add-to-cart warning reads the cached tags, so it
--      stays silent.
--   4. Nothing anywhere reports an error.
--
-- That is non-negotiable #4 territory and it is the exact failure `D7` and `MI1`
-- exist to prevent, arriving through the cache instead of through the data.
--
-- `allergen` itself is included for the same reason one step up: renaming or
-- deactivating an allergen changes what every dish carrying it displays.
--
-- WHERE THIS STOPS, AND WHY
--
-- `dish_category` is deliberately NOT covered. A category rename changes tab labels,
-- which is cosmetic, and the nightly refresh picks it up within a day. The line drawn
-- here is the same one `MI2` draws for the importer: what gets the expensive treatment
-- is decided by whether being wrong could hurt someone.
-- =============================================================================

-- Allergen tags are rows, not columns, so the affected schools are found the same way
-- trg_bump_smv_from_dish finds them — through the menus that carry the dish.
create function trg_bump_smv_from_dish_allergen() returns trigger
language plpgsql as $$
declare
  v_dish_id uuid := coalesce(new.dish_id, old.dish_id);
begin
  perform bump_school_menu_version(array(
    select distinct ma.school_id
      from menu_item mi
      join menu_assignment ma on ma.menu_id = mi.menu_id and ma.revoked_at is null
     where mi.dish_id = v_dish_id
  ));
  return null;
end;
$$;

comment on function trg_bump_smv_from_dish_allergen() is
  'E04-08 / 0007. dish_allergen is a separate table from dish, so adding or removing an '
  'allergen tag changes nothing 0001''s triggers watch. Under E04-10 the app refetches '
  'only on a version change, so without this a corrected allergen list never reaches a '
  'device that has already cached the menu.';

create trigger bump_smv_from_dish_allergen
  after insert or update or delete on dish_allergen
  for each row execute function trg_bump_smv_from_dish_allergen();

-- Renaming or deactivating an allergen changes what every dish carrying it displays.
-- These rows change almost never, so bumping every affected school is cheap.
create function trg_bump_smv_from_allergen() returns trigger
language plpgsql as $$
begin
  perform bump_school_menu_version(array(
    select distinct ma.school_id
      from dish_allergen da
      join menu_item mi       on mi.dish_id = da.dish_id
      join menu_assignment ma on ma.menu_id = mi.menu_id and ma.revoked_at is null
     where da.allergen_id = new.id
  ));
  return null;
end;
$$;

create trigger bump_smv_from_allergen
  after update on allergen
  for each row execute function trg_bump_smv_from_allergen();
