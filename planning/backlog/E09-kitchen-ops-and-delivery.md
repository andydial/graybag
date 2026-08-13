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

- [x] `E09-21` **The parent's per-line note reaches the kitchen, and the dish outweighs the child's name on a row.** `order_line.special_comments` existed and nothing rendered it, so a parent typing "less spicy" was typing into nothing — the exact failure `ux-spec` §5.6.1 makes the field conditional on avoiding. It now comes through `KITCHEN_ORDER_COLUMNS` and renders against its own line in an amber block labelled **Request**, per line and not per order. The label is load-bearing: the note is never a safety record, and it is what stops an operator reading an empty line as "no allergies". Separately, the row was inverted — the dish is now the dominant element and the name is secondary, because in a kitchen the dish is what is being made and the name matters at handover, and a name that is not dominant is one a visitor does not read off a shared screen (Andy, 2026-08-13)
- [ ] `E09-18` (risk:medium) **Move `kitchen-order-status`'s transaction into a SQL function.** The Edge Function currently holds the guards and the `BEGIN` itself, over a direct connection, because the WEB thread was told not to touch migrations on 2026-08-12. `checkout` and `recipients` are thin shells over `create_recipient()` / `change_recipient_school()` and this should join them: a guard in SQL is enforced against every caller, whereas a guard in a function body is enforced only against callers who come through that function. Needs one migration adding `kitchen_set_order_status()`

- [x] `E09-19` **The filter bar read as a form, not a tool.** Four dropdowns of equal weight all reading "All", with a native date picker among them — three interactions to answer a question that is almost always "today" or "tomorrow". Replaced by: the date as the largest thing on the screen with one-tap `‹`/`›` and a `Today` button that only appears when you have left today; a count line ("24 orders · 3 classes · 2 breaks", following the filters, singular when it should be); school/break/status as chips that show their own state without being opened, the leading chip of each naming its category ("All breaks", "Any status") rather than a bare "All"; and **a filter with fewer than two options is not drawn at all** — an inert control is worse than none (Andy, 2026-08-13). Raised and closed in the same PR
- [x] `E09-15` (owner:andy) (risk:high) Decide whether the kitchen packing list and per-class delivery sheet surface a parent's per-line note. **Answered 2026-08-10: yes — `P12`**
- [ ] `E09-16` (risk:high) Render the per-line kitchen note on the packing list and the per-class delivery sheet, under the same retention rule as the rest of it (`P12`, `E09-14`)
- [x] `E09-17` (mvp) Wire the kitchen dashboard to the real server — `liveTransport` implementing `KitchenTransport`, selected by `PUBLIC_KITCHEN_TRANSPORT=live`. Blocked on `docs/kitchen-transport-contract.md` §1 (`E12-06` sign-in) and §3 (the `kitchen-order-status` Edge Function), both owned by the `supabase/` thread. The screen and every one of its states are built and reviewable against fixtures today



- [x] `E09-20` (risk:high) **No Edge Function handled a CORS preflight**, so every one of them was correct for the app and unreachable from any web page. React Native's `fetch` sends no `OPTIONS`, which is why nothing failed and nothing was logged for months. A `POST` with `content-type: application/json` and an `Authorization` header is not a simple request, so a browser sends `OPTIONS` first — and `OPTIONS` was answered `405`. Found by the web thread on the back office's first real click. Fixed once in `_shared/cors.ts` for all six browser-callable functions rather than six times as six bugs; `payments-webhook` is deliberately excluded and the exclusion is asserted, because Razorpay calls it server to server and advertising a preflight would describe a browser surface that should not exist. 20 assertions, including one that fails when a seventh function appears unclassified

