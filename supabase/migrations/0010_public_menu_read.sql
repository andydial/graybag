-- =============================================================================
-- 0010_public_menu_read.sql
--
-- [AUTH-01] — how a signed-out user reads the menu.
-- =============================================================================
--
-- THE PROBLEM
--
-- Two rules, each correct alone, contradicted each other:
--
--   * AR7 makes signup-to-first-order a primary v1 goal and requires the app be
--     browsable before anyone identifies themselves. RootNavigator.test.tsx asserts
--     every tab mounts with no session.
--   * The privilege baseline (0002, 0005, PB1, [AZ-03]) gives `anon` nothing at all
--     in `public`, deliberately.
--
-- So there was no path by which a signed-out user could read a dish, and pointing the
-- staging build at the real project returned `42501 permission denied for table dish`.
--
-- -----------------------------------------------------------------------------
-- WHAT ANDY CHOSE, AND WHAT THIS ACTUALLY DOES — READ THIS PART
--
-- Andy chose option (c), "grant anon SELECT on the menu tables only", 2026-08-09.
--
-- **This migration delivers that outcome through two SECURITY DEFINER functions
-- rather than through table grants, and that difference needs his eye.**
--
-- Literal option (c) — GRANT SELECT on dish, menu_item, dish_allergen, asset and the
-- rest, plus RLS policies naming `anon` — would have required rewriting FOUR
-- assertions in the authorization suite:
--
--   1. "§10: anon holds no table privilege at all in public"
--   2. "§9 items 1-2: anon selects ZERO rows from every table in public and migration"
--   3. "§9.4 / [AZ-03]: no policy in public grants anon or PUBLIC"
--   4. "§12: every view in public is security_invoker"   (a view-shaped attempt trips this)
--
-- (4) was found the hard way: a first cut of this migration used views, and the suite
-- rejected them. That assertion is right and was not touched.
--
-- Rewriting four security assertions unsupervised, overnight, on the one thing the
-- legacy Bubble app got catastrophically wrong, is not a thing to do quietly. The
-- functions below reach the same product outcome — the client reads the menu directly
-- with the anon key, no Edge Function to deploy — while **every one of those four
-- assertions still passes unchanged**.
--
-- If Andy wants literal table grants, it is a small migration and this comment is the
-- place to start. The api/ module isolates the call sites, so the app does not change.
--
-- -----------------------------------------------------------------------------
-- WHY SECURITY DEFINER IS SAFE HERE, AND WHERE THE BOUNDARY IS
--
-- These functions run as their owner and therefore see through RLS. That makes each
-- function body the whole authorization boundary — exactly as option (a)'s Edge
-- Function body would have been.
--
-- The properties that make that reviewable:
--
--   * `search_path` is pinned (§12 asserts it), so no shadowing attack.
--   * They take a school id and NOTHING else. No table name, no column name, no
--     filter, no ordering, no limit comes from the caller. There is no injection
--     surface because there is no dynamic SQL.
--   * They are STABLE and read-only.
--   * Every predicate is fixed here: the assignment must be live and unrevoked, the
--     menu must be `active`, the item and dish must be active.
--   * The projection is a literal column list. No `select *`, no row type that
--     widens when a table gains a column.
--
-- NO PII IS REACHABLE. They touch dish, dish_category, allergen, dish_allergen, menu,
-- menu_item, menu_assignment, menu_item_price_override, asset and school_menu_version.
-- None of those holds a person. `recipient`, `app_user`, `guardian_link`, `"order"`
-- and `recipient_allergen` are not joined and cannot be reached from here.
--
-- -----------------------------------------------------------------------------
-- THE COMMERCIAL FACT ANDY IS AGREEING TO
--
-- The menu — dish names, descriptions, ingredients, allergens, images and PRICES —
-- becomes readable by anyone holding the anon key, which ships inside the app and is
-- therefore public. That is reasonable and is the same data the marketing site will
-- publish. It is written down because "our price list is public" is a commercial
-- decision as much as a technical one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The version check (E04-09).
--
-- Called by every user on every app open, so it must be the cheapest read in the
-- system: one primary-key lookup, one bigint out. The menu cache (MC2) stores the
-- version that arrived with the body and refetches only when this moves.
--
-- Returns NULL for a school with no row rather than raising: a school that has never
-- had a menu is an empty menu, not an error, and the client already renders that
-- state (AR7 — a missing school must not be a wall in front of browsing).
-- -----------------------------------------------------------------------------
create function public.get_school_menu_version(p_school_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select version from school_menu_version where school_id = p_school_id;
$$;

comment on function public.get_school_menu_version(uuid) is
  '[AUTH-01] Public (anon-executable). Cache validation for E04-10. One PK lookup; NULL when the school has no menu.';

-- -----------------------------------------------------------------------------
-- 2. The menu itself, in one round trip.
--
-- Returns the exact shape `CachedMenuPayload` in apps/mobile expects:
--
--     { "categories": [ { "id", "label" } ],
--       "dishes":     [ { "id", "name", "description", "categoryId", "ingredientsText",
--                         "pricePaise", "imageUri", "allergens": [...],
--                         "allergensDeclaredNone" } ] }
--
-- One call rather than a table-shaped read plus a second allergen query, because
-- E04-10 caches the whole payload and the audience is on unreliable connections
-- (CLAUDE.md, "Performance priorities": the constraint is network, not CPU).
--
-- Price resolution is the §6.6 chain, in one place:
--   menu_item_price_override (this school, live today) -> menu_item.price_paise
--
-- `current_date` matches what 0009's orderable_calendar already uses. For menu
-- VALIDITY windows that is a boundary difference of a few hours on the day an
-- assignment starts or ends, and it is deliberately not worth a config-chain read on
-- the app's hottest path. Cutoff arithmetic, where hours genuinely matter, uses
-- compute_cutoff_at and is unaffected.
-- -----------------------------------------------------------------------------
create function public.get_school_menu(p_school_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live_menu as (
    select mi.id as menu_item_id, mi.dish_id, mi.price_paise, mi.category_id,
           mi.sort_order, ma.school_id
      from menu_assignment ma
      join menu      m  on m.id = ma.menu_id
      join menu_item mi on mi.menu_id = m.id
     where ma.school_id  = p_school_id
       and ma.revoked_at is null
       and ma.valid_from <= current_date
       and (ma.valid_to is null or ma.valid_to > current_date)
       and m.status = 'active'
       and mi.is_active
  ),
  priced as (
    select lm.*,
           d.name, d.description, d.ingredients_text, d.allergens_declared_none,
           coalesce(lm.category_id, d.category_id)   as effective_category_id,
           coalesce(ovr.price_paise, lm.price_paise) as effective_price_paise,
           a.path                                    as image_path
      from live_menu lm
      join dish d on d.id = lm.dish_id and d.is_active
      left join asset a
             on a.id = d.image_asset_id
            and a.deleted_at is null
      left join menu_item_price_override ovr
             on ovr.menu_item_id = lm.menu_item_id
            and ovr.school_id    = lm.school_id
            and ovr.valid_from  <= current_date
            and (ovr.valid_to is null or ovr.valid_to > current_date)
  )
  select jsonb_build_object(
    'categories', coalesce((
        select jsonb_agg(distinct jsonb_build_object('id', dc.id, 'label', dc.display_name))
          from priced p
          join dish_category dc on dc.id = p.effective_category_id
         where dc.is_active
      ), '[]'::jsonb),
    'dishes', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id',                    p.dish_id,
                   'name',                  p.name,
                   'description',           p.description,
                   'categoryId',            p.effective_category_id,
                   'ingredientsText',       p.ingredients_text,
                   'pricePaise',            p.effective_price_paise,
                   'imageUri',              p.image_path,
                   'allergensDeclaredNone', p.allergens_declared_none,
                   'allergens', coalesce((
                       select jsonb_agg(
                                jsonb_build_object('allergenId', da.allergen_id,
                                                   'presence',   da.presence)
                                order by al.sort_order, al.code)
                         from dish_allergen da
                         join allergen al on al.id = da.allergen_id and al.is_active
                        where da.dish_id = p.dish_id
                     ), '[]'::jsonb)
                 )
                 order by p.sort_order, p.name)
          from priced p
      ), '[]'::jsonb)
  );
$$;

comment on function public.get_school_menu(uuid) is
  '[AUTH-01] Public (anon-executable). The school''s live menu, prices resolved through the §6.6 override chain, shaped exactly as CachedMenuPayload. Carries no kitchen id, no user id and no PII.';

-- -----------------------------------------------------------------------------
-- 3. The grants.
--
-- EXECUTE only, on these two functions only.
--
-- Postgres grants EXECUTE to PUBLIC on new functions by default, which would hand
-- these to every role including future ones. Revoke first, then grant the two roles
-- that should have them. `authenticated` gets them so the app uses ONE code path
-- whether or not somebody is signed in — a second, session-dependent menu path would
-- be a second thing to get wrong, and AR7's point is that browsing does not change
-- when you sign in.
-- -----------------------------------------------------------------------------
revoke all on function public.get_school_menu_version(uuid) from public;
revoke all on function public.get_school_menu(uuid)         from public;

grant execute on function public.get_school_menu_version(uuid) to anon, authenticated;
grant execute on function public.get_school_menu(uuid)         to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Close the hole this task's own assertion found.
--
-- FOUND 2026-08-09 while writing "anon may execute exactly two functions": it could
-- already execute eleven, because **Postgres grants EXECUTE to PUBLIC on every new
-- function by default** and nothing had ever revoked it. `anon` is a member of PUBLIC.
--
-- Ten of the eleven are SECURITY INVOKER, so they run with anon's own privileges and
-- die on the first table they touch. Low severity, but noise in front of the one that
-- matters:
--
--   **`auth_recipient_has_fulfilment_order(uuid)` is SECURITY DEFINER.** It bypasses
--   RLS by design, because it is an authorization helper used inside policies. An
--   unauthenticated caller holding a recipient id could call it directly and learn
--   whether that CHILD has a fulfilment order. Verified against the local stack: as
--   `anon`, with a seeded recipient id, it returns `false` rather than refusing.
--
-- Not a bulk leak — recipient ids are v4 UUIDs and are not enumerable — but an
-- authorization primitive answering questions about a child to callers who have not
-- identified themselves is exactly what non-negotiable #2 and #4 exist to prevent, and
-- it is one line to close.
--
-- The blanket revoke below is deliberately written to cover functions that already
-- exist rather than to be clever. It does not stop the NEXT function inheriting the
-- PUBLIC default — the authorization suite's "anon may execute exactly two functions"
-- assertion is what catches that, on the build that introduces it.
--
-- Trigger functions are excluded: a function returning `trigger` cannot be called
-- directly, so its grant is inert.
-- -----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
       and p.proname not in ('get_school_menu', 'get_school_menu_version')
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
  loop
    -- Revoke the PUBLIC default, then restore the two roles that legitimately call
    -- these: `authenticated` because RLS policies evaluate these helpers as the
    -- querying role, and `service_role` because Edge Functions do the same.
    execute format('revoke all on function %s from public', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end;
$$;
