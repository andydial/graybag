-- =============================================================================
-- `E09-46`. The kitchen can see the email of the parent who placed each order.
--
-- Andy, 2026-09-18, as an emergency: *"For each order — we need email of the user that placed the
-- order shown in kitchen."*
--
-- ## Why this is not one more column on the kitchen query
--
-- The obvious change is to add `app_user(email)` to `KITCHEN_ORDER_COLUMNS`. It would appear to
-- work for exactly one person and fail silently for everyone who needs it.
--
-- `app_user` has two read policies: `app_user_read_self`, and `app_user_read_admin` gated on
-- `auth_can_platform('users.view')`. `users.view` is held by **Super Admin only** — kitchen jobs
-- hold `orders.view`, `orders.view_pii` and `orders.mark_delivered`, and none of them is
-- `users.view` at platform scope. So an embed returns the row to Andy, who would be the person
-- testing it, and nothing at all to the kitchen staff the request is for. That failure mode is
-- this repository's recurring one: a check that passes because it was pointed at the half that
-- happened to work.
--
-- Widening `app_user_read_admin` is the other obvious move and it is worse. **RLS filters rows,
-- never columns** (`E02-36`, `E21-63`, twice now), so a policy admitting the kitchen to
-- `app_user` hands over `phone_e164`, `first_name`, `last_name`, `legacy_bubble_id` and every
-- other column on every parent who has ever ordered — to a population scoped to one kitchen.
-- A view that does not contain those columns cannot leak them.
--
-- ## The third definer exception, argued as `authorization.test.sql` §12 demands
--
-- §12 requires every view in `public` to be `security_invoker`, because a definer view skips the
-- base table's policies and fails **silently** — it simply returns rows it should not.
-- `order_money` (`E02-36`) was the first exception and `meal_pack_money` (`E21-86`) the second,
-- and the file says in terms that *"a third exception should be argued for as hard as these
-- were."* The argument:
--
--   · **An invoker view cannot work here at all.** It would run under the caller's policies on
--     `app_user`, and the kitchen has none — so it would return nothing to the only audience it
--     exists for. Adding a policy to fix that is the column leak above. The invoker route cannot
--     be made safe, rather than merely being less convenient.
--   · **It carries exactly one column of personal data**, `email`, and no phone, no parent name,
--     no child, no money, no order reference beyond the id needed to join.
--   · **The permission check is inside the view's own WHERE**, not in the caller, so no query
--     routes around it — the shape `E21-86` established.
--   · **It restates `auth_is_live_user()`**, the restriction being definer lets it bypass, which
--     is the bargain §12 holds the other two to.
--
-- ## The scope is the one the kitchen already has for the child's name
--
-- Deliberately **not** a new rule. `auth_recipient_has_fulfilment_order` already lets somebody
-- holding `orders.view_pii` at the order's school — or at the kitchen that serves it — read that
-- child's allergens. The predicate below is that same test keyed on the order rather than the
-- recipient, so the parent's email follows exactly the orders whose child's name is already on
-- the screen. Nobody gains reach over an order they could not already see.
--
-- This is a widening of what a PII-holding kitchen account sees, not a new audience for PII. It is
-- recorded as such rather than presented as neutral.
-- =============================================================================

begin;

create or replace view kitchen_order_contact as
  select o.id  as order_id,
         u.email as customer_email
    from "order" o
    join app_user u on u.id = o.customer_user_id
   -- Restated, because a definer view bypasses `deny_dead_accounts` on both tables. A disabled
   -- or deleted operator reads nothing here, exactly as `order_money` promises for itself.
   where auth_is_live_user()
     and u.deleted_at is null
     and exists (
       select 1
         from permission_grant g
        where g.user_id         = (select auth.uid())
          and g.permission_code = 'orders.view_pii'
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
          and (
               -- Granted directly at the school the order belongs to.
               (g.scope_type = 'school' and g.scope_id = o.school_id)
               -- Or at the kitchen that serves it. [DM-16]: one kitchen per school.
            or (g.scope_type = 'kitchen'
                and exists (select 1 from school s
                             where s.id = o.school_id and s.kitchen_id = g.scope_id))
          )
     );

comment on view kitchen_order_contact is
  'The email of the parent who placed each order, for the kitchen (E09-46). A DEFINER view, and '
  'the third deliberate exception to authorization.test.sql §12 — argued in the migration header. '
  'An invoker view returns nothing here, because the kitchen holds no policy on app_user, and the '
  'policy that would fix that leaks every other column on every parent: RLS filters rows, never '
  'columns. Scoped on orders.view_pii at the order''s school or its kitchen, which is the same '
  'reach the kitchen already has for the child''s name and allergens.';

grant select on kitchen_order_contact to authenticated;

commit;
