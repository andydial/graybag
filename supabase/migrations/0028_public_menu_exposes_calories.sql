-- =============================================================================
-- 0028_public_menu_exposes_calories.sql
--
-- `E21`, and Andy's dish-sheet item 7 of 2026-08-11: **calories are shown nowhere, and parents
-- in this market look for them.**
--
-- The data has been in the database since the catalogue import. `dish.nutrition` is a jsonb
-- column whose own `0001` comment says "unstructured extras; nothing queries it", and the
-- importer put the figure there as `calories_text`. Only the public projection was missing it,
-- so every client saw nothing — the same shape as `0023`'s missing `food_type`.
--
-- =============================================================================
-- WHY TEXT, AND NOT A NUMBER
--
-- The source gives ranges: "310-340", "250-350". `catalogue.sql` kept the text and left the
-- integer `calories_kcal` **null on purpose**, and its header records why: six dish rows were
-- merged and four had conflicting figures, Cold Coffee's differing by more than twofold. There
-- is no honest single number to publish, so the range is published as written.
--
-- A `nullif(trim(...), '')` because an empty string is not a calorie count, and a dish whose
-- importer wrote `''` should render as "no figure" rather than as a blank line where a number
-- belongs.
--
-- **Most dishes have no figure at all**, and that is the ordinary case rather than an error.
-- The client renders nothing for them.
--
-- =============================================================================
-- A REAL COLUMN, NOT A PROJECTION OF `nutrition`
--
-- The first version of this migration selected `d.nutrition ->> 'calories_text'` in the view.
-- The authorization suite failed it with `permission denied for table dish` — `public_menu` is
-- `security_invoker`, so it reads as the caller, and `0021` holds anon to column-level grants
-- that deliberately exclude `nutrition`.
--
-- Granting anon `nutrition` would have fixed it and published the wrong thing: the column is
-- documented in `0001` as "unstructured extras", so its contents are open-ended, and this
-- migration only ever intended to publish a calorie figure.
--
-- `0021`'s own comment anticipated today: *"Withheld: `calories_kcal`, `portion_text` and
-- `nutrition` — the last three have no reader yet and are trivially added to this list on the
-- day one exists."* A reader exists now, so the published value becomes a **real column** with
-- a single-column grant, and `nutrition` stays withheld. It is also cheaper: no per-row jsonb
-- extraction on the app's hottest path.
--
-- =============================================================================
-- APPENDED, NOT INSERTED — a Postgres constraint, not a preference
--
-- `create or replace view` may only ADD columns at the end, so this sits after `food_type`
-- exactly as `food_type` had to sit after `menu_item_id`. Reordering means dropping the view,
-- and dropping it revokes the grants and breaks every reader mid-deploy.
-- =============================================================================

alter table dish add column if not exists calories_text text;

comment on column dish.calories_text is
  'The calorie figure AS THE SOURCE WROTE IT — "310-340". Text because the legacy source gives ranges and catalogue.sql refused to invent a point inside one (six merged dish rows carried conflicting figures; Cold Coffee''s differ by more than twofold). Null for most dishes, which is ordinary rather than missing. Backfilled from nutrition->>calories_text by 0028; nutrition itself stays withheld from anon.';

-- Backfill from where the importer put it. `nullif(trim(...), '')` because an empty string is
-- not a calorie count and should read as "no figure" rather than as a blank where one belongs.
update dish
   set calories_text = nullif(trim(nutrition ->> 'calories_text'), '')
 where calories_text is null
   and nutrition ? 'calories_text';

-- `0021`'s list, plus one. `nutrition`, `calories_kcal` and `portion_text` remain withheld.
grant select (calories_text) on dish to anon;

create or replace view public_menu with (security_invoker = true) as
select
  ma.school_id,
  d.id                                        as dish_id,
  d.name,
  d.description,
  d.ingredients_text,
  d.allergens_declared_none,
  coalesce(mi.category_id, d.category_id)     as category_id,
  dc.display_name                             as category_label,
  coalesce(ovr.price_paise, mi.price_paise)   as price_paise,
  mi.sort_order,
  a.path                                      as image_path,
  coalesce(
    (
      select jsonb_agg(
               jsonb_build_object('allergenId', da.allergen_id, 'presence', da.presence)
               order by al.sort_order, al.code)
        from dish_allergen da
        join allergen al on al.id = da.allergen_id
       where da.dish_id = d.id
    ),
    '[]'::jsonb
  )                                           as allergens,
  mi.id                                       as menu_item_id,
  -- Appended for the reason in the header. `food_type` is NOT NULL on `dish`, so this never
  -- arrives null and the client's "we do not know" branch is genuinely unreachable through
  -- this view — which is what lets the app draw the mark on every card with confidence.
  d.food_type                                 as food_type,
  -- Appended, for the reason in the header. **Text, not a number.** The source gives ranges
  -- ("310-340"), and `catalogue.sql` deliberately left `calories_kcal` null rather than pick a
  -- point inside one — six dishes had two conflicting figures, and Cold Coffee's differ by
  -- more than twofold (160 vs 250-350). Publishing an invented integer would give a parent a
  -- precision the source does not have.
  d.calories_text                             as calories_text
from menu_assignment ma
join menu      m  on m.id = ma.menu_id
join menu_item mi on mi.menu_id = m.id
join dish      d  on d.id = mi.dish_id
join dish_category dc on dc.id = coalesce(mi.category_id, d.category_id)
left join asset a on a.id = d.image_asset_id
left join menu_item_price_override ovr
       on ovr.menu_item_id = mi.id
      and ovr.school_id    = ma.school_id;

comment on view public_menu is
  '[AUTH-01] security_invoker: carries no authority of its own. Every row has already passed the anon policies as the caller. Exists to save four round trips on the app''s hottest path. Carries menu_item_id since 0017 — create_checkout requires it and no other read exposes it (E05-16). Carries food_type since 0023: the veg/egg/non-veg mark is the first thing an Indian parent looks at. Carries calories_text since 0028: TEXT because the source gives ranges and catalogue.sql refused to invent a point inside one.';

grant select on public_menu to anon, authenticated;
