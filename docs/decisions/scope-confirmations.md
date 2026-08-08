# Decisions — Scope confirmations

`SC1`–`SC2` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

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
