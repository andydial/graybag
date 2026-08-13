-- Rollback for 0023. Recreates public_menu without food_type — the 0017 shape.
--
-- The app degrades to drawing no veg/egg/non-veg mark, which is the state it was in before
-- this migration. Not neutral for an Indian audience: it removes the single piece of
-- information most people check first.
create or replace view public_menu with (security_invoker = true) as
select
  ma.school_id, d.id as dish_id, d.name, d.description, d.ingredients_text,
  d.allergens_declared_none,
  coalesce(mi.category_id, d.category_id) as category_id,
  dc.display_name as category_label,
  coalesce(ovr.price_paise, mi.price_paise) as price_paise,
  mi.sort_order, a.path as image_path,
  coalesce((select jsonb_agg(jsonb_build_object('allergenId', da.allergen_id, 'presence', da.presence)
                             order by al.sort_order, al.code)
              from dish_allergen da join allergen al on al.id = da.allergen_id
             where da.dish_id = d.id), '[]'::jsonb) as allergens,
  mi.id as menu_item_id
from menu_assignment ma
join menu m on m.id = ma.menu_id
join menu_item mi on mi.menu_id = m.id
join dish d on d.id = mi.dish_id
join dish_category dc on dc.id = coalesce(mi.category_id, d.category_id)
left join asset a on a.id = d.image_asset_id
left join menu_item_price_override ovr on ovr.menu_item_id = mi.id and ovr.school_id = ma.school_id;

grant select on public_menu to anon, authenticated;
