-- =============================================================================
-- 0004_allergen_fulfilment_scope.sql
--
-- Closes a real read path into children's health data, found by running
-- supabase/tests/authorization.test.sql for the first time (E02-09 / E02-18).
-- =============================================================================
--
-- THE DEFECT
--
-- `docs/authorization-model.md` §7.2 says, in bold: "**PlatformAdmin has no read
-- policy on this table**" — `recipient_allergen` is tier S, the most sensitive table
-- in the system, and reading a child's health record is meant to require
-- `service_role` through a named, audited Edge Function.
--
-- 0002 implements that faithfully for the paths it considered: it grants no policy on
-- `users.view` and none on `consent.view`, and says so in a comment. What neither the
-- document nor 0002 accounted for is the FULFILMENT policy:
--
--     create policy recipient_allergen_read_fulfilment ... to authenticated
--       using (auth_recipient_has_visible_order(recipient_id, 'orders.view_pii'));
--
-- That policy exists for a good reason — a kitchen must not send a peanut dish to an
-- allergic child. But it resolves through `auth_has_permission`, and
-- `auth_has_permission` treats **`scope_type = 'platform'` as satisfying any scope
-- check** (0001). `orders.view_pii` is grantable at `{platform,kitchen,school}`, and
-- the `platform_admin` role template holds every permission at platform scope.
--
-- Net effect: a platform admin could read the allergen rows of every child who has
-- ever placed an order — through a policy written for kitchen staff, contradicting
-- the model's stated intent, and touching non-negotiable #4 (children's data is
-- regulated under the DPDP Act).
--
-- Nobody widened `users.view`. The widening arrived through a second permission that
-- the paragraph forbidding it did not mention. That is the failure mode this suite
-- exists to catch, and it stayed invisible for exactly as long as the suite went
-- un-run.
--
-- THE FIX
--
-- Fulfilment access is bound to actually fulfilling the order, which happens at a
-- kitchen or a school — never at the platform. `auth_recipient_has_fulfilment_order`
-- therefore matches grants at `kitchen` or `school` scope ONLY, deliberately refusing
-- to honour a platform-scope grant.
--
-- `city` is excluded too. It is not currently reachable — 0001 restricts
-- `orders.view_pii` to `{platform,kitchen,school}` — but writing the allowed scopes
-- positively means a future decision to allow city-scoped `orders.view_pii` cannot
-- silently re-open this hole.
--
-- `auth_recipient_has_visible_order` is left ALONE. It is still correct for
-- `recipient` itself (tier P — name, class, section), where platform admin access is
-- intended. Narrowing it globally would have removed access the model does grant.
-- =============================================================================

create function auth_recipient_has_fulfilment_order(p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from "order" o
      join permission_grant g
        on g.user_id         = (select auth.uid())
       and g.permission_code = 'orders.view_pii'
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
      join app_user u
        on u.id = g.user_id
       and u.is_disabled = false
       and u.deleted_at  is null
     where o.recipient_id = p_recipient
       and (
            -- Granted directly at the school the order belongs to.
            (g.scope_type = 'school' and g.scope_id = o.school_id)
            -- Or at the kitchen that serves it. [DM-16]: one kitchen per school.
         or (g.scope_type = 'kitchen'
             and exists (select 1 from school s
                          where s.id = o.school_id and s.kitchen_id = g.scope_id))
       )
  );
$$;

comment on function auth_recipient_has_fulfilment_order(uuid) is
  'True when the caller holds orders.view_pii at KITCHEN or SCHOOL scope for a school where this recipient has an order. Deliberately does NOT honour a platform-scope grant, which is what auth_has_permission would do and what let a platform admin read tier-S allergen data (0004). Fulfilment happens at a kitchen, never at the platform.';

drop policy recipient_allergen_read_fulfilment on recipient_allergen;

create policy recipient_allergen_read_fulfilment on recipient_allergen for select to authenticated
  using (auth_recipient_has_fulfilment_order(recipient_id));
