# Decisions — Scope confirmations

`SC1`–`SC3` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Answered by Andy in conversation on 2026-08-07 and binding. Also carried in CLAUDE.md's
non-negotiables.

| # | Decision | Why |
|---|---|---|
| SC1 | **Mohali only for v1. Confirmed 2026-08-07** — one city, one state. GST is a flat 5% shown as CGST 2.5% + SGST 2.5%, `gst_state_code` 03 (Punjab) everywhere. **No IGST, no place-of-supply derivation, no multi-state logic is to be built** | The kitchen is in the same state as every school served, so intra-state supply is the only case that can arise. Chandigarh (UT) and Panchkula (Haryana) are different state codes and would drag in IGST and possibly extra registrations; they are a fast-follow once live. This was already the working assumption — confirming it means the code may now *rely* on it rather than leaving room for a second state |
| SC2 | **Menu prices are GST-EXCLUSIVE. Confirmed 2026-08-07** — the stored `price_paise` is the taxable value, and 5% is added on top at checkout, matching what the Bubble cart does today. `platform_config.price_is_tax_inclusive = false` | Closes `[DM-14]` / `[DM-20]`, and takes option (a) of `[GST-01]` — **the cheap answer**. The inclusive path would have required relaxing `order_line`'s `check (line_subtotal_paise = unit_price_paise * quantity)`, because deriving a per-unit taxable value from a tax-inclusive price multiplies the rounding error by the quantity: four ₹99.00 tax-inclusive dishes come to ₹396.02, not ₹396.00, and no arrangement of integers fixes it while that constraint holds. Exclusive pricing makes the constraint true by construction and leaves `invoice.round_off_paise` at zero |

**Consequence still outstanding:** `platform_config.price_is_tax_inclusive` is `NULL` in `0001`
and must be set by a new migration with the column made `NOT NULL` — `0001` is applied to
staging and must not be edited (`MG5`). Tracked under `E02-06`.

---

| # | Decision | Why |
|---|---|---|
| SC3 | **Amity launches with ZERO migration. Confirmed 2026-08-09.** Amity's old email domains are dead; its ~150 users re-register from scratch on `ais.amity.edu.in` and **the loss of their order history is accepted**. Andy cleans the export himself and supplies a final import batch of valid users only. The other ~250 users at the smaller schools migrate **after** cutover, not before | Three effects, in order of size. **(1)** `E16` leaves the critical path — 10 open MVP tasks off the launch, and with them the two full dress rehearsals that had to complete before a cutover weekend, which were the riskiest calendar dependency in the plan. **(2)** Onboarding becomes revenue-critical rather than a polish concern: 150 parents register in a compressed window and re-enter their children by hand, so `AR7` is now a commercial constraint and `E03` gets a block of its own, having previously had none. **(3)** `E03-16` (migrate ~400 users by email match) is no longer a launch task — 150 of those users are re-registering and the rest migrate later — so it moves to the post-cutover block with `E03-18`/`E03-19`, which only matter to migrated accounts. The migration work is **deferred, not cancelled**: moving real order history into a live system with money in it is not less dangerous for happening later |
