-- =============================================================================
-- 0021_menu_dish_column_grants.sql
--
-- `E02-30`, continued. The tripwire added to `authorization.test.sql` in `0020` — "no
-- anon-readable column anywhere in public looks like a person's contact details or a legacy
-- identifier" — failed on its first run, and found two more than the one that was reported:
--
--   menu.legacy_bubble_id
--   dish.legacy_bubble_id
--
-- Reading the full column lists to fix those turned up a third that no pattern would have
-- caught by name:
--
--   menu.created_by_user_id      -- a member of staff's user id, readable by anon
--
-- None of these is a parent's or a child's data, and none is as bad as the contact details
-- in `0020`. They are all the same mistake: `0012` granted twelve whole tables when the app
-- reads a handful of columns from each, so every column any of those tables ever gains is
-- public the moment it is added.
--
-- =============================================================================
-- WHY NARROW THESE TWO AND NOT ALL TWELVE
--
-- `city`, `allergen`, `dish_category`, `dish_allergen`, `menu_item`,
-- `menu_item_price_override`, `menu_assignment`, `school_menu_version` and `asset` carry no
-- personal data and no internal identifier of consequence — they are ids, labels, prices and
-- sort orders, all of which the menu legitimately exposes. Narrowing them would add churn
-- and no safety, and a migration that touches everything is one nobody reviews closely.
--
-- What protects them instead is the assertion, which is now column-level and runs on every
-- migration. A column added to any of them that looks like contact details fails the suite.
--
-- -----------------------------------------------------------------------------
-- THE POLICY COLUMNS ARE DELIBERATELY NOT GRANTED
--
-- `anon_menu_active` filters on `menu.status`; the dish policy chain reaches `dish.is_active`.
-- Neither is granted below. An RLS USING expression is evaluated by the system as part of the
-- scan, not as part of the caller's projection, so it does not require the caller to hold
-- privileges on the columns it reads. PART 6.3 of the suite asserts the behaviour — a draft
-- menu and an inactive dish stay invisible — so if that ever stops being true, the suite says
-- so rather than the menu silently opening up.
-- =============================================================================

-- 1. `menu`. The app never selects a menu's own columns: `public_menu` reaches it only to
--    prove the assignment points at an active menu. `id` is what the join needs.
revoke select on menu from anon;
grant select (id) on menu to anon;

comment on table menu is
  'Anon holds column-level SELECT on (id) only — 0021/E02-30. It carries created_by_user_id '
  '(a staff user) and legacy_bubble_id, neither of which has any client reader. RLS filters '
  'rows; grants filter columns.';

-- 2. `dish`. Exactly what `public_menu` projects, plus `image_asset_id` for the join to
--    `asset`. Withheld: `kitchen_id` (the supply graph), `legacy_bubble_id`, `calories_kcal`,
--    `portion_text` and `nutrition` — the last three have no reader yet and are trivially
--    added to this list on the day one exists.
revoke select on dish from anon;
grant select (id, name, description, ingredients_text, category_id, image_asset_id,
              food_type, allergens_declared_none) on dish to anon;

comment on table dish is
  'Anon holds column-level SELECT on the columns public_menu projects — 0021/E02-30. '
  'kitchen_id and legacy_bubble_id are withheld: the supply graph is not public information '
  'and a legacy identifier has no client reader.';
