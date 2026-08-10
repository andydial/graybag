-- =============================================================================
-- 0017_public_menu_exposes_menu_item_id.sql
--
-- **The app could not place an order.** `E05-16`, one layer further on.
-- =============================================================================
--
-- `create_checkout` (migration `0014`) takes lines shaped
-- `{recipient_id, service_date, menu_item_id, quantity}` and joins on
-- `menu_item mi ... and mi.id = v_line.menu_item_id`. The **only** menu the app can read is
-- `public_menu` (`0012`), and that view joins `menu_item` and then never selects `mi.id`.
--
-- So the identifier the checkout requires never leaves the server, `ApiDish` has no field
-- for it, and there is no sequence of calls the client can make that produces a valid
-- checkout line. Every layer was tested and passed:
--
--   * pgTAP proved `create_checkout` works — its fixtures select `menu_item.id` straight
--     from the table, because a SQL test can.
--   * `checkout.test.ts` proved the `api/` module sends what it is given.
--   * `menu.test.ts` proved `public_menu`'s payload parses into `ApiDish`.
--
-- Nothing asserted that the output of the second is a possible input to the first. That is
-- the same shape as `E05-16` itself — two correct halves and an untested join — and it is
-- why `scripts/order-path-check.mjs` exists as of this commit: it walks the whole path in
-- one process, so a gap between two layers fails somewhere rather than nowhere.
--
-- -----------------------------------------------------------------------------
-- WHY `menu_item_id` AND NOT `dish_id`
--
-- A dish is the food; a `menu_item` is that dish **on a particular menu at a price**. The
-- same dish appears on several menus, and `menu_item_price_override` is keyed on the item
-- and the school. Ordering by `dish_id` would mean the server picking an item on the
-- client's behalf, and "which of the three prices did the customer actually see" would have
-- no answer — which is the question `L7`'s expected-total check exists to be able to ask.
--
-- So the item id is what travels, and `price_paise` in this view is already the resolved
-- price for that item at that school. The pair is consistent by construction.
--
-- -----------------------------------------------------------------------------
-- IS THIS SAFE TO PUBLISH?
--
-- Yes, and it is worth saying why rather than assuming. `menu_item.id` is an opaque uuid for
-- a row that is already fully published through this same view — name, description,
-- ingredients, allergens and price. It grants nothing: `create_checkout` re-derives the
-- price from `menu_item` and `menu_item_price_override` server-side and refuses on any
-- mismatch, so an id is a reference and never an authority.
--
-- `security_invoker = true` is restated below because `create or replace view` does not
-- carry options forward, and §12 asserts that every view in `public` has it. Dropping it
-- here would fail that assertion — loudly, which is the point of having it.
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
  -- **Appended, not inserted, and that is a Postgres constraint rather than a preference.**
  -- `create or replace view` may only add columns at the end: inserting one in the middle
  -- fails with "cannot change name of view column". Reordering it to read better would mean
  -- dropping and recreating the view, which drops its grants with it.
  mi.id                                       as menu_item_id
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
  '[AUTH-01] security_invoker: carries no authority of its own. Every row has already passed the anon policies as the caller. Exists to save four round trips on the app''s hottest path. Carries menu_item_id since 0017 — create_checkout requires it and no other read exposes it, so without it the app cannot construct a valid order line (E05-16).';

-- `create or replace view` preserves grants, but restating them costs nothing and means
-- this file is the whole truth about the view rather than half of it.
grant select on public_menu to anon, authenticated;
