-- =============================================================================
-- `E09-46`. A platform-scoped `orders.view_pii` sees every order's email.
--
-- `0095` shipped a guard that refused the person who asked for the feature. Andy, signed in as
-- Super Admin with `orders.view_pii` at **platform** scope, saw "Ordered by — not shown" on every
-- card, while Vivek's kitchen-scoped account saw all 43. Confirmed from production before changing
-- anything, by asking the view as each account rather than by reading the code:
--
--   ANDY  (orders.view_pii @ platform) -> 0 rows
--   VIVEK (orders.view_pii @ kitchen)  -> 43 rows
--   NOBODY (no grant)                  -> 0 rows
--
-- ## The mistake, stated plainly
--
-- `0095` hand-rolled its grant check as an `EXISTS` over `permission_grant` testing
-- `scope_type = 'school'` or `scope_type = 'kitchen'`. It copied the shape of
-- `auth_recipient_has_fulfilment_order`, which hand-rolls for a reason — it asks whether a
-- *recipient* has any fulfilment order, which is not a question `auth_can` can express.
--
-- This view asks something `auth_can` expresses exactly: *may this caller see this order?* And
-- `auth_has_permission` already implements the whole rule, of which the copy reproduced two
-- branches and dropped the rest:
--
--   · `scope_type = 'platform'` satisfies **any** requested scope — the branch that was missing,
--     and the entire bug;
--   · the **platform owner** is true unconditionally, which matters because the owner holds no
--     grant rows at all (`E02-39`) — so the copy would have failed for them too, for a second
--     and independent reason;
--   · `city → kitchen`, `city → school` and `kitchen → school` inheritance, of which the copy
--     reimplemented only the last;
--   · and the disabled/deleted checks on the grantee.
--
-- Reimplementing authorization instead of calling it is the actual defect. The fix is not to add
-- a platform branch to the copy — it is to stop having a copy.
--
-- ## What this now inherits, deliberately
--
-- `auth_can('orders.view_pii', 'school', o.school_id)` is the same predicate shape as
-- `order_read_backoffice`, which is `auth_can('orders.view', 'school', school_id)`. So the email
-- follows exactly the orders the caller can already see, under the system's own rule rather than
-- this view's private version of it. A city-scoped grant now works too — not a new decision, just
-- the consequence of asking the question properly instead of approximating it.
--
-- Nothing about the §12 bargain changes: still definer, still restates `auth_is_live_user()`,
-- still exposes two columns and no more.
-- =============================================================================

begin;

create or replace view kitchen_order_contact as
  select o.id  as order_id,
         u.email as customer_email
    from "order" o
    join app_user u on u.id = o.customer_user_id
   -- Restated, because a definer view bypasses `deny_dead_accounts` on both tables.
   where auth_is_live_user()
     and u.deleted_at is null
     -- The system's own authorization entry point, not a copy of part of it. Handles the platform
     -- scope, the owner, and city/kitchen → school inheritance — all of which `0095` dropped.
     and auth_can('orders.view_pii', 'school', o.school_id);

comment on view kitchen_order_contact is
  'The email of the parent who placed each order, for the kitchen (E09-46). A DEFINER view, and '
  'the third deliberate exception to authorization.test.sql §12 — argued in 0095''s header. '
  'Guarded by auth_can(''orders.view_pii'', ''school'', school_id), the same predicate shape as '
  'order_read_backoffice, so the email follows exactly the orders the caller can already see. '
  '0095 hand-rolled this check and dropped the platform-scope and owner branches, which refused '
  'every Super Admin: reimplementing authorization rather than calling it was the defect.';

commit;

-- -----------------------------------------------------------------------------
-- A note on this number, because it was contested.
--
-- `0096` was also claimed by `e21-104-105-the-stamp-too-late` (PR #196) and is taken here anyway.
-- `check-migrations` forbids both gaps and duplicates, so every number above `0095` was a GAP
-- while #196 sat unmerged — and #196's own migrations suite was failing at the time, so it was not
-- about to land. The choice was between this fix waiting on another branch's red PR, and that
-- branch renumbering on its next rebase, which the checker will tell it to do. The second costs a
-- rename; the first costs a kitchen its contact details for an unknown number of days.
--
-- Flagged in `planning/andy-queue.md` rather than left to be discovered in a merge conflict.
-- -----------------------------------------------------------------------------
