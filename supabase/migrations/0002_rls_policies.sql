-- =============================================================================
-- 0002_rls_policies.sql — GrayBag Row Level Security
-- =============================================================================
--
-- Transcribed from docs/authorization-model.md (Q03) and nothing else. Where this
-- file and that document disagree, the document is right and this file is a bug.
--
-- Section numbers in the comments below (§4.2, §7.5, …) refer to that document.
-- Decision references (D3, D10, M5, …) refer to docs/decisions.md.
-- Open decisions are marked [AZ-nn] / [DM-nn] and are listed in
-- docs/open-questions.md. Nothing marked open is settled; where a choice was
-- needed to make the file apply, the recommended option is used and labelled.
--
-- 0001 enabled RLS on every table in `public` and `migration` with NO POLICIES,
-- which is default deny (D17). Everything below is an explicit, named, tested
-- exception to that. A table absent from this file is DENIED to `anon` and to
-- `authenticated` for every command, deliberately, and the pgTAP suite in
-- supabase/tests/authorization.test.sql asserts that table by table.
--
-- The five rules this file may never break (§3, §5, docs/learnings.md):
--   1. EVERY policy names its role — `to authenticated`. A policy with no TO
--      clause is granted to PUBLIC, which includes `anon`. That is the single
--      most catastrophic mistake available in this schema and it is INVISIBLE.
--   2. EVERY predicate writes `(select auth.uid())`, never bare `auth.uid()`.
--      The scalar subquery is hoisted to an InitPlan and evaluated once per
--      statement instead of once per row.
--   3. NEVER `FOR ALL` on a permissive policy — its USING clause silently
--      doubles as the write check. One policy per command. The only `FOR ALL`
--      in this file is the RESTRICTIVE deny_dead_accounts policy, where that
--      doubling is exactly what is wanted.
--   4. EVERY `UPDATE` policy carries both USING and WITH CHECK. Omitting WITH
--      CHECK lets a user move a row OUT of their own visibility, which is how
--      "I edited my child's school to yours" becomes possible.
--   5. `recipient.created_by_user_id` MUST NEVER appear in a policy (D10).
--      guardian_link is the only path from a user to a recipient.
--
-- Every SECURITY DEFINER function pins `search_path` — mandatory, or it is a
-- privilege-escalation vector. None of the invoker-rights ones carry a SET
-- clause, because that blocks SQL inlining for no benefit (docs/learnings.md).
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE ADDS THAT §7 OF THE MODEL DOES NOT SPELL OUT
--
-- §7 is a specification, not a transcript, and three things had to be resolved to
-- make it apply. Each is marked `-- ADDITION` at its site. None widens the model;
-- each closes a gap where a documented write class had no policy to perform it.
--
--   A. `menu_assignment_update_backoffice`. §7.4 gives menu_assignment a read and
--      an INSERT policy. Assignments are REVOKED, not deleted (revoked_at), which
--      is an UPDATE — so without this, §8 row 19's "PlatformAdmin: W all" is false
--      and un-assigning a menu needs service_role. Gated identically to the insert
--      (`menu.publish` at platform), because revoking an assignment and creating
--      one are the same act.
--   B. `dish_allergen_delete_backoffice`. `dish.edit` is described in 0001 as
--      "Create and change dishes, INCLUDING ALLERGENS", and dish_allergen has no
--      `is_active` column, so removing a wrong allergen tag is a DELETE or it is
--      nothing. Deliberately NOT extended to menu_item, which has `is_active` and
--      can be retired without a delete policy.
--   C. The class-2 write policies for `school_class`, `break_time`,
--      `break_time_class`, `dish_category` and `allergen`. §7.1/§7.3 name the
--      gate in prose ("class 2 under school.edit", "auth_can_platform('dish.edit')")
--      without writing the SQL. These are that prose, written out.
--
-- Two helper functions beyond the 25 in §4 are also defined here, both because a
-- policy needed them and neither adds reach:
--
--   * `auth_break_time_school_id()` — §7.3's break_time_class policy is written
--     with an inline `exists (select 1 from break_time …)`. That subquery runs as
--     the INVOKER and therefore inherits break_time's own RLS, so the policy would
--     silently depend on the caller also satisfying a break_time policy. §4.4
--     forbids exactly that coupling for order-shaped tables; this applies the same
--     rule here. Same reach, no hidden dependency.
--   * `auth_is_privileged_role()` — the §6.1 guard triggers need a visible,
--     greppable service_role exemption. See §6 below.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
--   * No write policy on any class-3 table (§5 Rule 4). Money, order state,
--     access control and evidence are written by Edge Functions running as
--     `service_role`, because every one of those rows has at least one field whose
--     value must be COMPUTED rather than supplied. RLS filters rows and cannot
--     constrain a column, so an INSERT policy on `"order"` would let a customer
--     supply `total_paise = 0`. [AZ-01].
--   * No policy names `anon`, anywhere, for anything ([AZ-03]).
--   * No `FORCE ROW LEVEL SECURITY` (§10). It would not constrain `service_role`
--     — BYPASSRLS is a role attribute and is unaffected by FORCE — and it would
--     break migrations and the dashboard.
--   * No policies on `storage.objects`. §11 needs none: three of the four buckets
--     are private with no policy at all (access is a signed URL minted by an Edge
--     Function that has already checked `auth_owns_group()` or the permission),
--     and the fourth is a public bucket served by the CDN. See §11 below.
--   * No policies in schema `migration`. 0001 revoked USAGE on that schema from
--     `anon` and `authenticated`; RLS is on with nothing to permit. Never add any.
--
-- There is deliberately no explicit BEGIN/COMMIT: the Supabase migration runner
-- already wraps each file in a transaction.
-- =============================================================================


-- =============================================================================
-- 1. Helper functions (§4)
--
-- These are the whole vocabulary. No policy below reaches directly into another
-- table; every one is a call to something named here, so every one is a testable
-- unit in isolation. A policy that inlines its own EXISTS is a policy nobody can
-- assert about.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 Identity (§4.1)
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER: app_user's own policies call this, so an invoker-rights
-- version would recurse (docs/learnings.md).
create function auth_is_live_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user u
     where u.id = (select auth.uid())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;
comment on function auth_is_live_user() is
  '§4.1. A disabled or soft-deleted account is dead immediately (D15, §5 Rule 5). Backs the restrictive deny_dead_accounts policy.';

-- Not in §4. NOT security definer, deliberately: inside a SECURITY DEFINER
-- function current_user is the function OWNER, which would make this always true.
-- Used only by the §6.1 guard triggers, where the service_role exemption has to be
-- a visible decision rather than an accident of which key the caller used.
create function auth_is_privileged_role() returns boolean
language sql stable as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin');
$$;
comment on function auth_is_privileged_role() is
  'The explicit, greppable service_role exemption for the §6.1 protected-column guard triggers. Never call this from a policy — RLS does not constrain service_role in the first place (§2.1).';

-- -----------------------------------------------------------------------------
-- 1.2 The customer plane (§4.2)
--
-- guardian_link is the ONLY path from a user to a recipient (D10).
-- recipient.created_by_user_id exists for audit and appears nowhere below.
-- -----------------------------------------------------------------------------

create function auth_can_reach_recipient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.recipient_id = p_recipient
       and gl.user_id      = (select auth.uid())
       and gl.revoked_at is null
       and r.deleted_at is null
  );
$$;

-- Editing details and allergies.
create function auth_can_manage_recipient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.recipient_id = p_recipient
       and gl.user_id      = (select auth.uid())
       and gl.revoked_at is null
       and gl.can_manage
       and r.deleted_at is null
  );
$$;

-- Ordering for them. Used by the checkout Edge Function, NOT by a policy — order
-- writes are class 3 (§5 Rule 4). It lives here so the Edge Function and the
-- policies share one definition of reachability rather than two.
create function auth_can_order_for_recipient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.recipient_id = p_recipient
       and gl.user_id      = (select auth.uid())
       and gl.revoked_at is null
       and gl.can_order
       and r.deleted_at is null
       and r.is_active
  );
$$;

-- "Do I have a live recipient at this school" — the gate on menu visibility.
create function auth_can_reach_school(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.user_id = (select auth.uid())
       and gl.revoked_at is null
       and r.deleted_at is null
       and r.is_active
       and r.school_id = p_school
  );
$$;

-- -----------------------------------------------------------------------------
-- 1.3 The back-office plane (§4.3) — thin wrappers over auth_has_permission (0001)
-- -----------------------------------------------------------------------------

create function auth_can(p_permission text, p_scope_type scope_type, p_scope_id uuid)
returns boolean language sql stable as $$
  select auth_has_permission((select auth.uid()), p_permission, p_scope_type, p_scope_id);
$$;
comment on function auth_can(text, scope_type, uuid) is
  'Scope widening (§10.4 of the data model) means a grant at a WIDER scope satisfies a check at a narrower one, so almost every back-office policy on an order-shaped table is one call at school scope: platform, city, kitchen and school grants all resolve through it.';

create function auth_can_platform(p_permission text) returns boolean
language sql stable as $$
  select auth_has_permission((select auth.uid()), p_permission, 'platform', null);
$$;

-- "Does the caller hold this permission at ANY live scope." For reference tables
-- where the scope is irrelevant (the reason-code list, the allergen list).
-- SECURITY DEFINER for the same reason auth_has_permission is.
create function auth_has_any_grant(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from permission_grant g join app_user u on u.id = g.user_id
     where g.user_id         = (select auth.uid())
       and g.permission_code = p_permission
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

-- "Is the caller back office at all." Used only to widen reference-data reads.
create function auth_is_back_office() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from permission_grant g join app_user u on u.id = g.user_id
     where g.user_id = (select auth.uid())
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

-- -----------------------------------------------------------------------------
-- 1.4 Order reachability (§4.4)
--
-- SECURITY DEFINER so a child table's policy never depends on the parent's policy
-- having been written correctly. A policy that reads "order" as the invoker would
-- silently inherit "order"'s RLS, which is a correct-by-accident coupling nobody
-- should rely on.
-- -----------------------------------------------------------------------------

create function auth_owns_order(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from "order" o
                  where o.id = p_order and o.customer_user_id = (select auth.uid()));
$$;

create function auth_can_on_order(p_order uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "order" o
     where o.id = p_order
       and auth_has_permission((select auth.uid()), p_permission, 'school', o.school_id));
$$;

create function auth_owns_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from order_group g
                  where g.id = p_group and g.customer_user_id = (select auth.uid()));
$$;

-- A group can span schools (three-level shape, [DM-01]). The permission is required
-- on at least ONE member order, which is correct: a kitchen that prepares one of
-- the four orders in a checkout legitimately needs to see the payment status of
-- that checkout.
create function auth_can_on_group(p_group uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "order" o
     where o.order_group_id = p_group
       and auth_has_permission((select auth.uid()), p_permission, 'school', o.school_id));
$$;

-- -----------------------------------------------------------------------------
-- 1.5 Menu reachability for a customer (§4.5)
--
-- "The dishes on the menu currently assigned to a school where I have a live
-- recipient", in SQL.
-- -----------------------------------------------------------------------------

create function auth_customer_can_see_menu(p_menu uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from menu_assignment ma
      join guardian_link  gl on gl.user_id = (select auth.uid()) and gl.revoked_at is null
      join recipient       r on r.id = gl.recipient_id
                            and r.school_id = ma.school_id
                            and r.is_active and r.deleted_at is null
     where ma.menu_id = p_menu
       and ma.revoked_at is null
       and ma.valid_from <= current_date
       and (ma.valid_to is null or ma.valid_to > current_date)
  );
$$;

create function auth_customer_can_see_dish(p_dish uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from menu_item mi
     where mi.dish_id = p_dish
       and mi.is_active
       and auth_customer_can_see_menu(mi.menu_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- 1.6 The remaining reachability helpers (§4.6) — one table each
--
-- All the same shape: resolve the row to its owning school or kitchen, then
-- delegate to auth_has_permission().
-- -----------------------------------------------------------------------------

-- Gates school_class / break_time / break_time_class for a parent who is still
-- filling in the add-a-child form and therefore has no guardian_link yet.
create function auth_school_is_public(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from school s
     where s.id = p_school
       and s.is_active
       and s.onboarded_at is not null
       and s.offboarded_at is null
  );
$$;

-- §5 Rule 8 — NEED-TO-KNOW BEATS SCOPE ON CHILDREN'S DATA, and this function is
-- the whole of it. A grant of orders.view_pii at school scope does NOT open every
-- recipient enrolled at that school; it opens the recipients the grantee is
-- actually cooking for. Deliberately narrower than §13.7 of the data model, never
-- wider, and recorded as a tightening in §7.2 of the authorization model.
create function auth_recipient_has_visible_order(p_recipient uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "order" o
     where o.recipient_id = p_recipient
       and auth_has_permission((select auth.uid()), p_permission, 'school', o.school_id));
$$;

create function auth_can_on_menu(p_menu uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from menu m
     where m.id = p_menu
       and auth_has_permission((select auth.uid()), p_permission, 'kitchen', m.kitchen_id));
$$;

create function auth_can_on_dish(p_dish uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dish d
     where d.id = p_dish
       and auth_has_permission((select auth.uid()), p_permission, 'kitchen', d.kitchen_id));
$$;

-- menu_item_price_override and menu_item_capacity carry no kitchen_id, so both
-- resolve through menu_item -> menu.
create function auth_can_on_menu_item(p_menu_item uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from menu_item mi
      join menu m on m.id = mi.menu_id
     where mi.id = p_menu_item
       and auth_has_permission((select auth.uid()), p_permission, 'kitchen', m.kitchen_id));
$$;

create function auth_owns_refund(p_refund uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from refund rf
      join order_group g on g.id = rf.order_group_id
     where rf.id = p_refund
       and g.customer_user_id = (select auth.uid()));
$$;

create function auth_can_on_refund(p_refund uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from refund rf
      join "order" o on o.order_group_id = rf.order_group_id
     where rf.id = p_refund
       and auth_has_permission((select auth.uid()), p_permission, 'school', o.school_id));
$$;

create function auth_owns_invoice(p_invoice uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from invoice i
      join order_group g on g.id = i.order_group_id
     where i.id = p_invoice
       and g.customer_user_id = (select auth.uid()));
$$;

create function auth_can_see_report_asset(p_asset uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from school_report sr
     where sr.pdf_asset_id = p_asset
       and auth_has_permission((select auth.uid()), 'reports.view', 'school', sr.school_id));
$$;

-- ADDITION (not in §4). See the header: §7.3 writes break_time_class's predicate as
-- an inline EXISTS over break_time, which would run as the invoker and inherit
-- break_time's RLS. Same reach, no hidden coupling.
create function auth_break_time_school_id(p_break_time uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select bt.school_id from break_time bt where bt.id = p_break_time;
$$;

-- -----------------------------------------------------------------------------
-- 1.7 The customer-safe resolved config (§7.6)
--
-- resolve_effective_config() is STABLE and deliberately NOT security definer, so
-- it can be inlined — which means it runs with the caller's privileges and
-- inner-joins platform_config, which no customer may read. Once this file is
-- applied it returns a NULL ROW, WITH NO ERROR, for every customer: the cutoff,
-- the tax rates and the cancellation rules all silently become null in the app.
-- (docs/learnings.md.) This wrapper is the fix.
--
-- Deliberately omits revenue_share_bps (commercially sensitive, M4) and sac_code.
-- Everything else is either statutory — the tax rates, which the cart must show —
-- or a rule the app has to render.
--
-- [DM-14] / [DM-20]: price_is_tax_inclusive is NULL until Andy answers. This
-- function faithfully returns NULL and the client must treat that as "tax display
-- unavailable", never as false.
-- -----------------------------------------------------------------------------

create function effective_config_public(p_school_id uuid)
returns table (
  timezone text, order_cutoff_time time, order_cutoff_days_before smallint,
  max_advance_order_days smallint, min_advance_order_days smallint,
  default_delivery_mode delivery_mode, allow_classroom_delivery boolean,
  allow_counter_pickup boolean, pickup_code_enabled boolean,
  price_is_tax_inclusive boolean, cgst_rate_bps integer, sgst_rate_bps integer,
  igst_rate_bps integer, refund_default_destination refund_destination,
  wallet_at_checkout_enabled boolean, allergen_warning_enabled boolean,
  customer_cancellation_allowed boolean, customer_cancellation_cutoff_minutes integer
)
language sql stable security definer set search_path = public as $$
  select c.timezone, c.order_cutoff_time, c.order_cutoff_days_before,
         c.max_advance_order_days, c.min_advance_order_days,
         c.default_delivery_mode, c.allow_classroom_delivery,
         c.allow_counter_pickup, c.pickup_code_enabled,
         c.price_is_tax_inclusive, c.cgst_rate_bps, c.sgst_rate_bps,
         c.igst_rate_bps, c.refund_default_destination,
         c.wallet_at_checkout_enabled, c.allergen_warning_enabled,
         c.customer_cancellation_allowed, c.customer_cancellation_cutoff_minutes
    from resolve_effective_config(p_school_id) c
   where auth_can_reach_school(p_school_id)
      or auth_school_is_public(p_school_id)
      or auth_can('orders.view', 'school', p_school_id);
$$;
comment on function effective_config_public(uuid) is
  '§7.6. The ONLY config read a customer or a kitchen operator gets. Never open platform_config / kitchen_config / school_config to them instead: school_config.revenue_share_bps (M4) sits on the same row as the cutoff time, and RLS cannot hide a column.';


-- =============================================================================
-- 2. Protected-column guard triggers (§6.1)
--
-- RLS filters rows and CANNOT HIDE OR PROTECT A COLUMN (docs/learnings.md). A
-- class-1 UPDATE policy lets a customer update their own app_user row; it cannot
-- stop them setting is_disabled = false after an admin disabled them, clearing
-- deleted_at, or rewriting phone_e164 without re-verifying by OTP.
--
-- These are triggers and not policies ON PURPOSE: a trigger fires for service_role
-- too unless it explicitly exempts it, which makes the exemption a visible,
-- greppable decision (auth_is_privileged_role) rather than an accident of which key
-- the caller used.
--
-- The lists below are EXHAUSTIVE per §6.1. device_token and notification_preference
-- appear nowhere here because every field on them is the user's to set.
-- =============================================================================

create function trg_guard_protected_columns() returns trigger
language plpgsql as $$
declare
  v_required text[];
  v_perm     text;
  v_released boolean;
  v_col      text;
  v_old      jsonb := to_jsonb(old);
  v_new      jsonb := to_jsonb(new);
  i          integer;
begin
  -- The visible exemption. §2.1: service_role is not authorized by RLS, and it is
  -- not authorized by this trigger either — it is authorized by the code in the
  -- Edge Function, which is what [AZ-01] contains.
  if auth_is_privileged_role() then
    return new;
  end if;

  -- tg_argv[0] is a comma-separated list of platform permissions, ALL of which
  -- release the protected columns. An empty string means nothing releases them
  -- short of service_role.
  v_required := case when coalesce(tg_argv[0], '') = ''
                     then '{}'::text[]
                     else string_to_array(tg_argv[0], ',') end;

  v_released := cardinality(v_required) > 0;
  foreach v_perm in array v_required loop
    if not auth_can_platform(v_perm) then
      v_released := false;
      exit;
    end if;
  end loop;

  if v_released then
    return new;
  end if;

  -- tg_argv is 0-based; the columns are everything after the permission list.
  for i in 1 .. tg_nargs - 1 loop
    v_col := tg_argv[i];
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      raise exception
        '%.% is a protected column and may not be changed by this caller (docs/authorization-model.md §6.1)',
        tg_table_name, v_col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  return new;
end;
$$;

-- Released by users.manage at platform, or by service_role.
create trigger guard_protected_columns
  before update on app_user
  for each row execute function trg_guard_protected_columns(
    'users.manage',
    'id', 'phone_e164', 'phone_verified_at', 'email_verified_at',
    'is_disabled', 'disabled_reason', 'deleted_at', 'anonymised_at',
    'migration_source', 'claimed_at', 'legacy_bubble_id');

-- service_role only. is_self and created_by_user_id are structural; deleted_at and
-- anonymised_at are the erasure machinery (§13.4, D15).
create trigger guard_protected_columns
  before update on recipient
  for each row execute function trg_guard_protected_columns(
    '',
    'is_self', 'created_by_user_id', 'deleted_at', 'anonymised_at', 'legacy_bubble_id');

-- service_role only. Without this a guardian who holds can_manage could RE-POINT a
-- link at somebody else's child, which is D10's single answer turned into two.
create trigger guard_protected_columns
  before update on guardian_link
  for each row execute function trg_guard_protected_columns(
    '',
    'recipient_id', 'user_id', 'created_by_user_id');

-- Released by consent.view AND users.manage at platform, or by service_role.
--
-- Note the deliberate interaction with dsr_update_admin (§7.9): a grant of
-- consent.view alone satisfies the UPDATE policy but freezes every meaningful
-- column, so the update is a no-op rather than an escalation. That is the
-- conservative direction. Both permissions are held by the platform_admin
-- template, so it only bites for a narrower grant that does not exist yet.
create trigger guard_protected_columns
  before update on data_subject_request
  for each row execute function trg_guard_protected_columns(
    'consent.view,users.manage',
    'status', 'due_at', 'assigned_to_user_id', 'completed_at', 'resolution_note');


-- =============================================================================
-- 3. The restrictive policy (§5 Rule 5)
--
-- A soft-deleted or disabled user has NO ACCESS. auth_has_permission() already
-- checks is_disabled and deleted_at for the back-office plane; the customer plane
-- gets the same guarantee from this.
--
-- RESTRICTIVE, so it ANDs with everything else and cannot be defeated by adding a
-- permissive policy later. This is the only restrictive policy in the schema and it
-- is why "account deletion stops access immediately" (§13.4, D15) is true rather
-- than aspirational.
--
-- FOR ALL is correct here and only here: with no WITH CHECK given, Postgres uses
-- the USING expression for both, which is exactly what is wanted — a dead account
-- may neither read nor write.
--
-- Applied to every table that carries a customer-plane policy. Tables reachable
-- only through a permission_grant do not need it, because auth_has_permission()
-- already fails closed for a dead account.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'city', 'app_user', 'asset', 'dish_category', 'allergen', 'reason_code',
    'school', 'school_class', 'break_time', 'break_time_class',
    'recipient', 'guardian_link', 'recipient_allergen',
    'dish', 'dish_allergen', 'menu', 'menu_item', 'menu_assignment',
    'menu_item_price_override', 'school_menu_version',
    'order_group', 'order', 'order_line',
    'payment', 'refund', 'refund_line', 'invoice', 'invoice_line', 'wallet_balance',
    'policy_document', 'policy_version', 'consent_purpose',
    'user_policy_acceptance', 'consent_record', 'data_subject_request',
    'device_token', 'notification_preference', 'notification_delivery',
    'permission_grant'
  ] loop
    execute format('create policy deny_dead_accounts on public.%I', t)
         || ' as restrictive for all to authenticated using (auth_is_live_user())';
  end loop;
end;
$$;


-- =============================================================================
-- 4. Reference and geography (§7.1)
-- =============================================================================

-- The school picker groups schools by city. No PII. Back office also sees inactive
-- cities, because an offboarded city still has history to investigate.
create policy city_read_all on city for select to authenticated
  using (auth_is_live_user() and (is_active or auth_is_back_office()));

-- The allergen list is needed client-side to render the add-to-cart warning (E05-05)
-- and to let a parent record a child's allergies. The category list drives tab order.
create policy dish_category_read_all on dish_category for select to authenticated
  using (auth_is_live_user());
create policy allergen_read_all on allergen for select to authenticated
  using (auth_is_live_user());

-- ADDITION (§7.1 states the gate in prose): these two vocabularies are
-- platform-wide, so the check is at platform scope. A kitchen-scoped dish.edit
-- deliberately does NOT open them — one kitchen must not rename an allergen for
-- everybody.
create policy dish_category_insert_backoffice on dish_category for insert to authenticated
  with check (auth_can_platform('dish.edit'));
create policy dish_category_update_backoffice on dish_category for update to authenticated
  using (auth_can_platform('dish.edit'))
  with check (auth_can_platform('dish.edit'));
create policy allergen_insert_backoffice on allergen for insert to authenticated
  with check (auth_can_platform('dish.edit'));
create policy allergen_update_backoffice on allergen for update to authenticated
  using (auth_can_platform('dish.edit'))
  with check (auth_can_platform('dish.edit'));

-- Split. Customers see only what is meant for them; back office sees the working
-- vocabulary. [DM-22] decides which codes are customer-visible; this policy is what
-- makes that flag mean something.
create policy reason_code_read_customer on reason_code for select to authenticated
  using (auth_is_live_user() and is_active and is_customer_visible);
create policy reason_code_read_backoffice on reason_code for select to authenticated
  using (auth_has_any_grant('orders.cancel')
      or auth_has_any_grant('orders.refund')
      or auth_can_platform('audit.view'));

-- asset — four kinds, three audiences.
--
-- A CUSTOMER NEVER READS AN asset ROW FOR THEIR INVOICE. The bucket is private, so
-- bucket/path is useless without a signature; the PDF reaches them as a signed URL
-- minted by an Edge Function after it has checked auth_owns_group(). §11.
create policy asset_read_images on asset for select to authenticated
  using (auth_is_live_user() and kind in ('dish_image','category_image') and deleted_at is null);
create policy asset_read_invoice_pdf on asset for select to authenticated
  using (kind = 'invoice_pdf' and auth_can_platform('invoices.view'));
create policy asset_read_report_pdf on asset for select to authenticated
  using (kind = 'report_pdf' and auth_can_see_report_asset(id));
create policy asset_read_import_file on asset for select to authenticated
  using (kind = 'import_file' and auth_has_any_grant('menu.import'));

-- Class 2 for images only. asset carries no kitchen_id, so scope is not expressible
-- here — and a dish image is not scoped data. PDFs and import files are class 3.
create policy asset_insert_images on asset for insert to authenticated
  with check (kind in ('dish_image','category_image') and auth_has_any_grant('dish.edit'));
create policy asset_update_images on asset for update to authenticated
  using (kind in ('dish_image','category_image') and auth_has_any_grant('dish.edit'))
  with check (kind in ('dish_image','category_image') and auth_has_any_grant('dish.edit'));


-- =============================================================================
-- 5. Identity and people (§7.2)
-- =============================================================================

create policy app_user_read_self on app_user for select to authenticated
  using (id = (select auth.uid()));
create policy app_user_read_admin on app_user for select to authenticated
  using (auth_can_platform('users.view'));
create policy app_user_update_self on app_user for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()));

-- No INSERT policy: the row is created by the signup Edge Function alongside the
-- auth.users row, and by migration.
--
-- KITCHEN STAFF GET NOTHING HERE, DELIBERATELY (§13.3 rule 4). They need tier P and
-- tier S data, never tier A. The last-four-digits fallback search (E09-13; E09-07
-- builds the UI, E09-13 owns the mechanism) must therefore be an EDGE FUNCTION that
-- takes four digits and returns ONLY a match boolean / the matching ORDERS — never
-- the phone number, and never a SELECT on this table. A table read would hand a
-- kitchen operator the whole number. The ABSENCE of any kitchen-scoped policy on
-- app_user is what enforces this. If app_user is ever opened to kitchen scope, rule 4
-- is broken and E20-09 fails.

-- recipient — tier P, and allergy_note is tier S.
create policy recipient_read_guardian on recipient for select to authenticated
  using (auth_can_reach_recipient(id) and deleted_at is null);

-- The guardian_link written in the same transaction is what makes it theirs; the
-- deferred constraint trigger in 0001 rejects a recipient with no live link.
create policy recipient_insert_guardian on recipient for insert to authenticated
  with check (auth_is_live_user());

create policy recipient_update_guardian on recipient for update to authenticated
  using (auth_can_manage_recipient(id) and deleted_at is null)
  with check (auth_can_manage_recipient(id));

-- §5 Rule 8 — need-to-know, not scope. Kitchen staff get exactly the children they
-- are cooking for, not every child enrolled at the school.
create policy recipient_read_fulfilment on recipient for select to authenticated
  using (auth_recipient_has_visible_order(id, 'orders.view_pii'));

create policy recipient_read_admin on recipient for select to authenticated
  using (auth_can_platform('users.view'));

-- No DELETE policy. Removing a child is a soft delete performed by an Edge
-- Function, because recipient is referenced by orders and invoices (§13.4, D15).

-- guardian_link. [AZ-05] — a guardian sees the OTHER guardians on their child
-- (user_id, relationship, can_order, can_manage, is_primary) but not their name,
-- phone or email, because app_user is not opened. Andy to confirm; the failure mode
-- is a family situation, not a bug.
create policy guardian_link_read_self on guardian_link for select to authenticated
  using (user_id = (select auth.uid()));
create policy guardian_link_read_co_guardian on guardian_link for select to authenticated
  using (auth_can_reach_recipient(recipient_id));
create policy guardian_link_insert_manager on guardian_link for insert to authenticated
  with check (auth_can_manage_recipient(recipient_id));
-- Revocation is an UPDATE — links are revoked, never deleted; the audit trail matters.
create policy guardian_link_update_manager on guardian_link for update to authenticated
  using (auth_can_manage_recipient(recipient_id))
  with check (auth_can_manage_recipient(recipient_id));
create policy guardian_link_read_admin on guardian_link for select to authenticated
  using (auth_can_platform('users.view'));

-- No back-office read below platform. A kitchen operator has no business knowing
-- who a child's parents are.

-- recipient_allergen — tier S, the most sensitive table in the system.
create policy recipient_allergen_read_guardian on recipient_allergen for select to authenticated
  using (auth_can_reach_recipient(recipient_id));
create policy recipient_allergen_write_guardian on recipient_allergen for insert to authenticated
  with check (auth_can_manage_recipient(recipient_id));
create policy recipient_allergen_update_guardian on recipient_allergen for update to authenticated
  using (auth_can_manage_recipient(recipient_id))
  with check (auth_can_manage_recipient(recipient_id));
-- DELETE is permitted here and nowhere else in the customer plane: §13.4 says a
-- child's health data is deleted outright on erasure, because there is no statutory
-- reason to retain it.
create policy recipient_allergen_delete_guardian on recipient_allergen for delete to authenticated
  using (auth_can_manage_recipient(recipient_id));
-- Fulfilment. A kitchen must not send a peanut dish to an allergic child.
create policy recipient_allergen_read_fulfilment on recipient_allergen for select to authenticated
  using (auth_recipient_has_visible_order(recipient_id, 'orders.view_pii'));

-- PLATFORM ADMIN HAS NO READ POLICY ON recipient_allergen. users.view does not open
-- it and consent.view does not open it. Reading a child's health record requires
-- service_role through a named, audited Edge Function. If that turns out to be
-- operationally impossible it becomes a new permission (recipient.view_health),
-- never a widening of users.view.


-- =============================================================================
-- 6. Organisations (§7.3)
-- =============================================================================

-- P1: attendance is self-declared, so every onboarded school is offered.
create policy school_read_picker on school for select to authenticated
  using (auth_is_live_user()
         and is_active and onboarded_at is not null and offboarded_at is null);
create policy school_read_backoffice on school for select to authenticated
  using (auth_can('school.view', 'school', id) or auth_can('orders.view', 'school', id));
create policy school_update_backoffice on school for update to authenticated
  using (auth_can('school.edit', 'school', id))
  with check (auth_can('school.edit', 'school', id));

-- INSERT is class 3: school.onboard is platform-only, and creating a school also
-- creates its school_menu_version row and its config.

-- No customer access to kitchen. The app never displays which kitchen cooks the food.
create policy kitchen_read_backoffice on kitchen for select to authenticated
  using (auth_can('kitchen.view', 'kitchen', id));
create policy kitchen_update_backoffice on kitchen for update to authenticated
  using (auth_can('kitchen.edit', 'kitchen', id))
  with check (auth_can('kitchen.edit', 'kitchen', id));

-- school_class / break_time / break_time_class are readable by any live user for a
-- school in the picker. This is deliberate and solves a chicken-and-egg: a parent
-- must choose a class WHILE CREATING THE RECIPIENT, before any guardian_link
-- exists, so a policy keyed on auth_can_reach_school() would make the form
-- unfillable. Class labels and break times are not personal data.
create policy school_class_read_all on school_class for select to authenticated
  using (auth_is_live_user() and is_active and auth_school_is_public(school_id));
create policy break_time_read_all on break_time for select to authenticated
  using (auth_is_live_user() and is_active and auth_school_is_public(school_id));
-- Empty in v1; readable alongside break_time so switching E05-06 on is data, not a
-- policy change nothing would have caught.
create policy break_time_class_read_all on break_time_class for select to authenticated
  using (auth_is_live_user()
         and auth_school_is_public(auth_break_time_school_id(break_time_id)));

-- orders.view is in these predicates ON PURPOSE. The kitchen_operator template holds
-- orders.view but NOT school.view, and the packing list (E09-03) groups by class and
-- by break — so a policy keyed on school.view alone would leave a kitchen operator
-- unable to read the class list and break times for the orders they are packing.
-- (See docs/authorization-model.md §7.3 on the seed template probably also wanting
-- kitchen.view; that is seed data for E10-02, not schema.)
create policy school_class_read_backoffice on school_class for select to authenticated
  using (auth_can('school.view', 'school', school_id)
      or auth_can('orders.view', 'school', school_id));
create policy break_time_read_backoffice on break_time for select to authenticated
  using (auth_can('school.view', 'school', school_id)
      or auth_can('orders.view', 'school', school_id));

-- ADDITION (§7.3 states "writes are class 2 under school.edit" without the SQL).
create policy school_class_insert_backoffice on school_class for insert to authenticated
  with check (auth_can('school.edit', 'school', school_id));
create policy school_class_update_backoffice on school_class for update to authenticated
  using (auth_can('school.edit', 'school', school_id))
  with check (auth_can('school.edit', 'school', school_id));
create policy break_time_insert_backoffice on break_time for insert to authenticated
  with check (auth_can('school.edit', 'school', school_id));
create policy break_time_update_backoffice on break_time for update to authenticated
  using (auth_can('school.edit', 'school', school_id))
  with check (auth_can('school.edit', 'school', school_id));
-- break_time_class has no updatable column — it is a two-column join table whose
-- membership IS the data — so it gets INSERT and DELETE and no UPDATE.
create policy break_time_class_insert_backoffice on break_time_class for insert to authenticated
  with check (auth_can('school.edit', 'school', auth_break_time_school_id(break_time_id)));
create policy break_time_class_delete_backoffice on break_time_class for delete to authenticated
  using (auth_can('school.edit', 'school', auth_break_time_school_id(break_time_id)));


-- =============================================================================
-- 7. Menu (§7.4)
-- =============================================================================

create policy menu_read_customer on menu for select to authenticated
  using (status = 'active' and auth_customer_can_see_menu(id));
create policy menu_item_read_customer on menu_item for select to authenticated
  using (is_active and auth_customer_can_see_menu(menu_id));
create policy dish_read_customer on dish for select to authenticated
  using (is_active and auth_customer_can_see_dish(id));
create policy dish_allergen_read_customer on dish_allergen for select to authenticated
  using (auth_customer_can_see_dish(dish_id));
create policy menu_assignment_read_customer on menu_assignment for select to authenticated
  using (revoked_at is null and auth_can_reach_school(school_id));

-- Without this the app reads the base price and shows the wrong number at a school
-- with an override. Scoped, because one school's negotiated price is not another's
-- business.
create policy menu_item_price_override_read_customer on menu_item_price_override
  for select to authenticated using (auth_can_reach_school(school_id));

create policy school_menu_version_read_customer on school_menu_version
  for select to authenticated using (auth_can_reach_school(school_id));

-- Back office, all keyed on the owning kitchen except the two school-keyed tables.
create policy menu_read_backoffice on menu for select to authenticated
  using (auth_can('menu.view', 'kitchen', kitchen_id));
create policy menu_write_backoffice on menu for insert to authenticated
  with check (auth_can('menu.edit', 'kitchen', kitchen_id));
create policy menu_update_backoffice on menu for update to authenticated
  using (auth_can('menu.edit', 'kitchen', kitchen_id))
  with check (auth_can('menu.edit', 'kitchen', kitchen_id));

create policy dish_read_backoffice on dish for select to authenticated
  using (auth_can('menu.view', 'kitchen', kitchen_id));
create policy dish_write_backoffice on dish for insert to authenticated
  with check (auth_can('dish.edit', 'kitchen', kitchen_id));
create policy dish_update_backoffice on dish for update to authenticated
  using (auth_can('dish.edit', 'kitchen', kitchen_id))
  with check (auth_can('dish.edit', 'kitchen', kitchen_id));

-- menu_item and dish_allergen: same shape, resolved through the parent's kitchen_id
-- by a SECURITY DEFINER helper rather than by reading the parent as the invoker.
create policy menu_item_read_backoffice on menu_item for select to authenticated
  using (auth_can_on_menu(menu_id, 'menu.view'));
create policy menu_item_insert_backoffice on menu_item for insert to authenticated
  with check (auth_can_on_menu(menu_id, 'menu.edit'));
create policy menu_item_update_backoffice on menu_item for update to authenticated
  using (auth_can_on_menu(menu_id, 'menu.edit'))
  with check (auth_can_on_menu(menu_id, 'menu.edit'));
-- No DELETE policy on menu_item: it carries is_active, so taking a dish off a menu
-- is an update. Deleting one sets order_line.menu_item_id to null on history, which
-- is a service_role decision, not a kitchen one.

create policy dish_allergen_read_backoffice on dish_allergen for select to authenticated
  using (auth_can_on_dish(dish_id, 'menu.view'));
create policy dish_allergen_insert_backoffice on dish_allergen for insert to authenticated
  with check (auth_can_on_dish(dish_id, 'dish.edit'));
create policy dish_allergen_update_backoffice on dish_allergen for update to authenticated
  using (auth_can_on_dish(dish_id, 'dish.edit'))
  with check (auth_can_on_dish(dish_id, 'dish.edit'));
-- ADDITION. dish.edit is described in 0001 as "including allergens", and this table
-- has no is_active — so correcting a wrong allergen tag is a DELETE or it is
-- nothing. An unremovable false allergen is a usability failure; an unremovable
-- MISSING one would be a safety failure, which is why the insert side is not gated
-- any tighter.
create policy dish_allergen_delete_backoffice on dish_allergen for delete to authenticated
  using (auth_can_on_dish(dish_id, 'dish.edit'));

-- menu.publish is checked at PLATFORM, not kitchen, for menu_assignment. Assigning a
-- menu to a school decides what a school's parents are charged. menu.publish is
-- valid at kitchen scope for flipping a menu to `active`; deciding WHICH SCHOOL SEES
-- IT stays with platform in v1. If a kitchen should own its own assignments, that is
-- a one-line change and a deliberate one.
create policy menu_assignment_read_backoffice on menu_assignment for select to authenticated
  using (auth_can('school.view', 'school', school_id) or auth_can_on_menu(menu_id, 'menu.view'));
create policy menu_assignment_write_backoffice on menu_assignment for insert to authenticated
  with check (auth_can_platform('menu.publish'));
-- ADDITION. Assignments are revoked (revoked_at), never deleted, so un-assigning a
-- menu is an UPDATE. Same gate as the insert, because it is the same act.
create policy menu_assignment_update_backoffice on menu_assignment for update to authenticated
  using (auth_can_platform('menu.publish'))
  with check (auth_can_platform('menu.publish'));

create policy menu_item_price_override_read_backoffice on menu_item_price_override
  for select to authenticated
  using (auth_can_on_menu_item(menu_item_id, 'menu.view'));
create policy menu_item_price_override_write_backoffice on menu_item_price_override
  for insert to authenticated
  with check (auth_can_on_menu_item(menu_item_id, 'menu.edit'));
create policy menu_item_price_override_update_backoffice on menu_item_price_override
  for update to authenticated
  using (auth_can_on_menu_item(menu_item_id, 'menu.edit'))
  with check (auth_can_on_menu_item(menu_item_id, 'menu.edit'));

-- menu_item_capacity — designed, unused (P3, E02-12). Write is class 3; nothing
-- writes in v1. A CUSTOMER CANNOT READ IT, which means "sold out" is not expressible
-- client-side until E18-12 adds a policy. Recorded so it is a known gap and not a
-- surprise.
create policy menu_item_capacity_read_backoffice on menu_item_capacity
  for select to authenticated
  using (auth_can_on_menu_item(menu_item_id, 'menu.view'));

create policy school_menu_version_read_backoffice on school_menu_version
  for select to authenticated
  using (auth_can('school.view', 'school', school_id)
      or auth_can('orders.view', 'school', school_id));


-- =============================================================================
-- 8. Ordering (§7.5)
--
-- The hottest policies in the system. Both customer predicates are column compares
-- on the row itself, which is exactly why "order" denormalises customer_user_id and
-- school_id from its parent.
--
-- NO WRITE POLICY ON ANY OF THESE FOUR TABLES. Class 3. Order creation, status
-- transitions, delivery marking, cancellation and refund are Edge Functions running
-- as service_role, each of which checks auth_can_order_for_recipient() or auth_can()
-- explicitly before it writes. The reason is §5 Rule 4: an INSERT policy on "order"
-- would let a customer supply total_paise.
-- =============================================================================

create policy order_group_read_customer on order_group for select to authenticated
  using (customer_user_id = (select auth.uid()));
create policy order_group_read_backoffice on order_group for select to authenticated
  using (auth_can_on_group(id, 'orders.view'));

-- §5 Rule 7 — back-office order access is checked at SCHOOL scope. Not kitchen, not
-- city. Scope widening resolves platform, city and kitchen grants through this same
-- predicate, and "order" carries school_id denormalised precisely so the check is a
-- column compare.
create policy order_read_customer on "order" for select to authenticated
  using (customer_user_id = (select auth.uid()));
create policy order_read_backoffice on "order" for select to authenticated
  using (auth_can('orders.view', 'school', school_id));

create policy order_line_read_customer on order_line for select to authenticated
  using (auth_owns_order(order_id));
create policy order_line_read_backoffice on order_line for select to authenticated
  using (auth_can_on_order(order_id, 'orders.view'));

-- order_event is INVISIBLE TO CUSTOMERS — [AZ-06]. The table carries `note` and
-- `metadata` written by staff and by the payment provider, and
-- reason_code.is_customer_visible exists ([DM-22]) precisely because not every
-- reason is for the parent. The customer-facing timeline is built from "order"'s own
-- timestamp columns plus cancel_reason_code joined to the customer-visible subset of
-- reason_code. If Andy wants the richer timeline it is a customer_order_event VIEW
-- built in E05, not access to this table.
create policy order_event_read_backoffice on order_event for select to authenticated
  using (auth_can_on_order(order_id, 'orders.view'));


-- =============================================================================
-- 9. Configuration (§7.6)
--
-- Config is NOT readable by customers or by kitchen staff.
-- school_config.revenue_share_bps is commercially sensitive (M4) and it is a column
-- on the same row as the cutoff time, which everyone needs. Rather than fight the
-- column problem again, the resolved customer-safe subset is exposed through
-- effective_config_public() (§1.7 above) and these tables stay shut.
--
-- All writes are class 3. §8 row 23-25 of the model reads "R/W" for PlatformAdmin;
-- §7.6 and §5 Rule 4 both say class 3, and two explicit statements beat one column
-- of shorthand. Changing a tax rate is an audited Edge Function call, not an UPDATE.
-- =============================================================================

create policy platform_config_read on platform_config for select to authenticated
  using (auth_can_platform('config.platform_edit'));
create policy kitchen_config_read on kitchen_config for select to authenticated
  using (auth_can_platform('kitchen.config_edit'));
create policy school_config_read on school_config for select to authenticated
  using (auth_can_platform('school.config_edit'));
create policy config_change_log_read on config_change_log for select to authenticated
  using (auth_can_platform('audit.view'));


-- =============================================================================
-- 10. Money (§7.7)
--
-- Nothing in this section is writable by `authenticated`. All of it is class 3.
-- =============================================================================

create policy payment_read_customer on payment for select to authenticated
  using (auth_owns_group(order_group_id));
create policy payment_read_backoffice on payment for select to authenticated
  using (auth_can_on_group(order_group_id, 'orders.view_financials'));

create policy refund_read_customer on refund for select to authenticated
  using (auth_owns_group(order_group_id));
create policy refund_read_backoffice on refund for select to authenticated
  using (auth_can_on_group(order_group_id, 'orders.view_financials')
      or auth_can_on_group(order_group_id, 'orders.refund'));
create policy refund_line_read_customer on refund_line for select to authenticated
  using (auth_owns_refund(refund_id));
create policy refund_line_read_backoffice on refund_line for select to authenticated
  using (auth_can_on_refund(refund_id, 'orders.view_financials'));

create policy invoice_read_customer on invoice for select to authenticated
  using (auth_owns_group(order_group_id));
create policy invoice_read_admin on invoice for select to authenticated
  using (auth_can_platform('invoices.view'));
create policy invoice_line_read_customer on invoice_line for select to authenticated
  using (auth_owns_invoice(invoice_id));
create policy invoice_line_read_admin on invoice_line for select to authenticated
  using (auth_can_platform('invoices.view'));

-- The wallet row contains a user id, a paise integer and a ledger pointer, and
-- nothing else. §13.7 says "read through a function"; a direct SELECT on the
-- caller's own single row is equivalent and simpler, and the api/ module still
-- exposes it as one call. Recorded so it is not a silent divergence.
create policy wallet_balance_read_self on wallet_balance for select to authenticated
  using (user_id = (select auth.uid()));
create policy wallet_balance_read_admin on wallet_balance for select to authenticated
  using (auth_can_platform('orders.view_financials'));

-- The ledger. NO CUSTOMER ACCESS AT ALL (§13.7). Platform financials only.
create policy ledger_account_read_admin on ledger_account for select to authenticated
  using (auth_can_platform('orders.view_financials'));
create policy ledger_transaction_read_admin on ledger_transaction for select to authenticated
  using (auth_can_platform('orders.view_financials'));
create policy ledger_entry_read_admin on ledger_entry for select to authenticated
  using (auth_can_platform('orders.view_financials'));

create policy payout_read_admin on payout for select to authenticated
  using (auth_can_platform('payouts.view'));
-- [AZ-04] — what a school sees of its own payout. Written as option (a): confirmed
-- and paid only, never draft; `notes` is school-visible by rule and the admin UI must
-- say so. Andy to rule — it is a relationship question, not a technical one.
create policy payout_read_school on payout for select to authenticated
  using (payee_type = 'school'
         and status in ('confirmed', 'paid')
         and auth_can('payouts.view', 'school', payee_id));
-- payout_line is NOT opened to school scope even though payout is. A payout line
-- names an order_id and its share, which is order-level detail; E11-03 and §13.3
-- rule 5 say a school gets aggregates. [AZ-04].
create policy payout_line_read_admin on payout_line for select to authenticated
  using (auth_can_platform('payouts.view'));

-- Support and reconciliation only.
create policy payment_webhook_event_read_admin on payment_webhook_event
  for select to authenticated using (auth_can_platform('orders.view_financials'));

-- invoice_sequence and idempotency_key get NO POLICIES AT ALL, permanently. The
-- first is a counter whose only correct reader is the transaction allocating a
-- number (D14); the second holds replayed response bodies that may contain the
-- caller's own data and nobody else's business. service_role only.


-- =============================================================================
-- 11. Permissions and grants (§7.8)
--
-- These are the tables where a mistake is unrecoverable, so they get the most
-- conservative treatment in the schema.
-- =============================================================================

-- A back-office user may see their own access. Nothing else.
create policy permission_grant_read_self on permission_grant for select to authenticated
  using (user_id = (select auth.uid()));
create policy permission_grant_read_admin on permission_grant for select to authenticated
  using (auth_can_platform('grants.manage'));

create policy permission_read_admin on permission for select to authenticated
  using (auth_can_platform('grants.manage'));
create policy role_template_read_admin on role_template for select to authenticated
  using (auth_can_platform('grants.manage'));
create policy role_template_permission_read_admin on role_template_permission
  for select to authenticated using (auth_can_platform('grants.manage'));

-- NO WRITE POLICY ON permission_grant, EVER. Granting and revoking is class 3: an
-- Edge Function running as service_role that checks grants.manage at platform,
-- writes the grant, and writes an audit_log row in the SAME transaction. A write
-- policy here would mean the only thing between a compromised session and
-- self-granting orders.refund is a WITH CHECK expression — and the recursion hazard
-- (docs/learnings.md) makes that expression harder to reason about than the
-- function.
--
-- §5 Rule 9 — IMPERSONATION IS NEVER A JWT. users.impersonate (E10-13) is an Edge
-- Function acting as service_role that writes audit_log.impersonated_user_id on
-- every call. Minting or borrowing a customer's JWT would make the audit trail a lie
-- and would make every policy in this file unable to tell the difference.


-- =============================================================================
-- 12. Policy, consent and data-subject rights (§7.9)
-- =============================================================================

create policy policy_document_read_all on policy_document for select to authenticated
  using (auth_is_live_user());

create policy policy_version_read_published on policy_version for select to authenticated
  using (auth_is_live_user() and published_at is not null);
create policy policy_version_read_admin on policy_version for select to authenticated
  using (auth_can_platform('config.platform_edit'));

create policy consent_purpose_read_all on consent_purpose for select to authenticated
  using (auth_is_live_user() and is_active);

-- Append-only. UPDATE and DELETE are already revoked at the privilege level and
-- blocked by trigger (0001 §16); there is deliberately no policy for them either.
create policy user_policy_acceptance_read_self on user_policy_acceptance
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_policy_acceptance_insert_self on user_policy_acceptance
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_policy_acceptance_read_admin on user_policy_acceptance
  for select to authenticated using (auth_can_platform('consent.view'));

create policy consent_record_read_self on consent_record for select to authenticated
  using (user_id = (select auth.uid()));
-- THIS WITH CHECK IS THE LOAD-BEARING ONE. It makes it structurally impossible to
-- record consent ABOUT a child you have no guardian_link to. That is the
-- DPDP-relevant property, and it is a database constraint rather than an Edge
-- Function convention.
create policy consent_record_insert_self on consent_record for insert to authenticated
  with check (user_id = (select auth.uid())
              and (subject_type = 'user' and subject_id = (select auth.uid())
                   or subject_type = 'recipient' and auth_can_manage_recipient(subject_id)));
create policy consent_record_read_admin on consent_record for select to authenticated
  using (auth_can_platform('consent.view'));

create policy dsr_read_self on data_subject_request for select to authenticated
  using (user_id = (select auth.uid()));
create policy dsr_insert_self on data_subject_request for insert to authenticated
  with check (user_id = (select auth.uid())
              and (subject_recipient_id is null
                   or auth_can_manage_recipient(subject_recipient_id)));
create policy dsr_read_admin on data_subject_request for select to authenticated
  using (auth_can_platform('consent.view'));
create policy dsr_update_admin on data_subject_request for update to authenticated
  using (auth_can_platform('consent.view'))
  with check (auth_can_platform('consent.view'));

create policy retention_policy_read_admin on retention_policy for select to authenticated
  using (auth_can_platform('audit.view'));
create policy purge_run_read_admin on purge_run for select to authenticated
  using (auth_can_platform('audit.view'));

-- current_consent (the view) inherits consent_record's policies, because 0001
-- created it WITH (security_invoker = true). The suite asserts that for every view
-- in public, because the failure is silent — the view simply returns rows it should
-- not (docs/learnings.md).


-- =============================================================================
-- 13. Operational (§7.10)
-- =============================================================================

create policy device_token_read_self on device_token for select to authenticated
  using (user_id = (select auth.uid()));
create policy device_token_insert_self on device_token for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy device_token_update_self on device_token for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy device_token_delete_self on device_token for delete to authenticated
  using (user_id = (select auth.uid()));

create policy notification_preference_read_self on notification_preference
  for select to authenticated using (user_id = (select auth.uid()));
create policy notification_preference_insert_self on notification_preference
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy notification_preference_update_self on notification_preference
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notification_preference_delete_self on notification_preference
  for delete to authenticated using (user_id = (select auth.uid()));

-- Safe for a customer to read because the schema FORBIDS storing the rendered body:
-- a push saying "Aarav's lunch has been delivered" contains a child's name, so only
-- template_code and non-PII parameters are stored.
create policy notification_delivery_read_self on notification_delivery
  for select to authenticated using (user_id = (select auth.uid()));
create policy notification_delivery_read_admin on notification_delivery
  for select to authenticated using (auth_can_platform('audit.view'));

-- school_report is the SchoolViewer's entire world, and it is AGGREGATES ONLY — the
-- table has no recipient_id and nothing it references does (E11-03, E20-09). The
-- absence is the control.
create policy school_report_read_backoffice on school_report for select to authenticated
  using (auth_can('reports.view', 'school', school_id));

create policy audit_log_read_admin on audit_log for select to authenticated
  using (auth_can_platform('audit.view'));


-- =============================================================================
-- 14. Table and function privileges — the layer underneath RLS (§10)
--
-- RLS is not the only gate and should not be the only gate. Supabase's default
-- privileges give anon and authenticated SELECT/INSERT/UPDATE/DELETE on new tables
-- in public; RLS is what actually stops them. Two layers is better than one.
-- =============================================================================

-- Layer 2 on "anon gets nothing" ([AZ-03]). Now a missing policy is not the only
-- thing standing between an unauthenticated request and a table.
--
-- READ THE FUNCTION LINE CAREFULLY. `REVOKE … FROM anon` removes anon's DIRECT
-- grants; it cannot remove a privilege anon holds via PUBLIC, and Postgres grants
-- EXECUTE on functions to PUBLIC by default. So this line closes Supabase's explicit
-- grant to anon and nothing more. What actually makes the SECURITY DEFINER helpers
-- unreachable is the per-function `revoke all … from public` further down — those
-- are the privilege boundaries, and they are revoked from PUBLIC by name.
--
-- The remaining functions in public (resolve_effective_config, the trigger and
-- assertion functions, bump_school_menu_version) keep PUBLIC's implicit EXECUTE, and
-- that is not a leak: every one of them is invoker-rights and reads or writes tables
-- anon holds no privilege on, so calling one gets anon a permission error or a null
-- row. A blanket revoke from PUBLIC is deliberately not issued here — it would also
-- withdraw the implicit grant `authenticated` may be relying on, which is a change
-- with a blast radius well beyond RLS.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables    in schema public from anon;
    revoke all on all sequences in schema public from anon;
    revoke all on all functions in schema public from anon;
    alter default privileges in schema public revoke all on tables    from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke all on functions from anon;
  end if;
end;
$$;

-- Class-3 tables: revoke the write privileges no policy will ever back, so an
-- accidentally-added policy still cannot write. 0001 already does the equivalent for
-- the six append-only tables and for the whole `migration` schema.
--
-- THIS LIST IS THE MACHINE-READABLE FORM OF §5 RULE 4 AND THE TEST SUITE ASSERTS
-- AGAINST THE SAME LIST. A new table that belongs in class 3 must be added here or
-- the suite will not know to check it.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;
  foreach t in array array[
    'order_group', 'order', 'order_line', 'order_event',
    'payment', 'payment_webhook_event', 'refund', 'refund_line',
    'ledger_account', 'ledger_transaction', 'ledger_entry', 'wallet_balance',
    'invoice', 'invoice_line', 'invoice_sequence', 'payout', 'payout_line',
    'permission', 'role_template', 'role_template_permission', 'permission_grant',
    'platform_config', 'kitchen_config', 'school_config', 'config_change_log',
    'policy_document', 'policy_version', 'consent_purpose',
    'retention_policy', 'purge_run', 'idempotency_key',
    'audit_log', 'school_report', 'notification_delivery',
    'school_menu_version', 'menu_item_capacity', 'reason_code'
  ] loop
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end;
$$;

-- Every SECURITY DEFINER function is a privilege boundary, so PUBLIC must not hold
-- EXECUTE on it. The invoker-rights wrappers are listed too, for uniformity — there
-- is no reason for anon to hold execute on anything in this schema.
do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'auth_is_live_user()',
    'auth_is_privileged_role()',
    'auth_can_reach_recipient(uuid)',
    'auth_can_manage_recipient(uuid)',
    'auth_can_order_for_recipient(uuid)',
    'auth_can_reach_school(uuid)',
    'auth_can(text, scope_type, uuid)',
    'auth_can_platform(text)',
    'auth_has_any_grant(text)',
    'auth_is_back_office()',
    'auth_owns_order(uuid)',
    'auth_can_on_order(uuid, text)',
    'auth_owns_group(uuid)',
    'auth_can_on_group(uuid, text)',
    'auth_customer_can_see_menu(uuid)',
    'auth_customer_can_see_dish(uuid)',
    'auth_school_is_public(uuid)',
    'auth_recipient_has_visible_order(uuid, text)',
    'auth_can_on_menu(uuid, text)',
    'auth_can_on_dish(uuid, text)',
    'auth_can_on_menu_item(uuid, text)',
    'auth_owns_refund(uuid)',
    'auth_can_on_refund(uuid, text)',
    'auth_owns_invoice(uuid)',
    'auth_can_see_report_asset(uuid)',
    'auth_break_time_school_id(uuid)',
    'effective_config_public(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    foreach r in array array['authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('grant execute on function public.%s to %I', f, r);
      end if;
    end loop;
  end loop;
end;
$$;

-- The customer-plane helper used only by Edge Functions is not needed by the
-- browser client, but granting it to `authenticated` costs nothing and keeps the
-- grant list uniform: it reveals only what the caller could already learn from
-- guardian_link, which they can read.

-- FORCE ROW LEVEL SECURITY is deliberately NOT set (§10). It would make RLS apply to
-- the table owner (postgres), which sounds attractive but changes nothing for
-- service_role — BYPASSRLS is a ROLE ATTRIBUTE and is unaffected by FORCE — while it
-- would break migrations and the dashboard. The honest statement is §2.1's:
-- service_role is not authorized by RLS, and [AZ-01] is how that is contained.


-- =============================================================================
-- 15. Storage buckets (§11)
--
-- Supabase Storage is a table (storage.objects) with its own RLS, and the same rules
-- apply — including "no policy names anon".
--
-- NOTE WHAT IS NOT HERE: there are no storage.objects policies, and that is the
-- correct implementation of §11, not an omission.
--
--   dish-images  PUBLIC bucket. Long-cached, CDN-served, no PII. A public bucket is
--                served by the storage API without consulting RLS, so a read policy
--                would be dead code. Writes require dish.edit and go through an Edge
--                Function as service_role, which BYPASSRLS makes policy-free too.
--   invoices     PRIVATE. NO POLICY, deliberately: with RLS on and nothing to permit,
--                anon and authenticated get nothing. Access is a SHORT-LIVED SIGNED
--                URL minted by an Edge Function after it has checked
--                auth_owns_group() or invoices.view.
--   reports      PRIVATE, same pattern, gated on reports.view at the report's school.
--                The monthly PDF is emailed (P6), so the URL is usually not needed.
--   imports      PRIVATE, menu.import only. Uploaded spreadsheets contain
--                unvalidated data and are never public.
--
-- An invoice PDF contains buyer_name_snapshot, buyer_phone_snapshot and
-- pickup_codes. A guessable public path to it would be exactly the legacy failure in
-- a different medium.
--
-- Bucket creation is idempotent and guarded, so this file still applies against a
-- database without the storage extension (the pgTAP suite skips the storage
-- assertions in that case).
-- =============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is absent; skipping bucket creation (see §11 of docs/authorization-model.md)';
    return;
  end if;

  insert into storage.buckets (id, name, public) values
    ('dish-images', 'dish-images', true),
    ('invoices',    'invoices',    false),
    ('reports',     'reports',     false),
    ('imports',     'imports',     false)
  on conflict (id) do nothing;
end;
$$;


-- =============================================================================
-- End of 0002_rls_policies.sql
--
-- Next: supabase/tests/authorization.test.sql (E02-09 / Q04) asserts every allow AND
-- every deny in §8's matrix, every numbered denial in §9, and the structural
-- invariants in §12 — including a set assertion over the exact list of policies, so
-- that adding one fails the suite until somebody updates the matrix. That is the
-- direction that actually leaks data.
-- =============================================================================
