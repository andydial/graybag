-- =============================================================================
-- 0023_public_menu_exposes_food_type.sql
--
-- `E21-02`. **`public_menu` never exposed `dish.food_type`, so the app cannot tell a parent
-- whether a dish is vegetarian.**
--
-- In India that is not a nicety. It is the first thing most people look at on a menu, it is
-- the reason the veg/non-veg mark is a legal labelling requirement on packaged food, and for a
-- large share of the audience it decides whether the dish is orderable at all. The nine
-- reference screens in the design package have no such mark anywhere — they are a generic
-- delivery template — which is a good illustration of why those screens are the source of
-- truth for *feel* and not for what the product has to say.
--
-- The column has existed on `dish` since `0001` (`food_type` — `veg`, `non_veg`, `egg`). Only
-- the public projection was missing it, so every client saw `null` and drew nothing.
--
-- =============================================================================
-- APPENDED, NOT INSERTED — a Postgres constraint, not a preference
--
-- `create or replace view` may only ADD columns at the end. Putting `food_type` next to
-- `name`, where it belongs logically, fails with "cannot change name of view column"; getting
-- it there would mean dropping and recreating the view, which drops its grants with it and
-- leaves a window where `anon` cannot read the menu at all.
--
-- So it goes last, exactly as `0017` put `menu_item_id` last, for the same reason.
--
-- -----------------------------------------------------------------------------
-- WHY THIS IS NOT A NEW GRANT
--
-- `anon` already holds `select (…, food_type, …)` on `dish` from `0021` — that migration
-- narrowed the table-wide grant to the columns `public_menu` projects and deliberately
-- included `food_type` for this. The view is `security_invoker`, so it carries no authority of
-- its own and this migration widens nothing: it exposes a column the caller could already
-- read directly.
-- =============================================================================
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
  d.food_type                                 as food_type
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
  '[AUTH-01] security_invoker: carries no authority of its own. Every row has already passed the anon policies as the caller. Exists to save four round trips on the app''s hottest path. Carries menu_item_id since 0017 — create_checkout requires it and no other read exposes it, so without it the app cannot construct a valid order line (E05-16). Carries food_type since 0023: the veg/egg/non-veg mark is the first thing an Indian parent looks at, and without it the app could not draw one.';

grant select on public_menu to anon, authenticated;
