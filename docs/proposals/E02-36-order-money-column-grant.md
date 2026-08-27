---
title: "E02-36 — stop a kitchen operator reading order money"
status: |
  Proposed 2026-08-26 by the web thread. **Step 1 landed 2026-08-27** by the mobile thread as
  migration `0076_order_money_view.sql` — the view and its grant, no revoke. **Step 2 is the web
  thread's and is now unblocked.**
---

# The hole

A kitchen operator holding only `orders.view`, `orders.view_pii` and `orders.mark_delivered` at
kitchen scope can read every money column on the orders they may see. Proved on staging with a real
operator JWT through PostgREST — not the service role:

```
GET /rest/v1/order?select=order_ref,total_paise,subtotal_paise
[{"order_ref":"SEED-20260814-0020","total_paise":6300,"subtotal_paise":6000}, …]
```

Nothing looks wrong today because `KITCHEN_ORDER_COLUMNS` never asks for those columns. That is a
convention in one query, not enforcement: anyone with the operator's token and a URL bar reads the
money. `scripts/test/kitchen-scope.test.mjs` asserts the gap as it currently behaves, so **the day
this lands that test fails**, and inverting it is the intended last step.

RLS filters rows, not columns. No policy will fix this.

# Why the obvious one-liner is wrong

The first instinct — and what I originally told Andy — was:

```sql
-- WRONG. Do not do this.
revoke select (total_paise, …) on "order" from authenticated;
```

There is exactly **one** `authenticated` role. Every persona shares it:

| Persona | Reads order money? | Why |
|---|---|---|
| Parent | **yes** | their own order's total, on the order screen and at checkout |
| Platform admin | **yes** | `/orders`, `/reports`, `/admin/sales` |
| Kitchen operator | **no** | this ticket |
| Edge Functions | yes, unaffected | they use `service_role`, which no revoke touches |

A blanket revoke therefore breaks parents and admins to fix kitchens. Column privileges cannot
express "this authenticated user but not that one".

# What to land instead

Revoke the money columns, then re-expose them through a **definer view** whose `where` clause is
the rule. The view is owned by `postgres`, so it retains the privileges the revoke removes, and its
predicate — not a column list in a client — decides who sees money.

```sql
-- =============================================================================
-- E02-36. Order money is readable only by the customer who paid it, or by a
-- back-office caller holding orders.view_financials on that order.
--
-- RLS filters rows, not columns, so a kitchen operator correctly denied another
-- kitchen's orders was still served every money column on their own. There is one
-- `authenticated` role shared by parents, admins and kitchen staff, so a column
-- revoke alone cannot separate them — the predicate below is what does.
-- =============================================================================

revoke select (
  subtotal_paise, tax_cgst_paise, tax_sgst_paise, tax_igst_paise,
  discount_paise, total_paise, refunded_total_paise
) on "order" from authenticated;

-- Definer, deliberately: it must keep the privileges just revoked from the caller.
-- `security_invoker = true` would make the view hit the revoke and return nothing.
create or replace view order_money as
  select o.id,
         o.order_ref,
         o.subtotal_paise,
         o.tax_cgst_paise,
         o.tax_sgst_paise,
         o.tax_igst_paise,
         o.discount_paise,
         o.total_paise,
         o.refunded_total_paise
    from "order" o
   where o.customer_user_id = (select auth.uid())
      or auth_can_on_order(o.id, 'orders.view_financials');

grant select on order_money to authenticated;

comment on view order_money is
  'E02-36. The only path to order money for an authenticated caller. The money columns are revoked from `authenticated` on the base table, so a kitchen operator — who shares that role with parents and admins — cannot read them by naming them. Definer rather than invoker, because it must retain the privileges the revoke removes. service_role is unaffected and Edge Functions are unchanged.';
```

## Sequencing — this matters, and the first version of it was wrong

**Corrected 2026-08-27.** The original said "client work lands first, then the whole DDL". That
cannot work, and I checked rather than reasoned about it: on staging today,

```
GET /rest/v1/order_money  ->  404      the view does not exist
GET /rest/v1/order        ->  401      the table does, and wants a token
```

A client shipped against a view that does not exist yet **404s every money read on production** —
`/reports`, `/admin/sales`, `/orders` and the parent's own order screen, immediately. The mistake
was treating the DDL as one indivisible step. It is two, and only one of them is dangerous:
`create view` is **additive and breaks nothing**, while `revoke select` is what has a blast radius.

Split them and there is no window where anything is broken, in either direction:

1. ~~**Mobile thread — `create or replace view order_money` and its grant, and nothing else.**~~
   **DONE, 2026-08-27**, as `0076_order_money_view.sql`. Purely additive; `kitchen-scope.test.mjs`
   still passes, as it must until step 3.

   **One correction to the SQL in this document, and it matters.** The proposed predicate was
   `customer_user_id = auth.uid() OR auth_can_on_order(...)`. `authorization.test.sql` refused it:
   its rule that every view in `public` be `security_invoker` exists because **a definer view
   bypasses the base table's RLS entirely** — and `"order"` carries a RESTRICTIVE
   `deny_dead_accounts` using `auth_is_live_user()`. A disabled or deleted account would have read
   its own order money through the view while RLS refused it on the table.

   The predicate now leads with `auth_is_live_user()`. The rule for any definer view: **it must
   restate every restriction it bypasses**, not only the one it exists to work around. The
   exception is declared by name in `authorization.test.sql` with that bargain asserted, and
   `order_money.test.sql` proves a disabled account reads nothing — mutation-checked by removing
   the clause.
2. **Web thread — switch `admin-orders`, `admin-reports`, `admin-growth`, `orders` and `checkout`
   to read money from `order_money` joined on `id`.** These work now (the view exists) and after
   the revoke (the view is definer). This is the step that must not be skipped.
3. **Mobile thread — the `revoke select`.** By now nothing reads the money columns off the base
   table, so this changes no behaviour for anyone who should have the data.
4. **Web thread — invert the assertion** in `kitchen-scope.test.mjs` from "money is readable" to
   "money returns nothing", closing `E02-36`.

Step 3 before step 2 takes out every money screen at once. Step 2 before step 1 does the same
thing for a different reason. **Step 1 is safe to do today** and unblocks everything after it —
if you land nothing else this week, land that.

### Why the web thread had not shipped step 2 — resolved

Because step 1 has not happened. Re-checked **2026-08-27**, after the mobile thread landed
migrations `0070`–`0075` for meal packs:

```
GET /rest/v1/order_money  ->  404          still no view
grep -rl order_money supabase/migrations/  ->  (nothing)
```

So it is not that the migration is written and unapplied — it has not been written. There is
nothing to point a client at, and shipping step 2 against a missing view is the outage this
document exists to prevent.

**Step 1 is about fifteen lines and is additive.** It can go into any migration; it does not need
its own. As soon as it exists on staging the web thread takes step 2, which is a half-day across
five call sites, and then step 3 is safe.

Standing note for whoever lands it: the kitchen-scope suite asserts the gap **as it currently
behaves**, so `scripts/test/kitchen-scope.test.mjs` will fail the moment step 3 lands. That
failure is the intended signal, not a regression — inverting that assertion is step 4.

## What this does not change

- **Edge Functions.** They use `service_role`, which no revoke touches. `order-alert`,
  `ops-heartbeat`, `checkout` and the settlement paths are unaffected.
- **Row visibility.** Unchanged — a kitchen operator still sees exactly their own kitchen's orders,
  and `kitchen-scope.test.mjs` proves it.
- **Invoices and the ledger.** Different tables, different policies, out of scope here.
