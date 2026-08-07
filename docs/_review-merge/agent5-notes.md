# Agent 5 review-fix notes

Owned files: `docs/cutover-runbook.md`, `docs/store-submission.md`. No other files touched.

## Findings fixed

- **Finding #9 (review §2.3, task E16-19)** → `cutover-runbook.md` §5.D step 5.
  Rewrote the status map so legacy orders map to a **legal v1 status only, never `draft`**:
  completed/paid legacy order → `paid`; legacy-cancelled → `cancelled` (with matching
  `cancel_reason_code`); genuinely-awaiting-payment → `pending_payment`. Added the reasoning
  (draft unreachable per order-lifecycle.md §3.2; I12 asserts none exist, also in
  payments-design.md §8.3; §4.4 trigger only permits `NULL→draft` for an admin actor with
  `orders.create_on_behalf`, not the `system` actor the backfill runs as, so a draft row is
  rejected at insert or trips I12 on the first nightly run). Did NOT touch order-lifecycle.md.

- **Finding #12 (review §2.8, task E17-24)** → `cutover-runbook.md` clock offsets.
  Anchor facts: T-0 = Fri 22:00; T+14h = Sat 12:00; ordering must reopen Monday 06:00 (before
  the first weekday cutoff), which is **T+56h** (not T+32h — that was a 24h error). Soak runs
  Sat 12:00 → Mon 06:00 = 42h.
  - §2 timeline row H: `T+14h → T+32h (Sun)` → `T+14h → T+56h (Sat 12:00 → Mon 06:00)`.
  - §2 timeline row I (Open): `T+32h (Mon 06:00)` → `T+56h (Mon 06:00)`.
  - §6 Phase H heading: `T+14h → T+32h, Saturday evening → Monday 06:00` →
    `T+14h → T+56h, Saturday afternoon → Monday 06:00` (now 42h, internally consistent).
  - §6.I heading: `T+32h, Monday 06:00` → `T+56h, Monday 06:00`.
  - §8.2 comms #2 heading: `T+32h, Monday` → `T+56h, Monday`.
  - §10 gate G5 row: `T+32h Mon` → `T+56h Mon`.
  Chose to keep the real-world Monday-06:00 anchor and correct the offset to T+56h (rather than
  relabel Open as Sunday), because ordering opening before the first weekday cutoff is the fixed
  business constraint. This feeds precondition P3 (freeze window with ≥50% headroom).

- **Finding #11 (review §2.6, task E17-23)** → `store-submission.md` task-ID remap, every
  occurrence:
  - `E17-14` → `E17-19` (§0.1 BLOCKER, §3.0, §3.2 ×2 incl. the SMS-Retriever wording note, §6)
  - `E17-15` → `E17-20` (§1.4 incl. the `«ACCOUNT-DELETION-URL-PENDING-…»` token, §3.0 ×2, §6)
  - `E17-16` → `E17-21` (§5 ×2, §6)
  - `E17-17` → `E17-22` (§4, §6)
  - `E20-24` → `E20-28` (§3.3 ×2, §6)
  §6 "Pre-submission checklist (for Andy, E17-04)" now resolves every line to the correct task.
  NOTE: the deletion-URL placeholder tokens embed the owning task ID, so they were updated too
  (E17-15 → E17-20). Lines 241/245 (SMS-Retriever wording double-check) were E17-14 and became
  E17-19 per the finding's literal "every occurrence" instruction.

- **Finding #28 + §3.3 slips (task E17-23)** → `store-submission.md` recounted char numbers:
  - §4.5 keyword string `school,meals,lunch,tiffin,canteen,food,order,kids,allergy,parents,india,upi,menu`
    = **80** chars (was stated 83). Recounted with `printf %s ... | wc -c` = 80. Fixed.
  - §4.2 `Order school meals in seconds` = **29** chars (was stated 28); still within Apple's 30.
    Recounted = 29. Fixed.
  - §4 Apple promotional text ≤170 is correct; left as-is. (See backlog note below.)
  Also cross-checked: `Healthy school lunches, sorted` = 30 (matches doc), `GrayBag: School Meal
  Ordering` = 29 (doc says "30 chars — verify"; it is 29, within limit — not in my finding scope,
  left unchanged).

- **Finding §3.3 slip (task E17-23)** → `cutover-runbook.md` stale references:
  - §11: `docs/_overnight-merge/Q14-notes.md ... pending merge` → `docs/open-questions.md`
    (`[CO-01]`…`[CO-07]`); directory no longer exists and the merge happened.
  - P4: `(E16-18, proposed)` → `(E16-18)`.
  - §5.E reconciliation-baseline row: `(E17-18, proposed)` → `(E17-18)`.
  - §6.4: `(E17-17, proposed)` → `(E17-17)`.
  Left `[CO-01]`/`R6`/`R7` "proposed decision" wording alone — those label decisions/open
  questions, not the three tasks the finding names.

## Backlog tasks completed by these doc fixes

- **E16-19** — fully done in the doc: the runbook §5.D.5 no longer specifies a `draft` mapping.
  (Any migration-code implementation of this mapping is separate; the runbook spec is corrected.)
- **E17-24** — fully done: all clock labels now consistent (T+56h = Mon 06:00, soak = 42h).
- **E17-23** — the store-submission.md portion is fully done (all stale IDs + the two char
  miscounts + the runbook stale-reference slips). Note E17-23 in the review also covers items in
  files I do NOT own (decisions.md SUB1, open-questions.md Q12 preamble, refund-policy.md PY3/M5,
  data-model/order-lifecycle/dpdp slips); those remain for the coordinator/other agents, so
  E17-23 is only PARTIALLY complete overall.

## Backlog text the coordinator must fix

- **E17-22** backlog text says "100-char promotional text" — should be **170-char** (Apple
  promotional text limit; store-submission.md §4 correctly says ≤170). Review §2.6 says this was
  "corrected in place" but the backlog wording still needs the coordinator's fix.
- **decisions.md SUB1** still cites stale `E17-14` — should be `E17-19` (reconcile store answers
  vs final privacy policy). Owned by coordinator; not edited by me.
- **open-questions.md Q12 preamble** still cites stale `E17-14` — should be `E17-19`. Owned by
  coordinator; not edited by me.

## Finding #23 recommendation (15-hour shift / irreversible gate at hour 13)

Left §2/§10 shift structure as-is (deferred to coordinator per instructions). My analysis and
recommendation for the open-questions writeup:

The plan runs continuous from T-1h (~21:00 Fri) through Gate G3 at T+12h (~10:00 Sat) and cut-over
to T+14h (~12:00 Sat) — ~15 hours overnight with the single irreversible decision (G3) taken at
roughly hour 13, i.e. after an overnight migrate+validate stretch when judgement is worst. `[CO-07]`
/`R8` (rollback-by-default, no deputy) protects against *nobody being available*; it does not
protect against the *available person being 13 hours awake* when they sign the point of no return.

**Recommended option: move G3 to a fresh morning (decouple the irreversible gate from the overnight
run).** Concretely: run Freeze→Drain→Migrate→Validate overnight and reach Gate G2 (fully reversible)
by ~T+12h; then insert a **mandatory rest gate** and hold G3 (point of no return) and cut-over until
the operator has slept and is fresh (e.g. Saturday afternoon/early evening after rest, or Sunday
morning). The weekend freeze gives ample headroom — schools do not serve Sat/Sun, so there is no
time pressure to cut over at 10:00 Sat. This keeps the freeze window comfortably inside the ≥50%-
headroom P3 budget (now that the soak is correctly 42h to Mon 06:00) and puts the only unrecoverable
decision behind a rested operator.

Runner-up: **require a second signer for G3 only** (not for the whole weekend) — but GrayBag is
genuinely one person (`[CO-07]`), so a "rest gate before G3" is more realistic than manufacturing a
second human. Weakest option: a rest gate *before G3 but same session* without decoupling — better
than nothing but still lands the decision late in a long day.

Suggested open-question framing: "Should G3 (point of no return) be decoupled from the overnight
migrate/validate run and taken only after an operator rest gate, given the freeze window has slack?
Recommend yes: reach reversible G2 overnight, sleep, then sign G3 fresh."

## Proposed learnings

- **Forward task-ID references rot when written before the IDs are allocated.** store-submission.md
  (Q12) reserved an ID range, then Q13/Q14 appended tasks that took it, so every forward reference
  (E17-14/15/16/17, E20-24) silently came to mean a different task — including the entire
  pre-submission checklist. Lesson: a document should not cite a task ID it is itself minting for a
  *later* run; cite by description + placeholder, or allocate the ID in the backlog first.
- **Clock offsets get one segment fixed and the rest never re-added.** The runbook had T+14h correct
  (Sat 12:00) but everything from the soak onward was 24h short (T+32h labelled Monday 06:00, which
  is actually T+56h), and the Phase H heading claimed an 18h span for a 42h period. Lesson: derive
  every offset from the single T-0 anchor in one pass and check weekday+clock+delta together, rather
  than editing one row.
- **A migration that runs as `system` cannot use actor-gated transitions.** The `NULL→draft`
  transition is admin-only (`orders.create_on_behalf`), so a system backfill cannot legally produce
  `draft`; combined with invariant I12 (no draft rows), any "map legacy state → draft" is doubly
  wrong. Migration status maps must target only statuses reachable by the actor the backfill runs as.

## Could not resolve → open question

None blocking. One judgement call surfaced and resolved within scope: for finding #12 I chose to
anchor on Monday 06:00 (T+56h) rather than relabel Open as Sunday, because ordering reopening before
the first weekday cutoff is the fixed business constraint. If the coordinator instead wants a Sunday
open, the offsets would need re-deriving — flagging in case that was the intent (I judged Monday is
correct per §6.I "before the first weekday cutoff").
