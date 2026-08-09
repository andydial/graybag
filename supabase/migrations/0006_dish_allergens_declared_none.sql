-- =============================================================================
-- 0006_dish_allergens_declared_none.sql
--
-- Gives `dish` somewhere to keep the distinction `MI1` exists to preserve, found
-- while building the menu domain model (E04-01).
-- =============================================================================
--
-- THE DEFECT
--
-- `MI1` is explicit: **a blank `Allergens` cell means *unknown*, never *none*.**
-- `allergens_declared_none` is true only when the cell says so in as many words.
-- The importer implements this faithfully — `tools/menu-import/src/import.mjs`
-- emits `allergens_declared_none` per dish, and the run report counts the cells
-- that declared none explicitly.
--
-- **`dish` has no column to put it in.** So the importer computes the distinction
-- and the load drops it, and downstream there are only two observable states:
-- "has allergen rows" and "has no allergen rows". Those are the two states `MI1`
-- says must never be conflated, because they are opposite facts wearing the same
-- shape — an empty tag list.
--
-- WHY THIS MATTERS MORE THAN A MISSING COLUMN USUALLY DOES
--
-- `D7` keeps structured allergen tags from day one so that the add-to-cart warning
-- (`E05-05`) is nearly free. That warning reads the tags. A dish whose kitchen has
-- not filled the cell in has told us nothing, and rendering that as "no allergens"
-- is precisely the failure `D7` exists to prevent — on data about children, where
-- non-negotiable #4 applies and the consequence is an allergic reaction rather
-- than a wrong number on a screen.
--
-- THE THREE STATES, AFTER THIS MIGRATION
--
--   dish_allergen rows exist                       -> declared, and these are they
--   no rows AND allergens_declared_none = true     -> declared, and there are none
--   no rows AND allergens_declared_none = false    -> UNKNOWN. Warn; do not reassure
--
-- `false` is the correct default for every existing row: nothing in the database
-- today was loaded from a cell that explicitly said "none", so nothing today is
-- entitled to the reassuring reading. The default makes the safe state the resting
-- state, which is the same instinct as `D17` (RLS on, no policies) and `C6`
-- (a table with no retention row is an alert, not "keep forever").
-- =============================================================================

alter table dish
  add column allergens_declared_none boolean not null default false;

comment on column dish.allergens_declared_none is
  'MI1. True ONLY when the source explicitly declared "no allergens". False means '
  'nobody has said — which is NOT the same as none, and must render as unknown, not '
  'as a reassurance. Read it together with the dish_allergen rows: rows present = '
  'declared allergens; no rows + true = declared none; no rows + false = unknown.';

-- The importer is the only writer that can legitimately set this true, and it does so
-- per row. Nothing else should: an admin editing a dish and saving with an empty
-- allergen list has not thereby declared the dish allergen-free, and the UI must make
-- that an explicit tick rather than a side effect of saving (E10, E04-01).
