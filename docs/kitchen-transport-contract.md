---
title: What the kitchen dashboard needs from the server
status: The screen is built and runs on fixtures. This is the server half, specified and not built.
covers: E09-04, E09-05, E09-09 — and E12-06, which blocks both
audience: whoever owns `supabase/` and `packages/shared/` — written to be implemented as-is
---

# The kitchen transport contract

`apps/web/src/pages/kitchen.astro` is complete and every state is reachable today against
`fixtureTransport`. It cannot reach a real order because two things do not exist. This is those
two things, plus the read path, specified from the calling side.

**Nothing in `supabase/`, `packages/shared/` or `apps/mobile/` has been touched.**

The interface to satisfy is `apps/web/src/lib/kitchen/types.ts` — `KitchenTransport`. When the
pieces below exist, a `liveTransport` implementing that interface replaces one line in
`kitchen.astro`.

---

## 1. Back-office sign-in — `E12-06`. **Blocking, and blocks everything else.**

The web app has no authentication at all today. `packages/shared/src/api/auth.ts` already has
`sendEmailOtp` / `verifyEmailOtp` / `currentUser`, which `U1` names as the back-office path, and
nothing in `apps/web` uses them.

What is needed: a sign-in route, a session that survives a reload, and a redirect for an
unauthenticated visit to `/kitchen`. Until then every read below is unauthenticated and RLS
correctly returns nothing.

**A kitchen tablet is shared.** Whatever session handling is chosen should assume several people
and a device that is never locked — a long-lived session on a shared tablet is a different risk
from one on a parent's phone, and it is worth deciding deliberately rather than inheriting the
app's.

---

## 2. The read path — `orders.view`

Reads may use the Supabase client directly (`A4`), so this needs no Edge Function. What it needs
is confirmation that the existing policy is enough:

```sql
-- Already exists, 0002_rls_policies.sql
create policy order_read_backoffice on "order" for select to authenticated
  using (auth_can('orders.view', 'school', school_id));
```

The query the screen makes, per `KitchenFilters`:

```
select id, order_ref, school_id, school_name_snapshot, break_time_id, break_label_snapshot,
       recipient_name_snapshot, class_label_snapshot, section_label_snapshot,
       status, pickup_code,
       order_line(dish_id, dish_name_snapshot, quantity)
  from "order"
 where service_date = :date
   and status in ('paid','preparing','delivered','cancelled')
```

Three things about that list:

- **`pending_payment` is excluded.** `L5` — the kitchen never cooks against money that has not
  arrived, and a dashboard that shows one invites it.
- **No money columns.** `orders.view_financials` is a separate grant (`D3`, `E09-09`) and this
  screen renders no price, total or refund. A query that selects them is a leak waiting for
  somebody's grants to change.
- **Grants are per school.** `E09-10` says all-access is acceptable for now but the scoping must
  exist. **Please confirm** a kitchen operator's grants actually span every school their kitchen
  serves, or the school filter is decorative.

---

## 3. `mark-delivered` Edge Function — **blocking `E09-05`**

Writes go through Edge Functions (`A4`, non-negotiable #1). One function covers all three
transitions the screen offers.

`POST /functions/v1/kitchen-order-status`

```jsonc
{
  "orderIds": ["uuid", "..."],   // bulk: one tap marks a whole class
  "to": "preparing" | "delivered" | "cancelled",
  "reasonCode": "dish_unavailable" // required when `to` is "cancelled"
}
```

### It must be idempotent

A kitchen tablet on bad wifi retries. Marking an already-`delivered` order delivered again must
return success, not an error — the desired state is the desired state. Only a genuinely illegal
transition is a failure.

### It must set `app.actor_type`

`assert_order_status_transition` refuses any status change without it, and the permitted tuples
are `(paid|preparing → delivered, 'kitchen')`, `(paid → preparing, 'kitchen')` and
`(paid|preparing → cancelled, 'kitchen')`. See `order-lifecycle.md` §4.1 — `T8`, `T9`.

### It must be partial-safe

Thirty ids where three are already delivered should mark the other twenty-seven and report which.
The screen already sends only genuinely outstanding ids, but it computes that from data that may
be seconds stale.

| Response | When |
|---|---|
| `200 { "updated": [ids], "skipped": [ids] }` | Some or all applied. `skipped` = already in that state |
| `403 { "error": "not_permitted" }` | Missing `orders.mark_delivered` or `orders.cancel` |
| `409 { "error": "illegal_transition", "orderIds": [...] }` | e.g. delivered → preparing |
| `422 { "error": "reason_required" }` | Cancelling with no `reasonCode` |

Side effects per `T8`/`T9`: set `delivered_at` and `delivered_by_user_id`, write the
`order_event` row, and enqueue the `E08-05` notification.

---

## 4. The operator's grants, on the read

`KitchenDay.permissions` drives which controls are drawn (`E09-09`):

```jsonc
{ "viewOrders": true, "markDelivered": true, "cancelOrders": false }
```

Cheapest source is a view or RPC over the existing grant tables — the screen needs three
booleans, not the grant rows. **This is presentation only**; the server enforces regardless.
Without it the screen falls back to drawing every lifecycle-legal action and letting the server
refuse, which works and is worse: a button that fails is worse than a button that is not there.

---

## 5. What the web thread will do when these land

1. Add `liveTransport` in `apps/web/src/lib/kitchen/`, implementing `KitchenTransport`.
2. Select it with `PUBLIC_KITCHEN_TRANSPORT=live` — one line in `kitchen.astro`.
3. Point `E09-04`'s tests at both implementations so the fixture cannot drift from the server.

No schema change is requested and none is wanted.

---

## 6. Also outstanding, and not the kitchen's

`E12-15` — the `enquiry` table and `enquiry-submit` Edge Function for the website form,
specified in `docs/enquiry-submission-contract.md`. Unblocked by nothing and blocking nothing
until the site goes live, which waits on `E20-01` anyway.
