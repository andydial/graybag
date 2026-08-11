---
title: Overnight review — Q01–Q14, read as a skeptical senior engineer
status: review findings. Nothing here is a decision; every fix is a backlog task or an open question.
produced_by: Q15
reviewed: docs/data-model.md (Q01), supabase/migrations/0001_initial_schema.sql (Q02),
          docs/authorization-model.md (Q03), supabase/migrations/0002_rls_policies.sql +
          supabase/tests/authorization.test.sql (Q04), docs/motion-system.md +
          docs/design-tokens.md (Q05), docs/order-lifecycle.md (Q06), docs/payments-design.md (Q07),
          tools/menu-import/ (Q08), docs/gst-invoicing.md (Q09), docs/dpdp-compliance.md (Q10),
          docs/{privacy-policy,terms,refund-policy}.md (Q11), docs/store-submission.md (Q12),
          docs/{secret-rotation-policy,testing-strategy}.md (Q13), docs/cutover-runbook.md (Q14),
          docs/decisions.md, docs/open-questions.md, planning/backlog/*.md
---

# Overnight review — Q01 to Q14

> ## Status — checked 2026-08-09
>
> **This document is still live: 17 of its 25 tracked findings are open, three of them
> `[BLOCKS]`.** It is not archived and must not be, because it is the only written rationale
> behind those open tasks, and six epic files cite it by section number.
>
> **Closed (8):** `E13-16`, `E13-17`, `E13-18`, `E13-19`, `E13-20` (findings 3, 5, 6, 24, 25) ·
> `E17-23` (11, 26, 28) · `E17-24` (12) · `E02-21` (14).
>
> **Open — `[BLOCKS]` first:**
>
> | # | Finding | Sev | Task |
> |---|---|---|---|
> | 1 | Invoice placeholder guard fires **after** the customer's money is captured | **BLOCKS** | `E07-20` |
> | 2 | Three launch cities span three GST state codes; the cart never derives the split | **BLOCKS** | `E07-21` |

> **SUPERSEDED 2026-08-11 by `SC1`.** This finding rests on `docs/data-model.md` §1.7's
> *12-month planning* column, read as a statement of today's footprint. v1 is **Mohali only** —
> one city, one state code — and non-negotiable #7 forbids IGST and place-of-supply derivation.
> The cart is therefore correct as built. `G4` is superseded, `E07-21` struck, `E07-17`
> rewritten as a one-time assertion on the seller's own GSTIN, `[GST-06]` closed. Left in place
> rather than deleted because this document is the record of what the review found; what was
> wrong was the premise it was given, not the reasoning from it.

> | 4 | Withdrawing consent for one child erases the **parent's** account | **BLOCKS** | `E20-30` |
> | 7 | Push-notification bodies are an unguarded tier-P egress path | HIGH | `E20-29` |
> | 8 | `order_group_status = 'payment_failed'` is unreachable; test 5 expects it | HIGH | `E06-30` |
> | 9 | Migration maps legacy `new → draft`; invariant I12 forbids `draft` | HIGH | `E16-19` |
> | 10 | `resolve_effective_config()` returns null for every customer, silently | HIGH | `E02-20` |
> | 13 | Tier classification differs between normative doc and consumer | MED | `E20-31` |
> | 15 | Storage bucket policies specified, empty in `0002`, owned by nobody | MED | `E02-22` |
> | 16 | `[AZ-02]` tripwire test named three times, owned by nobody | MED | `E02-23` |
> | 17 | `otp_attempt` does not exist; published policy promises its retention | MED | `E20-33` |
> | 18 | `migration.migration_review` holds tier-A/P data with no retention row | MED | `E20-32` |
> | 19 | `product_analytics` purpose has no vendor and a contrary store declaration | MED | `E20-34` |
> | 20 | The ledger's sign convention is never stated | MED | `E06-31` |
> | 22 | Webhook retry sweep has no liveness alert, though `PY2` requires one | MED | `E15-13` |
> | 23 | Cutover asks one person for ~15 continuous hours, irreversible gate at hour 13 | MED | `E17-25` |
> | 27 | Last-4-phone search must be an Edge Function, owned by nobody | LOW | `E09-13` |
>
> Finding 21 (service-role rotation forces a mass re-OTP) carries no task — it is folded into
> `[SEC-02]`.
>
> Re-check with:
> `for id in E07-20 E20-30 …; do grep -rh "\`$id\`" planning/backlog/*.md; done`

Fourteen unattended runs produced ~18,000 lines of specification and 4,200 lines of SQL, each
written against the ones before it and none of them ever executed. This is the pass that reads
them **against each other** rather than in sequence.

The headline: **the corpus is internally consistent to an unusual degree, and the exceptions
cluster in three places** — (1) documents that were written *before* the tasks they cite were
renumbered, (2) arithmetic that nobody re-ran, and (3) rules that were stated in one document
and quietly assumed to be implemented in another. Everything below is either checkable against
a file or reproducible with a calculator; nothing is a matter of taste.

**What this document does not do.** It does not decide anything. Where a finding needs a
judgement call it is written up in `docs/open-questions.md` with options and a recommendation.
Where it needs work it is appended to a backlog epic. Nothing tagged `(owner:andy)` was touched.

**Severity key.** **[BLOCKS]** — would produce a wrong outcome in production or in front of a
regulator. **[HIGH]** — real defect, cheap now, expensive after the code exists.
**[MED]** — a document says something untrue; the code has not been written yet, so it is still
free to fix. **[LOW]** — hygiene.

---

## 0. Summary table

| # | Finding | Severity | Where | Fix |
|---|---|---|---|---|
| 1 | The invoice placeholder guard fires **after** the customer's money is captured | **BLOCKS** | `gst-invoicing.md` §2, `order-lifecycle.md` §8.4 | `E07-20` |
| 2 | The three launch cities span three GST state codes, so `M2`'s flat CGST+SGST is already wrong for two of them — and the **cart** never derives the split | **BLOCKS** | `data-model.md` §1.7/§3.1, `M2`, `E07-06` | `E07-21`, `[GST-06]` |
| 3 | `M09`'s 8-second timeout-and-retry on **Pay** manufactures the double-capture `[OL-05]` says the schema cannot record | **BLOCKS** | `motion-system.md` `M09` vs `order-lifecycle.md` §10.6b/§13 | `E13-20` |
| 4 | Withdrawing consent for **one child** runs an erasure pipeline that anonymises the **parent's account** | **BLOCKS** | `dpdp-compliance.md` §3.5 vs §6.5 | `E20-30` |
| 5 | The prescribed contrast fix for mock 02 does not work — `forest-600` on `primary-600` is **2.57:1**, not the 3.25:1 claimed | **HIGH** | `design-tokens.md` §2.3 | `E13-16` |
| 6 | Five semantic-role pairs fail the contrast bar that `E13-13` will assert | **HIGH** | `design-tokens.md` §2.9 | `E13-17`, `[DS-06]` |
| 7 | Push-notification bodies are an unguarded tier-P egress path | **HIGH** | `dpdp-compliance.md` §9 note 2 | `E20-29`, `[DP-08]` |
| 8 | `order_group_status = 'payment_failed'` is unreachable; test 5 expects it | **HIGH** | `order-lifecycle.md` §5 G3 vs §10.4 vs §12.1 | `E06-30` |
| 9 | The migration maps legacy `new → draft`, and invariant **I12** says no `draft` order may exist | **HIGH** | `cutover-runbook.md` §5.D.5 vs `order-lifecycle.md` §3.2/I12 | `E16-19` |
| 10 | `resolve_effective_config()` silently returns null for every customer once `0002` applies | **HIGH** | `authorization-model.md` §3, §7.6, §14 | `E02-20` |
| 11 | `docs/store-submission.md`'s entire pre-submission checklist cites task IDs that now mean different tasks | **HIGH** | `store-submission.md` §0/§6, `SUB1`, `open-questions.md` | `E17-23` |
| 12 | The cutover clock is 24 hours out from `T+14h` onward | **HIGH** | `cutover-runbook.md` §2, §6.I, §10 | `E17-24` |
| 13 | Tier classification differs between the document that declares itself normative and the one that uses it | **MED** | `data-model.md` §13.3 vs `dpdp-compliance.md` §2.2 | `E20-31` |
| 14 | `0002` contains zero `GRANT`/`REVOKE` — the specified second layer under RLS does not exist | **MED** | `authorization-model.md` §10, §14 | `E02-21` |
| 15 | Storage bucket policies are specified, deliberately empty in `0002`, and owned by no task | **MED** | `authorization-model.md` §11 | `E02-22` |
| 16 | The `[AZ-02]` self-enforcing tripwire test is named three times and owned by nobody | **MED** | `authorization-model.md` §14, `dpdp-compliance.md` §5.1 | `E02-23` |
| 17 | `otp_attempt` does not exist, and the **published** privacy policy promises a retention period for it | **MED** | `dpdp-compliance.md` §6.2, `privacy-policy.md` §6 | `E20-33` |
| 18 | `migration.migration_review` holds tier-A/P data with no retention row and no place in erasure | **MED** | `0001` `migration` schema vs `dpdp-compliance.md` §6 | `E20-32` |
| 19 | `product_analytics` is a consent purpose with no vendor, no processor-register row, and a store declaration that says the opposite | **MED** | `privacy-policy.md` §2.3/§4.1 vs `dpdp-compliance.md` §9 vs `store-submission.md` §2.1 | `E20-34` |
| 20 | The ledger's sign convention is never stated, and two nightly assertions depend on it | **MED** | `payments-design.md` §10, `order-lifecycle.md` I8 | `E06-31` |
| 21 | Rotating the service-role key on the 180-day clock forces a mass re-OTP, against `U3`'s whole purpose | **MED** | `secret-rotation-policy.md` §3.1, §6 | covered by `[SEC-02]`; noted |
| 22 | The webhook retry sweep has no liveness alert despite `PY2` requiring one | **MED** | `payments-design.md` §6.6 | `E15-13` |
| 23 | The cutover asks one person to work ~15 continuous hours with the irreversible gate at hour 13 | **MED** | `cutover-runbook.md` §2, §10 | `E17-25` |
| 24 | `M01` both permits and forbids press feedback on the quantity stepper | **LOW** | `motion-system.md` `M01` vs `design-tokens.md` §4.1 | `E13-18` |
| 25 | `M04` animates height, which the same document's lint rule fails | **LOW** | `motion-system.md` `M04` vs §7 rule 6 vs §9 gate 2 | `E13-19` |
| 26 | The MDR paragraph in the customer-facing refund policy names the wrong two parties | **LOW** | `refund-policy.md` §4 vs `M5`/`[PAY-04]` | `E17-23` |
| 27 | Last-4-phone search must be an Edge Function, never a table read — stated once, owned by nobody | **LOW** | `authorization-model.md` §14, `data-model.md` §13.3 rule 4 | `E09-13` |
| 28 | Assorted stale IDs, a wrong character limit, and small arithmetic slips | **LOW** | several | `E17-23`, inline |

---

## 1. Contradictions with `docs/decisions.md`

### 1.1 `M2` is not merely unconfirmed — it is already wrong for two of the three cities **[BLOCKS]**

`M2` states, flatly: *"5% GST, shown as CGST 2.5% + SGST 2.5%. Place of supply Mohali / SAS
Nagar — intra-state."* `[GST-02]` correctly flags that intra-state-ness also depends on
GrayBag's registered state, which nobody knows. **That framing understates the problem, and
`G4`'s per-invoice derivation only half-covers it.**

`docs/data-model.md` §1.7 says GrayBag serves **three cities**, and §3.1's `gst_state_code`
comment names their codes: *"Chandigarh `04`, Punjab `03`, Haryana `06`"*. The same three
appear in the store listing copy (`store-submission.md` §4.4: *"Chandigarh, SAS Nagar (Mohali)
and Panchkula"*). `gst-invoicing.md` §3.2 establishes that `place_of_supply_state_code` comes
from `city.gst_state_code` **via the school**, because for a catering service the place of
supply is where the service is performed.

So the place of supply already takes three distinct values. Under a single GSTIN, **at most one
of them can be intra-state**; the other two are IGST at 5%, whatever the accountant says about
registration. This is not contingent on `[GST-02]`'s answer — it is arithmetic on facts already
in the schema.

Two consequences:

- **`M2` needs rewording** from a statement of fact to a statement about one city. `G4` already
  says the split "is never hard-coded", and `E07-17` implements it *on the invoice* — that part
  is right and needs no change.
- **The cart does not derive it.** `E07-06` reads *"Update cart and checkout to show the
  CGST/SGST split rather than a single tax line"*, and `order-lifecycle.md` §8.2 step 7 says
  *"Compute the money: line subtotal, the CGST/SGST split per `M2`"*. The customer sees the
  split at checkout, before an invoice exists, from a code path that has no `E07-17` in it.
  A parent at a Panchkula school would be shown CGST+SGST and invoiced IGST — and under `L7`
  the charged total must equal the displayed total, so this is not cosmetic.

`E07-21` makes the checkout pricing path derive the split the same way `E07-17` does.
`[GST-06]` is the commercial question behind it: register in each state, or accept IGST for
two of the three cities.

### 1.2 `PY3` is cited for a decision it is not **[LOW]**

`docs/refund-policy.md` cites `PY3` twice — in its `sources:` front matter (*"PY3 refund
speed"*) and in §3 (*"`PY3`, refund speed `normal`"*). `PY3` in `docs/decisions.md` is
*"A misconfigured webhook secret is indistinguishable from an attack"*. The refund-speed item
is `[PAY-03]`, which is **open, not decided**. The refund policy does flag `[PAY-03]` two lines
later, so the substance is right; the citation points at the wrong record. `E17-23`.

### 1.3 `SUB1` cites `E17-14`, which now means something else **[HIGH]**

See §3.1 below. `SUB1`'s closing clause — *"the reconciliation is mandatory (`E17-14`)"* —
now points at *"Drain plan for Bubble in-flight payments"*. The reconciliation task is
`E17-19`.

### 1.4 `M5` is misdescribed in a customer-facing document **[LOW]**

`docs/refund-policy.md` §4: *"that fee is absorbed by GrayBag or the kitchen, not by you —
`M5`, `[PAY-04]`."* `M5` says the MDR comes out of **the school's** share; `[PAY-04]`
recommends the **platform** absorbs it where no share was earned. The kitchen is never named by
either. The `mdr_bearer` enum does carry a `kitchen` value, so the sentence is *possible* — but
no decision has ever assigned MDR to a kitchen. Since the paragraph is written for a parent it
matters less than it would internally, but it is a document about money citing a decision that
says something else. `E17-23`.

### 1.5 `D17` holds; `D16` holds; `L1`–`L8`, `PY1`–`PY9`, `G1`–`G10`, `C1`–`C9` hold **[none]**

Worth recording the negative result, because it is the substance of the review. I checked each
decision against the migration and the specs that claim to implement it:

- **`D17`** (RLS enabled in `0001`, policies in `0002`) — verified. `0001` enables RLS over
  `pg_tables` for `public` and `migration` in a `DO` loop with no policies; `0002` adds 140
  permissive plus 39 applications of one restrictive policy. The counts reconcile exactly to
  the `179` asserted at `authorization.test.sql:817`. The §15 prose *"140 permissive policies
  plus one restrictive policy on 39 tables"* reads ambiguously but is arithmetically correct.
- **`D16`** (idempotency by constraint) — all nine layers in `payments-design.md` §7.1 exist in
  `0001`, and `[OL-05]` is honest about the one that over-constrains.
- **`D13`** (basis points) — consistent everywhere, including `gst-invoicing.md`'s integer
  `half_up`.
- **`G2`** (independent CGST/SGST) — I re-derived every vector in `gst-invoicing.md` §6.5.1 and
  §6.5.3. All correct, including the two that diverge from naive-5% in opposite directions
  (rows 4 and 8), the degenerate row 10, and the §6.5.3 totals (65,550 / 1,640 / 1,640 /
  68,830). The §7 credit-note worked example (13,125 + 13,125 + 13,126 = 39,376) is also right.
- **`G9`** (16-character serial) — `GB/26-27/000417` is 15; `GBC/26-27/000417` is 16. Correct.
- **`PY6`** rule 3's last-unit-carries-the-remainder property is correctly stated and correctly
  worked.
- **`D12`** — no signature column exists on `payment`. Verified against `0001`.
- **`MI1`–`MI6`** — the importer's decisions are self-consistent and `[MI-01]` is still true:
  **there is no `.xlsx` anywhere in the repository** (`find . -iname "*.xlsx"` returns
  nothing), so `[DM-13]` cannot close.

---

## 2. Contradictions between documents

### 2.1 The invoice placeholder guard fires after the money is taken **[BLOCKS]**

`gst-invoicing.md` §2 specifies `E07-13`:

> **In production the invoice issuer must refuse to allocate a number at all** while
> `seller_gstin` matches `^«.*»$` or `sac_code` does. […] it fails the checkout's post-capture
> step rather than producing a document […] **Being unable to complete a purchase on day one is
> a smaller problem than a month of invalid invoices.**

The justification is sound. The *placement* is not, and the document says so in its own words
without noticing: **"post-capture"**. Trace it:

1. `[OL-01]` recommends **auto-capture** — Razorpay captures on authorization.
2. `order-lifecycle.md` §8.4 `settle_payment()` step 5 allocates the invoice number **inside the
   settlement transaction**, after step 3 has moved the orders `pending_payment → paid`.
3. `E07-13` raises there. The transaction rolls back.
4. `PY2` / `payments-design.md` §6.3: the webhook endpoint returns `200` even when its own
   processing throws, and **we** own the retry. The 5-minute sweep retries. It fails again.
   Forever.

Net effect on day one with a placeholder GSTIN in production config: **every customer is charged
and no order is ever created.** No 5xx, no Razorpay retry, an ever-growing
`payment_webhook_event` backlog at `failed`, and a reconciliation break class **B4** the next
morning ("captured with us, not captured at provider" — actually its mirror, B3-shaped, which
*auto-heals* by calling `settle_payment()` again, which fails again).

That is not "unable to complete a purchase". It is the worst possible failure of a payments
system, produced by a guard whose stated purpose was to prevent a lesser one.

**The fix is not to weaken the guard — it is to move it earlier.** `E07-20`: refuse `POST
/checkout` in production while either placeholder stands, and add a boot assertion on the
payments Edge Functions in the same shape as `E06-14`'s key-prefix check. Then the failure mode
really is "you cannot start a purchase", which is exactly what §2 argues for. Keep the
allocation-time check as defence in depth.

### 2.2 `order_group_status = 'payment_failed'` is unreachable **[HIGH]**

Three statements inside `order-lifecycle.md` disagree:

- **§3.1**: *"a failed payment produces `order.status = 'cancelled'` with `cancel_reason_code =
  'payment_failed'`, while the group […] records `payment_failed`"*.
- **§5 rule G3**: group status is `payment_failed` only when *"every member is `cancelled` with
  `cancel_reason_code = 'payment_failed'`"*.
- **§10.4 step 3**: the sweeper closes a group with *"T6 for every member order with
  `cancel_reason_code = 'checkout_expired'`"* — for **both** "every attempt terminally failed"
  **and** "never started", which the sentence conflates.

Since §10.1 leaves the group open after a failure and the sweeper is what eventually closes it,
every failed checkout ends with `checkout_expired`, G3 never matches, and the group falls
through to G4 → `cancelled`. `order_group_status.payment_failed` is dead.

§12.1 scenario 5 expects the opposite: *"Payment failed, no retry | Group `payment_failed` after
the sweeper"*. That test cannot pass as specified. `E06-30` splits the reason code on whether
any attempt reached `failed`.

### 2.3 The migration writes `draft` orders, which an invariant forbids **[HIGH]**

`cutover-runbook.md` §5.D step 5: *"Full order history […] status mapped on db_value
(`new→draft` etc.)"*.

`order-lifecycle.md` §3.2 is titled *"Why `draft` is unreachable in v1"* and says *"**v1 emits
no `draft` rows.** A monitoring assertion that counts them is cheap"*. That assertion is
invariant **I12** (*"No order exists whose `status = 'draft'`"*) and it is also asserted in
`payments-design.md` §8.3's daily ledger checks. Additionally the §4.4 trigger permits
`NULL → draft` only for actor `admin` holding `orders.create_on_behalf` (T1) — the migration
runs as `app.actor_type = 'system'`, so T1 does not apply and **every such insert would be
rejected outright**.

So the runbook's status map either fails at insert or, if the trigger is relaxed for the
backfill, trips I12 on the first nightly run after cutover. `E16-19`.

### 2.4 `M09`'s retry affordance on **Pay** creates real double charges **[BLOCKS]**

`motion-system.md` `M09`, for *"Place Order, Pay, Cancel Order, Save Recipient"*:

> **Timeout.** If the call has not returned in 8 seconds, the button reverts to its label and an
> inline `M10` error appears with a retry.

Against `order-lifecycle.md` §13: `payment_pending` (202) means *"Poll `GET
/checkout/:group/status`, show a waiting state — **not** a success screen"*, with no time bound.
And §10.6b:

> Attempt 1 is a UPI collect sitting pending; the customer gives up and pays by card; attempt 1
> then succeeds. Two real debits, one cart. **This *will* happen.**

`payments-design.md` §3.3 says a UPI collect *"[s]its `pending` for a long time; this is what
makes `[OL-03]` hard"*, and `[OL-03]` proposes a 30-minute TTL. Offering a **retry button at 8
seconds** on the Pay control is the single most efficient way to manufacture §10.6b — which
`[OL-05]` says the schema **cannot currently record**, so the correct response (record it, then
refund it) is unavailable.

`M09` is right for Place Order, Cancel Order and Save Recipient. It must not apply to Pay.
`E13-20`.

### 2.5 One child's consent withdrawal erases the parent **[BLOCKS]**

`dpdp-compliance.md` §3.5, for `child_data_processing`:

> **The dependent is deactivated.** `deleted_at` is set […] and **§6.5's erasure pipeline runs**.

§6.5's pipeline is written for an account:

- step 1 — *"set `app_user.deleted_at` / `recipient.deleted_at`"*
- step 4 — *"`device_token` rows deleted; `notification_preference` off"*
- step 5 — *"Anonymise tier A and P. **`app_user` names/phone/email**"*

A parent with two children who withdraws consent for one would have their own name, phone and
email anonymised, their device tokens deleted and their account soft-deleted — taking the other
child with it. `E20-18` compounds this by specifying *"the erasure pipeline as **one** Edge
Function running the fixed order"*.

The pipeline needs a scope parameter: `recipient` (steps 2, 3, part of 5, 6) versus `account`
(all steps). `E20-30`.

A smaller related slip in the same section: step 2 is justified as *"BEFORE anything else,
because after step 1 no customer-facing path can write it"* — while being numbered **after**
step 1. It happens to be harmless (the pipeline runs as `service_role`, which bypasses the
policy in question), but the stated reason for the ordering is contradicted by the ordering.

### 2.6 The store-submission pack's checklist points at the wrong tasks **[HIGH]**

`docs/store-submission.md` was written at Q12. Q13 and Q14 subsequently appended tasks that took
the ID range Q12 had reserved. Every one of Q12's forward references is now wrong:

| Cited in `store-submission.md` | What Q12 meant | What that ID means now | Correct ID |
|---|---|---|---|
| `E17-14` (§0.1 **BLOCKER**, §3.0, §3.2 ×2, §6) | Reconcile store answers against the final privacy policy | Drain plan for Bubble in-flight payments | **`E17-19`** |
| `E17-15` (§1.4, §3.0 ×2, §6) | Account-deletion / data-deletion URL | Lock down the public Bubble Data API | **`E17-20`** |
| `E17-16` (§5 ×2, §6) | Produce store screenshots | OTP re-login comms campaign | **`E17-21`** |
| `E17-17` (§4, §6) | Verify listing text against field limits | Cutover-day manual-review staffing | **`E17-22`** |
| `E20-24` (§3.3 ×2, §6) | Third-party recipient list matches the register | Draft the three policy documents | **`E20-28`** |

The same stale `E17-14` appears in `docs/decisions.md` `SUB1` and in `docs/open-questions.md`'s
Q12 preamble. `docs/learnings.md` already uses the corrected numbers (`E17-19`, `E17-20`), so
the corpus contains both.

This is worse than a typo: §6 is *"Pre-submission checklist (for Andy, `E17-04`)"* — the last
gate before a store submission — and every line of it currently resolves to a task about
something else. `E17-23`.

One substantive discrepancy rides along: `store-submission.md` §4 says Apple's promotional text
is **≤170** characters (correct); `E17-22` says **100-char promotional text**. I have corrected
`E17-22`'s text in place.

### 2.7 Tier classification diverges between the normative document and its consumer **[MED]**

`dpdp-compliance.md` §2.2 opens: *"The classification is already normative in
`docs/data-model.md` §13.3 and is repeated here"*. It is not repeated — it is **extended**:

| Column | `data-model.md` §13.3 | `dpdp-compliance.md` §2.2 |
|---|---|---|
| `order_line.allergen_codes_snapshot` | absent | **tier S** |
| `invoice_line.description` | absent | **tier P** |

Both additions are right — `data-model.md` §13.2 itself lists `allergen_codes_snapshot` as a
snapshot and `G7` exists precisely because a child's first name lands in
`invoice_line.description`. But §6.4's coverage assertion (*"every table carrying tier S, P or A
data must have a `retention_policy` row"*) and `E20-10`'s scrubbing rules key off the
classification, and the document that declares itself normative is the shorter one. `E20-31`.

### 2.8 The runbook clock is 24 hours out **[HIGH]**

`cutover-runbook.md` defines `T-0` as *"Friday ~22:00 IST"*. Then:

| Label | Stated as | Actually |
|---|---|---|
| `T+14h` end of cut-over | *"Saturday afternoon"* | Sat 12:00 — fine |
| `T+32h` | *"(Sun)"* in §2, **"Monday 06:00"** in §2 row I, §6.I heading, §10 gate G5 | **Sunday 06:00** |
| Monday 06:00 | — | **`T+56h`** |

§6's Phase H heading is internally inconsistent with its own label: *"H. Soak (`T+14h` →
`T+32h`, Saturday evening → **Monday 06:00**)"* — Sat 12:00 to Mon 06:00 is 42 hours, not 18.

This is not cosmetic: precondition **P3** requires *"Migration total wall-clock time from
rehearsal #2 **fits inside the freeze window** with ≥50% headroom"*, and the freeze window is
computed from these offsets. `E17-24`.

### 2.9 The runbook asks one person for a 15-hour shift and puts the irreversible gate at hour 13 **[MED]**

From §3 (*"`T-1h` Operator + Andy both online"*) through §6.G (`T+14h`), the plan is continuous:
freeze 22:00 → drain to 00:00 → migrate 00:00–06:00 → validate 06:00–10:00 → **Gate G3, the
point of no return, at 10:00** → cut over to 12:00. Fifteen hours, overnight, with the single
irreversible decision taken at hour thirteen.

`[CO-07]` and `R8` address the *absence* of a second signer — rollback-by-default is a good
control against nobody being available. It is not a control against the available person being
fourteen hours awake, and §12's "what a human must check" list does not mention it. Either build
in a rest gate before G3 or move G3 to a fresh morning. `E17-25`.

### 2.10 `resolve_effective_config()` returns null for every customer, silently **[HIGH]**

`authorization-model.md` §3 states the trap plainly:

> `resolve_effective_config()` is `STABLE` and *not* `SECURITY DEFINER` […] It joins
> `platform_config`, `kitchen_config` and `school_config`, none of which a customer may read.
> **Once `0002` is applied it returns a null row for every customer, with no error.**

§7.6 says `effective_config_public()` fixes it, and §14 lists it as *"work this document
creates"*. It does not exist in `supabase/` (verified by grep), and `E02-10`
(*"Resolution-chain resolver […] plus config cache"*) does not mention it. Every customer-facing
read of cutoff time, break times or prices would come back empty the day `0002` lands.
`E02-20`.

### 2.11 Three more items `authorization-model.md` §14 hands to Q15 and nobody owns **[MED]**

§14 says explicitly: *"Not appended to the backlog by this run — Q15 reconciles the overnight
batch against `planning/backlog/` and should pick these up."* Of the nine items, five are
already in `0002` (the helper functions, the guard triggers, `auth_recipient_has_visible_order`,
the structural invariants — all verified present) and are covered by `E02-18`/`E02-19`. Four are
not:

- **The §10 privilege revokes.** `grep -c '^revoke\|^grant' 0002_rls_policies.sql` returns **0**.
  The specified "second layer under RLS" does not exist. The practical exposure today is small —
  a table with RLS on and no `INSERT`/`UPDATE`/`DELETE` policy already denies those to
  `authenticated` — so this is defence in depth, not a live hole. It is still a specified control
  that no migration implements. `E02-21`.
- **Storage bucket policies (§11).** `0002` deliberately writes none and explains why (three
  private buckets reached only by signed URL, one public CDN bucket). But the buckets themselves,
  and the signed-URL discipline that `invoice.pdf_asset_id` depends on (`gst-invoicing.md` §8
  note 6), are owned by no task. `E02-22`.
- **The `[AZ-02]` tripwire.** Named in `authorization-model.md` §14, in `[AZ-02]`'s own
  recommendation (*"Add a test that fails the moment such a grant appears, so the deadline
  enforces itself"*) and in `dpdp-compliance.md` §5.1. Owned by nobody. `E02-23`.
- **Last-4-phone search as an Edge Function.** `E09-07` exists but says nothing about the
  mechanism, and `data-model.md` §13.3 rule 4 is explicit that the kitchen needs **no** tier A
  beyond those four digits. Implemented as a table read it would hand a kitchen operator the
  whole phone number. `E09-13`.

---

## 3. Arithmetic and measurable claims

Everything in this section was recomputed rather than read.

### 3.1 The prescribed contrast fix does not fix anything **[HIGH]**

`design-tokens.md` §2.3:

> Mock 02 puts a `#145f48` button on a `#00af52` field: **2.63:1**, below the 3:1 a control
> boundary needs. **`forest-600` on `primary-600` is 3.25:1 and passes.** That single pair of
> substitutions is the whole fix for that screen.

Recomputed (WCAG 2.1 relative luminance):

| Pair | Claimed | Actual |
|---|---|---|
| `forest-500 #145f48` on `primary-500 #00af52` | 2.63 | **2.63** ✓ |
| **`forest-600 #104c3a` on `primary-600 #009646`** | **3.25** | **2.57** ✗ |
| `forest-700 #0c3b2d` on `primary-600 #009646` | — | **3.25** |

The 3.25:1 figure is real — it belongs to **`forest-700`**, one step further down. `forest-600`
on `primary-600` is 2.57:1 and still fails the 3:1 non-text-contrast bar the sentence invokes.

This matters more than a typo because `E13-14` is an `(owner:andy)` **validation** — Andy is
being asked to approve "the 500 rule" on the strength of a worked example that does not work.
`E13-16` corrects the token and the number.

Every other ratio quoted in the file is correct to the stated precision, which is why this one
stands out: `2.90`, `3.85`, `5.19`, `7.14`, `10.06`, `7.61`, `9.92`, `12.51`, `1.69`, `10.68`,
`4.99`, `6.97`, `4.50`, `14.24`, `6.00`, `10.25`, `4.32`, `4.83`, `1.48`, `2.28`, `4.79`, `6.35`,
`10.27` all reproduce exactly. Three round by one hundredth in the wrong direction —
`danger-700` is 6.57 not 6.63, `neutral-800` is 14.57 not 14.56, `neutral-900` is 18.07 not
18.06 — which is noise, but `E13-13` will assert against these numbers, so they should be
corrected in the same pass.

### 3.2 Five semantic-role pairs fail the bar `E13-13` will assert **[HIGH]**

`design-tokens.md` §9 item 1 specifies a CI test that *"walks the §2.9 semantic role map plus a
declared list of legitimate foreground/background pairs, computes the WCAG 2.1 ratio, and
asserts the minimum stated in this file"*. Running that walk by hand over §2.9:

| Foreground role | Background role | Ratio | Required | |
|---|---|---|---|---|
| `text.tertiary` (`neutral-500`) | `bg.surfaceMuted` (`neutral-100`) | **4.23** | 4.5 | **FAIL** |
| `text.tertiary` (`neutral-500`) | `bg.canvas` (`neutral-50`) | **4.50** | 4.5 | exactly at the bar |
| `text.danger` (`danger-600`) | `danger-50` (§2.8 "Error banner fill") | **4.44** | 4.5 | **FAIL** |
| `border.default` (`neutral-400`) | `bg.surface` (`neutral-0`) | **2.28** | 3.0 | **FAIL** |
| `text.onBrand` (`neutral-0`) | `bg.surfaceBrand` (`primary-600`) | **3.85** | 4.5 | **FAIL** for body |

Each is a pair the document itself creates:

- `bg.surfaceMuted` is *"Inputs, image placeholders"* and `text.tertiary` is *"Placeholder,
  timestamps"* — so **placeholder text inside an input field**, the single most common use of
  the role, fails AA. §2.7 asserts *"`neutral-500` is the darkest grey that still reads as
  'placeholder'; anything lighter fails"* — which was checked against white only, not against
  the input fill the same file assigns.
- §2.8 pairs `danger-600` text with a `danger-50` banner fill by name.
- `border.default` is *"Input and card outlines"*. An input outline is a UI component boundary
  and needs 3:1 under WCAG 1.4.11. `border.strong` (4.79) exists and is described as *"Outlined
  control that must meet 3:1"* — so the file half-knows, and then assigns the wrong one to
  inputs.
- `text.onBrand`'s own note says white is legal *"only on `primary-700`+ or `forest-500`+"*,
  while `bg.surfaceBrand` is `primary-600` and is described as *"A green field that **carries
  controls**"*. The role map therefore has **no legal body-text colour for that surface at all**.

None of this is fixed by approving `DS-01`. `E13-17` is the work; `[DS-06]` is the one genuine
choice inside it (darken the tertiary/border roles, lighten the muted surface, or forbid the
pairs) with a recommendation.

### 3.3 Small numeric slips **[LOW]**

- `store-submission.md` §4.5 says the keyword string is 83 characters; it is **80**. §4.2 says
  *"Order school meals in seconds"* is 28; it is **29** (still inside Apple's 30).
- `order-lifecycle.md` §4.4 note 4 says *"**`I3`** in §12 asserts one event per transition"*.
  That is **`I2`**; `I3` is the group-totals invariant.
- `data-model.md` §14 says *"All are also listed in `docs/open-questions.md`"*. **`DM-14`** is
  not — the underlying question ("Is the Excel `Price` GST-inclusive?") is there under "Blocked
  on Andy" but carries no ID, and `[DM-20]` describes itself as *"a consequence of `DM-14`"*,
  so the reader is sent to an entry that does not exist.
- `dpdp-compliance.md` §3.5 cites `[DP-05]` (cross-border transfer) for the
  school-reporting-aggregate question. That is `[DP-04]` (is the school a fiduciary, processor
  or recipient).
- `cutover-runbook.md` §11 says its open questions live in
  `docs/_overnight-merge/Q14-notes.md` *"pending merge into `docs/open-questions.md`"*. That
  directory does not exist and the merge has happened — `[CO-01]`…`[CO-07]` are in
  `open-questions.md`. §5.E, §6.4 and P4 likewise still label `E17-18`, `E17-17` and `E16-18` as
  *"proposed"*; all three are real tasks.

All folded into `E17-23`.

---

## 4. Gaps — things nothing owns

### 4.1 Push notification bodies **[HIGH]**

`dpdp-compliance.md` §9, rule 2, states the problem and then hands it to nobody:

> **Push notification bodies are an egress path nobody thinks of.** "Aarav's lunch has been
> delivered" is tier P leaving for Expo's servers and appearing on a lock screen. The
> notification copy rule belongs with `E08` and needs the same sentinel test as `E20-10`.

`E08` has fourteen tasks (`E08-01`…`E08-14`) and none of them mentions it. `E20-10` is scoped to
*"product analytics and […] Sentry payloads"*. Meanwhile `privacy-policy.md` §3 already
**discloses** it to the customer — *"Expo / EAS […] Your device push token **and the
notification text**"* — so the notice describes an egress the code has no control over.

`E08-03` (*"Order confirmed — push + email with pickup code"*) and `E08-05`
(*"Order delivered — push"*) are precisely the templates that will want the child's name, and a
lock-screen preview is visible without unlocking the device. `E20-29` adds the rule and the
sentinel test; `[DP-08]` is the copy decision behind it (may a push body name a child at all).

### 4.2 `otp_attempt` does not exist, and a published policy promises a retention period for it **[MED]**

`dpdp-compliance.md` §6.2 schedules *"`otp_attempt` / auth logs — **90 days** — `delete`"*, and
`privacy-policy.md` §6 tells the customer *"Sign-in / OTP records — ~90 days — Deleted"*.

There is no `otp_attempt` table in `0001` (verified against the full table list). OTP state
lives in Supabase's `auth` schema (GoTrue), which our purge job does not reach and whose
retention is a vendor setting, not ours. So:

- §6.4's coverage assertion cannot cover it.
- The **published** policy makes a retention claim we do not implement or control.
- `E03-10` (*"OTP cost and abuse guardrails: per-number and per-IP throttles, alerting on
  spikes"*) needs exactly such a table to count against, and has no schema for it.

`E20-33`: build `otp_attempt` for `E03-10` and give it a real retention row, **or** restate the
privacy-policy line as a vendor default. Do not leave a customer-facing promise resting on
neither.

### 4.3 `migration.migration_review` holds tier-A/P data with no retention decision **[MED]**

`migration.migration_review` carries `legacy_id text` and `detail jsonb`, and its whole purpose
(`E03-11`, `[DM-11]`) is to park **ambiguous or duplicate phone matches** for manual review — so
`detail` will hold phone numbers and probably names. `migration.legacy_id_map` is the same
shape.

Neither appears in `dpdp-compliance.md` §6.2's schedule, in §6.5's erasure order, or in the
tier classification. §6.4's coverage assertion is written over *"every table carrying tier S, P
or A data"*, so a correct implementation of it would **fail** on these two — which is the right
outcome, and is exactly the loud-resting-state property `C6` argues for. It just has not been
noticed.

`E16-13` already worries about live children's data sitting in staging; this is the production
instance of the same concern. `E20-32` adds the retention rows and a teardown after `E17-22`
works the queue.

### 4.4 `product_analytics` has a consent purpose, a policy line, no vendor, and a contrary store declaration **[MED]**

Three documents describe it three ways:

- `privacy-policy.md` §2.3 lists *"**App analytics** — To understand which screens are used"*
  as automatically collected, and §4.1 offers `Product analytics` as an optional consent purpose.
- `dpdp-compliance.md` §5.1 names *"The analytics vendor"* as the recipient — and §9's processor
  register, which claims to list *"every third party that touches personal data"*, **has no
  analytics row**.
- `store-submission.md` §2.1 declares *"Everything above is **App Functionality** […] No row
  uses **Analytics**"* under `SUB2`.

`E15-11` (*"Product analytics: install → signup → first order funnel"*) is the build task; no
vendor is chosen, no DPA is contemplated, and `[DP-05]`'s cross-border question applies to it
exactly as it does to the unchosen email vendor. `E20-34` reconciles the three and adds the
register row; it should ride with `[DP-05]`.

### 4.5 The ledger's sign convention is never stated **[MED]**

`payments-design.md` §10 gives eleven postings as debit/credit pairs and every one balances —
I checked all eleven. But `ledger_entry` carries a `ledger_direction` enum and an amount, and
**nothing in any document says which direction is positive for which `ledger_account_type`**.

Two nightly assertions depend on it:

- **I8** — *"`wallet_balance.balance_paise = Σ` ledger entries for that account"*. The wallet is
  a liability (posting #1 **debits** `user:<id>:wallet` when the customer *spends*), so its
  balance is `Σcredits − Σdebits`.
- §8.3's last row — *"`balance(provider:razorpay:clearing)` = what Razorpay says is pending"*.
  Clearing is an asset (posting #2 **debits** it on capture), so its balance is
  `Σdebits − Σcredits`.

The two run in opposite directions, and a `balance()` helper written once with a single sign
will be wrong for half the accounts. `[DM-04]` chose a maintained wallet balance *with a nightly
assertion against the ledger sum* — that assertion is the thing this makes ambiguous. `E06-31`.

### 4.6 The webhook retry sweep has no liveness alert **[MED]**

`PY2`'s closing clause: *"The cost of owning retry is that the 5-minute sweep over
`pending`/`failed` needs its own liveness alert, not just an error alert."* `payments-design.md`
§6.6 repeats it and points at `E15-03` — which is *"Better Stack uptime monitoring with SMS
alert to Andy when the site or API is down"*. A cron that stopped running is neither the site
nor the API being down; it produces silence, and §6.6 says so: *"If that job is not running,
events are recorded and never applied, and the only thing that notices is the daily
reconciliation."*

The same applies to the other five scheduled jobs in `order-lifecycle.md` §11. `E15-06`'s daily
digest carries reconciliation status but not job liveness. `E15-13`.

### 4.7 Rotating the service-role key logs every user out, twice a year **[MED]**

`secret-rotation-policy.md` §3.1 sets the service-role key on a **180-day** cadence and notes:

> Because Supabase rolling the key **also rolls the JWT signing secret**, active user sessions
> are affected — see §6. Do this in a maintenance window and **expect users to re-login**.

§6 accepts it: *"do it on the same 180-day clock, in a maintenance window, communicated in
advance, accepting the re-login."*

`U3`'s entire reason for existing is that refresh tokens last 90–180 days so OTP volume — and
therefore cost, at ~Rs 0.15/OTP against ~4 logins/user/year — stays low. A scheduled mass
re-authentication every 180 days roughly **doubles** that rate on its own, and it is a
customer-visible event ("why is GrayBag asking me to log in again?") twice a year for a business
with one support person.

`[SEC-02]` covers the mechanism question (does the plan expose zero-downtime JWT rotation) and
already says the right thing about not shortening the TTL. What is *not* captured is that if the
answer is (b) — maintenance window plus re-login — then the 180-day service-role cadence has a
recurring OTP-cost and support consequence that should be weighed alongside `[SEC-01]`. Noted
here rather than raised as a new question, because `[SEC-01]` and `[SEC-02]` together already
put the decision in front of Andy; they just do not put this consequence next to it.

---

## 5. Internal inconsistencies inside a single document

### 5.1 `M01` both permits and forbids the quantity stepper **[LOW]**

`motion-system.md` `M01`:

> **Allowed on.** Every tappable element that has a visible surface: buttons, cards, list rows,
> chips, **the quantity stepper**, the tab bar.
>
> **Not on.** […] Anything under 32pt visually — **a 28pt stepper button** scaling to 0.97 is
> invisible and just costs frames; those get the colour change too.

`design-tokens.md` §4.1 confirms the stepper *"draws at roughly 28pt"*. The deny list is the
correct one. `E13-18`.

### 5.2 `M04` animates a property its own lint rule forbids **[LOW]**

`M04`: *"If the container's height changes, it animates over `base` with `ease.standard`."*

§7 rule 6: *"Animate `transform` and `opacity` only […] with exactly **two** documented
exceptions, `M10`'s and `M14`'s height collapses."*

§9 gate 2: the lint rule fails the build on *"animating any property other than `transform` /
`opacity`, outside the two files implementing `M10` and `M14`"*.

`M04` is the third height animation and is not exempted, so `E13-11`'s lint rule would fail
every implementation of the catalogue's most-used pattern. §10 confirms the behaviour is
intended (*"`M04` […] height animation dropped"* under reduce motion). Either exempt `M04` or
drop its height animation. `E13-19`.

### 5.3 `order-lifecycle.md` §8.4 repeats the MDR omission `E06-22` already corrects elsewhere **[LOW]**

`payments-design.md` §10 note 3 flags that *"#3 is missing from the worked example in
`docs/data-model.md` §8.4, which debits `provider:razorpay:clearing` for the full gross […]
without #3 the clearing account is permanently overstated by the MDR"*, and `E06-22` says to
correct it. The **same** omission is in `order-lifecycle.md` §8.4 step 6, which also debits
clearing for the full `payable_paise` with no fee posting, and `E06-22` does not name that file.
Folded into `E06-22`'s wording.

---

## 6. Things I checked and found correct

Recorded because a review that only lists faults gives no sense of the base rate.

- **All 179 policies reconcile.** 140 literal `create policy` statements plus a 39-element
  `DO` loop applying `deny_dead_accounts`, against the `179` literal in
  `authorization.test.sql:817`. The restrictive-policy array has exactly 39 entries and every
  one is a table with a customer-plane policy, as its comment claims.
- **RLS is on for every table in `0001`** — the `DO` loop over `pg_tables` covers `public` and
  `migration` before any policy exists, exactly as `D17` requires.
- **Append-only really is trigger-enforced.** `forbid_update_delete()` exists in `0001` and is
  applied by a `DO` loop to the six append-only tables and the whole `migration` schema, so
  `dpdp-compliance.md` §4.1's *"`UPDATE`/`DELETE` revoked and trigger-enforced"* is half true
  (the trigger half; see §2.11 on the revoke half).
- **Every GST test vector in `gst-invoicing.md` §6.5 recomputes exactly**, including the two
  divergence directions, the degenerate ₹0.10 row, and the §6.5.3 invoice totals.
- **All eleven ledger postings in `payments-design.md` §10 balance**, and the account types used
  are all present in the enum except `bank`, which `[PAY-05]`/`E06-23` already own.
- **The `payment_status` monotonic rank, the nine idempotency layers, and the two-signature
  split** are consistent between `order-lifecycle.md`, `payments-design.md`,
  `testing-strategy.md` and `secret-rotation-policy.md` — including the subtle one, that the
  callback signature is keyed on the **key** secret and the webhook on the **webhook** secret.
- **`[MI-01]` is still true.** No `.xlsx` exists anywhere in the repository, so `[DM-13]` cannot
  be closed and the twelve-code allergen seed list remains unvalidated against real data.
- **`00_Graybag_Brand Guidelines.pdf` is present** at
  `../Legacy-Application-backup/Graybag_Design Package/` (outside git since 2026-08-08 —
  see `docs/decisions.md`), 21.8 MB. `DS-05`/`E13-15` records it as
  unreadable in the sandbox Q05 ran in. It may now be readable a few pages at a time; that is
  `E13-15`'s job, not this review's, but it is worth knowing the blocker may be softer than
  recorded.

---

## 7. What a human needs to decide

Three genuinely open items were added to `docs/open-questions.md`:

| Q | One line | Owner |
|---|---|---|
| `[GST-06]` | Three cities, three state codes: register per state, or accept IGST for two of three? | Andy + accountant |
| `[DS-06]` | Which end of the failing contrast pairs moves — the ink, the surface, or the pairing? | Andy (brand-visible), with a recommendation |
| `[DP-08]` | May a push notification body name a child? It is tier P on a lock screen | Andy + `E20-01` |

Everything else in this document is work, and is in the backlog.
