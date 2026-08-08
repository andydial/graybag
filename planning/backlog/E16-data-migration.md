---
id: E16
title: Data Migration from Bubble
phase: 7
risk: critical
status: not-started
depends_on: [E02, E03, E04, E05, E06]
summary: Move ~400 users, dependents and full order history off Bubble. Rehearsed at least twice before the real thing.
---

## Known constraints

Verified against the real export on 2026-08-08 (`E19-04`). Full evidence in
**`docs/bubble-recon-findings.md`** — read it before writing `E16-01`. Several constraints below
were written from the schema and turned out to be wrong; those are struck rather than deleted.

- Bubble **cannot export password hashes**. Every user re-authenticates once — matched on **email**
  (`E03-16`), not phone.
- Bubble CDN image URLs die on migration; images must be re-hosted. **Confirmed:** all 85 dish
  photos are protocol-relative `cdn.bubble.io` URLs; **82 resolve, 3 return a permanent 403**
  (~2.0 MB total). Mirror them now, not at cutover.
- ~~Legacy role values must be mapped on **db_value**, not label~~ — **the CSV export emits labels,
  not db values**, so db_value mapping is not possible from an export. Live labels are `Parent`
  (362), `School Staff` (37), `KitchenStaff` (4), `SuperAdmin` (1). `School Staff` is ambiguous
  between the `staff` (= school admin) and `teacher` (= school staff) db values and must be
  disambiguated before `E16-02` — see `E16-20`.
- ~~Legacy has two parallel parent-child links (`Child.Parent` list and `Guardian_Link`) that must be
  reconciled into one.~~ — **`Guardian_Link` was never used and is not in the export at all.
  `Child.Parent` is the sole mechanism**, so there is nothing to reconcile (`E16-03` closed).
- **`Child.Parent` did not survive the CSV export** — empty on all 1,115 rows, and the
  `parent-email` fallback is filled on 2. The only residue is `User.child`, which exports as
  comma-joined **display names**, 48 of 376 of which are ambiguous. **Only 369 of 1,115 children
  (33%) have any recoverable parent.** The relationship must be re-extracted from Bubble via the
  Data API or a flattened text field (`E16-21`) — it must not be reconstructed by name matching.
- ~~Order status values map from `new / received / accepted / delivered / cancelled / refunded`.~~
  — **only three values are in live use, and the export shows labels:** `Paid` 281, `Draft` 78,
  `Cancelled` 2. Nothing ever reached a fulfilment state; legacy tracked payment, not delivery.
- **The 78 `Draft` orders are abandoned carts, not orders** — none has a payment id, 45 have no
  order date and no break. Do not migrate them in any status (`E16-19`, `E16-36`).
- ~~**Break-Start-Times db values contradict their labels**~~ — the contradiction is real in the
  option set but **cannot bite an export, which emits the label**. The two live labels are
  self-consistent with the two `Break-Timings` rows. Migrate on the **label string**; `E16-15`
  shrinks to asserting that. Break windows are effectively kitchen-wide, not per-school.
- ~~Legacy `mobile` is a **number** field, so leading zeros and country codes are already lost.~~ —
  **the field is empty for all 404 users.** There are no phone numbers to normalise, de-duplicate
  or contact on. `E16-14` and `E16-12` are struck; the new system starts with zero phone numbers
  and acquires them via `E03-17`.
- **Email is clean and is a sound migration key**: 404/404 present, 404 distinct, 404 valid, zero
  duplicates, zero placeholders. Every order's `order-parent` resolves to a user. The risks are
  **deliverability** (12 accounts on mistyped domains cannot receive an OTP) and ~15 people holding
  two accounts under different spellings of the same school domain — neither is a collision.
- **Money is rupee decimals and confirms GST-exclusive pricing**: `order-total ÷ Σ line_total` is
  exactly **1.05** on 280 of 282 non-draft orders. Every total converts to whole paise with no
  float artefact. `Dish-In-Order.unit_price` is empty but recoverable as `line_total ÷ quantity`
  (matches a menu price on 894 of 896 lines).
- **`Order.all-dishes-in-order` survived intact** as ` , `-joined Bubble ids — 636 references, zero
  dangling, zero truncation, and it is the *only* order→line edge (every reverse pointer on
  `Dish-In-Order` is empty).
- **Dishes are referenced by name, and 6 of 79 names are duplicated** — 138 of 911 line items are
  ambiguous. Four collisions resolve by `(name, menu, price)`; two are genuinely identical.
- **The `Menu`, `Guardian_Link` and `Temp` tables were not exported.** Menus exist only as name
  strings; both must be recreated by hand.
- **`Child.allergies` is empty on all 1,115 rows** — there is no allergy history to migrate. But
  `Dish-In-Order.special-comments` (127 rows, 15 with dietary language) *is* health-adjacent data
  about a named child and must be treated as regulated (`E16-24`).

## Tasks

- [ ] `E16-01` (risk:critical) (mvp) Write the migration script: users, recipients, guardian links, schools, kitchens, menus, dishes, orders, order lines
- [ ] `E16-02` (risk:critical) (mvp) Role mapping: legacy enum -> Customer + back-office grants
- [x] `E16-03` (mvp) ~~Reconcile the two parent-child link mechanisms into a single relationship; report conflicts rather than guessing~~ — **closed 2026-08-08 with nothing to reconcile.** `Guardian_Link` was never used and does not appear in the export at all; `Child.Parent` is the sole parent↔child mechanism (confirmed by Andy, corroborated by `E19-04`). The task's premise was wrong, not its work. The *real* problem is that `Child.Parent` did not survive the export — that is `E16-21`, not this
- [ ] `E16-04` (mvp) Migrate full order history with line items, preserving totals and dates
- [ ] `E16-05` (mvp) Re-host all dish images; report any that cannot be sourced
- [ ] `E16-06` (mvp) Data quality report: duplicates, orphans, test/junk records, users without mobile numbers
- [ ] `E16-07` Decide per-record what to leave behind (test data) vs migrate
- [ ] `E16-08` (risk:critical) (mvp) **Validation suite**: row counts, financial totals, and a sample of orders compared field-by-field between Bubble and the new DB
- [ ] `E16-09` (risk:critical) (mvp) **Dress rehearsal #1** into staging, timed end to end
- [ ] `E16-10` (risk:critical) (mvp) **Dress rehearsal #2** after fixes, timed again; produces the cutover runbook
- [ ] `E16-11` (mvp) Rollback plan: exactly what happens if validation fails mid-cutover
- [ ] `E16-12` ~~Users without a usable mobile number — identify early and contact them before cutover~~ — **superseded by `E16-23`**: the export has no mobile numbers at all, so this would name all 404 users. The list worth producing is the 12 accounts on an **undeliverable email domain**, who cannot claim their account by OTP. Kept for history
- [ ] `E16-13` (risk:critical) Dress rehearsals must run against **pseudonymised data**, or in an isolated project with mandatory teardown. Do not copy live children's names and allergies into staging and leave them there
- [ ] `E16-14` (risk:critical) ~~Normalise all mobile numbers to **E.164**; produce a report of duplicates, unparseable and missing numbers before cutover~~ — **struck 2026-08-08 (`E19-04`): `User.mobile` is empty on all 404 rows.** There is no input. Phone numbers enter the new system only via `E03-17`, post-login. Kept for history; do not build this
- [ ] `E16-15` (risk:high) (mvp) Hand-verified lookup table mapping legacy break-time values to real times — **reduced in scope by `E19-04`**: the export emits **labels**, not the contradictory db values, and the two live labels agree with the two `Break-Timings` rows. The table is those two rows; the work is asserting the migration joins on the label and never on a db value
- [ ] `E16-16` (risk:high) If any legacy prepaid / wallet balances exist (see `E00-18`), migrate them as **opening ledger credits** so nobody loses money at cutover
- [ ] `E16-17` Migrate kitchen staff from an `owner-email` string on the Kitchen record to real user accounts with scoped grants
- [ ] `E16-18` (risk:critical) **Point-in-time restore rehearsal**: prove the new Supabase project can be restored to the pre-cutover snapshot within the rollback SLA the `docs/cutover-runbook.md` assumes. Feeds the runbook's rollback plan
- [ ] `E16-19` (risk:high) **The migration status map must target only statuses reachable by the `system` backfill actor — never `draft`.** `docs/cutover-runbook.md` §5.D.5 previously mapped legacy `new→draft`; `draft` is unreachable in v1 (`order-lifecycle.md` §3.2, invariant I12) and the §4.4 trigger only allows `NULL→draft` for an admin with `orders.create_on_behalf`, so a system backfill row is rejected at insert or trips I12 on the first nightly run. The runbook spec is now corrected; the migration code must implement the legal mapping (paid/cancelled/pending_payment) and assert no draft rows are produced (review finding #9)

<!-- Appended 2026-08-08 from E19-04. Untagged = fast-follow until Andy says otherwise. -->

- [ ] `E16-20` (risk:high) Disambiguate the legacy `School Staff` role label before `E16-02` — the CSV export emits labels, not db values, so `School Staff` (37 users) could be either `staff` (= school admin) or `teacher` (= school staff), which are different grant sets. Resolve from the Bubble editor's option set or from what those 37 accounts can actually do, and write the label→db_value→grant table down. Do not guess
- [ ] `E16-21` (risk:critical) (owner:andy) **Re-extract `Child.Parent` from Bubble with real ids** — the CSV export drops list-of-thing fields, so the sole parent↔child link is absent (0/1,115) and only 33% of children have any recoverable parent. Either pull `Child` via the Bubble Data API (which returns list fields as id arrays) or add a Bubble-side text field flattening `Child.Parent` to comma-joined parent **emails** and re-export. Both need the Bubble editor. Without this the relationship cannot be migrated safely
- [ ] `E16-22` Prepare the `E16-21` extraction so it is a single click for Andy: write the Data API request (or the exact Bubble field expression and export steps), plus the parser and the assertion that every returned parent id resolves to a user. Hand it over ready to run
- [ ] `E16-23` (risk:high) Produce the **undeliverable-email contact list** — the 12 accounts on a mistyped domain (`ais.amity.eduh`, `gmail.coma`, and 10 similar) cannot receive an email OTP and so cannot claim their account. Two have order history. This replaces the phone-based list `E16-12` was going to produce
- [ ] `E16-24` (risk:high) Classify `Dish_In_Order.special-comments` as **regulated data under non-negotiable #4** — 127 rows of free text about a named child, 15 of them containing dietary or allergy language. Add it to the no-log / no-Sentry / excluded-from-school-reports lists in `docs/dpdp-compliance.md`, which do not currently name it
- [ ] `E16-25` Dish identity resolution: line items and menu items reference dishes by **name**, and 6 of 79 names are duplicated, leaving 138 of 911 lines ambiguous. Resolve on `(name, menu, implied unit price)`; for the two collisions that are genuinely identical, pick the lowest Bubble id deterministically and record that choice
- [ ] `E16-26` Reconstruct `unit_price` as `line_total ÷ quantity` (`Dish_In_Order.unit_price` is empty on all 911 rows), assert it matches a menu price, and report the exceptions — 894 of 896 matched in the dry run
- [ ] `E16-27` Repair or re-author the double-encoded UTF-8 in the dish catalogue (42 of 85 descriptions, 25 of 85 calorie counts, 3 special-comments). Re-authoring is preferable since the menu copy is being rewritten anyway. Either way, assert no `Ã`, `Â` or `â€` sequence survives into the new database
- [ ] `E16-28` Mirror the 82 dish images that still resolve (~2.0 MB) into Supabase Storage **now, not at cutover** — the Bubble CDN dies with the app. URLs are protocol-relative and need `https:` prefixing; 79 of 85 contain `%20`-encoded spaces
- [ ] `E16-29` (owner:andy) Decide what happens to the **3 dish photos that return a permanent 403** and cannot be sourced from Bubble — Aloo Chana Chaat, Tomato/Cucumber Cheese Sandwich, Brown Wheat Pasta with Mushroom and Pesto. New photography, or ship them with a category placeholder
- [ ] `E16-30` Normalise `Child.class` to a canonical enum via a hand-built alias map (114 of 1,115 children sit outside `Nursery`/`LKG`/`UKG`/`I`–`XII`, with variants like `4th`, `Grade-2`, `Kg1`, `Nursary`). Keep `section` as **free text** with trimming and casing only — the house names (`Gems`, `Pearls`, `Lotus`) and streams (`Commerce`, `Arts`, `Medical`) among its 25 values are real, so it must not be enumerated
- [ ] `E16-31` Derive all order date parts from `order_date` and discard Bubble's denormalised `order_month` / `order_week` / `order_year` — they disagree with `order_date` on 5 orders, and `order_ymd` is empty on all 361
- [ ] `E16-32` Coerce Bubble's **blank-means-false** boolean convention explicitly at the migration boundary — `Menu_Item.is_active` is blank on 36 of 84 rows, `User.disabled` on 6 of 404, `School.isCollege` on all 4. A nullable boolean here produces menu items that are neither active nor inactive
- [ ] `E16-33` Payment reconciliation exceptions for `E16-08`: 2 `Paid` orders whose totals cannot be rebuilt from their lines (₹120.45 against ₹109, ₹151.40 against ₹139), and 1 `Paid` order with no payment id at all (manually marked paid in the Bubble editor, so unreconcilable against Razorpay). Surface all three rather than forcing a formula
- [ ] `E16-34` (owner:andy) Decide the treatment of the **1 `Cancelled` order that carries a payment id** — money was taken and the order cancelled, and legacy had no `refunded` status to express what happened next. Confirm whether a refund was issued outside the system; if not, it is an opening ledger credit under `E16-16`
- [ ] `E16-35` Recreate the two menus by hand — the `Menu` table was not exported at all, so menus survive only as the name strings `Sky Bites - Amity` and `School Menu - May 2026` on `Menu_Item`, `School_Menu` and `Kitchen.default_menu`
- [ ] `E16-36` Exclude the **78 `Draft` orders and 275 orphan `Dish_In_Order` rows** from the migration, with the dropped counts and notional values (₹14,558 and ₹30,612) reported rather than silently discarded. Drafts are abandoned carts — none has a payment id — and migrating them as `pending_payment` would manufacture 78 fake open orders that the nightly sweeper immediately expires
- [ ] `E16-37` (owner:andy) Decide what to do with the **746 roster children who have no recoverable parent** — bulk-imported by the school on 2025-09-21, each with a unique `school-code`, none linked to an account. Migrate them as unlinked records for parents to claim in-app, or leave them behind and re-import from a fresh school roster
- [ ] `E16-38` Confirm the new order model accepts a **self-recipient order** before `E16-04` runs — 13 legacy orders have `recipient_type = Staff` and no child, i.e. the ordering adult is the recipient
- [ ] `E16-39` (owner:andy) Tell the kitchen that **no allergy data is migrating** — `Child.allergies` is empty on all 1,115 legacy rows, so every allergy record in the new system starts blank. They may believe they hold this data
- [ ] `E16-40` Validation-set caveat for `E16-08`: Amity International School is 95% of children, 95% of orders and 77% of users. Multi-school behaviour is close to untested in production data, so per-school logic needs synthetic coverage rather than migrated-data coverage
