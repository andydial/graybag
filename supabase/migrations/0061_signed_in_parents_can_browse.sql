-- =============================================================================
-- 0061_signed_in_parents_can_browse.sql — `E02-33`
--
-- **Signing in emptied the menu.** On production, an anonymous visitor reads 119 menu items;
-- the same parent, one second after signing in, reads **zero**. Found on 2026-08-15 during the
-- production verification sweep, as a genuinely clean parent rather than a granted account —
-- which is the only reason it was found at all, because every back-office grant hides it.
--
-- ## Why
--
-- The catalogue tables carry two families of read policy:
--
--   * `anon_*` (`0012`, `AUTH-01`) — public browsing. Live menu, active rows, nothing more.
--     Granted `to anon`, and **only** to anon.
--   * `*_read_customer` — the signed-in parent's view, scoped by `auth_customer_can_see_menu()`
--     / `auth_customer_can_see_dish()` to *schools the parent has a child at*.
--
-- Both are PERMISSIVE, so they OR — and for `anon` that is fine. But the moment a session
-- carries a JWT, PostgREST switches the role from `anon` to `authenticated`, and the `anon_*`
-- policies stop applying **because a role that is not `anon` cannot match a policy addressed to
-- `anon`**. All that is left is the school-scoped family. A parent with no child yet is scoped
-- to no schools, so the OR reduces to false on every row.
--
-- The result is precisely inverted from the intent: **signing in gives you strictly less than
-- signing out.**
--
-- ## What it broke
--
--   * `AR7` — "adding a child must not be a wall in front of browsing the menu". It was not a
--     wall before sign-in. It was a wall immediately after, which is worse, because the parent
--     has already committed. Signup-to-first-order is a primary v1 goal, and this severed it in
--     the middle.
--   * `SchoolPicker` is the app's front door for signed-in parents too (§6.1.1 cut the Welcome
--     screen and moved its content here). A parent who picks *any* school other than their own
--     child's — the entire purpose of a picker — got an empty menu.
--   * `menu_item_price_override` was in the same state, so a signed-in parent who *did* have a
--     child could be shown the **base price instead of the overridden one**. A wrong price is
--     not a degraded experience; it is a wrong invoice.
--   * `dish_allergen` likewise: a dish rendered with no allergen tags reads as "contains
--     nothing", and non-negotiable #4 is that this must never be the failure mode.
--
-- ## The fix
--
-- Widen the public browse policies to `anon, authenticated`. Their predicates are unchanged —
-- live menu, active rows — so a signed-in parent sees **exactly what a visitor sees**, plus
-- whatever their own school-scoped policies already gave them. Nothing new is exposed to
-- anybody: every row this admits is already world-readable to an anonymous request.
--
-- The names still say `anon_`. They are kept because `authorization.test.sql` §12 pins the
-- permissive-policy inventory by name, and renaming thirteen policies on launch day to improve a
-- label is not a trade worth making. The name records which migration introduced the policy, not
-- who it serves.
--
-- ## Six tables are deliberately absent
--
-- `school`, `city`, `dish_category`, `allergen`, `asset` and `break_time` already carry an
-- unscoped read for `authenticated` (`school_read_picker`, `city_read_all`,
-- `dish_category_read_all`, `allergen_read_all`, `asset_read_images`, `break_time_read_all`), so
-- they were never part of the failure and are left alone. Verified against production rather
-- than assumed — that check is what narrowed thirteen candidate policies to these seven.
--
-- `deny_dead_accounts` is RESTRICTIVE and still ANDs over all of this, so a disabled or deleted
-- account browses nothing. Widening a permissive policy cannot defeat it — that is exactly the
-- property `D15` chose RESTRICTIVE for.
-- =============================================================================

alter policy anon_school_menu_version    on school_menu_version       to anon, authenticated;
alter policy anon_menu_assignment_live   on menu_assignment           to anon, authenticated;
alter policy anon_menu_active            on menu                      to anon, authenticated;
alter policy anon_menu_item_on_live_menu on menu_item                 to anon, authenticated;
alter policy anon_price_override_live    on menu_item_price_override  to anon, authenticated;
alter policy anon_dish_on_live_menu      on dish                      to anon, authenticated;
alter policy anon_dish_allergen_of_visible_dish on dish_allergen      to anon, authenticated;

-- Proof, in the migration, that the thing it exists to fix is fixed. A parent who has never
-- added a child must be able to read the menu; if this migration ever stops achieving that, it
-- fails here rather than in the app.
do $$
declare
  v_user  uuid;
  v_items integer;
begin
  select id into v_user
    from app_user u
   where u.deleted_at is null
     and not u.is_disabled
     and not exists (select 1 from guardian_link g
                      where g.user_id = u.id and g.revoked_at is null)
   limit 1;

  if v_user is null then
    raise notice '0061: no childless parent in this database — the check is skipped, not failed';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_items from menu_item;

  reset role;

  if v_items = 0 and exists (select 1 from menu_item) then
    raise exception '0061 did not take: a childless signed-in parent still reads 0 of % menu items',
      (select count(*) from menu_item);
  end if;
end $$;
