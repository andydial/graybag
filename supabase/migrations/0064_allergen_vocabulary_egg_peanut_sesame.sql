-- =============================================================================
-- 0064_allergen_vocabulary_egg_peanut_sesame.sql — the three that were missing. `E10-37`.
-- =============================================================================
--
-- `0063` seeded the four codes that had been sitting in `supabase/seed.sql`: milk, gluten,
-- tree_nut, soy. That was the list a fixture happened to carry, not a list anybody chose, and it
-- is missing three of the allergens most likely to matter here.
--
-- **Egg above all.** It is more common than tree nut or soy in this catalogue and in this market,
-- and its absence had a specific consequence: nine production dishes visibly contain egg and
-- there was no code to tag them with. `admin-dish` would have refused `egg` as an unknown code —
-- correctly, and uselessly.
--
-- ## `food_type = 'egg'` and `allergen = 'egg'` are different facts and both are needed
--
-- They answer different questions for different people and neither substitutes for the other:
--
--   * **`dish.food_type`** is a `food_type` enum — `veg` | `non_veg` | `egg`. It is a *dietary
--     classification* of the whole dish, the thing an Indian menu filters on, and it says what
--     kind of food this is. A vegetarian family reads it to decide whether the dish is for them.
--
--   * **`allergen.code = 'egg'`** is a row in the shared vocabulary that `dish_allergen` and
--     `recipient_allergen` both reference. It is a *safety* fact about an ingredient, and it is
--     the half a specific child's record can be matched against.
--
-- A dish can be `food_type = 'veg'` and still contain egg — a cake made with egg is not sold as
-- an egg dish, and a family avoiding egg for dietary reasons and a child with an egg allergy need
-- to be told by different mechanisms. Collapsing the two would mean either mislabelling cakes as
-- egg dishes or leaving egg-allergic children with nothing to match on. Both are needed; neither
-- is derivable from the other.
--
-- ## Peanut is deliberately its own code, not a kind of tree nut
--
-- A peanut is a legume. The distinction is not pedantry: a great many people are allergic to one
-- and not the other, and `tree_nut` on a peanut dish tells a peanut-allergic child's family
-- nothing while alarming a family that avoids cashews. `[MI1]`'s rule — never conflate two facts
-- that wear the same shape — applies exactly as much here.
--
-- Sesame completes the set most relevant to this menu; it is a declarable allergen in the UK, EU
-- and US, and it appears in breads and chutneys without being named in a dish title.
--
-- Untargeted `on conflict` for the reason `0063` gives: the table is unique on **both** `id` and
-- `code`, so a targeted clause would watch the wrong constraint on an environment that already
-- seeded one of these under a different id.
--
-- This tags **no dish**. Which dish contains egg is Andy's data, exactly as `food_type` is.
-- =============================================================================

insert into allergen (id, code, display_name, description, is_major, sort_order) values
  -- Sort order interleaves with `0063`'s 10/20/30/40 rather than appending, so the picker reads
  -- in order of how often it is needed rather than in the order the rows happened to be created.
  ('a1000000-0000-0000-0000-000000000005', 'egg',    'Egg',    'Egg in any form, including in batter and mayonnaise', true, 15),
  ('a1000000-0000-0000-0000-000000000006', 'peanut', 'Peanut', 'Peanut and groundnut. A legume, NOT a tree nut — the allergies are different', true, 35),
  ('a1000000-0000-0000-0000-000000000007', 'sesame', 'Sesame', 'Sesame seed, til, and sesame oil', true, 45)
on conflict do nothing;
