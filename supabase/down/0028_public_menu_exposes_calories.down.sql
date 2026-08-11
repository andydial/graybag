-- Rollback for 0028 — restores `0023`'s `public_menu`, without `calories_text`.
--
-- No data is lost: the figure lives in `dish.nutrition` and only the projection changes. The
-- app renders nothing where a calorie line would have been, which is already the ordinary case
-- for most dishes.
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

-- The column goes with it. The figure survives in `dish.nutrition`, which is where `0028`
-- backfilled it from, so nothing is lost.
revoke select (calories_text) on dish from anon;
alter table dish drop column if exists calories_text;
