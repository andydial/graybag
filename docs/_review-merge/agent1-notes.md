# Agent 1 — review fixes (orders / payments / gst / data-model)

Scope: I own only `docs/order-lifecycle.md`, `docs/payments-design.md`,
`docs/gst-invoicing.md`, `docs/data-model.md`. Everything cross-cutting is recorded here rather
than edited into shared files.

## Findings fixed

- **#1 (review §2.1) — invoice placeholder guard fires after capture.**
  - `gst-invoicing.md` §2: rewrote "The guard" into three layers — (1) **primary** refusal at
    `POST /checkout` in production before authorization/capture while `seller_gstin`/`sac_code`
    is a placeholder, (2) a **boot assertion** on payments Edge Functions in the same shape as
    `E06-14`'s key-prefix check, (3) the allocation-time refusal kept only as **defence in
    depth** with an explicit warning that it strands a captured payment if it is the one that
    fires. Split ownership: `E07-13` = allocation check, `E07-20` = primary checkout guard +
    boot assertion. Updated §12 test #15 to assert all three placements.
  - `order-lifecycle.md` §8.4 step 5: annotated that the issuer's placeholder refusal is
    defence-in-depth only and points at the primary `E07-20` guard at `POST /checkout`.
- **#8 (review §2.2) — `order_group_status = 'payment_failed'` unreachable.**
  - `order-lifecycle.md` §10.4 step 3: split the sweeper's reason code — **any attempt reached
    `failed` → `payment_failed`**, never-started/expired-past-TTL → `checkout_expired`. Both use
    T6 (whose guard already admits either code).
  - §5: clarified G4's condition ("any other reason") and added a note that G3 is now reachable
    because of the split; §12.1 scenario 5 now satisfiable. `E06-30` cited as implementer.
- **#20 (review §4.5) — ledger sign convention never stated.**
  - `payments-design.md` new §10.1: explicit sign convention. `balance()` is defined per
    `ledger_account.normal_balance` — credit-normal (wallet/revenue/tax_payable/payable) =
    `Σcredits−Σdebits`, debit-normal (provider_clearing/provider_fees/receivable/suspense) =
    `Σdebits−Σcredits`. States that a single-sign `balance()` helper is wrong and why the bug is
    silent (per-transaction sums still zero). `E06-31`.
  - `order-lifecycle.md` I8: reworded to `balance(user:<id>:wallet) = Σcredits−Σdebits`
    (liability), cross-referencing §10.1 and noting clearing runs the opposite way.
- **#22 (review §4.6) — webhook retry sweep has no liveness alert.**
  - `payments-design.md` §6.6: replaced the `E15-03` (uptime) pointer with a **dedicated
    job-liveness alert** (heartbeat-overdue), explicitly distinct from uptime and error alerts,
    and extended it to **all six** scheduled jobs in `order-lifecycle.md` §11. New task
    `E15-13`.
- **#13 (review §2.7) — tier classification incomplete in the normative doc.**
  - `data-model.md` §13.3: added `order_line.allergen_codes_snapshot` (tier S) and
    `invoice_line.description` (tier P), plus a paragraph explaining why each carries its tier
    and that the section is the normative source `dpdp-compliance.md` §2.2 repeats. `E20-31`.
- **§5.3 — MDR omission in `order-lifecycle.md` §8.4 step 6.**
  - Added the MDR posting (`reason_code = 'provider_fee'`: debit `platform:provider_fees`,
    credit `provider:razorpay:clearing` for fee+tax) so clearing is not overstated. Matches
    `payments-design.md` §10 posting #3 / note 3. Implementer/cross-file task `E06-22`.
- **§3.3 slips.**
  - `order-lifecycle.md` §4.4 note 4: `I3` → `I2` (I3 is the group-totals invariant).
  - `data-model.md` §14: reworded the "All are also listed in `docs/open-questions.md`" line so
    it no longer sends the reader to a non-existent `DM-14` entry — states DM-14 is tracked as
    the accountant question "Is the Excel `Price` GST-inclusive?" (under "Blocked on Andy")
    without a `DM-` label, and DM-20 is filed as its consequence. Verified against
    `open-questions.md` (lines 22/26/92).

## Backlog tasks completed by these doc fixes

These were purely spec corrections and are **now complete at the spec level**; only the
described code remains:

- `E06-30` — spec reconciled (sweeper reason-code split; G3/G4; scenario 5). **Code still OPEN**
  (the sweeper implementation and pgTAP for scenario 5).
- `E06-31` — sign convention now stated in the spec. **Code still OPEN** (the branching
  `balance()` helper + the credit/debit-normal opposite-sign test).
- `E20-31` — normative tier list completed in `data-model.md` §13.3. **Code still OPEN**
  (scrubbing/coverage assertions that key off it).

Remain OPEN because they are **future code**, not doc work:

- `E07-20` — build the primary `POST /checkout` placeholder guard + payments Edge Function boot
  assertion. Only the SPEC placement was fixed here.
- `E07-13` — allocation-time refusal (now documented as defence in depth).
- `E06-22` — seed `sale`/`provider_fee` (and other movement) reason codes and post MDR; the
  step-6 spec now names them but the migration/ledger code is still to be written.

## New backlog tasks needed

- **`E15-13`** — target epic **E15** (observability/alerting). "Job-liveness monitor: heartbeat
  per scheduled job (webhook retry sweep, abandoned-checkout sweeper, in-flight payment &
  refund reconcilers, daily reconciliation, idempotency-key purge) with a page when a heartbeat
  is overdue for its cadence. Distinct from `E15-03` uptime and from per-job error alerts."
  Referenced by review finding #22 and by `payments-design.md` §6.6. (Do not renumber; append.)

## Proposed learnings (root causes)

- **Guards placed by prose, not by transaction position.** The invoice placeholder guard was
  described as firing at "the post-capture step" without anyone tracing that auto-capture (`OL-01`)
  means the money is already gone by then. **Rule: any guard whose job is to *prevent* an action
  must be shown to run before the irreversible step of that action** (here: before
  authorization/capture, not inside the settlement transaction). Re-check every "refuse/abort"
  guard against where in the txn timeline it actually executes.
- **Enum values become dead when the only writer collapses two cases into one.** `payment_failed`
  was unreachable because the sweeper wrote one reason code (`checkout_expired`) for both "failed"
  and "never started". **Rule: a status/enum value in a derivation table needs at least one code
  path that can actually produce its precondition; a test should assert reachability, not just
  correctness of transitions.** (Scenario 5 was that test, written before the producing path
  existed.)
- **Double-entry hides sign bugs.** Every transaction summing to zero (I10) means a
  wrong-signed `balance()` is invisible until you total a single account. **Rule: define the sign
  convention per account type *once and explicitly*, and test a credit-normal and a debit-normal
  account produce opposite signs from the same posting.** Do not ship a single-sign helper.
- **"Uptime" ≠ "the cron ran".** Pointing a liveness requirement at an uptime monitor is a
  category error: a silently-stopped cron produces silence, not a failed probe. **Rule: liveness
  of a scheduled job needs a heartbeat-overdue alert, separate from uptime and from error
  alerts.**
- **A "normative + repeated" pair drifts when the repeat is edited but the source is not.**
  `dpdp-compliance.md` §2.2 gained two rows the normative `data-model.md` §13.3 never got.
  **Rule: when one doc declares itself normative and another repeats it, the repeat must add no
  rows; any addition goes into the normative source first (ideally the consumer should be
  generated from / lint-checked against the source).**
- **Forward task-id references rot.** Several fixes here (E07-20 placement, E15-13, MDR posting)
  are the tail of Q12/Q13/Q14 renumbering. **Rule: cite tasks by permanent id and, when a doc
  reserves a range for future tasks, re-verify those ids still mean what the doc says before
  relying on them.**

## Proposed decisions.md changes

None strictly required — these are corrections to specs, not new architectural decisions. One
worth Andy/lead confirming (not by me, and not edited into `decisions.md`):

- The **three-layer placeholder guard** (checkout refusal + boot assertion + allocation-time
  defence in depth) is arguably a small architectural pattern ("irreversible-action guards run
  before the irreversible step, with a backstop"). If the team wants it recorded as a reusable
  principle it belongs in `decisions.md`; I have only put the reasoning in `learnings` above.

## Could not resolve → open question

Nothing blocked. All six findings + the slips were resolvable within my four files without
guessing. Note: I did **not** edit `docs/dpdp-compliance.md` §2.2 (a parallel agent aligns its
wording), `planning/backlog/*` (E15-13 recorded here for the backlog owner to append), or
`docs/{open-questions,learnings,decisions}.md` (proposals above for the merge step).
