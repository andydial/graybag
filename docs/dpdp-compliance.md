---
title: DPDP compliance — consent, retention, purpose limitation, grievance and breach
status: DRAFT SPECIFICATION — the mechanism is decided, the law is not. Every legal statement here is provisional on `E20-01`
sources: docs/data-model.md §11, §13.3, §13.4; supabase/migrations/0001_initial_schema.sql §9; supabase/migrations/0002_rls_policies.sql §7.9; docs/authorization-model.md §5, §6.2, §7.9; docs/decisions.md (D8, D10, D15, PY8); docs/open-questions.md ([DM-12], [DM-15], [AZ-02], [AZ-07])
---

# DPDP compliance

GrayBag stores the **name, school, class, section and declared allergies of children**. Under
India's Digital Personal Data Protection Act 2023 that is personal data about a minor,
including health data, and it is the single most regulated thing in this system. The legacy
Bubble app had no consent record, no stated purpose, no grievance officer, no retention policy
and no breach process — and it exposed the data publicly (`E00-04`, `E00-05`).

This document specifies six things: **how consent for a child's data is captured**, **what a
consent record contains**, **how long anything is kept**, **how purpose limitation is enforced
in code rather than in a policy document**, **what the grievance officer publishes and does**,
and **what happens in the first 72 hours of a breach**.

---

## 0. Read this first — what is decided here and what is not

> ## ⚠ `E20-01` MUST CONFIRM ALL OF THIS
>
> **Nothing in this document is legal advice, and no statement of law in it has been checked by
> a lawyer.** `E20-01` — *"Confirm DPDP obligations that apply to GrayBag with a lawyer or the
> accountant"* — is `(owner:andy)` and has not been done. Every legal claim below is **our
> reading of the statute**, written down so that a lawyer can correct a specific sentence
> instead of starting from a blank page.
>
> Statements that need confirming are marked **`[confirm in E20-01]`** inline. §10 collects
> every one of them into a hand-over checklist written to be sent as-is.
>
> **The Act is in force; the DPDP Rules 2025 were notified in November 2025 with phased
> commencement, and which obligations bind us on our launch date is precisely one of the things
> we do not know.** Do not read a date in this document as authority. `[confirm in E20-01]`

There are two kinds of statement here, and keeping them apart is what makes the document
useful rather than a liability.

| | **Mechanism** | **Substance** |
|---|---|---|
| Examples | Consent is a purpose-scoped append-only event log; a withdrawal is a new row; retention lives in a table; a breach starts a clock | What counts as *verifiable* parental consent; how many days we may keep an order; how many hours we have to tell the Board |
| Decided by | This document, and it is decided | A lawyer, via `E20-01` |
| Cost of being wrong | A migration | Regulatory |
| Status | **Decided** — `C1`–`C9` in `docs/decisions.md` | **Open** — placeholders and `[DP-01]`…`[DP-07]` |

The rule that follows, and the reason the schema was built the way it was: **build the machine
that can record whatever the answer turns out to be, and refuse to invent the answer.** Every
column that holds a legal value — `consent_purpose.legal_basis`, `consent_record.verification_method`,
`data_subject_request.due_at`, every row of `retention_policy` — exists and is deliberately
unseeded.

**Two hard gates carried over from the data model, and neither may be relaxed:**

1. **Do not build the consent UI until `E20-01` returns** (`[DM-12]`). If verifiable consent
   requires an identity check rather than a tick box, the dependent-creation flow is a
   different product, not a different screen.
2. **Do not seed `consent_purpose` wording or publish a policy version** until the wording is
   approved. A consent record pointing at wording nobody approved is worse than no consent
   record: it is evidence of the wrong thing. `0001` already declines to seed these and says so.

---

## 1. Scope

**In scope.** The consent flow for a child's data and the transaction rules around it; the
consent record shape, field by field, with worked examples; what withdrawal does, per purpose;
purpose limitation as an enforcement matrix with named controls and named tests; the retention
policy proposal and the purge and erasure pipelines; the grievance officer's published details
and intake process; the breach-notification runbook including notice templates; the third-party
processor register.

**Out of scope, and where it lives instead.**

| Thing | Where |
|---|---|
| The privacy notice, terms and refund policy text | `Q11` → `docs/privacy-policy.md`, `docs/terms.md`, `docs/refund-policy.md`. This document says what those texts must *contain*; it does not write them |
| Apple App Privacy / Google Data Safety answers | `Q12` → `docs/store-submission.md` (`E20-06` feeds it) |
| The RLS policies themselves | `docs/authorization-model.md`, `supabase/migrations/0002_rls_policies.sql` |
| Which back-office grant sees which column | `docs/authorization-model.md` §5, §6 |
| Statutory **invoice** retention arithmetic and the books | `docs/gst-invoicing.md`, `E00-10`. §6.2 here proposes a number and flags it as the accountant's |
| Secret rotation | `E00-17` → `docs/secret-rotation-policy.md` (`Q13`) |
| Sentry / analytics wiring | `E15-11`, `E20-10`. §5.3 here states the rule and the test |

---

## 2. The parties, the data, and where it goes

### 2.1 Roles

Our reading, all of it `[confirm in E20-01]`:

| Role | Who | Why it matters |
|---|---|---|
| **Data Fiduciary** | **GrayBag.** We decide the purpose and means | Every obligation in this document attaches here |
| **Data Processor** | Supabase, the SMS provider, Sentry, Better Stack, Netlify, Expo/EAS, the email sender | Processes on our instructions. Needs a contract (`E20-11`) |
| **Possibly an independent fiduciary, not our processor** | **Razorpay** | A payment gateway determines its own purposes for KYC, fraud and regulatory retention. If so, the relationship is disclosed in the notice rather than governed by our DPA. `[confirm in E20-01]` |
| **Data Principal** | The **parent or guardian** for their own data; the **child** for the child's data, exercised through the parent as lawful guardian | This is the subtle one: the child is the principal, the parent is the one who acts. It is why `consent_record` has both `user_id` (the adult acting) and `subject_id` (whose data it is) |
| **Recipient, not processor** | The **school** | It receives aggregate reports only (`P6`, `E11-03`). It never receives a child-level record from us. `[confirm in E20-01]` — see `[DP-04]` |

**Significant Data Fiduciary.** The Act allows the Government to designate a fiduciary as
"significant" on volume and sensitivity, which pulls in a Data Protection Officer **resident in
India**, an independent data auditor and a periodic Data Protection Impact Assessment. Children's
data is one of the listed factors. At v1 volumes (~400 legacy users) we assume we are not
designated, but "we process children's health data" is exactly the sensitivity factor the test
names. `[DP-01]`, `[confirm in E20-01]`.

### 2.2 What we hold

The classification is normative in `docs/data-model.md` §13.3, and this section **extends and
completes** it — it repeats the §13.3 rows and adds the two columns that §13.3 did not yet name
(`order_line.allergen_codes_snapshot` = tier S; `invoice_line.description` = tier P, first name
only, `G7`). Those two additions are being folded back into `docs/data-model.md` §13.3 so the
two documents agree; **`data-model.md` §13.3 remains the authoritative source once merged**, and
this table must not diverge from it. It is repeated here because every rule in §5 and §6 keys
off the classification.

| Tier | Meaning | Columns | Consent purpose that authorises it |
|---|---|---|---|
| **S — special category** | Health data about a minor | `recipient_allergen.*`, `recipient.allergy_note`, `order_line.allergen_codes_snapshot` | `allergen_health_data` — **optional**, declining means no warning, not no service |
| **P — personal, child** | Identifies a minor | `recipient.first_name`, `last_name`, `school_id`, `school_class_id`, `class_label`, `section_label`; `order.recipient_name_snapshot`, `class_label_snapshot`, `section_label_snapshot`; `invoice_line.description` (first name only, `G7`) | `child_data_processing`, `order_fulfilment` — both **required** |
| **A — personal, adult** | Identifies the customer | `app_user.first_name`, `last_name`, `phone_e164`, `email`; `invoice.buyer_*_snapshot` | Contract performance / the same required purposes |

Two things deliberately **not** collected, and they should stay that way because each is a new
consent conversation and a new retention question: a child's **date of birth** (`[DM-12]` —
`is_minor` is declared, not verified) and a child's **photograph**.

### 2.3 Where it goes — the processor register

Full register with contract status is §9. The one-line version, which is the rule the code
enforces:

> **Tier S and tier P leave the database for exactly one destination: the kitchen and delivery
> staff who have to put the right food in front of the right child.** They do not go to Sentry,
> analytics, the school, Razorpay, an email subject line, or a log line. §5.3 lists the control
> and the test for each.

---

## 3. The consent flow for a child's data

### 3.1 Two gates that are not the same thing

This is the mistake to avoid, and it is easy to make because the two tables look redundant.

| | `user_policy_acceptance` | `consent_record` |
|---|---|---|
| Question it answers | "Has this adult accepted the current terms and privacy notice?" | "Has consent been given for **this purpose**, about **this person**?" |
| Granularity | One row per user per policy version | One row per **event** per (subject, purpose) |
| Gate it drives | `blocks_ordering` — no ordering until accepted (`E20-03`) | Per-purpose: no child data without `child_data_processing`; no allergy warning without `allergen_health_data` |
| Can it be declined and the product still work? | No — it is the contract | **Yes, for optional purposes**, and that is the point |

**Accepting the privacy policy is not consent.** A single "I agree to the Privacy Policy" tick
that is then treated as authority to store a child's health data is precisely the blanket
consent that purpose-scoping exists to prevent. `C4`.

### 3.2 The flow, step by step

Consent is captured at **dependent creation** (`E05-01` / `E20-02`), not at signup, because
until there is a dependent there is no child's data to consent about.

```
1. Sign up / log in            phone + OTP (U1). Establishes an authenticated adult.
                               ↓
2. Policy gate                 Show current policy_version rows where requires_acceptance.
   (E20-03)                    Write user_policy_acceptance. Ordering is blocked until done.
                               ↓
3. Add a dependent             Name, school, class, section.
   ("Add a child")             ↓
4. Itemised notice             §3.3 — what is collected, why, who sees it, how long,
   + purpose consents          how to withdraw. One control per purpose, none pre-ticked.
                               ↓
5. Verification                [DM-12] — what makes this "verifiable". BLOCKED on E20-01.
                               Whatever it is, it is recorded in verification_method.
                               ↓
6. ONE TRANSACTION             insert recipient
   (C1)                          + insert guardian_link (can_manage = true, is_primary)
                                 + insert consent_record × N (granted)
                               If any part fails, the recipient does not exist.
                               ↓
7. Allergies (optional)        Separate screen, separate consent (allergen_health_data).
                               Declining is a supported end state: no allergen warning
                               at add-to-cart, and the UI says exactly that.
```

**Why one transaction.** If the recipient row can exist without its consent rows, then the
system's answer to "on what basis are you holding this child's name?" is *sometimes nothing*,
and there is no way to tell which rows those are afterwards. Making it atomic means the
question can never be asked about a row that has no answer. This is already asserted in the
`consent_record` table comment in `0001`.

**The mirror rule, which is new and is the one people get wrong.** `auth_can_manage_recipient()`
requires `recipient.deleted_at is null`. So the moment a dependent is soft-deleted, **nobody can
write a consent row about them ever again** — the withdrawal becomes unrecordable. Therefore:

> **Removing a dependent must write the `withdrawn` consent rows in the *same transaction* that
> sets `deleted_at`.** Not afterwards, not in a nightly job. `C1` covers both ends of the
> lifecycle: consent is written with the row that needs it, and withdrawn with the row that no
> longer does. `E20-16`.

Without this, `current_consent` shows `granted` forever for a child who was removed a year ago,
which is the exact opposite of what the record is for.

### 3.3 What the consent screen must contain

Our reading of the notice requirement (s.5) and the consent requirement (s.6) — free, specific,
informed, unconditional, unambiguous, by clear affirmative action, limited to the data necessary
for the stated purpose. `[confirm in E20-01]`.

| Requirement | How it is met | Failure mode if skipped |
|---|---|---|
| **Itemised** — each purpose separately | One control per `consent_purpose` row, with `display_name` written in the words shown to the user | A single tick is blanket consent |
| **No pre-ticked boxes** | Controls render unset. A `granted` row is written only from an affirmative interaction | Consent by inertia is not consent |
| **Plain language** | The `consent_purpose.display_name` / `description` are the user-facing strings, not developer text | |
| **Says who else sees it** | The notice names the kitchen and delivery staff explicitly, because that is where a child's name actually goes | An undisclosed recipient |
| **Says how long** | Links to the retention statement (§6), in days or in a plain rule | |
| **Withdrawal as easy as giving** | The same screen is reachable from Settings, and every purpose shown there can be turned off in one interaction | A consent you can give in one tap and only withdraw by emailing support is not compliant |
| **Consequences of withdrawal stated up front** | §3.5's table is the source for the wording | A parent who withdraws and unexpectedly loses ordering has been misled |
| **Contact of the grievance officer** | §7.2's block, rendered on the same screen | s.5 notice content |
| **Recorded, not just displayed** | `policy_version_id` and `capture_context.wording_id` pin the exact text shown | "We showed them a notice" with no evidence of which one |

**Additionally, for children, our reading of s.9:** no tracking or behavioural monitoring of a
child, and no targeted advertising directed at a child. This is why every marketing and
analytics purpose in the seed list is `applies_to_subject = 'self'` — an adult may consent to
marketing about themselves and **cannot** consent to their child being profiled. §5.3 makes it
a test. `[confirm in E20-01]`

### 3.4 The two branches of `[DM-12]`, and what actually changes

`[DM-12]` is the open question that decides how much of this is a screen and how much is a
product. Both branches are the *same* consent record; they differ in step 5 and in nothing else.

| | **Branch A — tick box by an OTP-authenticated adult** | **Branch B — stronger verification** |
|---|---|---|
| What it is | The adult has already proven control of an Indian mobile number via OTP. They affirmatively tick each purpose | Additionally: a payment-instrument check, a government-ID check, or a registered Consent Manager |
| `verification_method` | `otp_authenticated_adult` | `payment_instrument`, `govt_id`, `consent_manager:<id>` |
| Build cost | The flow in §3.2 | A new vendor, a new PII class to hold or to deliberately not hold, a new failure path, a new retention question, a new breach surface |
| Consequence for onboarding | Add a child in under a minute | A parent who cannot complete verification cannot order at all |
| Our recommendation | **A**, with the column recording it, because the adult is already authenticated and the data collected is minimal | — |

**If the answer is B, the following are also open and are not currently designed:** what happens
when verification fails; whether the verification artefact is stored or only its result;
whether an existing (migrated) parent must re-verify before their first order. Do not start
building B without reopening the flow. `[DM-12]`.

### 3.5 Withdrawal, and exactly what it does

Withdrawal must be as easy as giving (§3.3). What it *does* differs per purpose, and the UI
must say so **before** the confirmation, not after.

| Purpose | Required? | On withdrawal |
|---|---|---|
| `child_data_processing` | yes | **The dependent is deactivated.** `deleted_at` is set on that **recipient only**, all future ordering for them stops immediately, and §6.5's erasure pipeline runs with **`scope = 'recipient'`** (only that child's rows and data — **never** the parent's account or their other children). Past orders and invoices survive under the statutory basis (`D15`) and the parent is told so in the confirmation |
| `order_fulfilment` | yes | Same as above — `scope = 'recipient'`, that child only. We cannot deliver food to a child whose name we may not give the kitchen. Practically this is the same button; it is a separate purpose because the *recipient* of the data is different and the notice has to say so |
| `allergen_health_data` | no | **Every `recipient_allergen` row and `recipient.allergy_note` is deleted outright.** Add-to-cart warnings stop. The rest of the account is untouched. The confirmation must say, in plain words, that we will no longer warn them |
| `school_reporting_aggregate` | yes | Cannot be withdrawn while ordering continues, because the school's aggregate count is a consequence of the meal being delivered on its premises. **If a lawyer disagrees, this becomes optional and the report excludes the order** — `[DP-04]` (is the school a fiduciary, processor or recipient) |
| `marketing_email`, `marketing_push` | no | Sending stops on the next send. `notification_preference` is updated in the same transaction |
| `product_analytics` | no | Client stops emitting. Already-emitted events are not retrievable from the vendor per-user — which is itself a reason to send as little as possible (§5.3) |

**Withdrawal is never retroactive on lawfulness.** Processing done while consent was live stays
lawful; withdrawal stops future processing and triggers erasure of anything with no other basis.
This is why `consent_record` is an append-only *event* log rather than a flag — the question a
regulator asks is "was there consent **on the 14th**", and only the event log can answer it.

### 3.6 The gap: withdrawal is gated on a live `can_manage` link

Found while writing this document, and it is a real defect in `0002` rather than a hypothetical.

`consent_record_insert_self` is:

```sql
with check (user_id = (select auth.uid())
            and (subject_type = 'user' and subject_id = (select auth.uid())
                 or subject_type = 'recipient' and auth_can_manage_recipient(subject_id)))
```

That `WITH CHECK` is exactly right for a **grant** — it makes it structurally impossible to
record consent about a child you have no `guardian_link` to, which is the load-bearing
DPDP property and the reason it is a database constraint rather than an Edge Function
convention. It is **wrong for a withdrawal**, in three concrete cases:

1. A co-guardian with `can_manage = false` gave consent (or is recorded as `user_id` on one)
   and can never withdraw it.
2. A guardian whose link is revoked by the primary guardian can never withdraw the consent
   they personally gave, and `current_consent` keeps attributing a live `granted` to them.
3. Anyone at all, once the dependent is soft-deleted — §3.2's mirror rule.

The right shape is to split the policy by `action`: a `granted` row keeps the
`auth_can_manage_recipient` requirement; a `withdrawn` row is permitted where the caller is the
`user_id` of an existing `granted` row for that `(subject_type, subject_id, purpose_code)`.
Case 3 stays service-role-only and is handled by making removal atomic (§3.2).

`E20-15`, in `0003`. It is the same shape as `[OL-05]`: **a constraint that correctly protects
an invariant must not also prevent recording something the outside world is entitled to do** —
and a withdrawal right that the database refuses to write down is the one kind of consent bug
that is impossible to argue away afterwards.

### 3.7 Anti-patterns — things that must never appear in a PR

| Anti-pattern | Why it is wrong |
|---|---|
| `update consent_record set action = 'withdrawn'` | Destroys the history that is the entire point. The table is append-only and trigger-enforced |
| Reading consent by `select ... from consent_record order by occurred_at desc limit 1` in application code | Use the `current_consent` view. Hand-rolled "latest row" logic drifts, and the view is `security_invoker` so it inherits RLS |
| A default of `true` on any consent | Consent by omission |
| Recording consent for a purpose that is not in `consent_purpose` | The FK stops it. Do not work around it by widening the column |
| Storing the child's name in `capture_context` | It is jsonb, it is easy, and it puts tier-P data into a column that is copied into logs and support tools. §4.2 |
| Treating `is_required_for_service` as "so we don't need to ask" | Required means *the service cannot be provided without it*, not *it is assumed* |

---

## 4. The consent record shape

### 4.1 Field by field

`consent_record` (`docs/data-model.md` §11.5, `0001` §9). Append-only; `UPDATE`/`DELETE`
revoked and trigger-enforced.

| Column | What goes in it | Rule |
|---|---|---|
| `user_id` | The **adult who acted** | Never the child. On a dependent's consent this is the guardian |
| `subject_type` / `subject_id` | **Whose data it is** — `user` + the user's id, or `recipient` + the child's id | The pair is what `current_consent` keys on |
| `purpose_code` | One row per purpose. Never a bundle | FK to `consent_purpose` |
| `action` | `granted` \| `withdrawn` \| `expired` \| `superseded` | `expired` and `superseded` are written by the system, never by a user action — see §4.6 |
| `policy_version_id` | The privacy notice **in force at that moment** | Nullable in the schema; **treat it as mandatory** for any `granted` row. A grant with no policy version cannot evidence what the person was told |
| `occurred_at` | Server time, `now()` | Never a client clock |
| `capture_method` | `in_app_checkbox` \| `web_checkbox` \| `written` \| `admin_recorded` \| `migration_backfill` | `migration_backfill` is only ever for a real pre-cutover consent carried over **with evidence** |
| `verification_method` | How the adult was verified. Untyped `text` until `[DM-12]` returns | §4.3 |
| `capture_context` | jsonb. Screen name, app version, the id of the exact wording shown, the platform | §4.2 — **no PII, ever** |
| `evidence_text` | For `written` / `admin_recorded` only: what was actually said and by whom | Free text written by staff. Treat as tier A |
| `recorded_by_user_id` | The staff member, for `admin_recorded` | Null for self-service |

### 4.2 `capture_context` — allowed and forbidden

It is jsonb, so nothing stops a developer putting anything in it. The rule:

**Allowed:** `screen` (`add_dependent`, `settings_privacy`), `wording_id` (the id of the string
bundle shown, so the exact words are reconstructible), `app_version`, `platform`
(`ios`/`android`/`web`), `locale`, `policy_sha256` (a second copy of the proof), `flow`
(`onboarding`/`edit`), `correlation_id`.

**Forbidden:** any name, any phone or email, the school, the class, the section, any allergen,
a raw IP address, a device identifier, free text typed by a user.

Rationale: `capture_context` is the field most likely to be dumped into a support tool, an
export or a log line, because it looks like metadata. Two of the forbidden items — the child's
name and the allergen list — are tier P and tier S, which non-negotiable #4 says never leave the
database. `E20-10`'s scrubbing test should assert on this column specifically.

### 4.3 `verification_method` vocabulary

Deliberately untyped `text` until `[DM-12]` returns. When it does, these are the values to use,
and the column should get a `CHECK` constraint at that point (following `D18` — a closed set
that the ERD does not name is `text` + `CHECK`, not a new enum type):

| Value | Meaning |
|---|---|
| `otp_authenticated_adult` | Branch A. The acting adult holds a session established by phone OTP |
| `payment_instrument` | A successful payment by the adult was used as the verification signal |
| `govt_id` | An identity document was checked. **If this is the answer, the retention and breach surface of the document itself must be designed before the flow is built** |
| `consent_manager:<registered-id>` | Consent obtained through a registered Consent Manager |
| `written` | Paper or email, transcribed by staff, with `evidence_text` |
| `not_verified` | **Only** valid for `migration_backfill` rows, and every such row is a known gap that `E20-01` must be told about |

### 4.4 Worked examples

A parent adds a child on 3 March 2027, with allergies, under privacy policy v2:

```jsonc
// three rows, one transaction, alongside the recipient and guardian_link inserts
{ "user_id": "…parent",  "subject_type": "recipient", "subject_id": "…child",
  "purpose_code": "child_data_processing", "action": "granted",
  "policy_version_id": "…v2", "occurred_at": "2027-03-03T09:14:22+05:30",
  "capture_method": "in_app_checkbox", "verification_method": "otp_authenticated_adult",
  "capture_context": { "screen": "add_dependent", "wording_id": "consent.child.v2",
                       "app_version": "1.4.0", "platform": "android",
                       "correlation_id": "…" } }
{ …same, "purpose_code": "order_fulfilment" }
{ …same, "purpose_code": "allergen_health_data",
  "capture_context": { "screen": "add_dependent_allergies", "wording_id": "consent.allergen.v2", … } }
```

The parent turns off the allergy warning on 20 April — **one new row, nothing updated**:

```jsonc
{ "user_id": "…parent", "subject_type": "recipient", "subject_id": "…child",
  "purpose_code": "allergen_health_data", "action": "withdrawn",
  "policy_version_id": "…v2", "occurred_at": "2027-04-20T18:02:51+05:30",
  "capture_method": "in_app_checkbox", "verification_method": "otp_authenticated_adult",
  "capture_context": { "screen": "settings_privacy", "wording_id": "withdraw.allergen.v2", … } }
```

…and in the same transaction, every `recipient_allergen` row and `recipient.allergy_note` for
that child is deleted. Turning it back on on 22 April is a third row, `granted`. The history now
reads *granted 3 Mar → withdrawn 20 Apr → granted 22 Apr*, which is the sentence a regulator
asks for, and `current_consent` returns exactly one row: the latest.

### 4.5 Reading consent — the three questions code asks

Application code never reads `consent_record` directly. It asks `current_consent` one of three
questions, and each has exactly one right form:

| Question | Where it is asked | Form |
|---|---|---|
| "May I show an allergen warning for this child?" | Add-to-cart (`E05-05`) | `current_consent` where `(recipient, allergen_health_data)` and `action = 'granted'` |
| "May this dependent be ordered for at all?" | Checkout (`E05-04`, `E06`) | Both required purposes `granted`, **and** the `E20-03` policy gate passes |
| "What is this child's consent state?" (for the parent to see) | Settings → Privacy | The full `current_consent` set for the recipient, rendered as toggles |

Consent is **not** re-checked on every read of a row that already exists — a delivered order's
`recipient_name_snapshot` is not gated on live consent, because it is a historical record held
under `D15`/§6. Consent gates **new processing**, not the existence of past records. Getting
this backwards produces an app that retroactively empties a parent's order history the moment
they toggle something, which is both wrong and alarming.

### 4.6 Supersession on a new policy version

When a new `policy_version` of the privacy notice becomes effective and `requires_acceptance`
is true:

1. `user_policy_acceptance` gates ordering (`blocks_ordering`) until the adult accepts. This is
   the existing `E20-03` mechanism and needs nothing new.
2. Existing **consents are not automatically invalidated.** A privacy notice update does not
   erase a consent that was validly given.
3. **Unless the purposes themselves changed.** If a purpose's meaning changes — new recipient,
   new use — that is a *new purpose*, and the old consent does not cover it. Add a new
   `consent_purpose` row and ask again; write `superseded` against the old one. **Do not edit
   the meaning of an existing `consent_purpose` row in place.** `C2`.

`expired` exists for a consent with a stated lifetime. We do not currently expire any consent;
if `E20-01` says a child's consent must be re-affirmed periodically (annually, or at a change of
school year), that is the mechanism, and it needs a job. `[DP-06]`.

---

## 5. Purpose limitation, enforced in code (`E20-09`)

The principle: **a purpose that is stated in the notice but not enforced by a control is a
statement, not a limitation.** Every row below has a named control and a named test.

### 5.1 The matrix

| Purpose | Data it authorises | Who may see it | Enforced by | Test |
|---|---|---|---|---|
| `child_data_processing` | Tier P on `recipient` | The guardian(s) with a live `guardian_link`; platform admin | RLS: `auth_can_manage_recipient` / `auth_can_reach_recipient` (`D10` — `guardian_link` is the **only** path) | `authorization.test.sql` — customer A cannot see customer B's recipient |
| `order_fulfilment` | Tier P + tier S on the order and packing list | Kitchen and delivery staff, scoped to their kitchen/school, holding `orders.view_pii` | RLS at the row level; `orders.view_pii` in the `api/` layer — **`[AZ-02]`: RLS cannot withhold a column** | Persona sweep; plus the `[AZ-02]` tripwire test (below) |
| `allergen_health_data` | Tier S | The guardian; kitchen staff preparing that order. **`consent.view` does not open it** | RLS on `recipient_allergen` requires an order-visibility check, not a consent grant | `authorization.test.sql` |
| `school_reporting_aggregate` | Counts and money, **never a name** | `SchoolViewer` | `school_report` holds aggregates only; `SchoolViewer` gets none of S, P or A | `E11-03`; assert no tier-P column feeds a report query |
| `marketing_email` / `marketing_push` | Adult contact details | The sender job | `applies_to_subject = 'self'` — **a child can never be a marketing subject** | Assert no send targets a `recipient` |
| `product_analytics` | Behavioural events about the **adult** | The analytics vendor | Scrubbing at the client and at the edge | `E20-10` — a fixture containing a sentinel child name must not appear in any outbound payload |

**The `[AZ-02]` tripwire.** `orders.view_pii` is not enforceable in the database, because RLS
filters rows and cannot hide a column, and a customer and a kitchen operator are the same
Postgres role. It is safe *today* only because every template holding `orders.view` also holds
`orders.view_pii`. The control is a test that **fails the moment a grant of `orders.view`
without `orders.view_pii` is issued** — which is exactly what `E20-09`'s analyst role would be —
so the deadline for building `AZ-02` option (b) enforces itself instead of being remembered.

### 5.2 What each enforcement point can and cannot do

| Control | Can | Cannot |
|---|---|---|
| **RLS** | Decide which **rows** a caller sees. Be the authorization for customer-owned writes (`AZ-01` class 1) | Hide a **column** (`AZ-02`). Constrain a value on insert (which is why money is class 3) |
| **Guard triggers** | Raise on an attempt to change a protected column | Filter |
| **Grants** | Split `orders.view` from `orders.refund` (`D3`) | Be finer than a row, see above |
| **The `api/` module** | Project away columns; be the single place a rule is written (`A4`) | Be a security boundary on its own — a bug there is an exposure, which is why class 1 writes go through RLS as well |
| **Egress scrubbing** | Stop tier S/P leaving for Sentry, analytics, Razorpay | Retrieve what has already been sent |

### 5.3 Egress rules — the five places data leaves

1. **Logs.** Structured logs identify an order by `correlation_id` and `order_ref`, never by a
   recipient name (`docs/data-model.md` §13.3 rule 2).
2. **Sentry.** No tier S or P, ever. Also no tier A: an adult's phone number in a stack trace is
   still personal data leaving the country. `E20-10` — scrubbing rules verified by test, with a
   sentinel-name fixture.
3. **Analytics.** Events describe the adult's funnel, never the child. No event is keyed on a
   `recipient_id`. No behavioural profile of a child exists to be built. `E15-11`, and it is the
   code half of the s.9 no-tracking reading in §3.3.
4. **Razorpay.** `PY8` already makes this a test: `notes` carries `order_group_id`,
   `correlation_id` and `order_ref`; `prefill` carries the **paying adult's** phone and email
   because they are the payer; a sentinel recipient name must appear in no outbound request body
   and no stored payload. This is the rule a well-meaning "let's add the child's name so support
   can find it" PR breaks in one line.
5. **The school.** Aggregates only (`P6`, `E11-03`). The school gets counts, not children.

### 5.4 Data minimisation as a standing question

Purpose limitation's quieter half. Two live examples worth revisiting before launch, both of
which are cheap now and awkward later:

- `order.class_label_snapshot` and `section_label_snapshot` exist for the packing list. They are
  correctly **absent** from the invoice (`G7`) — a name-class-section triple on a statutory
  document is a school roster preserved indefinitely inside the accounts.
- `user_policy_acceptance.ip_hash` and `user_agent_hash` are hashed with a server-side pepper
  and never stored raw. That is the right shape: enough to evidence a distinct acceptance, not a
  location record. **Do not "improve" it by storing the raw value for debugging.**

---

## 6. Retention (`E20-05`)

### 6.1 Principles

1. **Retention is data, not a comment in a cron job.** `retention_policy` is inspectable and
   `purge_run` evidences that it ran — including dry runs — so "we delete after N days" is
   demonstrable rather than asserted.
2. **Never hard-delete a row an invoice or ledger entry depends on** (`D15`). Erasure is soft
   delete → anonymise in place.
3. **A child's health data has no statutory retention basis and is deleted outright.**
4. **Every table holding tier S, P or A data has a retention decision**, and a missing decision
   is a loud failure, not a silent "keep forever" (§6.4).
5. **The consent record survives erasure.** It is the evidence that the processing was lawful;
   deleting it on erasure destroys our own defence. Its own retention runs from the erasure
   date, not from the account's creation.

### 6.2 The proposed schedule — **numbers are proposals, not decisions**

> **None of these numbers are decided.** `retention_policy` is deliberately unseeded in `0001`
> because inventing a number here would be inventing the law. The table below is what we
> **propose** to seed, with the reasoning, so that `E20-01` and the accountant can correct a
> number rather than produce a schedule from scratch. `[DP-02]`.

| Entity | Proposed | Action | Basis | Statutory? |
|---|---|---|---|---|
| `invoice`, `invoice_line`, `invoice_sequence`, invoice PDFs | **8 years** from the end of the financial year | retain, then `delete` | Our reading: the CGST floor is 72 months from the due date of the annual return, and the Companies Act books requirement is longer. **Take the longer of the two.** The accountant owns this number (`E00-10`) | **yes** |
| `ledger_transaction`, `ledger_entry`, `payout*` | **8 years** | retain | Books of account. Must match the invoice number or the books do not reconcile | **yes** |
| `"order"`, `order_line` — the rows | **8 years** | retain | They are the supporting record behind an invoice | yes |
| `"order"` — tier-P **snapshot columns** (`recipient_name_snapshot`, `class_label_snapshot`, `section_label_snapshot`) | **18 months** after `service_date` | `anonymise` | The packing list needed them for a day. Nothing after that needs a child's name and class; the invoice line already carries a first name for the parent's benefit (`G7`) | no |
| `order_line.allergen_codes_snapshot` | **36 months** after `service_date` | `anonymise` | Tier S, but it is the record of *what the dish was declared to contain* if a child reacted. Longer than the name; not forever. **A lawyer may want this tied to the limitation period for a personal-injury claim** | `[confirm]` |
| `recipient_allergen`, `recipient.allergy_note` | **Immediately** on withdrawal, removal or erasure | `delete` | No statutory basis exists for retaining a child's health data | no |
| `recipient` — tier-P columns | **12 months** after the last order **and** removal of the last active `guardian_link` | `anonymise` | | no |
| `app_user` — tier-A columns | On erasure; otherwise **36 months** after last activity | `anonymise` | Dormant-account hygiene | no |
| `invoice.buyer_*_snapshot` | **8 years** | retain | It *is* the statutory record. Survives erasure — and the parent must be told so (§6.6) | **yes** |
| `consent_record`, `user_policy_acceptance` | **3 years** after the account is erased | retain, then `delete` | Evidence that processing was lawful. Outlives the data it authorised | `[confirm]` |
| `data_subject_request` | **3 years** after `completed_at` | retain, then `delete` | Evidence of compliance with the grievance process | `[confirm]` |
| `audit_log` | **36 months** | `delete` | It is the record of *who looked at a child's data*. Short retention here weakens the answer to the only question that matters after a breach | no |
| `payment_webhook_event` | **24 months** | `delete` | Reconciliation window (`PY7`). Payloads may carry a payer's contact details | no |
| `notification_delivery` | **12 months** | `delete` | Holds an email address / phone number per row | no |
| `device_token` | Revoke at **90 days** inactive; delete at **12 months** | `delete` | | no |
| `idempotency_key` | **24 hours** | `delete` | Already in the schema | no |
| `migration.migration_review`, `migration.legacy_id_map` | **Torn down once the review queue is worked** — no later than `E17-22` (cutover-day manual review). Not a rolling window; a one-off teardown | `delete` | These are **migration scaffolding that holds live tier-A/P data**: `migration_review` parks ambiguous/duplicate phone matches (`E03-11`, `[DM-11]`), so `detail jsonb` and `legacy_id` will contain legacy **phone numbers and probably names**; `legacy_id_map` is the same shape. They exist only to reconcile Bubble ids during cutover and have no reason to outlive it. Until they are classified they are the loud resting state §6.4 wants — see below | no |
| OTP / auth-log state (Supabase `auth` / GoTrue schema) | **Governed by the auth provider's (GoTrue) retention setting** — our purge job does not reach the `auth` schema | vendor-side | OTP and sign-in state lives in Supabase's managed `auth` (GoTrue) schema, not in a table we own. There is **no `otp_attempt` table in `0001`**, so our purge job cannot delete it and must not claim to. Its retention is whatever the auth provider is configured to. **`E20-33`** builds an owned `otp_attempt` table (needed by `E03-10`'s per-number/per-IP throttle counting); once it exists it gets its own real retention row (proposed **90 days** — fraud investigation window). | no |
| `purge_run` | **Retain** | retain | It is the evidence that retention happened | no |
| `school_report` | **3 years** | retain | Aggregates only — no personal data in it at all | no |
| Sentry events | **30 days** (vendor-side setting) | `delete` | Should contain no personal data anyway (§5.3); the short window is defence in depth | no |
| Better Stack logs | **30 days** (vendor-side setting) | `delete` | Same | no |

**Two things this table cannot currently express, and both need `0003`:**

- **`retention_policy.action` is `check (action in ('delete','anonymise'))`.** There is no way to
  record "we keep this, by law, indefinitely" — which is the answer for exactly the rows that
  matter most. Written as a long `retention_days` it becomes a claim that we delete invoices in
  year eight, which may be wrong. `E20-13`: add `'retain'` and make `retention_days` nullable
  when the action is `retain`. Same family as `[PAY-05]` — *the table modelled the mechanism
  completely and the vocabulary partially, and the missing vocabulary is invisible until you try
  to insert a real row.*
- **A column-level rule** ("anonymise these three columns on `"order"`, keep the row") does not
  fit a table keyed on `entity`. Options: an `entity` value of `order.pii_snapshot` naming a
  documented column set, or a `columns text[]` column. The first is cheaper and is what §6.2
  assumes; it needs writing down wherever the purge job reads. `E20-19`.

### 6.3 What `delete` and `anonymise` actually mean

| Action | Definition | Applies to |
|---|---|---|
| `delete` | The row is gone. Only legal where nothing references it `ON DELETE RESTRICT` | Tier S, operational rows, expired tokens |
| `anonymise` | The row survives; every identifying value is replaced. Names → `null`; `phone_e164` → a **non-routable sentinel that preserves uniqueness** (the column is unique and a null would collide across users); `email` → `null`; tier-P snapshots → `null`. `anonymised_at` is set | Tier A and tier P on rows an invoice or ledger entry depends on |

The sentinel-phone detail is not cosmetic: `phone_e164` is unique, so anonymising two users by
nulling it works, and anonymising two users by setting both to `+910000000000` does not. Use a
per-row non-routable value (e.g. an unroutable prefix plus the user id) so uniqueness survives
and the value cannot be dialled or texted.

### 6.4 The purge job

```
nightly:
  for each retention_policy row:
    1. compute cutoff_date from retention_days
    2. DRY RUN first — count the rows, write purge_run(is_dry_run = true)
    3. if the count exceeds the alarm threshold for that entity → STOP and alert.
       A purge that suddenly wants to delete 100× the usual number is a bug in the
       cutoff arithmetic, and it is unrecoverable if it runs.
    4. execute; write purge_run(rows_affected, is_dry_run = false)
    5. on error: write purge_run(error_text) and alert. Never silently skip.

  coverage assertion (this is the important one):
    every table carrying tier S, P or A data must have a retention_policy row.
    A table with no row is NOT "keep forever" — it is an alert.
```

Rule 5's coverage assertion is the same instinct as `D17` (RLS on from the first migration, with
no policies, so the failure mode is "nobody can read anything") and `MI3` (every row accounted
for): **the resting state must be loud.** A retention schedule that silently omits a table is
indistinguishable from one that covers it, right up until a regulator asks. `E20-19`.

**The `migration` schema is exactly this failure mode, caught.** `migration.migration_review` and
`migration.legacy_id_map` carry tier-A/P data (legacy phone numbers, and probably names, in
`detail jsonb` / `legacy_id`) and had **no** retention row and **no** place in the §6.5 erasure
pipeline. The coverage assertion above should therefore **fail** on them until they are classified
— which is the correct, loud outcome, and the production instance of the same live-children's-data
concern `E16-13` raises about staging. They are not erased per-recipient (they predate any new-stack
`app_user`/`recipient` and are keyed on legacy ids); instead they are **torn down as a unit once the
migration-review queue is worked** (no later than `E17-22`'s cutover-day manual review). §6.2 now
carries their row; `E20-32` owns adding the teardown job and asserting the schema is empty afterward.

### 6.5 The erasure pipeline — a fixed order, with a `scope`

Triggered by: a `data_subject_request` of type `erasure`, an in-app account deletion (`E03-08`,
an app-store requirement on both platforms), or withdrawal of a required consent for **one
child** (§3.5). One Edge Function, running as `service_role`, in the fixed order below — **the
order matters** — but it takes a **`scope` parameter that decides which rows it touches**:

| `scope` | Triggered by | What it erases |
|---|---|---|
| **`recipient`** | Withdrawal of `child_data_processing` / `order_fulfilment` for **one dependent** (§3.5); a `data_subject_request` scoped to a single child | **Only that dependent** — the child's `recipient` row, its tier-S and tier-P data, its consent withdrawals, its snapshots on historical orders. **The parent's `app_user` row and every other dependent are untouched.** |
| **`account`** | In-app account deletion (`E03-08`); a `data_subject_request` of type `erasure` against the whole account | The account: every dependent (each run through the `recipient` steps), **plus** the parent's own tier-A data, tokens and preferences |

> **The bug this fixes (review §2.5).** The pipeline was written for `account` and then invoked
> from a **single-child** withdrawal (§3.5). Run unscoped, withdrawing consent for one child of
> two would soft-delete and anonymise the **parent** (step 1's `app_user.deleted_at`, step 5's
> `app_user` names/phone/email) and delete the parent's device tokens (step 4) — taking the
> other child with it. A single child's withdrawal must run **`scope = 'recipient'`** and touch
> nothing on `app_user`.

The steps, annotated with which scope runs them:

```
                              scope
1. Stop access first.         recipient: set recipient.deleted_at for THAT child only.
                              account:   set app_user.deleted_at AND every recipient.deleted_at.
                              The restrictive deny_dead_accounts policy takes effect
                              immediately on the row(s) set; nothing further can be ordered
                              for the deactivated subject. This is the part the user asked
                              for, and it must not wait for the rest to succeed.
                              (See step 2 — record the withdrawal BEFORE this in the same
                              transaction, because after this no customer-facing path can.)

2. Record the withdrawal.     both: insert consent_record(action = 'withdrawn') for every
                              live purpose of the affected subject(s) — in recipient scope,
                              only that child's purposes; in account scope, the child
                              purposes AND the adult's self purposes. This runs FIRST,
                              in the same transaction as step 1, because once step 1's
                              deleted_at is set no customer-facing path can write it
                              (§3.2, §3.6); the pipeline can only because it is service_role.

3. Delete tier S outright.    both: recipient_allergen rows; recipient.allergy_note, for
                              the affected recipient(s). No statutory basis, so no
                              anonymisation half-measure.

4. Revoke.                    recipient: guardian_link.revoked_at for links to THAT child.
                              account:   also delete the parent's device_token rows and
                                         turn notification_preference off.
                              (In recipient scope the parent keeps their tokens and
                              preferences — they still have an account and other children.)

5. Anonymise tier A and P.    recipient: recipient names, class, section for that child.
                              account:   also app_user names/phone/email.
                              Set anonymised_at on each row touched.

6. Tier-P snapshots on         both: null recipient_name_snapshot / class / section on the
   historical orders.          affected recipient's orders past the §6.2 window. Orders
                               inside the window keep them until the nightly purge reaches
                               them — the kitchen may still have to deliver a meal that is
                               already paid for.

7. Leave alone, on purpose.   both: invoice.buyer_*_snapshot, invoice_line.description,
                              ledger entries, the order rows themselves. These are the
                              statutory record (D15).

8. Evidence.                  both: audit_log + purge_run. Close the data_subject_request
                              with a resolution_note naming the scope, what was deleted and
                              what was kept.
```

**`E20-18`'s "one Edge Function running the fixed order" must respect this `scope` parameter** —
the order of the steps is still fixed, but steps 1, 4 and 5 do less work in `recipient` scope,
and none of them may touch `app_user` in `recipient` scope. A test must assert that a
`recipient`-scope run leaves the parent's `app_user` row and any sibling `recipient` rows
byte-for-byte unchanged.

**Never `ON DELETE CASCADE`.** Every foreign key into a personal-data table is `RESTRICT`
precisely so that an erasure cannot quietly take the books with it.

### 6.6 What survives erasure, and telling the parent so

A DPDP erasure right is qualified by other law: we may keep what we are required to keep. What
survives is:

- **The tax invoice**, including the buyer name, address and the recipient's **first name** on
  the line (`G7`), for the statutory period.
- **The ledger and payout records** behind it.
- **The order rows** as supporting documents, with the child's name, class and section nulled
  once past the §6.2 window.
- **The consent record itself**, which is the evidence that we were entitled to hold any of it.

Everything else goes. **The erasure confirmation must say this in plain words**, before the
parent confirms — a deletion that silently keeps a child's first name on an invoice for eight
years, discovered later, is a complaint that we caused ourselves. The wording belongs in
`docs/privacy-policy.md` (`Q11`) and in the in-app confirmation. `[confirm in E20-01]` that this
retention is in fact permitted and that our characterisation of it is right.

---

## 7. Grievance officer (`E20-07`)

### 7.1 What must be published, and where

Our reading of s.13 (right to grievance redressal) and the notice requirements: a data
principal must be able to find, without an account and without asking, **who to contact and how
long it will take**. `[confirm in E20-01]`.

| Where | What appears |
|---|---|
| Website footer, on every page | "Grievance Officer" link → the block in §7.2 |
| `docs/privacy-policy.md` | The same block, verbatim, in the notice |
| App → Settings → Privacy | The same block, plus a "Raise a request" button that creates a `data_subject_request` without the user having to compose an email |
| App store listings | The privacy policy URL, which contains the block |
| Consent screens | At minimum the contact address (§3.3) |

Note `[AZ-03]`: `anon` holds **zero** RLS policies, so the website renders policy text from its
own static build or from an Edge Function — never from a public table read. The grievance block
is static content, which is the cheapest possible answer here.

### 7.2 The published block — template

> **Copy this verbatim into the website, the privacy policy and the app. The four placeholder
> tokens must be resolved before launch, and a production build containing one must fail CI**
> (`E20-22`, the same guard as `G3`).

```
Grievance Officer — GrayBag

Under the Digital Personal Data Protection Act, 2023, you may contact our
Grievance Officer about how we handle your personal data, or the personal data of
a child in your care.

  Name        «GRIEVANCE-OFFICER-NAME-PENDING-E20-21»
  Designation «GRIEVANCE-OFFICER-TITLE-PENDING-E20-21»
  Email       «GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»
  Address     «GRIEVANCE-OFFICER-ADDRESS-PENDING-E20-21»

You can ask us to:
  • give you a copy of the personal data we hold about you or your child;
  • correct anything that is wrong or out of date;
  • delete your account and the personal data we are not required by law to keep;
  • withdraw a consent you have given, at any time.

The fastest way is in the app: Settings → Privacy → Raise a request. You can also
email the address above.

We will acknowledge your request within «DSR-ACK-DAYS-PENDING-E20-01» working days
and respond within «DSR-RESPONSE-DAYS-PENDING-E20-01» days.

If you are not satisfied with our response, you may complain to the Data
Protection Board of India.
```

**A note on who this person is.** The Act does not require a small fiduciary to appoint a Data
Protection Officer — that obligation attaches to a Significant Data Fiduciary (`[DP-01]`) and
carries an India-residency requirement. It does require a means of grievance redressal. Naming
Andy is the obvious answer and is a **decision he has to make and publish**, which is why
`E20-21` is `(owner:andy)`. `[confirm in E20-01]` whether a DPO is required and whether the
published details must include a postal address.

### 7.3 Intake, the clock, and escalation

**Every request becomes a row before it becomes an email.** Any channel — in-app, the grievance
inbox, a web form, a phone call taken by Andy — is entered as a `data_subject_request` at
intake, with `channel` set. This is not bureaucracy: `ix_data_subject_request_due` is the *only*
thing that makes an approaching statutory deadline visible, and a request that lives only in an
inbox is invisible to it. `C8`.

```
received  ──▶ in_progress ──▶ completed
    │                              ▲
    └──────────▶ rejected ─────────┘   (with a reason, and the right of appeal stated)
```

| Step | Owner | Deadline |
|---|---|---|
| Row created, `due_at` computed | Automatic (in-app) or the grievance officer (other channels) | At intake |
| Acknowledge to the requester | Grievance officer | `«DSR-ACK-DAYS-PENDING-E20-01»` |
| Verify the requester (§7.4) | Grievance officer | Before disclosing anything |
| Fulfil: access → export; correction → edit; erasure → §6.5; withdrawal → §3.5 | Grievance officer + the pipeline | `«DSR-RESPONSE-DAYS-PENDING-E20-01»` |
| Close with `resolution_note` saying what was done | Grievance officer | |

**`due_at` is `not null` and there is no default.** The number of days is a legal value that
does not exist yet, and it currently has nowhere to live — `platform_config` has no
`dsr_response_days` column. `E20-14` adds it, so that when `E20-01` returns the deadline is a
config change and not a code change, and so it is the *same* number everywhere it is quoted.

### 7.4 Verifying the requester without over-collecting

A subject-access request is a data-disclosure event, and the classic failure is handing someone
else's child's data to a caller who sounded convincing.

- **In-app requests are already authenticated** (phone + OTP) and need nothing further. This is
  the strongest reason to make the in-app path the primary one.
- **Email or phone requests** are verified by matching the registered phone number and
  completing an OTP — i.e. we push the requester into the authenticated path rather than
  building a second one.
- **Do not ask for an ID document to prove identity for a routine request.** Collecting a
  government ID to service a privacy request means collecting more personal data than we hold
  in the first place, and creates a retention and breach problem that did not previously exist.
- **A guardian may request about their child** only where a live `guardian_link` exists. Where
  it does not (a separated parent, for instance), it is not a technical question and it goes to
  the lawyer. `[DP-07]`.

### 7.5 The overdue alarm

Missing a statutory deadline is the failure mode this whole section exists to prevent, and it
fails silently by construction — nothing errors when a date passes.

- **Warn** at 50% of the window elapsed on any `received` / `in_progress` row.
- **Page** the moment any row passes `due_at`.
- **Daily digest** lists open requests with days remaining, so the state is visible without
  anyone querying anything.

`E20-17`. Same reasoning as `PY3`: when the failure mode is silence, the alert has to be built
deliberately, because nothing will complain on its own.

---

## 8. Breach-notification runbook (`E20-08`)

### 8.1 What counts as a personal data breach

Our reading: any unauthorised processing, or accidental disclosure, acquisition, sharing, use,
alteration, destruction or loss of access, that compromises the confidentiality, integrity or
availability of personal data. `[confirm in E20-01]`.

**Is a breach:**

- Personal data readable without authorisation — an RLS policy removed or bypassed, a public
  Storage bucket, an unauthenticated endpoint returning rows.
- A `service_role` key, database credential or provider key leaked (`E00-01` shape).
- Back-office access by someone whose grant was revoked, or a grant issued in error that was
  used.
- An export, screenshot or report containing tier S or P data sent to the wrong recipient — a
  school report with a child's name in it, an invoice emailed to the wrong parent.
- A processor telling us **they** were breached.
- **Loss of availability**, not just confidentiality: a destructive incident or ransomware that
  makes data inaccessible is in scope on our reading.

**Is not a breach:**

- A kitchen operator seeing a child's name and class for an order they are preparing. That is
  the purpose.
- A vulnerability found and fixed with no evidence of access — but **log the assessment**,
  because "no evidence of access" is a conclusion that has to be supportable.
- A failed login, a rate-limited scrape, a blocked request.

**The one already on the books.** The legacy Bubble app makes `Order` and `Child` readable by
any visitor and may expose the Data API publicly (`E00-04`, `E00-05`), and `R3` keeps Bubble
alive for 30 days after cutover. If that exposure has been live under the DPDP regime, the
question of whether it is *itself* a notifiable breach is a real one and must be asked
explicitly rather than assumed away. `E20-23` prepares the facts (what was exposed, since when,
how many records) so `E20-01` can answer it. `[DP-03]`.

### 8.2 Severity

| Class | Definition | Response |
|---|---|---|
| **SEV-1** | Tier S or P exposed, or credentials that reach them leaked, or any exposure with evidence of third-party access | Full runbook. Assume notifiable |
| **SEV-2** | Tier A exposed, or a confirmed exposure with no evidence of access | Full runbook; the notification decision is made at T+6h with legal input |
| **SEV-3** | A vulnerability with no exposure; a processor incident that did not touch our data | Assess, log, fix. No notification, but the assessment is written down |

**When in doubt, it is one class higher.** The cost of over-classifying is a wasted afternoon;
the cost of under-classifying is a missed statutory deadline that cannot be recovered.

### 8.3 How we would find out

Ordered by how likely each is to be the actual first signal, which is not the order people
expect:

1. **Someone tells us.** A parent, a school, a researcher. **This needs a published address to
   arrive at** — the grievance email in §7.2 doubles as it, and a `security.txt` on the website
   should point at the same place. The legacy exposure, had it been noticed, would have arrived
   this way.
2. **A processor tells us** — Supabase, Razorpay, the SMS provider.
3. **CI.** The `authorization.test.sql` suite failing on a deny is a *potential exposure*, not
   just a red build. A PR that removes a policy is the most likely way we would cause one.
4. **Sentry / Better Stack** — an error spike, an unexpected 200 on an authenticated route.
5. **The `anon` visibility assertion** — zero rows from all tables, the single most important
   property in the model (`[AZ-03]`).
6. **Anomalous volume** — a back-office account reading thousands of rows, or an export that
   does not match anyone's job.

`[DP-03]` includes asking whether a defined detection capability is itself required.

### 8.4 The clock

> **T+0 is the moment of the first credible signal, not the moment of confirmation.** `C7`.
> Waiting for certainty before starting the clock is how a 72-hour deadline becomes a
> 20-hour one, and the timestamp we will be asked for is when we *became aware*, not when we
> finished investigating.

The deadlines below are **our reading and are not confirmed**. They are written as config
(`E20-14`) rather than constants precisely because they may be wrong. `[confirm in E20-01]`,
`[DP-03]`.

| Time | Action | Who |
|---|---|---|
| **T+0** | Declare. Create the incident record with the timestamp of the **signal**. Start a written timeline — every subsequent entry is appended, never edited | Whoever saw it |
| **T+0 → T+1h** | **Contain**, and **preserve evidence in that order of priority.** Rotate the compromised credential; revoke sessions; disable the endpoint or take the surface down. **Do not delete logs, do not `DROP` anything, do not "clean up".** Snapshot the database and export the relevant logs before they roll off — Sentry and Better Stack retention is 30 days and an incident easily runs longer | Incident lead |
| **T+1h → T+6h** | **Scope.** Which tables, which tiers, how many data principals, **how many of them are children**, what window, and is there evidence of actual access as opposed to possible access. Write the answers down even where the answer is "unknown" | Incident lead + technical |
| **T+6h** | **CERT-In.** Our reading is that the CERT-In Directions of April 2022 require certain cyber incidents to be reported **within 6 hours of noticing**, and that this is a *separate and earlier* obligation from the DPDP one. This is the deadline most likely to be missed because it is not the one anyone remembers. `[confirm in E20-01]` | Incident lead |
| **T+6h → T+24h** | **Decide and draft.** Notifiable or not, with the reasoning recorded. Draft the Board notice and the principal notice (§8.7). Legal review | Incident lead + lawyer |
| **Without delay** | **Tell the affected data principals.** Our reading is that intimation to each affected principal is required without delay and is not gated on completing the investigation — a first notice saying what we know and what we are doing is better than a complete one that is late | Grievance officer |
| **T+72h** | **Detailed particulars to the Data Protection Board.** Our reading is that an initial intimation is due without delay and fuller particulars within 72 hours of awareness | Incident lead |
| **T+72h → T+7d** | Notify affected schools where children of their pupils are involved. Follow-up notice to principals with the completed findings and remediation | Incident lead |
| **T+7d → T+30d** | Post-incident review (§8.9). Fix the class of bug, not the instance. New tests | Everyone |

### 8.5 Roles when the team is one person

The honest constraint: GrayBag is one person plus this repo. A runbook that begins "assemble
the incident response team" is a runbook that does not get used.

| Role | Who | Note |
|---|---|---|
| **Incident lead** | Andy | Declares, decides, signs the notices. Cannot be delegated |
| **Technical responder** | Claude Code, or a contractor | Containment, scoping queries, evidence export |
| **Legal** | The `E20-01` lawyer | **This is the single strongest argument for doing `E20-01` early**: at T+6h is not the moment to be finding a data-protection lawyer |
| **Comms** | Andy | Parents and schools |
| **Deputy** | **Undecided — `[DP-01]`** | One person with one phone is a single point of failure against a 6-hour clock. If there is no second person, the compensating control is the drill (`E20-20`) plus written templates that anyone can send |

### 8.6 Decision tree

```
Signal
  ├─ Is personal data involved?           no  → not a DPDP incident. Log it. Still fix it.
  └─ yes
      ├─ Tier S or P?                     yes → SEV-1. Assume notifiable. Start §8.4.
      └─ Tier A only
          ├─ Evidence of access?          yes → SEV-1.
          └─ Exposure but no evidence     → SEV-2. Still start the clock; decide at T+6h.

Notification decision (T+6h → T+24h), each answered in writing:
  1. Were data principals' personal data compromised?         → Board + principals
  2. Are children among them?                                  → escalate; expect scrutiny
  3. Is a CERT-In-reportable cyber incident involved?          → 6-hour clock, separate
  4. Is a processor's own notification obligation triggered?   → tell them, in writing
  5. Is the exposure ongoing?                                  → containment is not finished
```

### 8.7 Notice templates

**Placeholders in angle quotes are filled at incident time. Do not soften the language to make
it sound better; a notice that understates is worse than one that is blunt.**

**(a) Intimation to the Data Protection Board of India**

```
Subject: Personal data breach intimation — GrayBag («INCIDENT-REF»)

1. Data Fiduciary       GrayBag, «LEGAL-NAME», «ADDRESS», «GSTIN»
2. Contact              «GRIEVANCE-OFFICER-NAME», «EMAIL», «PHONE»
3. Nature of the breach «WHAT HAPPENED, IN TWO SENTENCES»
4. When it began        «START», known to be exposed until «END»
5. When we became aware «T+0 TIMESTAMP», via «DETECTION SOURCE»
6. Categories of data   «e.g. children's names, school, class, section; declared allergies
                          (health data); parents' names and phone numbers»
7. Number affected      «N» data principals, of whom «M» are children
8. Likely consequences  «PLAIN ASSESSMENT — do not minimise»
9. Measures taken       «CONTAINMENT, TIMESTAMPED»
10. Measures proposed   «REMEDIATION AND DATES»
11. Principals informed «WHEN AND HOW»
12. Attachments         Timeline; scope query and its result; remediation plan.
```

**(b) To an affected data principal (email + in-app)**

```
Subject: Important — a security incident affecting your GrayBag account

Dear «FIRST NAME»,

We are writing to tell you about a security incident at GrayBag that affected
your personal data«, and personal data about your child».

What happened.        «PLAIN LANGUAGE. NO JARGON. NO BLAME.»
When.                 «DATES», and we became aware on «DATE».
What was affected.    «SPECIFIC: names, school, class, allergies, phone number.»
What was not.         «SPECIFIC: e.g. no card details — those are held by our
                       payment provider and were not involved.»
What we have done.    «CONTAINMENT, IN PAST TENSE, WITH DATES.»
What we are doing.    «REMEDIATION, WITH DATES.»
What you should do.   «CONCRETE OR NOTHING — do not pad this.»

We have reported this to the Data Protection Board of India.

If you have questions, contact our Grievance Officer at «EMAIL». You may also
complain to the Data Protection Board of India.

«NAME», «TITLE», GrayBag
```

**(c) To a school** — same structure, plus how many of its pupils are affected and what the
school may want to tell parents. Send it **before** parents receive (b) where the timing can be
controlled, so the school is not answering questions it has not been briefed on.

**(d) Holding statement** — for use when the scope is not yet known and someone is already
asking. Says: we are aware, we are investigating, we will contact anyone affected directly, and
here is the contact address. **Never says "no data was affected" before that is established.**

### 8.8 The evidence pack

Assembled during, not after. If it is assembled afterwards it is a reconstruction, and it will
have gaps exactly where the questions are.

- The incident timeline, append-only, with the T+0 signal at the top.
- The scope query and its literal output (row counts by table and by tier).
- `audit_log` extracts for the window.
- Supabase, Netlify and provider logs, **exported before they roll off**.
- Every notice sent, with its timestamp and recipient count.
- The containment changes as commits and migrations.
- The decision record: what was decided at each gate, by whom, and why — including a decision
  *not* to notify, which is the one most likely to be questioned.

### 8.9 After

- **Post-incident review within 7 days.** Written. Blameless.
- **Fix the class, not the instance.** The `authorization.test.sql` suite exists because the
  legacy failure was a class of failure, not a single missing rule.
- **Every incident adds a test.** If it cannot be expressed as a test, say so and explain why.
- **Update this runbook** in the same PR as the fix.
- **Drill it.** `E20-20`: run the runbook end to end against a simulated exposure — once before
  launch, then annually. An untested runbook is a document, not a control, and the specific
  thing a drill catches is the discovery that nobody knows where the Board's intimation form is
  or who the lawyer's out-of-hours contact is.

---

## 9. Third-party processor register (`E20-11`)

Every third party that touches personal data. **The contract column is the one that matters and
every row of it is currently unfilled.**

| Party | What it processes | Tiers | Where | Instrument needed | Status |
|---|---|---|---|---|---|
| **Supabase** | Everything — the database, auth, storage, Edge Functions | S, P, A | **Mumbai `ap-south-1`** (`A2`) | DPA + confirmation that support access is logged and region-locked | **Unfilled** |
| **Razorpay** | Payment. `notes` carries ids only; `prefill` carries the **paying adult's** phone and email (`PY8`) | A | India | Possibly an independent fiduciary rather than our processor — §2.1. Disclose in the notice | **Unfilled** |
| **SMS provider** (MSG91 / Gupshup) | Phone number + OTP / transactional message content | A | India | DPA; DLT registration is separate (`E00-06`…`E00-08`) | **Unfilled** |
| **Sentry** | Error events. **Should contain no personal data at all** (`E20-10`) | none, by design | Outside India unless a region is selected | DPA; check whether an EU/US region is in use and whether a data-region option exists | **Unfilled** |
| **Better Stack** | Logs. Same rule | none, by design | Outside India | DPA | **Unfilled** |
| **Netlify** | Marketing site + admin/kitchen web. Serves the app; access logs contain IPs | A (incidental) | Global CDN | DPA; log retention setting | **Unfilled** |
| **Expo / EAS** | Build and OTA update; **Expo Push** handles push tokens and notification bodies | A, and **push bodies must never contain tier P** | Outside India | DPA; a push body rule and its test | **Unfilled** |
| **Email sender** (`E07-04`, `E08`) | Parent email address, invoice PDF, pickup code | A, and the invoice contains a child's **first name** (`G7`) | TBD | DPA; **choose the vendor with this in mind** | **Vendor not chosen** |
| **Apple / Google** | Store-level analytics and crash reporting | A (aggregate) | Outside India | Their standard terms; disclose | n/a |

**Two rules that fall out of this table:**

1. **Cross-border.** Tier S and P never leave the Indian region because they never leave the
   database except to the kitchen (§2.3). Residual tier A does leave, via Sentry, Netlify, Expo
   and the email sender. Whether that requires anything specific under DPDP's transfer rules is
   `[DP-05]` and `[confirm in E20-01]`.
2. **Push notification bodies are an egress path nobody thinks of.** "Aarav's lunch has been
   delivered" is tier P leaving for Expo's servers and appearing on a lock screen. The rule,
   concretely (**`E20-29`**):
   - **No push or notification body may contain tier-P or tier-S data** — in practice, **no
     child's name** (and never a class, section, school or allergen). Refer to the order by a
     neutral phrase ("Your order has been delivered", "Your lunch order is confirmed"), or by an
     order reference the recipient already knows, not by the child.
   - This copy is authored in the **`E08` notification templates**, and the two that will be
     tempted to name the child are **`E08-03`** (*order confirmed — push + email with pickup
     code*) and **`E08-05`** (*order delivered — push*). Those are where the rule bites.
   - It is **covered by the same sentinel-name test as `E20-10`**: a fixture containing a
     sentinel child name must not appear in any rendered push/notification body or any outbound
     Expo Push payload. The test runs against the `E08` templates, not only against Sentry and
     analytics.
   - **The decision "may a push body EVER name a child at all" is `[DP-08]`** and is
     `(owner:andy)` / `E20-01` — not decided here. `E20-29` builds the rule and the test on the
     conservative default (no child name); if `[DP-08]` later permits a child's first name to an
     opted-in parent on that parent's own device, the rule and the sentinel test are relaxed to
     match, not before.

---

## 10. Hand-over checklist for `E20-01`

**Written to be sent to the lawyer as-is**, alongside `docs/data-model.md` §11 and this
document. Each item names what changes depending on the answer, because a question with no
stated consequence gets a general answer.

**A. Scope and status**

1. Which DPDP obligations bind GrayBag **on our launch date**, given the phased commencement of
   the Rules? Which are already live? → decides what must ship in v1 versus what is scheduled.
2. Is GrayBag likely to be a **Significant Data Fiduciary**, given that we process children's
   data including declared allergies at a few thousand users? → a DPO resident in India, a
   DPIA and an annual audit are a staffing and cost question, not a code one. `[DP-01]`
3. Is a **Data Protection Officer** required, or is a grievance officer sufficient? Must the
   published details include a postal address? → §7.2.
4. Is the **school** a joint fiduciary, a processor, or merely a recipient of aggregates?
   Does it need its own consent relationship with the parent? `[DP-04]`

**B. Consent for a child (the big one — `[DM-12]`)**

5. What makes parental consent **verifiable**? Is a tick box by an adult authenticated via
   phone OTP sufficient, or is a payment-instrument or ID check required? → **the entire
   dependent-creation flow, and whether the consent UI can be built at all.**
6. Is a **declared** `is_minor` sufficient, or must age be verified? → whether we must collect
   a date of birth we currently do not.
7. Does consent need **re-affirming** periodically, or on a change of school year? → whether
   `consent_action = 'expired'` needs a job. `[DP-06]`
8. What happens when a child **turns 18**? Does the consent transfer to them, and are we
   required to detect it without holding a date of birth? `[DP-06]`
9. Is our purpose list (§2.2, `docs/data-model.md` §11.4) correct and complete, and is each
   `legal_basis` consent, or is any of it a "legitimate use"? → seeds `consent_purpose`.
10. Can a **separated or non-custodial parent** exercise rights over a child's record where no
    `guardian_link` exists? → §7.4, and it is a family situation before it is a bug. `[DP-07]`
11. Is our reading of the **no-tracking / no-targeted-advertising** rule for children correct —
    that no analytics event may be keyed on a child, and no marketing purpose may name a child
    as its subject? → §3.3, §5.3.

**C. Retention**

12. Are the numbers in §6.2 defensible? Specifically: 18 months for a child's name on an order,
    36 months for the allergen snapshot, 36 months for the audit log, 3 years for the consent
    record after erasure. `[DP-02]`
13. The **statutory floor for GST invoices and books** — the number the whole schedule hangs
    off. (Also `E00-10`, the accountant's.)
14. Is it correct that a child's **first name survives on the tax invoice** through an erasure
    request, and that our characterisation of it to the parent (§6.6) is right?
15. Is deleting a child's **allergy data outright** on withdrawal correct, or is there a reason
    to retain it (e.g. a limitation period for an injury claim)?

**D. Grievance and rights**

16. What is the **response deadline** for an access, correction or erasure request, and is an
    acknowledgement separately required and on what timescale? → seeds `platform_config`
    (`E20-14`), and §7.2's published text.
17. Must we offer a **data export** in a particular form?
18. Is our §7.4 identity-verification approach — push the requester into the authenticated
    app path rather than collect an ID — acceptable?

**E. Breach**

19. **Deadlines and recipients:** intimation to the Board, intimation to affected principals,
    and the content required for each. Is 72 hours for detailed particulars right, and what is
    required "without delay"? `[DP-03]`
20. Does the **CERT-In 6-hour** obligation apply to us, and to which incident classes? It is
    the earliest deadline and the least remembered. `[DP-03]`
21. Are the §8.7 notice templates adequate in form and content?
22. **Is the legacy Bubble exposure itself notifiable?** `Order` and `Child` were readable by
    any visitor and the Data API may have been public (`E00-04`, `E00-05`), and Bubble stays
    live 30 days post-cutover (`R3`). `E20-23` prepares the facts. This is a question to ask
    early, not one to discover later. `[DP-03]`

**F. Documents**

23. Review `docs/privacy-policy.md`, `docs/terms.md` and `docs/refund-policy.md` (`Q11`) once
    drafted, and the consent wording that will seed `consent_purpose` (`E20-12`).

---

## 11. Open questions this document raises

Full entries are in `docs/open-questions.md`. Index:

| Q | One line | Blocks |
|---|---|---|
| `[DP-01]` | Significant Data Fiduciary designation, and the deputy for the incident clock | `E20-01`, `E20-08` |
| `[DP-02]` | The retention numbers in §6.2 | `E20-05`, `E20-19` |
| `[DP-03]` | Breach deadlines, CERT-In, and whether the legacy exposure is notifiable | `E20-08`, `E20-23` |
| `[DP-04]` | Is the school a joint fiduciary, a processor or a recipient? | `E11`, `E20-11` |
| `[DP-05]` | Cross-border transfer of residual tier-A data to Sentry / Netlify / Expo | `E20-11`, `E15` |
| `[DP-06]` | Consent expiry, re-affirmation, and what happens when a child turns 18 | `E20-02`, `E20-12` |
| `[DP-07]` | Rights of a guardian with no live `guardian_link`, and who may withdraw a consent | `E20-15`, `E03` |

**Already open elsewhere, and not duplicated here:** `[DM-12]` (verifiable consent — the single
biggest one), `[DM-15]` (erasure versus statutory retention; `D15` fixed the shape, §6.2
proposes the numbers), `[AZ-02]` (`orders.view_pii` is not enforceable by RLS), `[AZ-07]` (who
may progress a `data_subject_request` — the `consent.view` / `users.manage` mismatch, which
bites `E20-04` directly and should be settled with this document in front of you), `[DS-04]`
(FSSAI veg / non-veg mark — the other regulated-display question).

---

## 12. Task mapping

| Task | Where it is specified |
|---|---|
| `E20-01` (owner:andy) | §10 is the hand-over checklist |
| `E20-02` consent capture | §3, §4 — **blocked on `[DM-12]`** |
| `E20-03` policy versions and the ordering gate | §3.1, §4.6 |
| `E20-04` withdrawal and deletion | §3.5, §6.5, §7.3 |
| `E20-05` retention and purge | §6 |
| `E20-06` privacy notice content | §2, §5.3, §6.6 supply the facts; `Q11` writes it |
| `E20-07` grievance officer | §7 |
| `E20-08` breach runbook | §8 |
| `E20-09` purpose limitation in code | §5 |
| `E20-10` scrubbing children's data from Sentry and analytics | §5.3, §4.2 |
| `E20-11` processor review | §9 |
| `E20-12` … `E20-23` | Raised by this document — see the epic file |
