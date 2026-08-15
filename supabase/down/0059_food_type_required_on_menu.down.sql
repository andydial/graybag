-- Rollback for `0059_food_type_required_on_menu.sql`.
--
-- Dropping the guard leaves the data exactly as it is — no menu item is removed and no dish is
-- unmarked. What comes back is the ability to publish an unmarked dish to a menu, which is the
-- state production was in when the guard was written: 79 dishes, none of them marked, 83 of them
-- already offered.
--
-- The trigger goes before the function it calls; `drop function` would otherwise refuse.

drop trigger if exists menu_item_dish_is_marked on menu_item;
drop function if exists assert_dish_is_marked();
