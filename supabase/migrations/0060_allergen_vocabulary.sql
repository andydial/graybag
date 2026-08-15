-- =============================================================================
-- 0060_allergen_vocabulary.sql — the allergen list, on every environment. `E10-25`.
-- =============================================================================
--
-- Production had **zero rows in `allergen`**. Not a subset, not a stale set: none.
--
-- Found while building the merged dish editor, where the allergen checkboxes rendered as an
-- empty fieldset against production and were full against the fixtures. Nothing else showed it.
-- `check:launch` did not look, the importer never needed to, and every screen that reads
-- allergens degrades to "none recorded" — which is indistinguishable from a dish that genuinely
-- has none, and from a child who genuinely has no allergy.
--
-- ## Why that is a launch blocker and not a tidiness item
--
-- `allergen` is the **shared vocabulary** behind `dish_allergen` and `recipient_allergen`, and
-- the match between those two rows is the entire mechanism of an allergy warning (`E09-33`,
-- non-negotiable #4). With the table empty:
--
--   * no dish can be tagged — `admin-dish` correctly 422s every code as unknown;
--   * no parent can record a child's allergy, because the picker has nothing in it;
--   * the kitchen's allergy badges cannot fire, and the packing sheet shows no flags;
--   * and all of that looks exactly like "nobody has any allergies".
--
-- A silent failure on a children's-food product on day one. The failure mode is the one that
-- matters: it fails *quiet*, and the quiet reads as safe.
--
-- ## Why a migration rather than a seed
--
-- It was in `supabase/seed.sql` all along — which is the **local fixture**, applied by
-- `db reset` and by nothing else. Staging got it from `seeds/staging-menu.sql`; production was
-- built from the real catalogue import, which has no allergen section, so it got nothing. A
-- vocabulary every environment must agree on does not belong in a file only one environment
-- runs. `0035_seed_ledger_accounts.sql` set this precedent for reference data.
--
-- **The same four codes and the same ids as `seed.sql`**, deliberately — not a new decision.
-- Changing which allergens the system tracks is a product decision and is Andy's; propagating
-- the one already made is not.
--
-- This does **not** tag any dish. Which dish contains milk is Andy's data, exactly as
-- `food_type` is, and it is not guessable from a name — `catalogue.sql` refused to invent it and
-- so does this.
-- =============================================================================

insert into allergen (id, code, display_name, description, is_major, sort_order) values
  ('a1000000-0000-0000-0000-000000000001', 'milk',     'Milk',     'Dairy in any form',           true,  10),
  ('a1000000-0000-0000-0000-000000000002', 'gluten',   'Gluten',   'Wheat, barley, rye and oats', true,  20),
  ('a1000000-0000-0000-0000-000000000003', 'tree_nut', 'Tree nut', 'Almond, cashew, walnut',      true,  30),
  ('a1000000-0000-0000-0000-000000000004', 'soy',      'Soy',      'Soybean and soy derivatives', true,  40)
-- No conflict target on purpose. `allergen` is unique on **both** `id` and `code`, and an
-- environment that already seeded these codes under different ids — a local database reset from
-- an older `seed.sql`, say — would violate the `code` constraint while `on conflict (id)` was
-- watching the wrong one, and the migration would fail rather than no-op. Untargeted covers
-- either. Nothing is updated: an environment that has edited a display name keeps its edit.
on conflict do nothing;
