# Open questions

Grouped by who unblocks them. Items here block specific backlog tasks.

## Blocked on an architecture decision — raised 2026-08-09

### ~~`[AUTH-01]` How does a signed-out user read the menu?~~ — **RESOLVED 2026-08-09**

> **Andy's ruling: open a read path for `anon` (option (c)) rather than build a `service_role`
> Edge Function.** Shipped in migration `0010` as EXECUTE on two `SECURITY DEFINER` functions
> rather than as grants on tables — see decision `U5` for why, and for the four security
> assertions that stayed intact as a result. The text below is kept for the reasoning only.
>
> **One thing needs Andy's eye:** the implementation is not the literal wording of option (c).
> Literal table grants remain available and are a small migration if he wants them.

**Blocks:** the `api/` module, `E04-10`'s menu fetch, `E14-08`, and any device build that shows
a dish. **Found by** pointing the staging EAS environment at the real project and getting
`42501 permission denied for table dish` back.

Two rules that are each correct on their own now contradict each other:

* **`AR7`** makes signup-to-first-order a primary v1 goal and says in as many words that the app
  must be browsable before anyone identifies themselves. The navigator has no authenticated
  graph; `RootNavigator.test.tsx` asserts every tab mounts with no session.
* **The privilege baseline** (`0002`, `0005`, `PB1`, `[AZ-03]`) gives `anon` **nothing at all**
  in `public`, deliberately, and the authorization suite fails if that is ever relaxed.

So there is currently **no path by which a signed-out user can read a dish.** The `menu-version`
Edge Function does not solve it either: it uses the anon key plus the caller's `authorization`
header, so for a signed-out caller it hits the same wall.

This is not a bug in either rule. It is a decision nobody has made yet, and it must be made
before the `api/` module is written, because the answer determines what that module *is*.

| Option | What it means | Cost |
|---|---|---|
| **(a) A public read Edge Function using `service_role`**, scoped to menu data only | The function is the boundary: it takes a school id, returns the menu, and holds the only elevated key. `anon` keeps nothing | One more function to review carefully. A bug in it is a data leak, so it must never accept a table name or a filter from the caller |
| **(b) Supabase anonymous sign-in** — every app open creates a real (anonymous) session | `authenticated` already has the grants, so nothing about the baseline changes | Creates an `auth.users` row per install. Interacts with `E03`'s account linking and with DPDP data minimisation — an anonymous row is still a row |
| **(c) Grant `anon` SELECT on the menu tables only** | Simplest to write | Reverses `[AZ-03]` and weakens the one assertion that has never been allowed to weaken. The legacy Bubble app exposed every order and child record publicly, and that suite exists so it cannot recur |

**Recommendation: (a).** It keeps `anon` at zero privileges, which is the property the
authorization suite is protecting and the one the legacy app got catastrophically wrong. It also
matches the shape already in the codebase — non-negotiable #1 routes every backend call through
`api/`, reads may use the Supabase client, and writes go through Edge Functions; a menu read for
an unidentified user is simply a read the client is not entitled to make directly. It needs no
new decisions about identity, which (b) does.

**Not guessed and not built.** Andy decides.

## Blocked on legal / regulatory advice

| Q | Blocks | Notes |
|---|---|---|
| **DPDP Act 2023** — what applies to GrayBag given it stores minors' names, class, section and **allergies (health data)** | All of `E20` | Verifiable parental consent, grievance officer, breach notification. The legacy app had none of this |
| **RBI Prepaid Payment Instrument rules** — does refund-only wallet credit fall outside PPI regulation? | `E06-10`, `E18-09`, `E18-10` | Refund credit is usually fine; **cash top-up** of stored value is regulated. Ask before building top-up |
| Data retention minimums for GST invoices | `E20-05` | Statutory; drives the purge policy |

## Blocked on Andy's accountant

| Q | Blocks | Notes |
|---|---|---|
| GSTIN for GrayBag | `E07-02` | Required on every invoice. **Its first two digits are the state code**, which is what decides CGST+SGST vs IGST — `[GST-02]` |
| SAC code — 996331 assumed for catering | `E07-02` | Needs confirming |
| Does the school's 10% revenue share attract 18% GST on the school's invoice to GrayBag? | `E07-09`, `E07-10` | Andy's position: any such tax comes out of the agreed 10%, not on top |
| Five further GST questions raised by `docs/gst-invoicing.md` | `E07-02`, `E07-06`, `E18-01` | `[GST-01]`…`[GST-05]` below. §10 of that document is a hand-over checklist written to be passed to the accountant as-is, alongside `E00-10` |

## Blocked on Andy

| Q | Blocks | Notes |
|---|---|---|
| ~~Is the Excel `Price` GST-inclusive or exclusive?~~ **ANSWERED 2026-08-07: EXCLUSIVE** | ~~`E04-04`, `E07-06`~~ | Closed. 5% is added on top at checkout, as the cart already does. See `SC2` in `docs/decisions.md`; closes `[DM-14]`, `[DM-20]` and takes option (a) of `[GST-01]`. `E00-12` closed |
| ~~Do school staff accounts that use an email address as a username have real, deliverable mailboxes?~~ **RAISED AND ANSWERED 2026-08-07: YES — they are real, accessible inboxes** | ~~`E03-14`, `E03-06`~~ | Closed, no change to scope. Email OTP (`E03-14`) reaches those accounts, so `E03-06` (email + password) **stays back-office-only** and does not widen. Recorded because the alternative was expensive: if those usernames had been unroutable, the only passwordless factor those staff have would not have reached them, and `E03-06` would have had to grow to cover real school users — a scope change to auth discovered during cutover rather than now |
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
| **`DM-20`** — **ANSWERED 2026-08-07: prices are EXCLUSIVE, so `price_is_tax_inclusive = false`. See `SC2`. The text below is kept for the reasoning only; the question is closed.** | **A consequence of `DM-14`, not a new question — but it has teeth.** §9.2 says every setting on `platform_config` is `NOT NULL`. `price_is_tax_inclusive` is the one setting whose value is genuinely unknown, because nobody has said whether the Excel `Price` includes GST. `NOT NULL` would force a default, and a default here is a guess about money that silently propagates into every invoice ever issued. **Options:** (a) leave the column nullable and unset, so tax calculation *refuses to run* until it is answered — loud, and impossible to get silently wrong; (b) `NOT NULL DEFAULT false` (price is exclusive), matching what the current cart does when it adds 5% on top — quiet, and wrong for every dish if the assumption is backwards. **Recommended: (a)**, which is what is written. | Nullable, seeded `NULL` | `E04-04`, `E07-06`, `Q09` |
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

The design package supplies five hexes, a font family, a pattern, nine mock screens and — as
`E13-15` established by finally reading the brand guidelines — a four-level **type hierarchy**
and a set of per-colour UI usage rules. It supplies **no** neutral ramp, no tonal steps, no
semantic roles, no spacing scale, no radius numbers and no contrast analysis. Everything below
is a choice that had to be made to write a token file at all. Where a choice was needed to keep
the documents coherent, the recommended option is what is written, and it is labelled as such.
**`DS-05` and `DS-06` are now closed; `DS-01` is the one still waiting on Andy**, and reading
the brand document made it a larger question rather than a smaller one.

### Needs Andy — brand

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`DS-01`** | **The brand green fails WCAG as a button fill, and this changes what every button in the product looks like.** White on `#00af52` is **2.90:1** — below AA for normal text (4.5:1), below AA for large text (3:1), and below the 3:1 a control boundary needs. Every primary button, every price and every field label in `06_App UI` uses exactly that pair. Mock 02 additionally puts a `#145f48` button on a `#00af52` field at **2.63:1**. **Options:** (a) **the 500 rule** — `#00af52` stays the identity colour in the logo, pattern and brand fields, and *functional* green moves one or two steps darker (`primary-700 #007e3b`, 5.19:1, for fills and text; `primary-600 #009646`, 3.85:1, for boundaries). The mocks stay recognisable and become legible; (b) keep `#00af52` as the fill and put **dark ink on it** — `neutral-900` on `#00af52` is ≈6.2:1 and passes, but a dark-on-green button is a different product's visual language and contradicts every mock and the approved logo pairings in §2.6; (c) accept the failure — not available: it is an accessibility defect, and `E13-10`/`E12-08` gate on Lighthouse and axe, so it would fail CI rather than ship. **Recommended: (a)**, which is what is written. **This is a validation, not an engineering call — it is the one thing in Q05 that genuinely needs Andy's eye.** **Updated 2026-08-09 (`E13-15`) — the question got bigger.** The brand guidelines were read in full, and their Colour Usage Guide assigns `#00AF52` to **"Buttons & CTAs in UI"** in as many words. So option (a) is not a correction to the mocks, it is a **documented deviation from the brand guideline itself**, and Andy is being asked to approve overriding his own brand book on one line. The argument for doing so is unchanged and is now easier to state: the brand document contains **no contrast analysis anywhere** — it was written for packaging, presentations and social, where that line is one of nine and nothing on the page had to survive WCAG 1.4.3. Option (b) gets a second mark against it: the brand's five approved logo-on-colour pairings put **white** on `#00AF52`, so dark ink on a green field contradicts the brand document too, and less defensibly. Nothing else in the reconciliation touched this. | (a) — the 500 rule, `docs/design-tokens.md` §2.1, §2.11 | `E13-01`, `E13-03`, `E13-14`, all of `E13` |
| **`DS-06`** | **Five semantic-role contrast pairs fail the bar `E13-13` will assert — which end of each moves?** Distinct from `DS-01`: approving the 500 rule does not fix any of these. One pair (input/card outlines → reassign to `border.strong`, 4.79:1) is **already fixed** in `docs/design-tokens.md` §2.9 and needs no decision. The four brand-visible ones need Andy's eye. **Per pair, with recommendation:** (a/b) `text.tertiary neutral-500` as placeholder/tertiary text on the `neutral-100` input fill (4.23) / `neutral-50` canvas (4.50) — **recommend darkening the ink one step to `neutral-600`** (placeholder is not identity colour, and `neutral-500` was only ever checked against white, not the fill it sits on); (c) `text.danger danger-600` on the `danger-50` banner fill (4.44) — **recommend `danger-700` on the fill**, keep `danger-600` on white; (e) white body text on `bg.surfaceBrand primary-600` (3.85, fails 4.5) — **recommend forbidding body text on `primary-600` and introducing `surfaceBrandStrong = primary-700`** (white on `primary-700` = 5.19) for text-bearing green fields. **Overall: darken the ink where the colour is not brand identity, and restrict `surfaceBrand` to `primary-700` for anything carrying text.** These are brand-visible, so the actual choice is Andy's; the doc flags each pair pending this. **CLOSED 2026-08-09 by `E13-17`, and it turned out not to need Andy.** Walking the whole role map found the five were really eight, and that all of them are one mistake made repeatedly: *an ink was chosen against white and then used on a tinted surface.* `neutral-500`, `danger-600` and `amber-700` were each picked against `neutral-0`. So the ink moved down one step in every case — `text.tertiary` → `neutral-600`, `text.secondary` → `neutral-700` to keep three steps, `text.danger` → `danger-700`, `text.warning` → `amber-800`, plus `nav.itemInactive`, `status.warning`, `status.danger` following their ink. **No bar was lowered and no brand hue changed:** six of the seven are greys, an error red and a warning brown, none of which is in `02_Colour Palette`. The seventh, `bg.surfaceBrandStrong = primary-700`, is the green `action.primaryBg` already uses, so it adds no colour to the product — it is `DS-01`'s consequence applied to a surface, and stands or falls with `E13-14`. **This is why it was not escalated:** `DS-06` was filed here on the assumption that fixing it meant repainting brand colours, and it did not. Three further pairs were found in the same walk, including `forest-500` on `amber-500` at **4.4994** — the pair the brand guidelines themselves recommend, six ten-thousandths short of AA. | Resolved in `docs/design-tokens.md` §2.9; the list `E13-13` asserts is §9.1 | ~~`E13-13`, `E13-17`~~ |

### Needs legal

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`DS-04`** | **Must the FSSAI veg / non-veg mark be displayed at the point of ordering?** `DM-17` already asks who fills the veg/non-veg column in for the existing ~50 dishes. This is the adjacent *display* question: whether an online food operator must show the statutory green-circle / brown-triangle mark on a dish listing, and in the prescribed colours and geometry. If yes, the mark is a regulated symbol and is **never** re-tinted to `primary-500` or `lime-500` — which is what a designer will reach for, because it is nearly the brand green. The tokens reserve the statutory colours and §2.10 forbids brand-tinting it. **Needs a legal answer, not a design one.** | Mark reserved, never brand-tinted | `E04-01`, `E04-04`, `E13-03`, `E20` |

### Technical, flagged because reversal is expensive

| Q | Question | Recommendation | Blocks |
|---|---|---|---|
| **`DS-02`** | **If the VAG Rounded Next licence (`E19-03`, `owner:andy`) comes back "no", which typeface?** The package ships ten weights; the licence has never been checked, and a bad answer changes every screen. Two halves: (i) **use three weights, not ten** — it narrows the licence question to "may we embed three weights in an app and serve them as webfonts", which is a far easier thing to buy or be refused, and it keeps the mobile bundle small, which is the real constraint (P11); (ii) **name the substitute now rather than in a panic.** | **Nunito (SIL OFL)** — the closest freely-licensed match to VAG Rounded's rounded terminals on an upright skeleton, full weight range, good hinting at small sizes, and no cost or negotiation. Rejected: Quicksand (too geometric, thin at body sizes), Comfortaa (display-only), Baloo 2 (heavier, Devanagari-first — irrelevant under P10), Poppins (not rounded). **Decide the substitute before `E13-03`, not after `E19-03` returns**, so a refusal costs a token change rather than a redesign | `E13-01`, `E13-02`, `E13-03`, `E19-03` |
| **`DS-03`** | **Dark mode in v1?** Not in the mocks, not in the package, and it roughly doubles the contrast surface to design and test. **Options:** (a) light only in v1, but every colour named by *role* (§2.9) so that adding dark mode later is a second mapping file rather than a rewrite; (b) build both now. | **(a)**, which is what is written. The cost of (a) is paid once, in discipline, and it is discipline we want anyway — a component that reaches past `bg.surface` into `neutral-0` is a bug under either option. Consequence to accept: no dark mode at launch, and the "no dark-mode transition" row in §12 of the motion system holds until it exists | `E13-01`, `E13-03`, `E14` |
| ~~**`DS-05`**~~ | ~~**`00_Graybag_Brand Guidelines.pdf` has never been read**~~ — **CLOSED 2026-08-09 by `E13-15`.** The premise was wrong: the file reads fine via a paged PDF read, 20 pages a call, and the recorded blocker was a property of the overnight sandbox rather than of the file (`docs/learnings.md`, 2026-08-09). All 40 pages read. **It specifies** a four-level type hierarchy (Main Heading Semi Bold 48–32, Heading Semi Bold 32–28, Subheading Medium 24–20, Body Regular 16–12), per-colour UI usage rules, and a rounded-geometry rule — all adopted; see §0 of `docs/design-tokens.md` for the ten-row change list and `S12`–`S15` in `docs/decisions.md` for the reasoning. **It specifies no** tints, tonal steps, neutral ramp, spacing scale, radius numbers or contrast analysis, so those parts of the token file stand on their own authority. `docs/design-tokens.md` is **no longer provisional**. One conflict survives and it is `DS-01`, above. | Closed — reconciled | ~~`E13-01`, `E13-15`~~ |

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
| **`OL-01`** | **Auto-capture or manual capture at Razorpay?** Auto-capture (`payment_capture: 1` on the order) makes `authorized` a state we effectively never see: the provider captures on authorization and one `payment.captured` arrives. Manual capture gives a window in which to validate before taking the money — re-check the cutoff, re-check availability — and then capture explicitly. It also gives a second failure mode nobody wants: an authorization that expires uncaptured, where the customer's bank shows a hold that never became a charge. | **Auto-capture.** The validation manual capture would buy us is already done *before* the Razorpay order is created (§8.2), the amount is fixed at that point, and there is nothing to decide at capture time. An uncaptured authorization on a Rs 200 lunch is a support cost with no upside. Consequence: `[OL-02]` cannot be solved by "just don't capture" — the money is already taken when the cutoff question arises. **VERIFIED 2026-08-09 by `E19-01`:** a real UPI intent payment shows `captured` in the Razorpay dashboard, not `authorized`. Auto-capture behaves as documented for UPI intent specifically, so `authorized` is a transient out-of-order-webhook state rather than one an order can sit in. `L5` stays in the design as a guard; it now guards a case that should not arise in normal operation | `E06-02`, `E06-03` |
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
| ~~**`PAY-01`**~~ **RESOLVED 2026-08-09 by `E19-01`: option (a), the official React Native SDK. Demonstrated, not assumed — the SDK compiles against RN 0.86 under the New Architecture, an EAS release build ships it, and a real test-mode UPI payment on a real Android handset captured with a verifying callback signature (`docs/spike-results.md` B6, B7). The accepted cost stands: no Expo Go, every developer and every E2E run needs an EAS build. The text below is kept for the reasoning only; the question is closed.** | **How is Razorpay Standard Checkout hosted inside the app?** **Options:** (a) the official **React Native SDK** (`react-native-razorpay`), a thin native module over Razorpay's Android and iOS checkout SDKs — the only option that gets native UPI intent app-switch, the saved-card flow and the UPI app chooser for free, which is the entire point of `E06-02`; (b) the **web checkout script in a WebView** — no native module, so it runs in Expo Go, but UPI intent from inside a WebView needs us to intercept the navigation and fire the `upi://` intent ourselves and the return is not guaranteed; (c) a **bespoke flow on the S2S/custom checkout APIs**, which puts our code next to card data and changes our PCI posture. | **(a)**, which is what is written. **Its cost must be accepted explicitly: the app can no longer run in Expo Go** — every developer and every E2E run needs an EAS development build. That is already the plan (`A1`), but `E19-01` says "a bare Expo app", and a bare *managed* Expo app cannot host this SDK. **The spike must be run on a development build or it proves the wrong thing** | `E19-01`, `E06-02`, `E14` |
| **`PAY-02`** | **How does a refund split across a wallet-funded and a source-funded portion?** An order paid ₹50 from wallet and ₹160 from a card has only ₹160 at the provider, so a ₹210 "refund to source" is not partially possible — it is impossible. `refund.destination` is a single enum on a single row, so one logical refund may need **two rows**. **Options:** (a) the wallet-funded portion goes back to the **wallet** and the remainder to the requested destination, capped at what source actually captured — two rows sharing a `correlation_id`; (b) proportional across both, defensible in accounting and impossible to explain to a parent ("you paid ₹50 from your balance and got ₹38 of it back"); (c) refuse source refunds on part-wallet orders entirely — simple, and it leaves a real support case with no answer. | **(a)**, which is what is written. The group-level over-refund guard (`E06-21`) enforces the cap independently, so an arithmetic bug fails at write time rather than sending money | `E06-08`, `E06-09` |
| **`PAY-05`** | **The ledger cannot post anything today, for two independent reasons.** (i) `ledger_account_type` is `wallet, revenue, receivable, payable, tax_payable, provider_clearing, provider_fees, suspense` — there is **no bank or cash account**, so a settlement has nowhere to land: `provider:razorpay:clearing` is debited on every capture and never credited, grows without bound, and the "does our clearing account equal what Razorpay holds" assertion that `[DM-03]` chose double-entry *for* can never pass. `docs/data-model.md` §8.4 already assumes the account exists ("payout … credits a bank clearing account"), so payouts are blocked on the same gap. (ii) `ledger_transaction.reason_code` is `not null references reason_code(code)`, and **not one of the eight seeded codes names a money movement** — no sale, no MDR fee, no wallet hold, no settlement, no revenue-share accrual. `reason_category` already anticipates the split (`cancellation` / `refund` are the *why* vocabulary, `ledger` is the *what movement* vocabulary); only the second is missing, and `migration_opening_balance` is its sole member. | **Fix both in `0003`** — add `bank` to `ledger_account_type`, seed `platform:bank`, and seed the eleven `category = 'ledger'` codes in §10 of `docs/payments-design.md`. `E06-23` and `E06-22`. Note that `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, and a Supabase migration file is one transaction — so the value lands in `0003` and its first use in `0004`. Flagged here rather than treated as a pure gap because (i) is a schema change that propagates into payouts and reporting | **`E06-07`**, `E06-11`, `E07-10`, `E11-01` |

## Raised by the menu importer (`tools/menu-import/`, Q08)

Q08 was meant to close `[DM-13]` by reading the distinct values out of the real
`Allergens` column. **It could not**, because the file it names is not in the repository —
see `[MI-01]`, which is the blocker the rest of this section hangs off. The importer was
built and tested against the documented column list instead, so it is ready to answer
`[DM-13]` the moment the workbook appears. **None of these are decided.**

### Needs Andy

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`MI-01`** | **The source workbook is missing, so `[DM-13]` is still open.** `.../GrayBag_School_Menu 1 1.xlsx` is not in this repository (nor in `../Legacy-Application-backup/`, where the legacy design package now lives — see `docs/decisions.md`), and `Legacy-DB/gray-bag-23660.bubble` is the Bubble *application definition* — pages, workflows and option sets, not dish rows. There is therefore **no real allergen data anywhere in the repo**, and the seed list in `docs/data-model.md` §3.3 is still twelve codes chosen from the FSSAI declarable set rather than from GrayBag's menu. This is not a decision, it is a missing input: drop the `.xlsx` anywhere and run `node tools/menu-import/src/cli.mjs "<file>" --json out/menu.json`, then read the `allergen_report` block. `unmapped` and `uncoded` both empty is the condition for freezing the list. | Built and tested against the documented column list plus a synthetic sample sheet | **`DM-13`**, `E04-01`, `E04-04`, `E04-13`, `E05-05` |
| **`MI-02`** | **Three allergen mappings are judgement calls, and two of them are safety-relevant in opposite directions.** (i) **Oats → `gluten`.** Botanically gluten-free; routinely cross-contaminated in Indian milling. Mapping over-warns a coeliac child off a safe dish; not mapping under-warns. **Written as: mapped**, because the cost of the two errors is not symmetric. (ii) **Coconut is left *uncoded*, not mapped to `tree_nut`.** The US FDA classes it as a tree nut, the EU and FSSAI do not. Mapping it would make every coconut dish warn a cashew-allergic child for no reason; ignoring it would drop a real declaration. **Written as: neither — the row fails and asks.** (iii) **Molluscs are not folded into `crustacean`.** "Shellfish" in a menu usually means prawn, but not always, and prawn and squid allergies are distinct. The seed list has no mollusc code at all, so `shellfish` currently fails every row it appears on. **Recommended: add `mollusc` to the seed list**, and answer (i) and (ii) alongside `DS-04`, which is the other FSSAI question. Andy plus whoever answers `DS-04`. | (i) mapped, (ii) uncoded, (iii) uncoded | `DM-13`, `E04-01`, `E05-05` |
| **`MI-03`** | **Should an allergen the system cannot interpret fail the row, or import the dish with an "unknown allergen" flag?** Written as **fail the row**: an unmapped fragment means the parent's warning would be built from an incomplete tag list, and a dish that silently under-declares is exactly the failure D7 exists to prevent. **Options:** (a) fail the row, so the spreadsheet or the synonym table gets fixed before anything reaches a customer — safe, and it means one unrecognised word blocks an otherwise fine dish, which will be irritating on import day; (b) import with `has_unparsed_allergens = true` on the dish and suppress it from the menu until an admin clears it — same safety, more machinery, and it needs a column the schema does not have; (c) import and warn only — not available, it ships an unwarned allergy. **Recommended: (a) for the prototype and for the first real import; revisit as (b) if `E04-04`'s preview turns out to strand whole menus.** | (a) | `E04-04`, `E05-05` |
| **`MI-04`** | **Where does the Excel `Item No.` go, and what does a re-import match on?** `dish` has `legacy_bubble_id` but no column for the spreadsheet's own item number, and its uniqueness guard is `(kitchen_id, lower(name))`. So a re-import matches dishes **by name** — which means renaming "Veg Sandwich" to "Grilled Veg Sandwich" in the spreadsheet reads as *delete one dish, create another*, silently orphaning its images, its price overrides and its order history links. E04-04's "never silently overwrite" promise is only as good as the key it matches on. **Options:** (a) add `dish.external_ref text` (unique per kitchen), populate it from `Item No.`, and match re-imports on it first and on name second — one small migration, and it makes a rename a rename; (b) keep matching on name and accept that renames are create-plus-delete, documented in the preview UI; (c) match on name and require the operator to resolve every add/remove pair by hand in the preview. **Recommended: (a)**, and it is cheap now and awkward after the first import has run. The importer already emits `item_no` on every dish so nothing is lost either way. | Emitted as `item_no`, not yet a schema column | `E04-04`, `E04-06`, `E16-06` |

### Answered, and noted here because the answer was assumed elsewhere

| Q | Note |
|---|---|
| `DM-20` (is the Excel `Price` GST-inclusive?) — **now ANSWERED: exclusive (`SC2`)** | The importer does **not** guess. Every dish carries `price_is_tax_inclusive: null`, matching the nullable-and-unset column `DM-20` recommends. Nothing downstream can accidentally inherit a default from this tool. |
| `DM-17` (veg / non-veg / egg) | Confirmed absent from the documented format. `food_type` is `null` on every imported dish and the importer emits a file-level `food_type_absent` notice on every run, so it cannot be forgotten. |

## Raised by the GST invoicing spec (`docs/gst-invoicing.md`, Q09)

Q09 **closed `[DM-19]`** — rounding is per line, per tax component, half-up, and the reasoning is
`G1` in `docs/decisions.md`. Five things it could not close are below. **None of these are
decided.** `[GST-01]` and `[GST-02]` both have teeth: the first costs a migration if it lands the
wrong way, and the second decides whether `M2`'s CGST/SGST split — and therefore `E07-06`'s cart
change — is correct at all.

### Needs Andy — follows `[DM-20]`

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`GST-01`** — **RESOLVED 2026-08-07 by `SC2`: option (a), exclusive. The problem does not arise and no constraint needs relaxing.** | **Tax-inclusive pricing cannot both satisfy the schema and charge the displayed price.** `order_line` has a hard `check (line_subtotal_paise = unit_price_paise * quantity)`. If `[DM-20]` returns "inclusive", `unit_price_paise` must hold the *derived exclusive* unit price or `subtotal + tax` double-counts the tax — but deriving per unit and multiplying **multiplies the per-unit rounding error by the quantity**. Four ₹99.00 tax-inclusive dishes come to ₹396.02, not ₹396.00, and no arrangement of integers fixes it while the constraint holds (worked table in §6.6). **Options:** (a) answer `[DM-20]` as **exclusive** and the problem does not exist — this is also what the current cart already does; (b) derive the taxable value at the **line** rather than the unit, relax `order_line_subtotal_arithmetic` in `0003`, and carry the ±1-paise residual per line in `invoice.round_off_paise`, which is provably bounded (§6.6); (c) accept the drift and charge ₹396.02. **Recommended: (a), and if the answer is "inclusive" then (b) — before `E05` builds pricing, not after.** The point of raising it separately from `[DM-20]` is that the two answers are not equally cheap, and that should be visible when the answer is given. | Exclusive path built; inclusive path fully specified in §6.6 but not implemented | `E04-04`, `E05-04`, `E07-02`, `E07-06` |

### Needs the accountant — rides with `E00-10`

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`GST-02`** | **Is the supply actually intra-state?** GST is intra-state when the supplier's registered state equals the place of supply. `M2` asserts CGST 2.5% + SGST 2.5% on the basis that the place of supply is Mohali / SAS Nagar (Punjab, `03`) — but that is a fact about the *place of supply*, and the other half of the test is GrayBag's **registered** state, which is the first two digits of a GSTIN we do not have. If GrayBag is registered in Chandigarh (`04`), every invoice is **IGST at 5%**, and `E07-06`'s cart change is wrong. **Written as:** the split is derived per invoice from `left(seller_gstin, 2)` against `place_of_supply_state_code` and never hard-coded (`G4`, `E07-17`), so the schema and the renderer already handle either answer. What is open is which answer we get, and whether `M2` needs rewording. **Ask directly rather than inferring it from the GSTIN**, because a second registration in another state is also a possible answer. | Derived per invoice; `M2` assumed | `E07-02`, `E07-06`, `E07-17` |
| **`GST-03`** | **Round the grand total to the nearest rupee, or charge exact paise?** The conventional Indian invoice carries a "Round Off ₹0.40" line bringing the payable to a whole rupee. **Options:** (a) exact paise — Razorpay charges exact paise, the arithmetic is already correct, and the customer is charged precisely what the invoice says; (b) round to the rupee, using `invoice.round_off_paise`, which the column supports. **Recommended: (a)**, which is what is written (`G6`). Listed because it is a convention question an accountant may have a firm view on, and because it **changes the amount charged** — so it cannot be added later as a rendering change, it needs a dated cutover. | (a) | `E07-02` |
| **`GST-04`** | **Is catering supplied *to a school* exempt, where the same catering supplied to a parent is taxable?** Notification 12/2017 exempts certain services provided **to an educational institution** by way of catering. Today the supply is GrayBag → parent, so the exemption plainly does not arise. But `E18-01` asks whether a school might buy in bulk and bill through fees — and that is a supply **to the institution**, which may land in a different tax position entirely (and, being B2B, may also pull in the e-invoicing question in §9). **This is a question, not a finding — do not build anything on it either way.** Not needed for launch. Worth asking at the same time as `E00-10` because it may decide whether `E18-01`'s school-bulk model is viable before anyone designs it. | Not modelled; v1 is parent-only | `E18-01`, `E07-09` |
| **`GST-05`** | **Does the invoice PDF need a digital signature?** Rule 46 requires a signature or digital signature of the supplier. Electronically issued invoices are commonly served with "This is a computer-generated invoice and does not require a signature". **Options:** (a) the computer-generated wording, which is what the layout in §8 assumes; (b) a digital signature certificate applied to every PDF, which is a key, a renewal, a signing step in the PDF pipeline and a place for the pipeline to fail silently. **Recommended: ask.** The answer changes the PDF pipeline, not the data, so it is cheap to defer — but it should be answered before `E07-04` starts emailing documents. | (a), as `«SIGNATURE-TREATMENT-PENDING-E00-10»` | `E07-02`, `E07-04` |
| **`GST-06`** | **Three launch cities, three GST state codes — so `M2`'s flat CGST+SGST is already wrong for two of them.** The cities span Punjab (`03`), Chandigarh (`04`) and Haryana (`06`), so the place of supply takes three distinct values (`data-model.md` §3.1). Under a **single GSTIN** at most one can be intra-state; the other two are **IGST at 5%**, whatever the accountant says about registration. This is arithmetic on facts already in the schema, not contingent on `[GST-02]`. **Options:** (a) register a GSTIN in **each** of the three states → CGST+SGST everywhere, but three registrations, three sets of returns, more compliance overhead; (b) a **single GSTIN**, accept IGST for the two out-of-state cities, and derive the split per `place_of_supply_state_code` the same way `E07-17` already does on the invoice (`E07-21` carries it into the checkout pricing path so the customer is not shown CGST+SGST and then invoiced IGST — under `L7` the charged total must equal the displayed total). **Recommended: (b) for launch, revisit if a city's volume justifies its own registration.** Note: once decided, `M2` in `decisions.md` must be reworded from a statement of fact ("intra-state") to a statement about **one** city. | (b) assumed; `M2` needs rewording | `E07-06`, `E07-17`, `E07-21` |

### Confirmations rather than decisions

Not open questions so much as things stated in `docs/gst-invoicing.md` on our own reading of the
CGST Rules, which an accountant should sign off once. §10 of that document is the hand-over list.

| What | Where |
|---|---|
| The Rule 46 field list is complete for our supply type | §4.1 |
| The 16-character serial-number limit, and the `GB/26-27/000417` format | §5.2, `G9` |
| Current e-invoicing / dynamic-QR turnover thresholds and GrayBag's distance from them | §9 |
| Credit notes share the invoice series, or get their own | `[PAY-06]`, already open |

## Raised by the DPDP compliance draft (`docs/dpdp-compliance.md`, Q10)

Q10 could close nothing, and that is the correct outcome: **`E20-01` has not been done**, so
every legal value in the system — what makes consent verifiable, how many days anything is kept,
how many hours we have to notify — is still unknown. What Q10 did was build the machinery to
record whatever the answer is, decide the nine mechanism questions (`C1`–`C9` in
`docs/decisions.md`), and turn the legal gap into a **hand-over checklist written to be sent to
a lawyer as-is** (§10 of that document). **None of these are decided.**

`[DP-03]` is the one with a live edge: it asks whether the legacy Bubble exposure is *already* a
notifiable breach, and that question does not improve with age.

### Needs legal — `E20-01`

| Q | Question | Written as | Blocks |
|---|---|---|---|
| **`DP-01`** | **Is GrayBag a Significant Data Fiduciary, and who is the deputy on the incident clock?** Two halves of the same staffing question. (i) SDF designation turns on volume *and* sensitivity, and "processes children's data including declared allergies" is squarely one of the sensitivity factors. Designation pulls in a **Data Protection Officer resident in India**, an independent data auditor and a periodic DPIA — none of which is a code change and all of which is a cost and a hiring decision. **Assumed for now: not designated at ~400 users.** (ii) The runbook's earliest deadline may be six hours, and GrayBag is one person with one phone. **Options:** (a) name a deputy who can declare an incident and send a template — needs a second human; (b) no deputy, and the compensating control is the drill (`E20-20`) plus templates anyone can send; (c) a retained contractor on call. **Recommended: ask about SDF first**, because if a DPO is required (a) stops being optional. | Not designated; no deputy | `E20-01`, `E20-08`, `E20-20` |
| **`DP-02`** | **The retention numbers.** §6.2 of `docs/dpdp-compliance.md` proposes a full schedule — 18 months for a child's name on an order, 36 months for the allergen snapshot, 36 months for `audit_log`, 3 years for the consent record after erasure, 8 years for invoices and the books — each with its reasoning. `retention_policy` is deliberately **unseeded** in `0001`, because inventing a number there would be inventing the law. The one number that is not ours at all is the **statutory floor for GST invoices**, which is the accountant's and rides with `E00-10`; the whole schedule hangs off it, because the order rows are the supporting record behind the invoice and cannot be shorter. **Recommended: send §6.2 as a table to be corrected**, rather than asking an open question — a schedule with reasoning gets edited, a blank page gets a generality. | Unseeded; §6.2 is a proposal | `E20-05`, `E20-19`, `E00-10` |
| **`DP-03`** | **Breach deadlines, CERT-In, and the exposure we already have.** Three things. (i) Our reading is that intimation to affected data principals is required **without delay** and detailed particulars to the Data Protection Board within **72 hours** of becoming aware. (ii) Separately and *earlier*, the CERT-In Directions of April 2022 appear to require certain cyber incidents to be reported **within 6 hours of noticing** — the deadline most likely to be missed, because it is not the one anyone remembers. Both are written into `platform_config` as values rather than constants (`E20-14`) precisely because they may be wrong. (iii) **The live one:** the legacy Bubble app makes `Order` and `Child` readable by any visitor and may expose the Data API publicly (`E00-04`, `E00-05`), and `R3` keeps Bubble alive for 30 days after cutover. Whether that exposure is *itself* notifiable is a real question with a clock on it. `E20-23` prepares the facts — what was exposed, since when, how many records — so the lawyer can answer rather than speculate. **Recommended: ask (iii) in the first conversation, not the last.** | 72h / 6h assumed, as config; the legacy exposure is unassessed | `E20-08`, `E20-14`, `E20-23`, `E00-04` |
| **`DP-04`** | **Is the school a joint data fiduciary, a processor, or merely a recipient?** Written as a **recipient of aggregates only** — it receives counts and money, never a child-level record (`P6`, `E11-03`), and `SchoolViewer` gets none of tiers S, P or A. Three things complicate it: the school is where the food is delivered and its staff hand it to the child; `[DM-08]` may have the school supply a class/section list, which is a flow *into* us; and if `[GST-04]`/`E18-01`'s school-bulk model ever happens, the school becomes the buyer. **Options:** (a) recipient, disclosed in the notice, no DPA needed; (b) processor, needing a contract; (c) joint fiduciary, needing an allocation of responsibilities. **Recommended: (a) for v1 as written, and re-ask the moment `E18-01` is designed.** | (a) | `E11`, `E20-11`, `E18-01` |
| **`DP-05`** | **Cross-border transfer of the residual adult data.** Tier S and P never leave the Indian region, because they never leave the database except to the kitchen — that is a design rule with tests (`E20-10`, `PY8`). But tier A does leave: Netlify access logs, Expo push (token *and notification body*), Sentry and Better Stack if they contain anything at all, and whichever email vendor is chosen. **Question:** does DPDP's transfer regime restrict any of that today, and does it change what vendors are acceptable? **Recommended: ask before the email vendor is chosen** (`E07-04` has not picked one), because that is the one decision still fully open, and it carries the invoice PDF — which contains a child's first name (`G7`). | Assumed permitted; no vendor chosen | `E20-11`, `E07-04`, `E15` |
| **`DP-06`** | **Does a child's consent expire, and what happens when the child turns 18?** `consent_action` has `expired` and nothing currently writes it. Two sub-questions. (i) Must consent be re-affirmed periodically or at a change of school year? If yes, it needs a job and a re-ask flow. (ii) At 18 the data principal is the young person, not the guardian — but **we do not hold a date of birth** (`[DM-12]`: `is_minor` is *declared*), so we cannot detect the transition. **Options:** (a) do nothing, and rely on the account being abandoned when the child leaves school — the honest description of the status quo; (b) collect a year of birth, which is new personal data collected specifically to enable a deletion, and must be justified; (c) re-affirm all dependent consents annually, which surfaces the question to the parent without us holding an age. **Recommended: (c) if anything is required**, because it needs no new data. Ask before building any of it. | (a), by omission | `E20-02`, `E20-12` |
| **`DP-07`** | **Who may withdraw a consent, and what are the rights of a guardian with no live `guardian_link`?** Half technical, half not. The technical half is a real defect: `consent_record_insert_self`'s `WITH CHECK` requires `auth_can_manage_recipient()`, which is exactly right for a **grant** and wrong for a **withdrawal** — a co-guardian with `can_manage = false`, or one whose link was revoked, can never withdraw the consent they personally gave, and `current_consent` keeps attributing a live `granted` to them. `E20-15` fixes it by splitting the policy on `action`. The half that is not ours: **should** a revoked guardian retain a withdrawal right, and may a separated or non-custodial parent exercise access or erasure over a child's record when no link exists? That is a family situation before it is a bug, and it sits next to `[AZ-05]`, which already decided a guardian can *see* the other guardians. **Recommended: build `E20-15` regardless** — being unable to record a withdrawal is indefensible whichever way the legal half lands — and ask the second half. | The defect stands; `E20-15` raised | `E20-15`, `E03`, `E20-04` |
| **`DP-08`** | **May a push / notification body ever name a child?** A body like "Aarav's lunch has been delivered" renders on the **lock screen — visible without unlocking the device** — and transits Expo/EAS's servers, so it is an uncontrolled egress of tier-P data. The functional need is weak: the parent already knows which child they ordered for, and the order identifies neutrally. **Options:** (a) **never name a child** — neutral copy ("Your lunch order has been delivered"); (b) first-name-only, to an **opted-in** parent, on **their own device** — still lock-screen-visible, so a weak relaxation. **Recommended: (a), default NO.** Keep the sentinel-name test (`E20-29`, same shape as `E20-10`) strict — no child name at all in a push body — until `[DP-08]` explicitly relaxes it. This is a genuine DPDP s.9 child-data judgement; do not let an implementer decide it by omission. | (a), by conservative default; `E20-29` builds the test | `E20-29`, `E08-03`, `E08-05`, `E20-01` |
| **`DP-09`** | **`product_analytics` is described three inconsistent ways and has no chosen vendor** (rides with `[DP-05]`). `privacy-policy.md` §2.3/§4.1 **collects** it; `dpdp-compliance.md` §5.1 names an analytics **vendor** as a recipient but §9's processor register — which claims to list every third party — has **no analytics row**; `store-submission.md` §2.1 declares **"no Analytics"** (a legal attestation). **Options:** (a) **pick a vendor** — add a §9 processor-register row, contemplate a DPA and the cross-border question (`[DP-05]`), and flip the store Data-Safety / App-Privacy declaration to disclose Analytics; (b) **cut analytics for v1** — remove the `product_analytics` consent purpose (privacy §4.1), "App analytics" (privacy §2.3) and the analytics vendor (dpdp §5.1), keeping the store "no Analytics" attestation true. **Recommended: (b) for v1** — one fewer vendor, one fewer cross-border tier-A egress and DPA, and it makes the legal store attestation true with the least work. `E20-34` reconciles the three; ride it with `[DP-05]`. | Inconsistent as written; `E20-34` reconciles; lean (b) | `E20-34`, `E15-11`, `[DP-05]` |

### Already open elsewhere, and load-bearing for all of the above

| Q | Why it matters here |
|---|---|
| `[DM-12]` | **The biggest one in the project's compliance surface.** Whether verifiable parental consent is a tick box by an OTP-authenticated adult or an identity check decides whether `E20-02` is a screen or a different product. `docs/dpdp-compliance.md` §3.4 specifies both branches so the answer costs a flow change, not a redesign. **The consent UI must not be built until it returns** |
| `[DM-15]` | `D15` fixed the *shape* (soft delete, then anonymise in place, never a hard delete); §6.2 now proposes the *numbers*, which is `[DP-02]` |
| `[AZ-02]` | `orders.view_pii` cannot be enforced by RLS, so purpose limitation on a child's name in the back office rests on the `api/` layer plus a tripwire test that fires the moment a grant of `orders.view` without `orders.view_pii` is issued — which is exactly what `E20-09`'s analyst role would be |
| `[AZ-07]` | Who may progress a `data_subject_request`. The `consent.view` / `users.manage` mismatch makes the update a **silent no-op** for a grantee holding only `consent.view`, and `E20-04` is the task that will trip over it. It was deliberately left as-is in `0002` to be settled "with `E20-04` in front of you" — this document is that moment |
| `[DS-04]` | The other regulated-display question (the FSSAI veg / non-veg mark). Worth asking the same lawyer in the same conversation |

## Raised by the policy drafts (`docs/{privacy-policy,terms,refund-policy}.md`, Q11)

Customer-facing / commercial values the three policy drafts surfaced. Most are **not** new DPDP
questions (those are `[DP-01]`…`[DP-07]`); they are the "what do we actually tell the customer"
side, which needs Andy and, for two of them, the lawyer. **None of these are decided.**

- **`[PP-01]` Customer self-cancellation window.** How long before the kitchen cutoff may a
  customer cancel their own order and get a full refund? The system has
  `customer_cancellation_cutoff_minutes` and `customer_cancellation_allowed` (lifecycle T10) but
  the number is unchosen. **Options:** (a) same as the order cutoff — cancel any time up to cutoff;
  (b) a buffer (e.g. 60 min before cutoff) so the kitchen's headcount is stable earlier; (c) no
  self-cancel, contact-us only. **Recommended: (a) or a small buffer, as config per kitchen.**
  **Does NOT block launch** (a value can ship), but a value must be chosen before the refund policy
  is published. Owner: Andy (product). Blocks `E00-19`.
- **`[PP-02]` Post-delivery / problem-with-order refund stance.** §2.3 of the refund policy
  currently says post-delivery refunds are goodwill-only and at GrayBag's discretion. Is there a
  stated window to report a problem (e.g. "same day"), and is any category automatic (wrong item
  delivered)? **Recommended:** state a same-day report window and make "wrong item / not delivered"
  an automatic refund; keep "didn't like it" discretionary. **Does NOT block launch.** Owner: Andy
  (product), with a light legal check on the wording. Blocks `E00-19`.
- **`[PP-03]` Allergy liability wording.** Terms §8 and the privacy notice both say the allergy
  warning is an aid, not a guarantee, and that a serious-allergy child must not rely on the app
  alone. The exact wording (`«ALLERGY-LIABILITY-WORDING-PENDING-E20-01»`) is health-and-safety
  language and **must** be drafted/approved by a lawyer. **Recommended:** do not soften it; if
  anything, strengthen the "do not rely solely on the app" line. **BLOCKS launch** — shipping an app
  that shows allergy warnings for children without reviewed liability wording is the single riskiest
  gap in these documents. Owner: Andy → lawyer (`E20-01`, `E20-25`).
- **`[PP-04]` Liability cap wording.** Terms §10 caps liability at the order value with a carve-out
  for death/personal injury. `«LIABILITY-CAP-WORDING-PENDING-E20-01»` needs a lawyer — a cap that
  tries to exclude what cannot be excluded under Indian law is unenforceable and looks bad.
  **Does NOT block launch** independently but rides with `E20-01`. Owner: lawyer (`E20-25`).
- **`[PP-05]` Wallet credit and RBI PPI.** Terms §5 states wallet credit is refund-only store credit
  and cash top-up is not offered. The RBI Prepaid Payment Instrument question for cash top-up is
  already open (top of this file); the drafts assume refund-only credit is outside PPI regulation.
  **Recommended:** keep top-up out of v1 (already the plan); have the lawyer confirm refund-only
  credit needs no PPI licence before we describe it as "store credit". **Does NOT block launch** for
  v1 (no top-up), but the sentence should be lawyer-checked. Owner: lawyer (`E20-01`).
- **`[PP-06]` Minimum age to hold an account.** Terms §2 states 18+. The system has `is_self`
  recipients (a college student ordering for themselves may be 17). Is an account holder required to
  be 18, and what about a 16–17 self-ordering college student? **Recommended:** keep account holder
  = 18+; a minor eats via a guardian's account. **Does NOT block launch.** Owner: Andy (product),
  light legal check.

## Raised by the store-submission pack (`docs/store-submission.md`, Q12)

App Privacy (Apple) / Data Safety (Google) declaration questions the store pack surfaced. Every
answer was derived from `docs/dpdp-compliance.md` §2.2 and `docs/data-model.md` §13.3, **not** from
`docs/privacy-policy.md`, which did not exist at Q12's HEAD — so all of these must be reconciled
against the final policy (`E17-19`). **None of these are decided.**

- **`[SS-01]` Which Data Safety "purpose" values do we claim for phone and email?** Google forces
  each data type into a fixed purpose list. Phone (OTP) is clearly "Account management" + "App
  functionality"; email is "App functionality" (receipts/invoices). The question is whether we also
  tick "Fraud prevention" for phone. **Recommended:** App functionality + Account management only;
  do not claim Fraud prevention or Analytics against contact data, to keep the label minimal and
  honest. **Does NOT block launch** — a wording choice within an honest range, resolvable at
  submission.
- **`[SS-02]` Do we declare "Data shared with third parties" for the Razorpay payer prefill?** The
  paying adult's phone + email are sent to Razorpay as `prefill` (payments-design §3.7). Razorpay is
  arguably a processor (App functionality) rather than a party we "share" with, but `[DP-04]`/§2.1 of
  dpdp-compliance flags Razorpay may be an **independent fiduciary**, which under the store
  definitions leans towards "shared". **Recommended:** declare payer phone + email as **shared** with
  the payment processor for "App functionality / to complete the payment" — the conservative, honest
  reading. Confirm against the final privacy policy and `E20-11` processor review. **Does NOT block
  launch**, but must be consistent with the policy.
- **`[SS-03]` App Privacy: is declared allergy data "Health & Fitness → Health"?** A child's declared
  allergies are health data (tier S), collected, linked to identity, not used for tracking.
  **Recommended:** declare "Health" collected, linked to identity, purpose "App functionality", not
  used for tracking. There is no genuine ambiguity — flagged so it is not "simplified" away. **Does
  NOT block launch.**
- **`[SS-04]` Do the store consoles need the grievance-officer contact, and is it the same as the
  App Store "privacy contact"?** The four `«…-PENDING-E20-21»` grievance tokens are unresolved. No
  store field needs the officer's name directly, but the privacy-policy URL both stores require will
  contain them. **Recommended:** already covered by `E20-21` + `E20-22`; noted so the store
  submission is not blocked on a *store* question when it is really an `E20-21` question. **Blocks
  launch, transitively** — a production privacy-policy URL containing a `«…-PENDING-…»` token must
  not ship (`E20-22`), and the store listing links that URL.

## Raised by the secret-rotation policy and testing strategy (`docs/secret-rotation-policy.md`, `docs/testing-strategy.md`, Q13)

**None of these are decided.**

- **`[SEC-01]` Secret rotation cadences — accept or shorten.** **Options:** (a) as recommended —
  180 days for high-value provider secrets (Razorpay key secret, webhook secret, service-role, SMS,
  DB), 90 days for CI tokens, 365 days for the off-Supabase backup encryption key, plus immediate
  rotation on any suspected exposure; (b) shorter (e.g. 90 days everywhere) — tighter leak-lifetime
  bound, more rotation friction, more chances to botch a dual-secret webhook rotation;
  (c) compliance-driven, if a school contract or payments partner imposes a cadence. **Recommended:
  (a).** It bounds a silent leak's lifetime while keeping rotation rare enough that the dual-secret
  webhook dance is done correctly. **Does NOT block launch** — policy Andy ratifies; the mechanics
  work at any cadence. Owner: Andy (decision).
- **`[SEC-02]` Does the Supabase plan expose zero-downtime JWT key rotation?** Rotating the Supabase
  Auth JWT signing secret invalidates every JWT signed with the old one; with `U3`'s long-lived
  refresh tokens a hard rotation logs everyone out (mass re-OTP). **Options:** (a) seamless via JWKS
  overlap if the plan supports it; (b) maintenance window + accepted re-login on the 180-day clock,
  coupled to service-role rotation; (c) only ever rotate the JWT secret on suspected compromise,
  accepting the mass logout as the correct incident response. **Recommended: (a) if available, else
  (b).** Do NOT shorten the refresh-token TTL to make rotation cheaper — that permanently raises OTP
  cost against a rare event, the wrong side of `U3`. **Does NOT block launch.** Owner: Andy
  (credentialed — check the plan).
- **`[SEC-03]` The 180-day service-role rotation forces a twice-yearly mass re-OTP — is that
  acceptable, and does it change the cadence?** Supabase rolling the service-role key **also rolls
  the JWT signing secret** (`secret-rotation-policy.md` §3.1/§6), so every user is logged out and
  must re-OTP. `U3`'s whole point is that ~180-day refresh tokens keep OTP volume low (~4
  logins/user/year at ~Rs 0.15/OTP); a *scheduled* twice-yearly re-auth roughly **doubles** it and
  is a customer-visible event ("why is GrayBag asking me to log in again?") for a one-support-person
  business. **Options:** (a) accept the twice-yearly re-login in a communicated maintenance window;
  (b) if `[SEC-02]` finds the plan exposes **zero-downtime** JWT rotation, use it and avoid the
  re-login entirely; (c) lengthen the service-role cadence **beyond** 180 days to reduce frequency.
  **Recommended: resolve `[SEC-02]` first; if there is no zero-downtime path, weigh (a) against (c)
  with the OTP-cost / support consequence stated explicitly alongside `[SEC-01]`** — which puts the
  cadence in front of Andy but does not currently put this consequence next to it. **Does NOT block
  launch.** Cross-references `[SEC-01]`, `[SEC-02]`. Owner: Andy (decision).
- **`[TEST-01]` Coverage threshold numbers.** **Options:** (a) recommended — 80% global line
  coverage, 90% floor on `packages/shared`, with money-math and authorization held to effectively
  100% by *suite completeness* (property tests + the exact-policy-set assertion) rather than by an
  lcov number; (b) higher blanket gate (90–95% everywhere) — risks rewarding assertion-free tests on
  UI/glue; (c) lower / advisory — contradicts `E01-12` and non-negotiable #6. **Recommended: (a).**
  The real risk (money, authz) is already gated by specific-tests-present, not a percentage.
  **Does NOT block launch**, but `E01-12` needs a ratified number before CI can enforce a gate —
  blocking for "CI is green means something". Owner: Andy (decision).

## Raised by the cutover runbook (`docs/cutover-runbook.md`, Q14)

Cutover-execution questions. **None of these are decided.** Several block scheduling the cutover
weekend (`E17-09`) rather than the build.

- **`[CO-01]` When is the cutover weekend, and how long is the ordering freeze?** **Options:** (a) a
  Friday-night → Monday-morning window (Bubble read-only Friday ~22:00 IST after the last weekly
  cutoff, migrate/validate Saturday, soak Sunday, open Monday 06:00 before the first cutoff); (b) a
  tighter Saturday–Sunday window with less soak time; (c) cut over during a school-holiday week when
  no service days fall inside the window. **Recommended: (c) if a holiday week is available within
  the launch timeline, otherwise (a)** — schools do not serve on Sat/Sun in the current cities, so
  no `service_date` falls inside the freeze. **BLOCKS launch** — `E17-09` cannot be scheduled without
  it. Owner: Andy (a date decision, depends on the school calendar).
- **`[CO-02]` Does Bubble go fully read-only, or stay writable for 30 days?** The runbook assumes
  Bubble is read-only at freeze and kept so as the 30-day break-glass (`R3`). If a full technical
  lock is not achievable in Bubble, the compensating control is to disable the payment and
  order-create workflows only. **Recommended:** achieve read-only by disabling Bubble's order-create
  and payment workflows and pointing DNS at the new site; leave data readable for support lookups.
  Confirm what "read-only" Bubble actually permits. **BLOCKS launch (partial)** — the break-glass
  story in `R3` depends on it. Owner: Andy (credentialed — Bubble editor; a validation).
- **`[CO-03]` Cutover-time in-flight orders and payments: how are they drained?** At freeze there may
  be Bubble orders paid-but-not-delivered (future service date) and Bubble payments in flight (UPI
  collect pending) that do not fit the E16 historical migration cleanly. **Recommended (built into
  runbook §4):** drain rather than migrate — stop new Bubble payments at freeze; let in-flight Bubble
  payments settle or fail on Bubble during a fixed drain window before the migration snapshot;
  migrate resulting settled orders as history; reconcile anything still pending at snapshot by hand
  against the Razorpay dashboard. **BLOCKS launch** — `E16-01`/`E16-04` need to know whether
  future-dated paid Bubble orders come across as fulfillable orders or closed history. Owner: Andy +
  build. Resolved by `E17-14`.
- **`[CO-04]` Do future-dated paid Bubble orders get fulfilled by the new kitchen ops, or refunded?**
  A parent who paid on Bubble for next Tuesday's lunch has a real obligation. **Options:** (a) migrate
  future-dated paid orders as real `paid` orders so the kitchen packing list includes them, with the
  money as an **opening ledger credit** posture (no second charge) — honest but the harder migration;
  (b) refund-and-reorder on Bubble before cutover — cleaner technically but charges/inconveniences
  paying customers and risks a coverage gap. **Recommended: (a).** **BLOCKS launch.** Owner: Andy
  (product/commercial, ideally with the kitchen) + build.
- **`[CO-05]` Legacy prepaid/wallet balances at cutover.** Ties to `E00-18` / `E16-16`. If off-system
  prepaid balances exist they must land as **opening ledger credits** before the first new-stack
  order, or customers lose money. **Recommended:** resolve `E00-18` before scheduling the weekend;
  if balances exist, `E16-16` is a blocking predecessor of `E17-09`. **BLOCKS launch if balances
  exist.** Owner: Andy.
- **`[CO-06]` Is the legacy Bubble exposure (`[DP-03]`) already a notifiable breach, and does keeping
  Bubble live 30 days extend the exposure window?** Not new — this is `[DP-03]`, flagged because the
  cutover plan is the moment it becomes operational: keeping Bubble read-only for 30 days (`R3`) keeps
  the publicly-readable `Order`/`Child` surface live 30 more days unless it is locked down. The
  runbook adds a pre-cutover step to lock down or take offline the public Bubble Data API
  independently of the read-only decision. **Recommended:** fold into `E20-23` (prepare the facts) and
  ask the lawyer (`E20-01`) before the weekend, not after. **BLOCKS launch** — a live regulatory
  clock. Owner: Andy + lawyer. This is the R3 ↔ `[DP-03]` tension made operational; addressed by
  `E17-15`.
- **`[CO-07]` What is the go/no-go authority when the team is one person?** Every go/no-go gate in the
  runbook names Andy as the decider; `[DP-01]`'s deputy question applies. The compensating control is
  that the runbook's default action at every failed gate is to **NOT proceed and roll back**, which
  is safe without a second human (`R8`). **Recommended:** accept single-signer for v1; the
  rollback-by-default design is the mitigation. Revisit with `[DP-01]`. **Does NOT block launch.**
  Owner: Andy.
- **`[CO-08]` The runbook asks one person to work ~15 continuous overnight hours with the single
  irreversible gate G3 at ~hour 13 — decouple it?** `[CO-07]`/`R8` (rollback-by-default) guards
  against *nobody being available*, not against the *available person being 13 hours awake* when
  they sign the point of no return. **Options:** (a) **decouple G3 from the overnight run** — reach
  the reversible Gate G2 overnight, insert a **mandatory rest gate**, then sign G3 fresh (Saturday
  afternoon or Sunday morning); the freeze has slack (42h soak, no Sat/Sun service, so no
  `service_date` falls inside the window and there is no time pressure to cut over at 10:00 Sat);
  (b) require a **second signer for G3 only** — but GrayBag is genuinely one person (`[CO-07]`), so
  manufacturing a second human is less realistic than a rest gate; (c) a rest gate **before G3 but
  in the same session** — better than nothing, still lands the decision late in a long day.
  **Recommended: (a).** Keeps the freeze comfortably inside P3's ≥50%-headroom budget (now that the
  soak is correctly 42h) and puts the only unrecoverable decision behind a rested operator.
  `E17-25` implements it. **Does NOT block launch** but should be settled before `E17-09` is
  scheduled. Owner: Andy.

| Q | Notes |
|---|---|
| Default delivery mode — classroom bulk vs counter pickup | Depends on whether a school orders school-wide or a handful per class. Both mechanisms are built |
| Per-dish daily capacity limits | Table designed (`E02-12`), unused until a kitchen asks |
| Play App Signing upload key ownership | Mandatory since Aug 2021 so almost certainly enabled; Google resets the upload key on request if Bubble holds it. Low risk |
| **746 roster children with no parent** — migrate as unlinked records to be claimed in-app, or leave behind and re-import a fresh school roster? | From `E19-04`. Bulk-imported by the school on 2025-09-21, each with a unique `school-code`, none linked to an account. Narrowed by `AR1`/`AR2`: dependents now come from orders, so this is purely about whether the roster is worth carrying at all — 131 children get a parent from order history and the rest have none by definition. `E16-37`. Owner: Andy |
| **The one `Cancelled` order carrying a payment id** — was a refund issued outside the system? | Legacy had no `refunded` status to record it. If no refund was made it is an opening ledger credit under `E16-16`. `E16-34`. Owner: Andy |
| **Support policy for the ~15 parents holding two accounts** under different spellings of the same school domain | They migrate as distinct accounts (correct); the question is whether merging is offered on request. Must not be automatic — the domains may be genuinely separate mailboxes. `E03-18`. Owner: Andy |
| **3 dish photos that return a permanent 403** — new photography or a category placeholder? | `E16-29`. Owner: Andy |
| ~~Does the legacy `School Staff` label mean `staff` or `teacher`?~~ | **Closed 2026-08-08 (`AR3`).** Roles are binary: `parent`/`teacher`/`staff`/`collegestudent` → Customer, `admin`/`kitchen` → back-office. Both readings land in the same place, so the ambiguity dissolved. `E16-20` closed |
| **Is anyone relying on legacy allergy data?** | `Child.allergies` is empty on all 1,115 rows, so nothing migrates and every record starts blank. The kitchen may believe otherwise. `E16-39`. Owner: Andy |
| **Does anything need doing about email verification?** | **No — closed 2026-08-08 (`AR4`).** Google verifies the address; an email OTP cannot succeed on an unreadable one. Verification is a property of the two chosen mechanisms, not a step to add |
| **When exactly does Amity's email domain change land, and are the old addresses deleted or aliased?** | Determines how tight the re-export-to-cutover window must be, and whether `E16-41`'s reconciliation is a rename or a re-identification. Aliased is recoverable; deleted is not. Owner: Andy, from the school |
