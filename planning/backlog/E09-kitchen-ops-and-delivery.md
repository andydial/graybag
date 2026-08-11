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
- [x] `E09-04` (mvp) **The kitchen dashboard: one working list of the day's orders.** Child, class, section, break, school, dishes, status. Filters: school, date, break, status. **Production totals as a summary at the top** — "how much do we cook" is answered by the same data, so it is a header on this list rather than a second screen. `productionTotals` and `perSchoolTotals` already compute it (`E09-01`, `E09-02`)
- [x] `E09-05` (mvp) **Update status from the list**: mark delivered (bulk per class, one tap — `L8`), mark prepared, and cancel with a reason (`E09-08`). Optimistic, failing loudly; `delivered` is terminal (`T8`/`T9`)
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

- [ ] `E09-15` (owner:andy) (risk:high) Decide whether the kitchen packing list and per-class delivery sheet surface a parent's per-line note. If they don't, the note field is not built at all — a note nobody reads is a lie told to a parent trying to be careful (ux-spec §5.6.1) *(Renumbered from a second `E09-11` on 2026-08-11. Two different tasks carried that id, so `scripts/check-mvp.mjs` — which keys tasks by id — saw only the later one and reported the earlier, genuinely-MVP task as untagged. The tablet-legibility task keeps `E09-11` because it is the older assignment and the one the MVP list means; this is the accidental reuse and takes the next free id. `check-mvp.mjs` now fails on duplicates.)*
- [ ] `E09-16` **The standalone printable packing list, as its own view.** Grouped school → break → class → section, built on `packingList`, which is done. **Fast-follow, deliberately** (Andy, 2026-08-11): the MVP kitchen surface is one order list with status updates, and a separate packing screen is a second surface to build, test and teach before there is evidence anyone needs it. The capability already exists as CSV (`E09-11a`), so nothing is lost by waiting. `E09-14`'s retention rule governs it whenever it is built, because it names children
- [ ] `E09-17` (mvp) Wire the kitchen dashboard to the real server — `liveTransport` implementing `KitchenTransport`, selected by `PUBLIC_KITCHEN_TRANSPORT=live`. Blocked on `docs/kitchen-transport-contract.md` §1 (`E12-06` sign-in) and §3 (the `kitchen-order-status` Edge Function), both owned by the `supabase/` thread. The screen and every one of its states are built and reviewable against fixtures today

