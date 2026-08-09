-- =============================================================================
-- 0007_bump_menu_version_from_allergens.down.sql — reverses 0007
-- =============================================================================
--
-- BE CLEAR ABOUT WHAT THIS RE-OPENS. Without these triggers, changing a dish's
-- allergen tags does not move `school_menu_version`, and under `E04-10` the app
-- refetches only on a version change — so a corrected allergen list never reaches a
-- device that has already cached the menu. Not late: never.
--
-- It exists because a migration that cannot be rolled back is worse than one that can
-- (`MG2`), and because if these triggers turn out to cause a write-amplification
-- problem on a bulk import the fastest safe move may be to revert and re-approach.
-- It is NOT a routine operation. If it is run, `refresh_school_menu_versions()` must
-- be run afterwards and the nightly job relied on to close the window, and that is a
-- day of staleness on allergen data, which is a decision somebody has to take
-- deliberately rather than inherit.
--
-- MG4 is satisfied: this widens no access.
-- =============================================================================

drop trigger bump_smv_from_allergen on allergen;
drop function trg_bump_smv_from_allergen();

drop trigger bump_smv_from_dish_allergen on dish_allergen;
drop function trg_bump_smv_from_dish_allergen();
