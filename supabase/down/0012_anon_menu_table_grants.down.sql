-- Reverses 0012_anon_menu_table_grants.sql — [AUTH-01].
--
-- Returns `anon` to holding nothing at all in `public`. After this a signed-out user
-- cannot read a dish by any route, which is the state [AUTH-01] was raised about — run it
-- only alongside a replacement.
--
-- Does NOT restore 0010's SECURITY DEFINER functions. They were dropped deliberately
-- (one way in), and re-creating them here would make a "revert" quietly reinstate the
-- mechanism 0012 exists to remove.

drop view if exists public_menu;

drop policy if exists anon_asset_of_visible_dish        on asset;
drop policy if exists anon_allergen_active              on allergen;
drop policy if exists anon_dish_category_active         on dish_category;
drop policy if exists anon_dish_allergen_of_visible_dish on dish_allergen;
drop policy if exists anon_dish_on_live_menu            on dish;
drop policy if exists anon_price_override_live          on menu_item_price_override;
drop policy if exists anon_menu_item_on_live_menu       on menu_item;
drop policy if exists anon_menu_active                  on menu;
drop policy if exists anon_school_menu_version          on school_menu_version;
drop policy if exists anon_city_of_visible_school       on city;
drop policy if exists anon_school_onboarded             on school;
drop policy if exists anon_menu_assignment_live         on menu_assignment;

revoke select on school, city, school_menu_version, menu_assignment, menu, menu_item,
                 menu_item_price_override, dish, dish_allergen, dish_category, allergen,
                 asset
  from anon;
