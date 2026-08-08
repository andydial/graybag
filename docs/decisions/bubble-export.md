# Decisions — Bubble export constraints

`BR1`, `BR3`–`BR5`, `BR7` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

From `E19-04`, the export dry run — evidence in `docs/bubble-recon-findings.md`. These are
`E16`'s live migration constraints. `BR2` and `BR6` were superseded by `AR1` and `AR6` and are
in the archive.

| # | Decision | Why |
|---|---|---|
| BR1 | **Email is the sole migration key, and that is now settled rather than preferred** | `User.mobile` is empty on all 404 rows — not lossy, absent. `U1`/`E03-16` had already chosen email because the legacy `number` field was an account-takeover vector; the export removes the fallback entirely, so there is no longer a decision to revisit under pressure at cutover. Email itself is sound: 404/404 present, 404 distinct, 404 valid, zero duplicates, zero placeholders |
| BR3 | **The 78 `Draft` orders are not migrated in any status** | They are abandoned carts: none has a payment id, 45 have no order date and no break. `E16-19` already forbids producing `draft` rows (unreachable for the `system` actor, trips I12). The tempting alternative — `pending_payment` — would manufacture 78 fake open orders that the nightly sweeper expires on day one, turning a data-quality artefact into user-visible noise and a false ₹14,558 in the funnel |
| BR4 | **Migrate on the option *label*, not the db_value — the opposite of what `E16` said** | The constraint "map on db_value, not label" was correct about Bubble's internals and useless in practice: **the CSV export emits labels only**. This inverts two constraints at once. For breaks it is good news — the labels are self-consistent with the `Break-Timings` rows, so the `10__00_am`-renders-as-"10:40AM" contradiction cannot reach us and `E16-15` shrinks to an assertion. For roles it is bad news — `School Staff` is ambiguous between the `staff` and `teacher` db values, which carry different grants, so `E16-20` must resolve it from the editor before `E16-02` |
| BR5 | **Accounts on mistyped domains migrate as-is and are contacted, not corrected** | 12 users sit on domains like `ais.amity.eduh` and `gmail.coma`. Auto-correcting to the obvious intended domain would silently reassign an account — including two with order history — to an address its owner never entered, which is an account-takeover by typo-fix. They migrate unchanged and become the pre-cutover contact list (`E16-23`), replacing the phone-based list `E16-12` was going to produce |
| BR7 | **`Dish_In_Order.special-comments` is reclassified as regulated data** | 127 rows of free text attached to a named child, 15 containing dietary or allergy language. Nobody classified it, because the field the DPDP work guards — `Child.allergies` — turned out to be empty on all 1,115 rows. The sensitive data was in the field nobody was watching. Non-negotiable #4 applies to it (`E16-24`) |

**The export confirmed `SC2` rather than changing it:** `order-total ÷ Σ line_total` is exactly
**1.05** on 280 of 282 non-draft orders, and every total converts to whole paise with no float
artefact. GST-exclusive pricing is measurable in fourteen months of production orders, not just
Andy's recollection.
