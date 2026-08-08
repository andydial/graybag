# Decisions — Product

`P1`–`P11` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

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
