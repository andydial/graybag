-- Rollback for 0021_menu_dish_column_grants.sql.
--
-- Restores the table-wide grants on `menu` and `dish`, which re-exposes
-- `menu.created_by_user_id` (a member of staff's user id), `menu.legacy_bubble_id` and
-- `dish.legacy_bubble_id` to `anon`. Lower stakes than 0020's rollback, but the same shape:
-- it widens the public surface rather than returning to neutral.
revoke select (id) on menu from anon;
grant select on menu to anon;

revoke select (id, name, description, ingredients_text, category_id, image_asset_id,
               food_type, allergens_declared_none) on dish from anon;
grant select on dish to anon;
