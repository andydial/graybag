# Decisions — Product

`P1`–`P12` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

| # | Decision | Why |
|---|---|---|
| P1 | School attendance is **self-declared** | Schools refused to maintain the roster. School code is dead. |
| P2 | **No holiday-calendar blocking** in v1 | Kitchen/Admin refunds to wallet instead. |
| P3 | **No per-dish capacity limits** in v1, but the counter table is designed | A `(menu_item, service_date, remaining)` row with an atomic decrement costs less than the order insert. Not a `COUNT(*)`. |
| P4 | Delivery: **bulk mark-delivered per class** + **4-digit pickup code** for counter collection + name / last-4-phone fallback | No QR printing. Pickup code goes in the confirmation email and on the invoice, so children without phones are covered. |
| P5 | Default delivery mode **parked** | Depends on real usage patterns (whole-school vs a few orders per class). Both are supported. |
| P6 | School reports = **monthly PDF emailed**, not a portal | Lands in the principal's inbox rather than waiting to be discovered. Far cheaper to build. |
| P7 | **One web app** for marketing site, admin, kitchen ops and school reports | Cheaper than three; can be split later. |
| P8 | **Read-only offline** in v1 | Offline *ordering* needs conflict handling (price change, sold out, cutoff passed) and is not worth delaying launch for. |
| P9 | **Push + email only.** No WhatsApp in v1 | Deferred, not rejected. |
| P10 | **English only** | |
| P11 | **Device tier de-emphasised.** Audience is private schools in tier-1 cities, so mid-range Androids, not bottom-tier | The real performance constraint is **network**, not CPU. Keep the menu cache, skeletons, optimistic UI, image sizing and offline reads; drop the obsession with the cheapest handsets |
| P12 | **The per-line kitchen note is built, and the packing list surfaces it.** Capped at **140 characters**; copy states it is a request passed to the kitchen on a best-effort basis, **not a guarantee and not allergy information**; retention follows the packing list (`E09-14`, option c) — fresh per service date, destroyed at end of day, nothing retained server-side | Decided by Andy 2026-08-10, settling `E09-11`. **Why it is built rather than cut:** 127 of roughly 282 non-draft legacy orders used `Dish_In_Order.special-comments` — close to half. Removing it is a visible regression from Bubble on a feature parents actually use. **Why the packing list is the condition:** the packing list is the only *per-child* artefact we produce; the production list is aggregated, so a note about one portion has nowhere to live on it. If the note does not reach the packing list it reaches nobody, and a field nobody reads is worse than no field. **Why 140 characters:** a parent writing an essay is a parent whose request will not be read in a busy kitchen at 7am. **Why the retention rule:** the moment a parent types something about their child into it, it is regulated data (§13.3), so it cannot outlive the service date it belongs to |
