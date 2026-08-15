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
- ~~Legacy role values must be mapped on **db_value**, not label~~ — **roles are binary** (`AR3`):
  legacy `parent`, `teacher`, `staff` and `collegestudent` all map to **Customer**; only `admin`
  and `kitchen` get back-office grants. The export emitting labels rather than db values therefore
  stops mattering — the `School Staff` label was ambiguous between `staff` and `teacher`, and both
  land in the same place. `E16-20` closed; `E16-02` unblocked.
- ~~Legacy has two parallel parent-child links (`Child.Parent` list and `Guardian_Link`) that must be
  reconciled into one.~~ — **neither was used.** `Guardian_Link` is absent from the export and
  `Child.Parent` is empty on all 1,115 rows because it was never populated, not because the export
  damaged it (`E16-03`, `E16-21` both closed).
- **Parent↔child comes from `Order` (`order-parent` + `child`), and dependents are created *from*
  orders rather than matched to the roster** (`AR1`/`AR2`). **A child nobody has ordered for has no
  parent, and that is correct data, not missing data.** Do not use `User.child` as a recovery path.
  Measured: 146 distinct child names appear on orders → **131 dependents with an unambiguous
  parent**; **15 names stay ambiguous** even after narrowing by school, and **6 names are ordered
  for by more than one parent email** (mother and father both ordering is indistinguishable from
  two same-named children at one school). Report those 21, never guess them.
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
  duplicates, zero placeholders. Every order's `order-parent` resolves to a user. Verification
  needs no work — Google verifies the address, and an email OTP cannot succeed on one the user
  cannot read (`AR4`).
- **⚠ The key is moving underneath us.** Amity — 95% of children and 95% of orders — is moving
  everyone to a **new email domain** over the coming weeks, and the old accounts may be deleted
  (`AR5`). A dump taken today keys the migration to addresses that will not exist at cutover, and
  up to 154 Amity accounts are exposed. **Re-export close to cutover and reconcile changed
  addresses** (`E16-41`). This outranks the 12 mistyped domains, which are 12 static rows.
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

- [x] `E16-20` ~~Disambiguate the legacy `School Staff` role label before `E16-02`~~ — **closed 2026-08-08 by `AR3`: roles are binary.** Legacy `parent`, `teacher`, `staff` and `collegestudent` all map to **Customer**; only `admin` and `kitchen` get back-office grants. `School Staff` was ambiguous between `staff` and `teacher`, and under a binary model both land in the same place, so the ambiguity stops mattering and no Bubble-editor lookup is needed. `E16-02` unblocked
- [x] `E16-21` (owner:andy) ~~Re-extract `Child.Parent` from Bubble with real ids~~ — **closed 2026-08-08 by `AR1`: `Child.Parent` was never used.** Its emptiness is the accurate state, not export damage, so there is nothing to re-extract. Parent↔child is derived from `Order` instead (`order-parent` + `child`), and a child nobody has ordered for correctly has no parent. Andy confirmed this in conversation
- [x] `E16-22` ~~Prepare the `E16-21` extraction so it is a single click for Andy~~ — **closed 2026-08-08 with `E16-21`.** There is no extraction to prepare. The equivalent preparation work is now `E16-42`: build the order-derived dependent resolution and its exception report
- [ ] `E16-23` Produce the **undeliverable-email contact list** — the 12 accounts on a mistyped domain (`ais.amity.eduh`, `gmail.coma`, and 10 similar) cannot receive an email OTP and so cannot claim their account. Two have order history. This replaces the phone-based list `E16-12` was going to produce
- [ ] `E16-24` (risk:high) Classify `Dish_In_Order.special-comments` as **regulated data under non-negotiable #4** — 127 rows of free text about a named child, 15 of them containing dietary or allergy language. Add it to the no-log / no-Sentry / excluded-from-school-reports lists in `docs/dpdp-compliance.md`, which do not currently name it
- [ ] `E16-25` Dish identity resolution: line items and menu items reference dishes by **name**, and 6 of 79 names are duplicated, leaving 138 of 911 lines ambiguous. Resolve on `(name, menu, implied unit price)`; for the two collisions that are genuinely identical, pick the lowest Bubble id deterministically and record that choice
- [ ] `E16-26` Reconstruct `unit_price` as `line_total ÷ quantity` (`Dish_In_Order.unit_price` is empty on all 911 rows), assert it matches a menu price, and report the exceptions — 894 of 896 matched in the dry run
- [ ] `E16-27` Repair or re-author the double-encoded UTF-8 in the dish catalogue (42 of 85 descriptions, 25 of 85 calorie counts, 3 special-comments). Re-authoring is preferable since the menu copy is being rewritten anyway. Either way, assert no `Ã`, `Â` or `â€` sequence survives into the new database
- [x] `E16-28` Mirror the 82 dish images that still resolve (~2.0 MB) **now, not at cutover** — the Bubble CDN dies with the app. **Done 2026-08-08 (`AR6`)**: all 82 downloaded off the Bubble CDN by `tools/mirror-dish-images/`, held outside git with a committed manifest and checksums. Upload into Supabase Storage is `E16-43`, and no longer depends on Bubble being alive
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
- [ ] `E16-41` (risk:high) **Re-export from Bubble close to cutover and reconcile changed email addresses** (`AR5`) — Amity, which is 95% of children and 95% of orders, is moving everyone to a new email domain over the coming weeks and the old accounts may be deleted. Email is the migration key, so a dump taken today keys the migration to addresses that will not exist at cutover; up to 154 accounts are exposed. Diff the fresh export against the previous one on `unique id` (which is stable) and produce a moved/added/deleted-address report before the dress rehearsals, not after. This outranks `E16-23`
- [ ] `E16-42` Build the order-derived dependent resolution (`AR1`/`AR2`): create a dependent per distinct (`order-parent`, `child` name, `school`) triple, and emit an exception report rather than guessing — 15 child names stay ambiguous after narrowing by school, and 6 are ordered for by more than one parent email. Assert that no child is silently attached to two parents, and that no roster row is auto-merged into an order-derived dependent
- [ ] `E16-43` Upload the mirrored dish images into Supabase Storage and rewrite the dish records to point at them. The download half is done (`E16-28`), so this no longer depends on Bubble being alive and can run whenever the storage bucket exists

- [ ] `E16-44` Re-run `tools/upload-dish-images` WITHOUT `--fixture-aliases` once the menu import gives dishes their `legacy_bubble_id`, and delete the alias table rather than extending it. 78 of the 82 uploaded photographs are currently unused because staging has five seed fixtures rather than the real catalogue
- [ ] `E16-48` **Seed every environment from the real Bubble catalogue.** `tools/seed-catalogue/build.mjs` reads the sanitised export in `tools/seed-catalogue/data/` and generates `supabase/seeds/catalogue.sql`: 3 Mohali schools, 8 categories, 79 dishes, 2 menus, 83 prices. No `User`, `Child`, `Order` or `Dish_In_Order` — and `All-Schools.contact-email` / `Kitchens.owner-email` dropped at import rather than blanked. Applied to staging with photos serving; `supabase/migrations/0024_onboard_real_schools.sql` carries the `onboarded_at` correction a seed re-run cannot
- [ ] `E16-45` (owner:andy) **Settle four calorie conflicts.** The legacy catalogue holds two rows for each of Blueberry Muffin (400-430 vs 240–340), Lemon Ice Tea (90-120 vs 80–140), Peach Ice Tea (100-130 vs 100–160) and Cold Coffee (160 vs 250–350). The import preserves both figures in `dish.nutrition` and leaves `calories_kcal` null rather than choosing — publishing a calorie count nobody measured is the same failure as guessing `food_type`. A validation: somebody has to say which is right, and only the kitchen knows
- [ ] `E16-46` **Fold the real catalogue into the local and CI seed.** `supabase/seed.sql` still carries the four synthetic dishes, because its fixed UUIDs are referenced by the pgTAP suite and the jest fixtures; swapping them blind would break tests that are asserting the right things. Decouple the fixtures from the ids first, then include `catalogue.sql` so local, CI and staging genuinely match
- [ ] `E16-47` **Fill `food_type` for the 79 real dishes.** `[DM-17]`: veg / non-veg / egg is not in the legacy export and the importer refuses to infer it from ingredients — in this market a wrong mark is a trust failure, not a cosmetic gap. The menu currently renders every dish with no food-type mark. Needs an admin column and someone from the kitchen going through the list
- [x] `E16-49` (risk:high) **The migration actor, and the narrowest exemption I could write.** `0040`/`0041`, Andy's option (b). `0039` enforces §4.1, whose only entry points are `draft` and `pending_payment`, leaving `E16`'s ~283 finished legacy orders nowhere to go. Walking each through the machine would write an `order_event` history that never happened onto the table `I2` exists to make trustworthy; disabling the trigger in the importer is the version that ends up in a script nobody reviews. So: a named `migration` actor with **T14**, and three properties that keep it narrow — only `paid` and `cancelled` (the recon counts 281 and 2; drafts are not migrated, and `delivered`/`refunded` are absent because no legacy order is in them), **INSERT only** (no UPDATE row exists for it anywhere, so it can create history and never move a live order), and **the row must carry a `legacy_bubble_id`** (the actor and the data must agree, so a new order — which has no Bubble id and never will — cannot use this path). Four assertions, three of them about what it refuses. §4.1 updated with T14 and the reasoning
- [x] `E16-51` (risk:critical) **Production had schema and no catalogue.** Found 2026-08-16 while standing up `graybag-prod`: 56 migrations applied and **zero cities, schools, kitchens, dishes, menus or break times** — only the reference data migrations insert directly. Every parent opening the app on the 19th would have met an empty school picker, which §5.21 exists because it is indistinguishable from a bug. `seed.sql` is dev fixtures and says *"NEVER into staging or production"*, and `db push` does not apply seeds regardless; the real catalogue is `supabase/seeds/catalogue.sql` and had to be applied deliberately. `0024_onboard_real_schools` predicts exactly this in its header. Applied and verified **as an anonymous visitor**, which is the population that matters: 3 schools onboarded and active, 47/36/36 menu items, 79 dishes, 8 categories
- [ ] `E16-52` (owner:andy) (risk:critical) **Every dish on production has `food_type` null — no veg / non-veg / egg marking.** `[DM-17]` is open and `catalogue.sql` deliberately refuses to guess it: *"guessing it in this market is a trust failure, not a cosmetic gap."* Correct call by the generator, and it leaves a hole that matters more than any other missing field: **shipping a school lunch app in India with no veg marking is the single most likely thing to cause a complaint on day one**, and for many families it is a religious rather than a dietary question. The data exists with the kitchen; it needs someone to state it per dish. 79 dishes. Blocks a comfortable launch on 19 August far more than anything technical still open
- [ ] `E16-53` (risk:critical) **`supabase/seeds/catalogue.sql` can no longer be applied — every fresh environment is unbuildable.** `0059_food_type_required_on_menu` adds `assert_dish_is_marked`, which refuses any **active** `menu_item` whose dish has `food_type` null. `catalogue.sql` ships **all 79 dishes unmarked**, deliberately: `[DM-17]` is open and the generator's own header refuses to guess, because *"guessing it in this market is a trust failure, not a cosmetic gap"*. Both decisions are right on their own and together they are a contradiction: the seed says *we will not invent this* and the guard says *nothing unmarked reaches a menu*. Verified by applying the catalogue to a database carrying the trigger — it dies on the first row, `dish "Wheat Jaggery Cake" has no food type, so it cannot be put on a menu`. **Production is fine and that is the trap**: its catalogue was loaded on 16 August *before* the trigger existed, so prod holds 83 menu items that can no longer be reproduced from source. A rebuilt staging, a new environment, a restore drill (`E01-17`) or a disaster recovery all fail at the seed. **Nobody has seen this yet** because `main`'s newest Integration run is `73f41ad`, which predates the migration — the suite has never run on a commit containing it. Not fixed here, and deliberately not papered over: the resolution is either marking the 79 dishes (`E16-52`, `owner:andy`, and the right answer) or making the guard tolerate a seed, and choosing between them is the web thread's call since the guard is theirs. **Do not fix it by inventing food types.**
- [ ] `E16-54` (owner:andy) (risk:high) **Production has no allergen data at all — zero rows in `allergen`, zero in `dish_allergen`.** Found on production 2026-08-15. The reference table is empty, so there is nothing to tag dishes with and nothing for the allergen watchlist to match against; every dish therefore renders with no allergen information, which reads as *"contains nothing"*. This is the same shape as `E16-52` (no `food_type` on any of 79 dishes) and the same reason: `catalogue.sql` will not invent it. It is a validation only the kitchen can supply — which allergens are declared, and which dishes contain them. Non-negotiable #4 makes this the highest-consequence data gap of the three, because the failure mode is a child eating something they are allergic to rather than a complaint. The app-side machinery is built and tested (`useAllergenWatchlist`, the cart warnings wired in `E05-45`); it has nothing to work with
