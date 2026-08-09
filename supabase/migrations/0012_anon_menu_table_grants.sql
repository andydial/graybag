-- =============================================================================
-- 0012_anon_menu_table_grants.sql
--
-- [AUTH-01], as originally decided: **literal table grants**, replacing the two
-- SECURITY DEFINER functions 0010 shipped. Andy's ruling 2026-08-10.
-- =============================================================================
--
-- WHY THIS REPLACES 0010's APPROACH, IN HIS WORDS
--
-- 0010 delivered the menu read as `SECURITY DEFINER` functions rather than as table
-- grants, to avoid rewriting four assertions in the authorization suite overnight.
--
-- The argument against that, and it is a good one: **`E02-26` in the same migration was a
-- `SECURITY DEFINER` function reachable by `anon`** — an authorization helper that
-- answered questions about a child to callers who had not identified themselves. Having
-- just found that, choosing the same pattern for the menu read path put the product's
-- most-called read behind exactly the mechanism that had just failed. A definer function
-- carries its own authority; a table grant plus a policy carries the caller's, and the
-- database enforces the boundary rather than the function body.
--
-- So the four assertions are rewritten rather than routed around, and they are stricter
-- than what they replace — see `supabase/tests/authorization.test.sql` PART 6. The old
-- ones asserted *structure* ("anon holds no table privilege"). The new ones assert
-- *behaviour*: anon selects a published dish and gets it, and selects a child and gets
-- nothing.
--
-- -----------------------------------------------------------------------------
-- WHAT ANON MAY NOW READ, AND UNDER WHAT CONDITION
--
-- Twelve tables, SELECT only, each with a policy that is the real gate. The grant makes
-- the table reachable; the policy decides which rows. Both are required — `0002` enables
-- RLS on every table in `public`, so a grant with no policy still returns nothing.
--
--   school                    active, onboarded, not offboarded
--   city                      only cities that have such a school
--   school_menu_version       only for such schools
--   menu                      status = 'active'
--   menu_assignment           live today, not revoked, and pointing at such a menu
--   menu_item                 active, on such a menu
--   menu_item_price_override  live today, for such an item
--   dish                      active, on such a menu_item
--   dish_allergen             for such a dish
--   dish_category             active
--   allergen                  active
--   asset                     not deleted, and the image of such a dish
--
-- **A draft or retired menu is unreachable, and so is a revoked assignment.** That is
-- asserted behaviourally: the suite flips the seeded menu to `retired` and checks the
-- public read goes empty.
--
-- **Everything else stays at zero.** `"order"`, `order_line`, `recipient`,
-- `recipient_allergen`, `app_user`, `guardian_link`, `payment`, `invoice`, and every
-- `ledger_*` table get no grant at all, so they fail on privilege before RLS is even
-- consulted. The suite asserts that by role, not by inspection.
--
-- -----------------------------------------------------------------------------
-- ON POLICY SUBQUERIES AND RECURSION — read before editing a predicate
--
-- A policy expression that queries another table has **that table's RLS applied too**.
-- The predicates below therefore form a deliberate one-way chain:
--
--   asset -> dish -> menu_item -> menu -> (nothing)
--   menu_assignment ---------------------> menu
--
-- **`menu` is the base case and references nothing.** It must not be changed to reference
-- `menu_assignment`: two tables already reference `menu`, and the cycle is not caught at
-- migration time — it fails at query time with `infinite recursion detected in policy`, on
-- whichever screen happens to read first.
--
-- The direction matters for more than recursion. With `menu` as the base case gated on
-- `status = 'active'`, a live assignment **to a draft or retired menu is itself invisible**,
-- because `menu_assignment`'s policy cannot find the menu. The other direction leaked the
-- existence of unpublished menus through their assignments.
--
-- -----------------------------------------------------------------------------
-- THE COMMERCIAL FACT, UNCHANGED FROM 0010
--
-- The menu — dish names, descriptions, ingredients, allergens, images and PRICES — is
-- readable by anyone holding the anon key, which ships inside the app and is therefore
-- public. Same as before; it is the mechanism that changed, not the exposure.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The functions 0010 added, removed.
--
-- Dropped rather than left in place: leaving them would keep a SECURITY DEFINER path to
-- the same data alive alongside the policies, so a policy tightened later would not
-- actually tighten anything. One way in.
-- -----------------------------------------------------------------------------
drop function if exists public.get_school_menu(uuid);
drop function if exists public.get_school_menu_version(uuid);
drop function if exists public.get_schools();

-- -----------------------------------------------------------------------------
-- 2. The grants.
-- -----------------------------------------------------------------------------
grant select on school, city, school_menu_version, menu_assignment, menu, menu_item,
                menu_item_price_override, dish, dish_allergen, dish_category, allergen,
                asset
  to anon;

-- `authenticated` already holds SELECT from 0005's baseline; naming it here would be a
-- second source of truth for the same privilege.

-- -----------------------------------------------------------------------------
-- 3. The policies. These are the authorization boundary.
-- -----------------------------------------------------------------------------

-- Live, unrevoked, AND pointing at a menu this role can see — which, by the `menu` policy
-- below, means an active one. A draft menu's assignment is invisible along with it.
create policy anon_menu_assignment_live on menu_assignment
  for select to anon
  using (
    revoked_at is null
    and valid_from <= current_date
    and (valid_to is null or valid_to > current_date)
    and exists (select 1 from menu m where m.id = menu_assignment.menu_id)
  );

create policy anon_school_onboarded on school
  for select to anon
  using (is_active and onboarded_at is not null and offboarded_at is null);

create policy anon_city_of_visible_school on city
  for select to anon
  using (exists (select 1 from school s where s.city_id = city.id));

create policy anon_school_menu_version on school_menu_version
  for select to anon
  using (exists (select 1 from school s where s.id = school_menu_version.school_id));

-- Base case. References nothing — see the recursion note above. `status = 'active'` is the
-- single condition that makes a draft or retired menu unreachable, and everything else in
-- the chain inherits it.
create policy anon_menu_active on menu
  for select to anon
  using (status = 'active');

create policy anon_menu_item_on_live_menu on menu_item
  for select to anon
  using (is_active and exists (select 1 from menu m where m.id = menu_item.menu_id));

create policy anon_price_override_live on menu_item_price_override
  for select to anon
  using (
    valid_from <= current_date
    and (valid_to is null or valid_to > current_date)
    and exists (select 1 from menu_item mi where mi.id = menu_item_price_override.menu_item_id)
  );

create policy anon_dish_on_live_menu on dish
  for select to anon
  using (is_active and exists (select 1 from menu_item mi where mi.dish_id = dish.id));

create policy anon_dish_allergen_of_visible_dish on dish_allergen
  for select to anon
  using (exists (select 1 from dish d where d.id = dish_allergen.dish_id));

create policy anon_dish_category_active on dish_category
  for select to anon
  using (is_active);

create policy anon_allergen_active on allergen
  for select to anon
  using (is_active);

create policy anon_asset_of_visible_dish on asset
  for select to anon
  using (
    deleted_at is null
    and exists (select 1 from dish d where d.image_asset_id = asset.id)
  );

-- -----------------------------------------------------------------------------
-- 4. One view, for the round trips the client would otherwise make.
--
-- `security_invoker = true`, so it carries **no authority of its own** — every row it
-- returns has already passed the policies above, as the caller. It is a shape, not a
-- privilege, and §12's "every view in public is security_invoker" assertion holds.
--
-- Without it the app makes four round trips to draw one screen: the live assignment, the
-- items, the price overrides, and the allergens. The audience is mid-range Androids on
-- unreliable connections and CLAUDE.md is explicit that **network is the constraint, not
-- CPU** — four dependent requests on a cold open is the difference between a menu that
-- appears and one that is still arriving.
-- -----------------------------------------------------------------------------
create view public_menu with (security_invoker = true) as
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
  )                                           as allergens
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
  '[AUTH-01] security_invoker: carries no authority of its own. Every row has already passed the anon policies as the caller. Exists to save four round trips on the app''s hottest path.';

grant select on public_menu to anon, authenticated;
