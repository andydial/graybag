-- =============================================================================
-- 0009_orderable_calendar.down.sql — reverses 0009
-- =============================================================================
--
-- WHAT THIS RE-OPENS. Nothing that guards money. `orderable_calendar` is advisory (§9.2 E1)
-- and drawing-only: without it the app cannot grey out closed days, so it offers days that
-- checkout will refuse — a worse experience, not a weaker guarantee. `assert_cutoff_open` is
-- untouched and still refuses them.
--
-- Dropping this while a calendar endpoint calls it fails loudly at the call site, which is
-- the correct direction. `MG4` is satisfied: it widens no access.
-- =============================================================================

drop function if exists orderable_calendar(uuid, date, date);
