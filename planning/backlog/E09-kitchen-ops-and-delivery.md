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

- [ ] `E09-01` (risk:high) **Aggregate production list** per kitchen: "make 120 sandwiches" across all schools for a service date **Domain done 2026-08-10** — `packages/shared/src/kitchen/lists.ts`, `productionTotals`. Open for the screen that renders it and the query that feeds it (`E05-09`)
- [ ] `E09-02` **Per-school aggregate view** for the same date **Domain done 2026-08-10** — `perSchoolTotals`. Open for the screen
- [ ] `E09-03` **Packing/delivery list** grouped school -> break -> class -> section **Domain done 2026-08-10** — `packingList`, grouped in exactly that order because it is the order the food physically moves. Open for the screen
- [ ] `E09-04` (mvp) Order list with filters: school, date, break, status
- [ ] `E09-05` (mvp) "Mark all delivered" per class, one tap
- [ ] `E09-06` 4-digit **pickup code** lookup for counter collection — staff types the code, order appears, one tap to hand over
- [ ] `E09-07` **Fallback search** by recipient name or last 4 digits of the parent's mobile, for when the code is unavailable
- [ ] `E09-08` (mvp) Reject / cancel an order with a reason, triggering refund (dish unavailable etc.)
- [ ] `E09-09` (risk:high) (mvp) Permission split enforced: `orders.mark_delivered` separate from `orders.refund` and `orders.view_financials`
- [ ] `E09-10` Kitchen users scoped to their kitchen(s) — currently all-access is acceptable, but the scoping must exist
- [x] `E09-11` (mvp) Works well on a tablet/phone in a kitchen — large tap targets, readable at arm's length
- [ ] `E09-11a` (risk:high) **Printable / CSV production and packing lists** — the kitchen must be able to work at 7am even if the app or their network is down **CSV done 2026-08-10** — `productionCsv`, `perSchoolCsv`, `packingCsv`. CRLF for Excel, formula-injection neutralised, and the packing file carries a first-row warning that it names children. Open for the print stylesheet and the download route **Terminal path shipped 2026-08-10** — `npm run kitchen -- --date YYYY-MM-DD`, with `--csv production|per-school|packing`. Reads paid orders and prints all three lists. This is the 'works at 7am when the app is down' half; the print stylesheet and a download route are still open
- [ ] `E09-12` (owner:andy) **Decision parked**: default delivery mode (classroom bulk vs counter pickup) until real usage data exists. Both are supported

Added by Q15 (`docs/overnight-review.md` §2.11).

- [ ] `E09-13` `E09-07`'s **last-4-phone fallback search is an Edge Function, never a table read.** `docs/data-model.md` §13.3 rule 4 says the kitchen needs **no** tier A beyond those four digits, and `docs/authorization-model.md` §14 names the mechanism; `E09-07` as written says nothing about it, and a table read would hand a kitchen operator the whole `phone_e164`. Rate-limited, logs the lookup to `audit_log`, returns the order and nothing else
- [ ] `E09-14` **The packing list is tier P and needs a retention rule.** `packingCsv` names children by design — staff hand food to a named child and there is no version of that job that does not. That makes a downloaded packing CSV regulated data sitting on a kitchen laptop indefinitely. Decide how long it may be kept and how it is destroyed, and put it in `docs/dpdp-compliance.md`. The file warns the reader in its first row, which is the most a file can do for itself; the rest is policy. Raised with `E09-11a`

- [x] `E09-11` (owner:andy) (mvp) (risk:high) Decide whether the kitchen packing list and per-class delivery sheet surface a parent's per-line note. **Answered 2026-08-10: yes — `P12`**
- [ ] `E09-12` (risk:high) Render the per-line kitchen note on the packing list and the per-class delivery sheet, under the same retention rule as the rest of it (`P12`, `E09-14`)
