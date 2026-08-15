-- Down for 0061. Puts the seven public browse policies back to `anon` only.
--
-- **Applying this re-breaks signed-in browsing.** It is here because every migration must be
-- reversible, not because reversing it is ever a good idea: the state it restores is the one in
-- which a parent who signs up and has not yet added a child sees an empty menu, and a parent who
-- *has* one is quoted the base price instead of their school's override.
--
-- If you are reaching for this, the thing you probably want is to narrow the predicates, not to
-- take `authenticated` off the role list.

alter policy anon_school_menu_version    on school_menu_version       to anon;
alter policy anon_menu_assignment_live   on menu_assignment           to anon;
alter policy anon_menu_active            on menu                      to anon;
alter policy anon_menu_item_on_live_menu on menu_item                 to anon;
alter policy anon_price_override_live    on menu_item_price_override  to anon;
alter policy anon_dish_on_live_menu      on dish                      to anon;
alter policy anon_dish_allergen_of_visible_dish on dish_allergen      to anon;
