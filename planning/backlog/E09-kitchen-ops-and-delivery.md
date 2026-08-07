---
id: E09
title: Kitchen Ops & Delivery
phase: 5
risk: high
status: not-started
depends_on: [E02, E05]
summary: What the kitchen actually needs at 7am, plus the two delivery mechanisms and a permission split that lets a Delivery role exist later.
---

## Context

Kitchen staff today log in via "Admin Login" on the website and see all orders. Kitchens serve multiple schools. The delivery function may later be handled by a separate party, so `orders.mark_delivered` is a distinct permission from refund and financial access.

## Tasks

- [ ] `E09-01` (risk:high) **Aggregate production list** per kitchen: "make 120 sandwiches" across all schools for a service date
- [ ] `E09-02` **Per-school aggregate view** for the same date
- [ ] `E09-03` **Packing/delivery list** grouped school -> break -> class -> section
- [ ] `E09-04` Order list with filters: school, date, break, status
- [ ] `E09-05` "Mark all delivered" per class, one tap
- [ ] `E09-06` 4-digit **pickup code** lookup for counter collection — staff types the code, order appears, one tap to hand over
- [ ] `E09-07` **Fallback search** by recipient name or last 4 digits of the parent's mobile, for when the code is unavailable
- [ ] `E09-08` Reject / cancel an order with a reason, triggering refund (dish unavailable etc.)
- [ ] `E09-09` (risk:high) Permission split enforced: `orders.mark_delivered` separate from `orders.refund` and `orders.view_financials`
- [ ] `E09-10` Kitchen users scoped to their kitchen(s) — currently all-access is acceptable, but the scoping must exist
- [ ] `E09-11` Works well on a tablet/phone in a kitchen — large tap targets, readable at arm's length
- [ ] `E09-11a` (risk:high) **Printable / CSV production and packing lists** — the kitchen must be able to work at 7am even if the app or their network is down
- [ ] `E09-12` (owner:andy) **Decision parked**: default delivery mode (classroom bulk vs counter pickup) until real usage data exists. Both are supported

Added by Q15 (`docs/overnight-review.md` §2.11).

- [ ] `E09-13` `E09-07`'s **last-4-phone fallback search is an Edge Function, never a table read.** `docs/data-model.md` §13.3 rule 4 says the kitchen needs **no** tier A beyond those four digits, and `docs/authorization-model.md` §14 names the mechanism; `E09-07` as written says nothing about it, and a table read would hand a kitchen operator the whole `phone_e164`. Rate-limited, logs the lookup to `audit_log`, returns the order and nothing else
