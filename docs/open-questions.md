# Open questions

Grouped by who unblocks them. Items here block specific backlog tasks.

## Blocked on legal / regulatory advice

| Q | Blocks | Notes |
|---|---|---|
| **DPDP Act 2023** — what applies to GrayBag given it stores minors' names, class, section and **allergies (health data)** | All of `E20` | Verifiable parental consent, grievance officer, breach notification. The legacy app had none of this |
| **RBI Prepaid Payment Instrument rules** — does refund-only wallet credit fall outside PPI regulation? | `E06-10`, `E18-09`, `E18-10` | Refund credit is usually fine; **cash top-up** of stored value is regulated. Ask before building top-up |
| Data retention minimums for GST invoices | `E20-05` | Statutory; drives the purge policy |

## Blocked on Andy's accountant

| Q | Blocks | Notes |
|---|---|---|
| GSTIN for GrayBag | `E07-02` | Required on every invoice |
| SAC code — 996331 assumed for catering | `E07-02` | Needs confirming |
| Does the school's 10% revenue share attract 18% GST on the school's invoice to GrayBag? | `E07-09`, `E07-10` | Andy's position: any such tax comes out of the agreed 10%, not on top |

## Blocked on Andy

| Q | Blocks | Notes |
|---|---|---|
| Is the Excel `Price` GST-inclusive or exclusive? | `E04-04`, `E07-06` | Cart currently adds 5% on top, implying exclusive |
| Original dish images — can all be re-sourced? | `E04-13`, `E16-05` | Bubble CDN URLs die on migration |
| Bubble data export (row counts for users/children/orders/lines) | `E16-06` | Needed to size migration and spot junk data |
| **VAG Rounded Next licence** — does it permit app embedding and webfont use? | `E19-03`, `E00-16`, all of `E13` | A bad answer means a different typeface before any UI is built |
| Do any **legacy prepaid card / wallet balances** exist off-system? | `E00-18`, `E16-16` | If yes, they must migrate as opening ledger credits or users lose money at cutover |

## Blocked on the GrayBag team / schools

| Q | Blocks | Notes |
|---|---|---|
| **Subscription model — entire design** | All of `E18-01`…`E18-08` | Discussed once internally; needs a conversation with a school. For planning, assume parents subscribe |
| Who buys — parent in-app, or school in bulk billed through fees? | `E18-01` | Radically different builds |
| Auto-generated daily orders vs prepaid credit with daily selection? | `E18-02` | Leaning toward pre-planning a week/month, editable until each day's cutoff |
| Meal-pack composition and whether the customer picks dishes | `E18-03` | Likely they can pick |
| Unused meals — expire, roll over, refund? | `E18-04` | |
| Mid-period cancellation and pro-rata | `E18-05` | |
| Per-school / per-city subscription pricing | `E18-06` | Almost certainly needed once kitchens vary by city |

## Raised by the target data model (`docs/data-model.md`, Q01)

Full options and reasoning for each are in §14 of that document; this table is the index.
"Assumed" is what the ERD models so it stays coherent — **none of these are decided**.

### Needs Andy — product or business

| Q | Assumed for now | Blocks |
|---|---|---|
| **`DM-01`** Can one checkout cover two children and/or two days? This decides whether orders are `order_group` → `order` → `order_line` (three levels) or `order` → `order_line` with the recipient on the line. **Read this one first — it reshapes the order and money tables** | Three levels | `E02-04`, `E05-04`, `E06-05` |
| **`DM-02`** Invoice per payment or per fulfilment order | Per payment | `E07-01` |
| **`DM-08`** Will schools give us a class/section list at onboarding? Without one, "5A" / "5 A" / "V-A" break "mark all delivered per class" and the packing list | Admin-maintained `school_class` list, free text as fallback | `E09-03`, `E09-05`, `E10-01` |
| **`DM-09`** Is "resume my cart on a new phone" a launch requirement? | No — cart is client-only | `E05-04` |
| **`DM-10`** Pickup codes are 4 digits and therefore guessable. Confirm staff will check the name shown on screen, not just the code | Unique per school per day, name shown, lookup rate-limited | `E09-06` |
| **`DM-11`** Migrated users have no auth identity until they log in. Pre-create their Supabase auth rows at migration, or hold them in a staging schema? | Pre-create; ambiguous/duplicate phone matches parked for manual review | `E03-11`, `E16-01` |
| **`DM-16`** Can one school ever be served by more than one kitchen? | No — a plain foreign key | `E10-01` |
| **`DM-17`** Veg / non-veg / egg marking is not in the source Excel. Required at launch, and who fills it in for the existing ~50 dishes? | Column exists, nullable | `E04-01`, `E04-04` |
| **`DM-18`** The school's 10% is 10% of *what*? Gross including GST, or taxable value excluding it? Earned when the order is paid or when it is delivered? Reversed how on a refund? **M4 fixes the rate but never the base** | Taxable value, earned on delivery, reversed on refund with MDR per M5 | `E07-09`, `E07-10`, `E11-01` |

### Needs legal or the accountant

| Q | Assumed for now | Blocks |
|---|---|---|
| **`DM-12`** What makes parental consent "verifiable" under DPDP — a tick box by an OTP-authenticated adult, a payment-instrument check, or an ID check? And is a declared `is_minor` enough, or must age be verified? The three answers are three different products | Declared `is_minor`, no date of birth, `verification_method` recorded but unfilled. **Do not build the consent UI until this returns** | `E20-01`, `E20-02`, `E05-01` |
| **`DM-15`** Account deletion (store requirement + DPDP erasure) vs the statutory minimum retention for GST invoices | Soft delete then anonymise in place; allergy data deleted outright; invoice buyer snapshots retained. Never a hard delete | `E20-04`, `E20-05`, `E03-08` |
| **`DM-19`** GST rounding per line or per invoice — `E07-02` requires it be decided once and unit-tested | Both supported in the schema; `Q09` must pick | `E07-02` |

### Technical, flagged because reversal is expensive

| Q | Recommendation | Blocks |
|---|---|---|
| **`DM-03`** Ledger single-entry or double-entry | **Double-entry.** A missing counterpart becomes a constraint violation at write time instead of a discrepancy found a month later, and it is what makes the daily Razorpay reconciliation a single query | `E02-05`, `E06-07`, `E06-11` |
| **`DM-04`** Wallet balance derived from the ledger, or a maintained column | **Maintained**, with a nightly assertion against the ledger sum. Checkout is a hot path | `E06-09`, `E06-10` |
| **`DM-05`** **Modifies `D9`.** Partition the `order` table from day one, or index by city + kitchen now and partition at a documented trigger point? Partitioning forces the partition key into the primary key, which then propagates into every table that references `order` | **Index now.** Update D9's wording to "reporting is *scoped* by city + kitchen", which is the property that matters. Needs Andy's sign-off because it edits a locked decision | `E02-11`, `E11-07` |
| **`DM-06`** Is a dish owned by a kitchen, or is there a platform catalogue kitchens inherit? | **Kitchen-owned.** Revisit if a new city is meant to inherit a standard GrayBag menu | `E04-01` |
| **`DM-07`** Config as typed columns on three tables, or a generic key/value table | **Typed columns** — real types, real constraints, and the inheritance UI reads straight off the three rows | `E02-10`, `E10-06` |
| **`DM-13`** Allergen seed list and severity vocabulary | Reconcile against the **distinct values actually in the Excel**, which `Q08` produces. An allergen present in the data but missing from the table is an unwarned allergy | `E04-01`, `E05-05` |

## Parked (deliberately, until real data exists)

| Q | Notes |
|---|---|
| Default delivery mode — classroom bulk vs counter pickup | Depends on whether a school orders school-wide or a handful per class. Both mechanisms are built |
| Per-dish daily capacity limits | Table designed (`E02-12`), unused until a kitchen asks |
| Play App Signing upload key ownership | Mandatory since Aug 2021 so almost certainly enabled; Google resets the upload key on request if Bubble holds it. Low risk |
