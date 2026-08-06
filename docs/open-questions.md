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

## Raised by the initial DDL (`supabase/migrations/0001_initial_schema.sql`, Q02)

Three things the data model left implicit that had to be resolved one way or the other to
write real DDL. Each is written the way the schema now behaves, with the alternative and a
recommendation. **None of these are decided.**

### Needs Andy

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`DM-20`** | **A consequence of `DM-14`, not a new question — but it has teeth.** §9.2 says every setting on `platform_config` is `NOT NULL`. `price_is_tax_inclusive` is the one setting whose value is genuinely unknown, because nobody has said whether the Excel `Price` includes GST. `NOT NULL` would force a default, and a default here is a guess about money that silently propagates into every invoice ever issued. **Options:** (a) leave the column nullable and unset, so tax calculation *refuses to run* until it is answered — loud, and impossible to get silently wrong; (b) `NOT NULL DEFAULT false` (price is exclusive), matching what the current cart does when it adds 5% on top — quiet, and wrong for every dish if the assumption is backwards. **Recommended: (a)**, which is what is written. | Nullable, seeded `NULL` | `E04-04`, `E07-06`, `Q09` |
| **`DM-21`** | Can a discount exist at the **checkout** level only, or must every discount land on a member order? The `order_group` totals invariant asserts that the group's subtotal, tax **and discount** equal the sum over its member orders. That means a future promo code has to be distributed across the orders in the cart rather than held only at the group. **Options:** (a) require distribution — the invoice lines are built from the orders, so a discount held only at the group would appear on no line, which is not a valid tax document; (b) drop `discount` from the assertion and allow a group-only discount, which reopens exactly that problem at invoicing time. **Recommended: (a)**, which is what is written. Nothing in v1 issues a discount, so this only bites when promo codes are built. | Distribution required | `E05-04`, `E07-01`, `E18` |
| **`DM-22`** | `reason_code` is seeded with the eight codes the model names, but the model does not say which are **customer-visible** or which **require a note**. The schema seeds all cancellation and refund reasons as customer-visible, `goodwill` and `migration_opening_balance` as requiring a note, and `migration_opening_balance` as internal. This is data, not schema — admin can change any of it without a migration — but it decides what wording a parent sees when their child's order is cancelled. **Needs Andy to eyeball once**, not to decide architecture. | As described | `E06-08`, `E09-08` |

## Raised by the authorization model (`docs/authorization-model.md`, Q03)

Six things the data model's §13.7 left as a one-line summary and that had to be resolved to
write real RLS policies. Full options and reasoning for each are in §13 of that document.
**None of these are decided.** Where a choice was needed to keep the document coherent, the
recommended option is what is written, and it is labelled as such.

### Needs Andy — product or commercial

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`AZ-04`** | **What does a school see of its own payout?** A `school`-scoped `payouts.view` grant opens the `payout` row, which carries `mdr_deduction_paise` (M5 — refund MDR comes out of the school's share), `adjustment_paise` (where an admin's manual edit lands) and `notes`. **Options:** (a) schools see `payout` rows at status `confirmed`/`paid` only, never `draft`; `payout_line` stays platform-only; `notes` is school-visible by rule and the admin UI says so; (b) schools see only `share_paise` / `net_payable_paise` via `school_report` and never the `payout` table at all. This is a relationship question — showing the MDR deduction is transparent and supports M5, hiding the adjustment invites disputes. **Recommended: (a)**, which is what is written. | (a) | `E07-10`, `E11-01` |
| **`AZ-05`** | **Can a guardian see the other guardians on their child?** Written as yes: a guardian sees the recipient's `guardian_link` rows (`user_id`, `relationship`, `can_order`, `can_manage`, `is_primary`) but **not** the other guardian's name, phone or email. For: a parent must be able to see and revoke who else can order for their child. Against: it reveals that a second account exists, which matters in a separated-parents situation. **Recommended: yes, with the display name resolved server-side to a first name only.** The failure mode here is a family situation, not a bug. | Visible | `E03`, `E05-01` |
| **`AZ-06`** | **Does a customer see `order_event`?** Written as **no** — `note` and `metadata` carry staff and provider text, and `reason_code.is_customer_visible` exists (`DM-22`) because not every reason is for the parent. The customer timeline is built from `"order"`'s timestamps plus `cancel_reason_code` filtered to customer-visible codes. **Alternative:** a `customer_order_event` view exposing `to_status`, `created_at` and the customer-visible reason only — nicer UX ("cancelled at 9:14am because the dish was unavailable"), one view and one policy, and it can land in E05 rather than here. **Recommended: no direct table access; build the view in E05 if the timeline is wanted.** | No access | `E05-10`, `E09-08` |

### Technical, flagged because reversal is expensive

| Q | Question | Recommendation | Blocks |
|---|---|---|---|
| **`AZ-01`** | **Does an Edge Function act as the caller, or as `service_role`?** A4 says writes go through Edge Functions but not which database identity they use, and the answer decides whether RLS is *authorization* or merely a read filter — `service_role` holds `BYPASSRLS`, so no policy constrains it. **Options:** (a) everything as `service_role`, simplest, but every write is authorized solely by function code with no second line of defence; (b) three classes — customer-owned and back-office-catalogue writes run as the **caller** so RLS `WITH CHECK` is the authorization, while money, order state, access control and evidence run as `service_role` because those rows carry values that must be *computed*; (c) everything as the caller, not viable — an `INSERT` policy on `"order"` cannot stop a customer supplying `total_paise = 0`, because RLS filters rows and cannot constrain a column. | **(b)**, which is what is written. It maximises the surface where a policy is the real gate and reduces the `service_role` surface to a short, reviewable list. Cost: the `api/` module must know which class each call is in | `E01`, `E02-08`, `E05`, `E06` |
| **`AZ-02`** | **`orders.view_pii` cannot be enforced by RLS.** RLS filters rows, not columns, so anyone who can see an `"order"` row sees `recipient_name_snapshot`, `class_label_snapshot` and `section_label_snapshot`. **Options:** (a) accept it for v1 and enforce the split in the `api/` layer — safe *only* while every template holding `orders.view` also holds `orders.view_pii`, which is true today; (b) move the tier-P snapshot columns to a 1:1 `order_recipient_snapshot` table with its own policy, the only option that makes the promise enforceable in the database, at the cost of one join on the packing list and an edit to §7.3 of the data model; (c) column-level `GRANT SELECT (cols)` — does not work, because a customer and a kitchen operator are the same Postgres role. | **(a) now, (b) before any grant of `orders.view` without `orders.view_pii` is ever issued** — i.e. before E20-09's analyst role. Add a test that fails the moment such a grant appears, so the deadline enforces itself | `E02-08`, `E20-09`, `E18-14` |
| **`AZ-03`** | **`anon` and the public privacy policy.** App stores require a publicly reachable privacy policy URL, and E12 may want a public sample menu — both argue for one `anon` read policy. **Options:** (a) `anon` keeps **exactly zero** policies; the website renders policy text from its own static build or from an Edge Function; (b) one narrow `anon` `SELECT` on published `policy_version` rows. | **(a)**, which is what is written. "No policy names `anon`" is a one-line CI assertion and is worth more than the convenience; (b) converts a boolean invariant into a list of approved exceptions, and lists grow. Consequence to accept: no client-side "browse the menu before you sign up" — if that becomes a marketing requirement it is a public Edge Function returning a curated sample, not a policy | `E12`, `E20-03` |

## Raised by the RLS policies (`supabase/migrations/0002_rls_policies.sql`, Q04)

One genuine conflict inside `docs/authorization-model.md` that only shows up when the SQL is
written. Everything else Q04 had to resolve was a gap rather than a decision, and each of
those is marked `-- ADDITION` at its site in the migration and listed in its header.
**This is not decided.** The migration is written the conservative way and labelled.

### Technical, low stakes but currently incoherent

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`AZ-07`** | **Who may progress a `data_subject_request`?** §7.9 gives `dsr_update_admin` a policy requiring **`consent.view`**. §6.1 protects `status`, `due_at`, `assigned_to_user_id`, `completed_at` and `resolution_note` behind **`consent.view` AND `users.manage`**. The two disagree, so a grantee holding only `consent.view` passes the policy and then finds every meaningful column frozen — the update succeeds and changes nothing, silently. It does not bite today because the `platform_admin` template holds both, and no narrower grant exists. **Options:** (a) drop `users.manage` from the guard, so `consent.view` alone means "may handle DSRs end to end" — simplest, and matches what the policy already says; (b) tighten the policy to require both, so the two agree in the other direction and a read-only compliance grant is possible; (c) leave it, and accept a silent no-op for a grant nobody has issued. **Recommended: (b)** — a `consent.view`-only grant is exactly the shape E20's evidence-to-a-regulator work will want, and it should be readable without being able to close requests. Written as **(c)** for now, because changing either half is a one-line edit that should be made deliberately with E20-04 in front of you, not in a migration whose subject is RLS. | (c) — the mismatch stands, and the no-op is silent | `E20-04`, `E20-07` |

## Raised by the design tokens and motion system (`docs/design-tokens.md`, `docs/motion-system.md`, Q05)

The design package supplies five hexes, a font family, a pattern and nine mock screens. It
supplies **no** neutral ramp, no tonal steps, no semantic roles, no type scale, no spacing
scale and no contrast analysis. Everything below is a choice that had to be made to write a
token file at all. **None of these are decided.** Where a choice was needed to keep the
documents coherent, the recommended option is what is written, and it is labelled as such.

### Needs Andy — brand

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`DS-01`** | **The brand green fails WCAG as a button fill, and this changes what every button in the product looks like.** White on `#00af52` is **2.90:1** — below AA for normal text (4.5:1), below AA for large text (3:1), and below the 3:1 a control boundary needs. Every primary button, every price and every field label in `06_App UI` uses exactly that pair. Mock 02 additionally puts a `#145f48` button on a `#00af52` field at **2.63:1**. **Options:** (a) **the 500 rule** — `#00af52` stays the identity colour in the logo, pattern and brand fields, and *functional* green moves one or two steps darker (`primary-700 #007e3b`, 5.19:1, for fills and text; `primary-600 #009646`, 3.85:1, for boundaries). The mocks stay recognisable and become legible; (b) keep `#00af52` as the fill and put **dark ink on it** — `neutral-900` on `#00af52` is ≈6.2:1 and passes, but a dark-on-green button is a different product's visual language and contradicts every mock and the approved logo pairings in §2.6; (c) accept the failure — not available: it is an accessibility defect, and `E13-10`/`E12-08` gate on Lighthouse and axe, so it would fail CI rather than ship. **Recommended: (a)**, which is what is written. **This is a validation, not an engineering call — it is the one thing in Q05 that genuinely needs Andy's eye.** | (a) — the 500 rule, `docs/design-tokens.md` §2.1 | `E13-01`, `E13-03`, `E13-14`, all of `E13` |

### Needs legal

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`DS-04`** | **Must the FSSAI veg / non-veg mark be displayed at the point of ordering?** `DM-17` already asks who fills the veg/non-veg column in for the existing ~50 dishes. This is the adjacent *display* question: whether an online food operator must show the statutory green-circle / brown-triangle mark on a dish listing, and in the prescribed colours and geometry. If yes, the mark is a regulated symbol and is **never** re-tinted to `primary-500` or `lime-500` — which is what a designer will reach for, because it is nearly the brand green. The tokens reserve the statutory colours and §2.10 forbids brand-tinting it. **Needs a legal answer, not a design one.** | Mark reserved, never brand-tinted | `E04-01`, `E04-04`, `E13-03`, `E20` |

### Technical, flagged because reversal is expensive

| Q | Question | Recommendation | Blocks |
|---|---|---|---|
| **`DS-02`** | **If the VAG Rounded Next licence (`E19-03`, `owner:andy`) comes back "no", which typeface?** The package ships ten weights; the licence has never been checked, and a bad answer changes every screen. Two halves: (i) **use three weights, not ten** — it narrows the licence question to "may we embed three weights in an app and serve them as webfonts", which is a far easier thing to buy or be refused, and it keeps the mobile bundle small, which is the real constraint (P11); (ii) **name the substitute now rather than in a panic.** | **Nunito (SIL OFL)** — the closest freely-licensed match to VAG Rounded's rounded terminals on an upright skeleton, full weight range, good hinting at small sizes, and no cost or negotiation. Rejected: Quicksand (too geometric, thin at body sizes), Comfortaa (display-only), Baloo 2 (heavier, Devanagari-first — irrelevant under P10), Poppins (not rounded). **Decide the substitute before `E13-03`, not after `E19-03` returns**, so a refusal costs a token change rather than a redesign | `E13-01`, `E13-02`, `E13-03`, `E19-03` |
| **`DS-03`** | **Dark mode in v1?** Not in the mocks, not in the package, and it roughly doubles the contrast surface to design and test. **Options:** (a) light only in v1, but every colour named by *role* (§2.9) so that adding dark mode later is a second mapping file rather than a rewrite; (b) build both now. | **(a)**, which is what is written. The cost of (a) is paid once, in discipline, and it is discipline we want anyway — a component that reaches past `bg.surface` into `neutral-0` is a bug under either option. Consequence to accept: no dark mode at launch, and the "no dark-mode transition" row in §12 of the motion system holds until it exists | `E13-01`, `E13-03`, `E14` |
| **`DS-05`** | **`00_Graybag_Brand Guidelines.pdf` has never been read** — 21.8 MB, over the file-read limit, and no PDF rasteriser was runnable in the sandbox the tokens were written in. If it specifies a type scale, tints, tonal steps or usage rules, `docs/design-tokens.md` must be reconciled against it and **the brand document wins on anything about the brand**. This is not a decision; it is an unverified assumption sitting under the whole token file. `E13-15` | Reconcile before `E13-03` | `E13-01`, `E13-15` |

`E19-02` (the mid-range Android performance spike) is not listed here because it is already a
backlog task, but it has one effect worth stating: **`M05`, the dish-card → dish-detail shared
element, is provisional until that spike runs.** It is the only pattern in the catalogue that
could fail the frame budget. If it cannot hold 60fps on the target profile it is deleted, and
dish detail becomes a plain `M07` sheet.

## Raised by the order lifecycle (`docs/order-lifecycle.md`, Q06)

Six things that had to be resolved to write a complete state machine, and that the data model
and the DDL both left open. **None of these are decided.** Where a choice was needed to keep
the document coherent, the recommended option is what is written, and it is labelled as such.
`[OL-02]` and `[OL-05]` block `E06-06` outright — it cannot be built correctly without them.

### Needs Andy — product

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`OL-02`** | **The cutoff passes while the payment is in flight.** A parent taps Pay at 23:58 for tomorrow's lunch, the UPI collect request sits pending, and the capture lands at 00:03 — three minutes after the kitchen's cutoff. The money is real and the order is late. **Options:** (a) **a grace window** — a capture is honoured if the payment was *initiated* before cutoff and captures within `payment_in_flight_grace_minutes` (say 15); past that it is captured, auto-cancelled and refunded. The kitchen absorbs a handful of late orders it did not plan for; (b) **hard cutoff** — any capture after `cutoff_at` is refunded automatically with `cutoff_missed`, no exceptions. Clean rule, and it will produce angry parents who did everything right and were charged and refunded because their bank was slow; (c) **hold the order** for the *next* available service date and tell the customer. Novel, and it silently changes what someone bought. **Recommended: (a)**, with the grace minutes as config so a kitchen that cannot absorb late orders sets it to 0 and gets (b). This is a kitchen-operations question, not an engineering one — the right number is however long the kitchen can still add a sandwich to the run. | Grace window assumed; the value is not chosen | `E05-07`, `E06-06`, test 17 |
| **`OL-03`** | **How long is a `pending_payment` checkout held before it is swept?** Too short and a slow UPI collect gets cancelled under a customer who is about to pay — which manufactures the `§10.5` late-capture path. Too long and the cart's capacity decrement and wallet hold sit outstanding, and the customer's order list is full of zombies. **Options:** 15 / 30 / 60 minutes. **Recommended: 30 minutes**, as config (`pending_payment_ttl_minutes`), *and* the sweeper must reconcile against Razorpay before cancelling rather than trusting the clock. The floor is set by how long Razorpay lets a UPI collect stay pending, which is `E19-01`'s to answer. | 30 minutes assumed | `E05-14`, `E06-06`, `E06-17` |
| **`OL-04`** | **Does a partial or post-delivery refund change `order.status`?** `order_status` has `refunded` but no `partially_refunded`, while both `order_group_status` and `order_line_status` have one — three enums describing the same money at three levels, disagreeing. **Options:** (a) **status is fulfilment, money is money** — a partial refund never moves `order.status`, and a full refund on a *delivered* order leaves it `delivered`. `refunded` is reachable only from `cancelled`. The kitchen's and the school's views stay truthful about what was eaten; the customer's "refunded" badge is computed from `refunded_total_paise`; (b) add `partially_refunded` to `order_status` and allow `delivered → refunded`. Reads more naturally in the order list and makes every "was this delivered" query — the packing list, the school report, the revenue share under `[DM-18]`, which earns on delivery — go looking for a timestamp instead of a status. **Recommended: (a)**, which is what is written. Cheap to reverse *if* it is reversed before `E11` builds reports on it; expensive after. | (a) | `E06-05`, `E06-08`, `E11-01` |
| **`OL-06`** | **The price changed between building the cart and paying.** The client sends `expected_total_paise`; the server recomputes and they differ. **Options:** (a) **abort with `price_changed`** and make the customer re-confirm the new total. One extra tap on a rare event, and the customer is never charged an amount they were not shown; (b) charge the server's price silently — it is the correct price, after all. It is also a different number from the one on the screen when they tapped Pay, which is the kind of thing that produces a chargeback and, at scale, a regulator. **Recommended: (a)**, which is what is written and is `L7`. Listed here rather than decided because it is a UX cost on a real path (a kitchen editing prices at 8pm), and Andy may prefer to forbid same-day price edits instead. | (a) | `E05-04`, `E05-13`, `E10-06` |

### Technical, flagged because reversal is expensive

| Q | Question | Recommendation | Blocks |
|---|---|---|---|
| **`OL-01`** | **Auto-capture or manual capture at Razorpay?** Auto-capture (`payment_capture: 1` on the order) makes `authorized` a state we effectively never see: the provider captures on authorization and one `payment.captured` arrives. Manual capture gives a window in which to validate before taking the money — re-check the cutoff, re-check availability — and then capture explicitly. It also gives a second failure mode nobody wants: an authorization that expires uncaptured, where the customer's bank shows a hold that never became a charge. | **Auto-capture.** The validation manual capture would buy us is already done *before* the Razorpay order is created (§8.2), the amount is fixed at that point, and there is nothing to decide at capture time. An uncaptured authorization on a Rs 200 lunch is a support cost with no upside. Consequence: `[OL-02]` cannot be solved by "just don't capture" — the money is already taken when the cutoff question arises. **[verify in E19-01]** that auto-capture behaves as documented for UPI intent specifically | `E06-02`, `E06-03` |
| **`OL-05`** | **A genuine duplicate capture cannot be recorded.** `uq_payment_one_capture_per_group` — `unique (order_group_id) where status = 'captured'` — is `D16`'s guarantee that two payments never settle one checkout, and it is right. Its unwritten consequence: when a customer really is charged twice (attempt 1 pending on UPI, they pay by card, attempt 1 then succeeds), the second capture **cannot be written to the database at all**, so the one correct response — record it, then refund it — is the one thing the schema forbids. **Options:** (a) add `duplicate_of_payment_id uuid` to `payment` and change the index to `where status = 'captured' and duplicate_of_payment_id is null`. The invariant becomes "one *primary* capture per group", which is what it always meant, and the true record of the double charge exists so it can be refunded and reconciled; (b) park the duplicate on a synthetic `order_group` — keeps the index untouched and puts a fictional checkout in the order history; (c) prevent it upstream by refusing a new attempt while an earlier one is non-terminal. Necessary and worth doing, but it narrows the race rather than closing it, and it cannot help at all once the money has left the customer's account. | **(a), plus (c) as a mitigation.** The general rule this is an instance of: *a uniqueness constraint that protects an internal invariant must not also prevent recording something the outside world has already done.* Razorpay is the system of record for whether money moved; our schema has to be able to write down whatever it says. Needs a migration (`0003`) before `E06-06` can be built | `E06-06`, `E06-18`, `E06-20` |

## Raised by the payments design (`docs/payments-design.md`, Q07)

Seven things that had to be resolved to write a complete Razorpay integration design, and that
the data model, the DDL and the order lifecycle all left open. **None of these are decided.**
Where a choice was needed to keep the document coherent, the recommended option is what is
written, and it is labelled as such. `[PAY-05]` blocks `E06-07` outright — the ledger cannot be
built until it is answered, because `ledger_transaction.reason_code` currently has no legal
value for any money movement the system performs.

### Needs Andy — product or commercial

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`PAY-03`** | **Refund speed — `normal` or `optimum`?** Razorpay offers a normal refund (settled on the usual cycle, no extra charge, T+5–7 working days to the customer's bank) and an instant option at a per-refund fee. **Options:** (a) `normal`, always — `M7` already provides the instant path and it is the *default*: the wallet is instant and free, so paying a premium to speed up the non-default path is buying the wrong thing, and under `M5` that premium would land on the school's share for a choice the school did not make; (b) `optimum` for specific reason codes — a duplicate charge, say, where goodwill matters most and the customer never chose to be charged twice; (c) `optimum` always, and absorb the fee. **Recommended: (a)**, which is what is written. Listed because it is a cost-versus-experience trade, and (b) is a defensible answer. Exact speed names, availability by method and cost are `[verify in E19-01]`. | (a) | `E06-08` |
| **`PAY-04`** | **`M5` has no share to deduct from on the most common refund.** M5 says the Razorpay MDR lost on a refund comes out of the school's 10%. Under `[DM-18]`'s assumed reading — the share is *earned on delivery* — an order cancelled before delivery earned the school nothing, so there is no share for the MDR to come out of. The deduction then either silently reduces an unrelated order's share in the same payout period or falls to zero, and neither is what M5 says. **Options:** (a) the platform **absorbs** the MDR on refunds of undelivered orders, and M5 applies only where a share was actually earned (post-delivery goodwill refunds) — honest, visible as a platform cost on the payout report, and it costs GrayBag roughly 2% of the refunded value on cancellations; (b) **net it against the school's next period** regardless of which order earned what — which is what a naive implementation does by accident, and it produces a payout line the school cannot reconcile to any order; (c) change `[DM-18]` so the share is **earned on payment** and reversed on refund, so there is always a share to deduct from — at the cost of paying schools for meals nobody ate until the reversal lands. **Recommended: (a)**. This is a commercial term, not an engineering call, and it must be answered together with `[DM-18]`, which is also open. Needs Andy and probably the accountant. | (a) | `E06-12`, `E07-11`, `E11-01` |
| **`PAY-07`** | **Dashboard-initiated refunds bypass the ledger entirely.** Anyone with Razorpay dashboard access can refund a payment without touching our database: the money moves, our ledger says it did not, the school's revenue share is overstated, and the customer's order still reads `paid`. It surfaces as an unmatchable `refund.created` webhook and then as break class B6 in the next day's reconciliation — a day late. **Options:** (a) **forbid by policy, detect by design** — refunds go through the admin UI, which is the only path that writes a `refund` row, a ledger posting and a credit note; the dashboard is break-glass only; and the webhook handler records an unmatched provider refund as a **draft** `refund` for an admin to classify rather than guessing a `reason_code`; (b) fully automatic ingestion with a synthetic reason code, which quietly legitimises a path that skips the credit note; (c) policy alone, which is not a control. **Recommended: (a)**, which is what is written. Needs Andy's agreement because he is the dashboard holder, and it needs a seeded `provider_initiated` reason code. | (a) | `E06-08`, `E06-11` |

### Needs the accountant

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`PAY-06`** | **Do credit notes share the invoice number series?** `invoice_fy_sequence_unique (financial_year, sequence_no)` spans **both** document types, so a credit note allocated from `invoice_sequence` consumes an invoice number and the two documents interleave in one series. Indian GST requires a consecutive serial number unique within the financial year for both invoices and credit notes, and a single shared series satisfies the letter of that; a **separate series per document type** is the more common practice and is what an accountant or an auditor will expect to see. **Options:** (a) one shared series, which is what the schema does today — nothing to build; (b) a second sequence row keyed by document type, plus a rendering prefix (`GB/2026-27/…` vs `GBC/2026-27/…`) — a small migration now, a much larger one after real credit notes exist. **Recommended: ask before `E07-07` is built**, because (b) is cheap now and expensive later. Rides with `E00-10` / `E00-11`. | (a) | `E07-07`, `E07-02` |

### Technical, flagged because reversal is expensive

| Q | Question | Recommendation | Blocks |
|---|---|---|---|
| **`PAY-01`** | **How is Razorpay Standard Checkout hosted inside the app?** **Options:** (a) the official **React Native SDK** (`react-native-razorpay`), a thin native module over Razorpay's Android and iOS checkout SDKs — the only option that gets native UPI intent app-switch, the saved-card flow and the UPI app chooser for free, which is the entire point of `E06-02`; (b) the **web checkout script in a WebView** — no native module, so it runs in Expo Go, but UPI intent from inside a WebView needs us to intercept the navigation and fire the `upi://` intent ourselves and the return is not guaranteed; (c) a **bespoke flow on the S2S/custom checkout APIs**, which puts our code next to card data and changes our PCI posture. | **(a)**, which is what is written. **Its cost must be accepted explicitly: the app can no longer run in Expo Go** — every developer and every E2E run needs an EAS development build. That is already the plan (`A1`), but `E19-01` says "a bare Expo app", and a bare *managed* Expo app cannot host this SDK. **The spike must be run on a development build or it proves the wrong thing** | `E19-01`, `E06-02`, `E14` |
| **`PAY-02`** | **How does a refund split across a wallet-funded and a source-funded portion?** An order paid ₹50 from wallet and ₹160 from a card has only ₹160 at the provider, so a ₹210 "refund to source" is not partially possible — it is impossible. `refund.destination` is a single enum on a single row, so one logical refund may need **two rows**. **Options:** (a) the wallet-funded portion goes back to the **wallet** and the remainder to the requested destination, capped at what source actually captured — two rows sharing a `correlation_id`; (b) proportional across both, defensible in accounting and impossible to explain to a parent ("you paid ₹50 from your balance and got ₹38 of it back"); (c) refuse source refunds on part-wallet orders entirely — simple, and it leaves a real support case with no answer. | **(a)**, which is what is written. The group-level over-refund guard (`E06-21`) enforces the cap independently, so an arithmetic bug fails at write time rather than sending money | `E06-08`, `E06-09` |
| **`PAY-05`** | **The ledger cannot post anything today, for two independent reasons.** (i) `ledger_account_type` is `wallet, revenue, receivable, payable, tax_payable, provider_clearing, provider_fees, suspense` — there is **no bank or cash account**, so a settlement has nowhere to land: `provider:razorpay:clearing` is debited on every capture and never credited, grows without bound, and the "does our clearing account equal what Razorpay holds" assertion that `[DM-03]` chose double-entry *for* can never pass. `docs/data-model.md` §8.4 already assumes the account exists ("payout … credits a bank clearing account"), so payouts are blocked on the same gap. (ii) `ledger_transaction.reason_code` is `not null references reason_code(code)`, and **not one of the eight seeded codes names a money movement** — no sale, no MDR fee, no wallet hold, no settlement, no revenue-share accrual. `reason_category` already anticipates the split (`cancellation` / `refund` are the *why* vocabulary, `ledger` is the *what movement* vocabulary); only the second is missing, and `migration_opening_balance` is its sole member. | **Fix both in `0003`** — add `bank` to `ledger_account_type`, seed `platform:bank`, and seed the eleven `category = 'ledger'` codes in §10 of `docs/payments-design.md`. `E06-23` and `E06-22`. Note that `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, and a Supabase migration file is one transaction — so the value lands in `0003` and its first use in `0004`. Flagged here rather than treated as a pure gap because (i) is a schema change that propagates into payouts and reporting | **`E06-07`**, `E06-11`, `E07-10`, `E11-01` |

## Parked (deliberately, until real data exists)

| Q | Notes |
|---|---|
| Default delivery mode — classroom bulk vs counter pickup | Depends on whether a school orders school-wide or a handful per class. Both mechanisms are built |
| Per-dish daily capacity limits | Table designed (`E02-12`), unused until a kitchen asks |
| Play App Signing upload key ownership | Mandatory since Aug 2021 so almost certainly enabled; Google resets the upload key on request if Bubble holds it. Low risk |
