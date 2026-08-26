---
title: "E02-36 — stop a kitchen operator reading order money"
status: Proposed 2026-08-26 by the web thread. **The migration is the mobile thread's to land.**
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

## Sequencing — this matters

The revoke breaks any browser query still selecting money from `order` directly. **The client work
lands first**, and it is the web thread's:

1. **Web thread** ships `admin-orders`, `admin-reports`, `admin-growth`, `orders` and `checkout`
   reading money from `order_money` joined on `id`. Those queries work **before and after** the
   revoke, so there is no window where anything is broken.
2. **Mobile thread** lands the DDL above in their migration block.
3. **Web thread** inverts the assertion in `kitchen-scope.test.mjs` from "money is readable" to
   "money returns nothing", closing `E02-36`.

Landing 2 before 1 takes out `/reports`, `/admin/sales`, `/orders` and the parent order screen at
once. Please don't.

## What this does not change

- **Edge Functions.** They use `service_role`, which no revoke touches. `order-alert`,
  `ops-heartbeat`, `checkout` and the settlement paths are unaffected.
- **Row visibility.** Unchanged — a kitchen operator still sees exactly their own kitchen's orders,
  and `kitchen-scope.test.mjs` proves it.
- **Invoices and the ledger.** Different tables, different policies, out of scope here.
