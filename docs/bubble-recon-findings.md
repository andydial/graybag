---
title: Bubble Export Recon Findings
---

# Bubble export recon findings — `E19-04`

**Date:** 2026-08-08
**Source:** `bubble-export-recon/` — 10 CSVs exported from Bubble on 2026-08-08 (`E00-15`), held
**outside** this repository as a sibling directory. Nothing from it is committed.
**Method:** read-only scripted analysis. Every number below is an aggregate. No name, email,
allergy or free-text comment from the export appears in this document; the handful of examples
are masked or invented to show *shape* only.

> **Handling.** The export contains 1,115 real children's first names with class, section and
> school. That is DPDP-regulated personal data of minors (non-negotiable #4). Once the findings
> below are accepted, the folder should be deleted. The real migration must re-export from
> Bubble at cutover anyway — this dump is a survey, not a source of truth, and it will be stale.

---

## 1. The five things that change the plan

1. **`mobile` is empty for all 404 users.** Not mangled — *absent*. Every phone-related migration
   assumption in `E16` is moot, and the decision to key migration on email (`E03-16`) turns out to
   have been not merely safer but the only option available.
2. **Email is in excellent shape.** 404/404 present, 404 distinct, 404 syntactically valid, zero
   duplicates, zero placeholder addresses. `E03-16` has a clean run. The only real risk is
   *deliverability*, not collision — see §4.
3. **`Child.Parent` did not survive the export.** 0/1,115 rows carry it. The parent↔child link —
   which per Andy is the *only* link mechanism, `Guardian_Link` having never been used — is not in
   this dump at all. It is partially recoverable from `User.child`, but that field exports as
   **comma-joined display names, not ids**, and 48 of 376 references are ambiguous. This is the
   single largest migration hazard found.
4. **`Order.all-dishes-in-order` *did* survive, as ids.** Order → line-item relationships are
   intact and 100% referentially sound. Order history is migratable.
5. **The legacy `status` option set has only three live values** — `Paid`, `Draft`, `Cancelled` —
   not the six `E16` assumed. 78 orders (21.6%) are `Draft`, i.e. abandoned carts, and they collide
   directly with `E16-19`'s rule that no migrated row may land in `draft`.

---

## 2. Row counts and junk

| Table | Rows | Notes |
|---|---:|---|
| `All-Users` | 404 | matches the "~400 users" estimate exactly |
| `All-Children` | 1,115 | 1,010 of them a single bulk roster import |
| `All-Orders` | 361 | |
| `Dish-In-Order` | 911 | only 636 are reachable from an order |
| `Dishes` | 85 | 79 distinct names |
| `All-Menu-Items` | 84 | |
| `All-Schools` | 4 | |
| `All-School-Menus` | 3 | |
| `Break-Timings` | 2 | |
| `Kitchens` | 1 | |
| **Total** | **2,970** | |

**Three tables in `docs/legacy-bubble-schema.md` were not exported at all:** `Guardian_Link`
(confirmed never used — see §5), `Menu`, and `Temp`. `Menu`'s absence matters: menus survive only
as **name strings** (`"Sky Bites - Amity"`, `"School Menu - May 2026"`) on `Menu_Item`,
`School_Menu` and `Kitchen.default_menu`. Two menus exist; both must be recreated by hand.

### Obviously test or junk

The striking result is how *little* is fake. Almost none of this data is test data; the mess is
**incompleteness**, not fabrication.

| Category | Count | Verdict |
|---|---:|---|
| `Demo School` (city: Chandigarh, not Mohali) | 1 row | Drop. 0 children, 0 orders depend on it |
| Placeholder child named like `"Student Name (<school>)"` | 1 | Drop |
| Accounts on internal domains (`threevee.in`, `graybag.com`) | 6 | **Keep** — 4 are the real KitchenStaff accounts. 3 orders, ₹424 |
| Accounts on a mistyped domain | 12 | See §4 — undeliverable, not fake |
| `disabled = yes` users | 2 | Migrate as deactivated |
| `Dish-In-Order` rows reachable from no order | 275 (30.2%) | Abandoned cart lines, ₹30,612 notional. Drop |
| …of those, rows with no dish either | 15 | Drop |
| `Draft` orders | 78 (21.6%) | Abandoned carts, ₹14,558 notional. Do not migrate as orders |
| Children with no school | 4 | Needs a decision |
| Orders with no school / city / kitchen | 5 | Defaultable — one kitchen, one city exist |
| Orders with no `recipient_type` | 4 | Inferable from `child` being set |
| Children with a non-standard `class` string | 114 | Dirty, not junk — see §9 |
| Children with a `section` outside A–G | 50 | Dirty, not junk — see §9 |
| Users with no child and no order | 59 | Real signups that never converted. Migrate |

**Nothing matched a test-data pattern** (`test`, `demo`, `dummy`, `asdf`, `example.com`, …) in any
email or user name. There is no test-record cleanup problem here; `E16-07` is a much smaller job
than assumed.

---

## 3. Mobile numbers — the field is empty

| Measure | Count |
|---|---:|
| Users | 404 |
| `mobile` non-empty | **0** |
| Parse to valid E.164 | **0** |
| Duplicated | n/a |
| Mangled by the legacy number type | n/a — nothing to mangle |

The column exists in the CSV header and is the empty string on every one of the 404 rows. Two
readings are possible and we cannot distinguish them from the dump alone: either the field was
genuinely never populated, or Bubble's CSV export dropped it the way it dropped the list fields
(§5). Either way **the export delivers zero phone numbers**, so:

- `E16-14` (normalise all mobile numbers to E.164) has no input. Struck.
- `E16-12` (users without a usable mobile number — contact them before cutover) applies to
  **all 404 users**, which makes it meaningless as a pre-cutover exception list. Struck.
- `E03-17` (collect mobile as a profile field post-login) becomes the *only* route by which the
  new system ever acquires a phone number. Every user starts with none.
- The kitchen loses its ability to phone a parent about an order on day one. Worth knowing before
  cutover; it is an operational regression, not a technical one.

**Does this threaten `E03-16`'s email-match migration? No — it removes its only competitor.**
Had `mobile` been present but lossy, there would have been a temptation to fall back to it. There
is nothing to fall back to, which makes the email path unambiguous.

---

## 4. Emails — clean, and the migration key holds

| Measure | Count |
|---|---:|
| Users with an email | **404 / 404 (100%)** |
| Distinct (case-insensitively) | **404 — zero duplicates** |
| Syntactically valid | **404 (100%)** |
| With uppercase, leading/trailing whitespace, or `+` addressing | 0 / 0 / 0 |
| Matching a test/placeholder pattern | 0 |
| On a non-real domain (`example.com`, `test.com`, …) | 0 |

Every order's `order-parent` and `Creator` is an email, all 361 resolve to a user, and
`Creator == order-parent` on 361/361 orders. Every `Dish-In-Order.Creator` resolves too. **Email is
a reliable join key across the whole export.**

**Top domains:** `gmail.com` 215, `ais.amity.edu` 115, `ais.amity.edu.in` 24,
`aismohali.amity.edu` 11, `yahoo.com` 10, everything else ≤ 4.

### The two real email risks

**(a) 12 accounts on a mistyped domain — undeliverable, so unreachable by OTP.**

Masked, with shape preserved:

| Domain as stored | Almost certainly | Users | Placed orders? |
|---|---|---:|---|
| `ais.amity.eduh` | `ais.amity.edu` | 2 | 1 yes |
| `ais.amity.edut`, `ais.amity.eduu`, `ais.amity.edua` | `ais.amity.edu` | 3 | 1 yes |
| `ais.amity.efu`, `ais.anity.edu`, `ais.aimty.edu` | `ais.amity.edu` | 3 | no |
| `205ais.amity.edu`, `sis.amity.edu` | `ais.amity.edu` | 2 | no |
| `gmail.coma` | `gmail.com` | 1 | no |
| `threevee.ins` | `threevee.in` | 1 | no |

These 12 are the accounts that **cannot receive an email OTP and therefore cannot claim their
account**. Two of them have order history. This — not duplication — is the concrete pre-cutover
contact list, and it replaces the one `E16-12` was going to produce from phone numbers.

**(b) 15 people appear to hold two accounts under different spellings of the same school domain.**

15 local-parts occur under more than one of `ais.amity.edu` / `ais.amity.edu.in` /
`aismohali.amity.edu` / `aismohali.amity.edu.in` / `ais.amity.eduh`. As *strings* these are
distinct emails and will migrate to distinct accounts, which is correct and safe. But they are
probably ~15 duplicated humans, and after cutover each will hold two accounts with a split view of
their own children and order history. That is a support problem, not a data-integrity one, and it
must not be "fixed" by guessing — `ais.amity.edu` and `ais.amity.edu.in` may genuinely be separate
mailboxes.

**Recommendation: migrate all 404 as distinct accounts. Do not merge.** Produce the list and let
support merge on request, after the user confirms.

---

## 5. List fields — one survived, one did not

This is the finding with the largest downstream cost.

| List field | Exported as | Result |
|---|---|---|
| `Order.all-dishes-in-order` | ` , `-joined **Bubble ids** | ✅ **Survived intact** |
| `User.child` | `, `-joined **display names** | ⚠️ Survived, but lossy |
| `Child.Parent` | *(empty on every row)* | ❌ **Did not survive** |
| `Menu_Item.available_days` | *(empty on every row)* | ❌ Did not survive |

### `Order.all-dishes-in-order` — fully intact

| Check | Result |
|---|---|
| Orders carrying the field | 361 / 361 |
| Total references | 636, all distinct |
| References pointing at a missing `Dish-In-Order` row | **0** |
| Line rows referenced by more than one order | **0** |
| Orders with zero lines | **0** |
| Longest value | 277 chars (8 ids) — no truncation |
| Lines per order | 1 → 152, 2 → 155, 3 → 49, 4 → 1, 5 → 3, 8 → 1 |

Order → line-item migration can proceed exactly as `E16-04` assumes. Note the separator is
`space-comma-space`, and that the reverse pointers (`Dish-In-Order.order`, `.child`, `.school`,
`.order_date`) are **all empty** — the list field is the only edge, so it must be parsed, not
worked around.

### `Child.Parent` — gone, and only partly recoverable

`Child.Parent` is empty on all 1,115 rows. `Child.parent-email`, the denormalised string copy that
would have rescued it, is filled on **2 rows**. So the export contains no direct parent→child edge.

What remains is `User.child`, which exported as a comma-joined list of **first names**:

| Check | Result |
|---|---:|
| Users listing ≥ 1 child | 330 / 404 |
| Total child references | 376 |
| References that are Bubble ids | **0** — all are display names |
| Resolving to exactly one child row by name | 328 |
| Resolving to **more than one** child (ambiguous) | **48** |
| Resolving to no child | 0 |
| Child names containing a comma (would corrupt the joined list) | 0 |

Combining `User.child` with `Order.child` (also a name) recovers at most **338 distinct child
names**, covering **369 of 1,115 children (33%)**. The other **746 children — every one of them
from the bulk roster import — have no recoverable parent at all.**

Of the 1,115 children:

- **1,010** were created by `(App admin)` on essentially one day (2025-09-21: 1,004 of them), all carrying
  a unique `school-code`, none carrying a parent. This is a **school roster import**, not a set of
  customer-created dependents.
- **105** were created by real users, none with a `school-code`. These are the genuine
  parent-created children.
- 264 of the roster children are additionally referenced by some user's `child` list — i.e. a
  parent later adopted a roster row.

**What this means for `E16-01`/`E16-03`:** reconstructing the link from names is a *matching*
exercise with a 12.8% ambiguity rate, on data about minors, where a wrong match shows one parent
another family's child. That is exactly the class of error non-negotiable #2 exists to prevent.

**Do not migrate the relationship from this export.** The correct fix is to get the ids out of
Bubble properly before cutover — either via the Data API (which returns list fields as id arrays)
or by adding a Bubble-side text field that flattens `Child.Parent` to joined parent *emails* and
re-exporting. Both need the Bubble editor, so both are Andy's to run. Task added.

If that proves impossible, the fallback is: migrate the 105 user-created children by name match,
migrate the roster as unlinked records keyed on `school-code`, and let parents claim their children
in-app after login. Report every ambiguous match rather than resolving it.

---

## 6. Dish images — 82 of 85 still resolve

| Measure | Count |
|---|---:|
| Dishes with a `photo` value | **85 / 85 (100%)** |
| Distinct URLs | 85 |
| Fetched successfully (HTTP 200) | **82** |
| **HTTP 403 — permanently unfetchable** | **3** |

All 85 are protocol-relative (`//<hash>.cdn.bubble.io/f<id>/<filename>`) on a single CDN host, so
they need `https:` prefixing before use. 79 of 85 contain `%20`-encoded spaces in the filename.
Formats: 52 PNG, 33 JPG. Total payload **1.56 MB** across the 82 that fetch (the CDN's
`Content-Length` headers over-report at ~2.0 MB; the bytes actually delivered are 1.56 MB).
Re-hosting is a two-minute job, not a project.

The 3 that return 403 do so consistently, on `HEAD` and on `GET`, with a browser user-agent. They
are:

- Aloo Chana Chaat
- Tomato, Cucumber Cheese Sandwich in Brown Bread
- Brown Wheat Pasta with Mushroom and Pesto

These are the "cannot be sourced" cases `E16-05` asks us to report. They need new photography or a
placeholder.

**These URLs die when the Bubble app is decommissioned.**

> **Done, 2026-08-08 (`AR6`, `E16-28`).** All 82 have been pulled off the Bubble CDN by
> `tools/mirror-dish-images/`. The binaries live **outside** the repository; the committed record
> is `manifest.json` — per-image source URL, byte count, content type and SHA-256 — and
> `npm --prefix tools/mirror-dish-images run verify` re-checks the local copies against it.
> Uploading into Supabase Storage is `E16-43` and no longer depends on Bubble being alive.

---

## 7. Break times — the contradiction is real but the export routes around it

`docs/legacy-bubble-schema.md` §"Break-Start-Times" records the option set as
`10__00_am` → "10:40AM - 11:15AM" and `10_15_am` → "11:15AM - 11:40AM" — db values that contradict
their labels, the hazard `E16-15` exists to handle.

**The export does not contain the db values.** `Order.break` exports the **label**, and the labels
are self-consistent with the `Break-Timings` table:

| `break-id` | `break-time` (label) | `break_start` | `break_end` | School |
|---|---|---|---|---|
| 1 | 10:40AM - 11:15AM | 10:40AM | 11:15AM | Amity International School |
| 2 | 11:15AM - 11:40AM | 11:15AM | 11:40AM | Amity International School |

Both rows are internally consistent — start, end and label agree. Only two break windows exist in
the entire system, and `Order.break` uses exactly those two label strings.

**So the contradiction cannot bite this export, and the mitigation is simpler than `E16-15`
assumed: migrate on the label string, never on the db value.** The hand-verified lookup table is
still needed — but it maps two labels, not five db values, and the `Break-Timings` rows above *are*
that table. `E16-15` shrinks from "reconstruct the truth" to "assert we used the label".

Two things to note:

- **Break usage:** 316 orders carry a break; 45 do not. Every one of the 45 is a `Draft` order —
  the break is chosen at checkout, so abandoned carts never got one. No paid order is missing a
  break.
- **`Break-Timings` only defines Amity's windows**, yet 10 Paragon orders and 1 Gem order use the
  same two label strings. Break windows are effectively **global**, despite the `School` column
  implying per-school configuration. Do not build a per-school break model off this data without
  asking; model it as a kitchen-wide schedule with a school override if needed later.

---

## 8. Orders — dates, statuses, and money

### Date range

| Series | Range | Filled |
|---|---|---|
| `Order.Creation Date` | 2025-06-14 → 2026-08-06 | 361/361 |
| `Order.order_date` | 2025-06-15 → 2026-08-07 | 316/361 |
| `Dish-In-Order.Creation Date` | 2025-06-13 → 2026-08-06 | 911/911 |
| `User.Creation Date` | 2025-06-02 → 2026-08-07 | 404/404 |
| `Child.Creation Date` | 2025-06-02 → 2026-08-07 | 1115/1115 |

Roughly 14 months of history. Order volume by month peaks at 61 (2026-03) and runs 34–56 per month
through 2026; 2025 is negligible (≤ 7/month) — the business effectively started in 2026-01. Every
date parsed cleanly from Bubble's `%b %d, %Y %I:%M %p` format; **no unparseable and no
future-dated rows**, and no order dated before its own creation.

The denormalised `order_month` / `order_week` / `order_year` columns **disagree with `order_date`
on 5 orders** (timezone drift in Bubble's derivation). `order_ymd` is empty on all 361.
**Derive all date parts from `order_date`; discard the pre-computed columns.**

### Status distribution

| Legacy status | Count | Value | Maps to |
|---|---:|---:|---|
| `Paid` | 281 (77.8%) | ₹57,750.75 | `paid` |
| `Draft` | 78 (21.6%) | ₹14,558.00 | **nothing — do not migrate** |
| `Cancelled` | 2 (0.6%) | ₹227.85 | `cancelled` |

**The six statuses `E16` lists (`new / received / accepted / delivered / cancelled / refunded`) are
db values; only three are in live use, and the export shows their labels.** In particular
`docs/legacy-bubble-schema.md` records the `payment_processed` workflow setting status to
`received` — whose label is evidently `Paid`. As with breaks, **map on the label, and note that no
order ever reached a fulfilment state**: nothing is `delivered`, nothing is `refunded`. Legacy
Bubble tracked payment, not fulfilment.

### What will not map onto the new state machine

1. **78 `Draft` orders.** `E16-19` already forbids producing `draft` rows — `draft` is unreachable
   for the `system` backfill actor and trips invariant I12. These are abandoned carts: 45 have no
   `order_date` and no break at all, and **none of the 78 has a payment id**. They are not orders.
   **Recommendation: do not migrate them in any status.** Migrating them as `pending_payment` would
   manufacture 78 fake open orders on day one, each of which the nightly sweeper would then expire.
   Record the ₹14,558 as *not* revenue.
2. **13 orders with `recipient_type = Staff`** and no child (consistent — 13 staff orders, 13 empty
   `child` fields). The new model must accept an order whose recipient is the ordering adult, not a
   dependent. Confirm `E05`/`E02` handle a self-recipient order before `E16-04` runs.
3. **1 `Paid` order with no payment id** (₹109, and its total equals its line sum — no GST added).
   Manually marked paid in the Bubble editor. It cannot be reconciled against Razorpay.
4. **1 `Cancelled` order that does have a payment id.** Money was taken and the order cancelled,
   with no `refunded` status available to express what happened next. Needs Andy to confirm whether
   a refund was issued outside the system before `E16-16` decides whether an opening credit is owed.
5. **No fulfilment history exists**, so every migrated order lands in a terminal payment state with
   no delivery record. Reports over migrated data must not claim delivery.

### Money

**Legacy totals are rupee decimals, and they confirm the GST-exclusive scope fact.**

| Check | Result |
|---|---|
| `order-total` unparseable / zero / negative | 0 / 0 / 0 |
| `order-total` with a fractional rupee part | 241 / 361 |
| `order-total × 100` not a whole number of paise | **0** — every total converts exactly |
| Sum of all `order-total` | ₹72,536.60 |
| Sum of `Paid` only | ₹57,750.75 |

Reconstructing each order from its lines gives a decisive result:

| `order-total ÷ Σ line_total` | Orders | Reading |
|---|---:|---|
| **1.05** | 280 | GST 5% added on top of exclusive line prices |
| **1.00** | 79 | 78 `Draft` (GST applied at checkout, never reached) + 1 anomalous `Paid` |
| 1.105 | 1 | unreconstructable |
| 1.0892 | 1 | unreconstructable |

**This is direct evidence for the `docs/mvp-scope.md` fact that menu prices are GST-exclusive and
5% is added at checkout** — 280 of 282 non-draft orders satisfy it to the paise. The two outliers
(₹120.45 against a ₹109 line, ₹151.40 against ₹139) carry a small unexplained excess and cannot be
rebuilt from their lines; they need a manual decision in `E16-08`, not a formula.

`Dish-In-Order.unit_price` is **empty on all 911 rows**, but is recoverable:
`line_total ÷ quantity` matches a menu price for **894 of the 896** lines that name a dish. Use the
derivation, assert the match, and report the 2 exceptions. Quantities are 1 (880), 2 (27), 3 (2),
5 (2) — no zero or negative quantities, no fractional line totals.

---

## 9. Everything else that will bite

**Dish identity is by name, and 6 names are duplicated.** `Dish-In-Order.dish` and
`Menu_Item.dish` both reference dishes by **name**, not id — and 85 dish rows carry only 79 distinct
names. That leaves **138 of 911 line items (15%) and 11 of 84 menu items ambiguous**. Four of the
six collisions are resolvable, because the duplicate pair sits on *different menus at different
prices* (e.g. one name at ₹69 on `Sky Bites - Amity` and ₹89 on `School Menu - May 2026`), so
`(name, implied unit price)` disambiguates. **Two are genuinely indistinguishable** — same name,
same category, same menu, same price, differing only in Bubble id. For those, either dish row is an
equally correct target; pick deterministically (lowest id) and say so.

**Text fields carry double-encoded UTF-8 (mojibake).** UTF-8 was re-encoded as Latin-1 somewhere in
Bubble's export path, so en-dashes and similar arrive as `â€"`:

| Table.column | Damaged rows |
|---|---:|
| `Dishes.description` | 42 / 85 |
| `Dishes.Calorie Count` | 25 / 85 |
| `Dish-In-Order.special-comments` | 3 / 127 |

Users, children and orders are clean, and **no child's name contains a non-ASCII character**, so the
damage is confined to catalogue copy. It is mechanically repairable
(`s.encode('latin-1').decode('utf-8')`), but since dish descriptions are being rewritten for the new
menu anyway, re-authoring is safer than repairing. Whichever route, **assert no `â€`, `Ã` or `Â`
sequence survives into the new database.**

**`Child.allergies` is empty on all 1,115 rows.** The field the DPDP work treats as the most
sensitive in the system was never populated in Bubble — so there is no allergy history to migrate,
and every allergy record in the new system starts blank. Worth telling the kitchen before cutover;
they may believe they have this data.

But **`Dish-In-Order.special-comments` is populated on 127 rows, 15 of which contain dietary or
allergy language** (an invented but representative example: *"no egg please"*). This is
health-adjacent free text about a named child, sitting in a field nobody classified as sensitive.
**It must be treated as regulated under non-negotiable #4** — never logged, never sent to Sentry,
excluded from school reports. It is currently in no such list.

**`class` and `section` are free text and are dirty.** 44 distinct `class` values for what should be
15 (`Nursery`, `LKG`, `UKG`, `I`–`XII`): the roster uses Roman numerals, but user-entered rows
contain `3`, `4th`, `3rd`, `Grade-2`, `2 nd`, `First`, `KG 1`, `Kg1`, `Nursary`, `Pre Nursery`, and
one row reading `2026`. **114 children (10%) sit outside the standard set.** `section` has 25
distinct values where 4 would do: A–D covers 1,064, then `Gems`, `Pearls`, `Pearl`, `Parls`,
`Jasmine`, `Lotus`, `Lilly`, `Star`, `Commerce`, `Arts`, `Medical`, `8a`, and several that are
plainly keyboard noise (`Ghg`, `Mmmmm`, `MM`, `HW`). **50 children (4.5%) sit outside A–G.**

The house-name sections (`Gems`, `Pearls`, `Jasmine`, `Lotus`) and stream names (`Commerce`,
`Arts`, `Medical`) are *real* — some schools genuinely organise that way. Normalise `class` to a
canonical enum with a hand-built alias map; keep `section` as free text with trimming and casing
only. Do not enum `section`.

**`school-code` is a clean roster key.** 1,010 of 1,115 children carry one, and all 1,010 are
**unique** — mostly 2–4 digit numbers, plus two of the form `Amity-<digits>`. It is present on
exactly the App-admin roster rows and absent on all 105 user-created ones. This is the natural join
key if the school ever supplies a fresh roster, and the only stable identifier the 746 unlinked
children have.

**Amity International School is effectively the whole business.** 1,058 of 1,115 children, 342 of
361 orders, 312 of 404 users. Paragon has 46 children and 13 orders; Gem has 7 children and 1
order; Demo School has none. Multi-school support is real but very thinly exercised — the migration
validation set is essentially one school, and any per-school logic is close to untested in
production data.

**`is_active` and `disabled` use Bubble's blank-for-false convention.** `Menu_Item.is_active` is
`yes` on 48 rows and **blank on 36** — blank means false, not unknown. Same for `User.disabled`
(396 `no`, 2 `yes`, 6 blank) and `School.isCollege` (blank on all 4). **Coerce blank to false
explicitly**; a nullable boolean here will produce 36 menu items that are neither active nor
inactive.

**Fields present in the schema but empty in the export**, i.e. things that do not exist to be
migrated: `Child.allergies`, `Child.Parent`, `Child.Slug`; `User.mobile`, `User.lname`,
`User.Stripe_id`, `User.current_client_secret`, `User.null` (an actual column named `null`);
`Order.actor_user`, `Order.staff_user`, `Order.menu`, `Order.payment_id` (the second of the two
duplicate payment-id fields — only `payment-id` is populated), `Order.order_ymd`;
`Dish-In-Order.order`, `.child`, `.school`, `.order_date`, `.unit_price`; `Menu_Item.available_days`;
`Dish.nutritional_info`; `School.menu`, `School.isCollege`; `School_Menu.end_date`. **Every `Slug`
column is empty on every table.**

`Order.payment-id` is well-formed where present: all 281 values match `pay_*` (Razorpay payment
ids), all distinct. No `order_*` ids and no signatures survive, so payments can be *referenced* but
not *re-verified* against Razorpay from this data alone.

**`(App admin)` and `(deleted thing)` appear as `Creator` values.** `Creator` is a user pointer that
Bubble renders as an email; where the creating user was deleted it renders `(deleted thing)`
(all 4 schools, both break rows, the kitchen, and most dishes/menu items). Do not attempt to resolve
`Creator` to a user account — treat these as system-created.

---

## 10. Answers, in one line each

| Question | Answer |
|---|---|
| Row counts | 2,970 across 10 tables; 404 users, 1,115 children, 361 orders, 911 order lines |
| Test/junk | Very little — 1 demo school, 1 placeholder child, 0 test emails. The real waste is 275 orphan lines and 78 draft orders |
| Mobile → E.164 | **0 of 404.** The column is empty for every user. Nothing to normalise, nothing to dedupe |
| Does that threaten `E03-16`? | No — it eliminates the alternative. Email is the only key, and it is sound |
| Emails | 404/404 present, 404 distinct, 404 valid, 0 duplicates, 0 fake. 12 undeliverable domains; ~15 people hold 2 accounts under different school-domain spellings |
| `Child.Parent` | **Empty on all 1,115 rows — did not survive.** Only 33% of children have any recoverable parent |
| `Order.all-dishes-in-order` | Survived as ids, 636 refs, 0 dangling, 0 truncation |
| Dish images | 85 URLs, **82 resolve, 3 permanently 403**. ~2.0 MB total. Mirror now |
| Break times | Export carries labels, not db values, and the labels are self-consistent. Migrate on label; `E16-15` shrinks to a 2-row assertion |
| Orders | 2025-06-14 → 2026-08-07; `Paid` 281 / `Draft` 78 / `Cancelled` 2. Drafts must not be migrated |
| Won't map | 78 drafts, 13 staff-recipient orders, 1 paid-without-payment-id, 1 cancelled-with-payment-id, and zero fulfilment history |
