# Q14 — cross-cutting output from writing `docs/cutover-runbook.md`

Everything here is a proposal for a human or another worker to merge into the canonical
files (`docs/open-questions.md`, `docs/decisions.md`, `docs/learnings.md`, the backlog).
I did not touch those files — isolation rule.

---

## New open questions

Proposed ids use the `[CO-nn]` prefix (**CO** = cutover). Renumber on merge if it collides.

### `[CO-01]` — When is the cutover weekend, and how long is the ordering freeze?
- **Options.** (a) A **Friday-night → Monday-morning** window: Bubble goes read-only Friday
  ~22:00 IST after the last cutoff has passed for the week, migrate/validate Saturday, soak
  Sunday, open the new stack Monday 06:00 before the first cutoff. (b) A **Saturday–Sunday**
  window only, tighter, less soak time. (c) Cut over during a **school holiday week** when no
  service days fall inside the window, which removes the in-flight-order problem almost
  entirely.
- **Recommendation.** (c) if a holiday week is available within the launch timeline; otherwise
  (a). A weekend is chosen because schools do not serve on Sat/Sun in the current cities, so no
  `service_date` falls inside the freeze and the in-flight-order surface is limited to orders
  *already placed* for the following week, not orders being placed during the window.
- **Blocks launch?** Y — `E17-09` cannot be scheduled without it. Owner: Andy (a date decision,
  and it depends on the school calendar).

### `[CO-02]` — Does Bubble go fully read-only, or stay writable for 30 days?
- The runbook assumes Bubble is switched to **read-only** at freeze and kept read-only as the
  30-day break-glass (`R3`). If a full technical read-only lock is not achievable in Bubble
  (workflows may still fire), the compensating control is to **disable the payment workflow and
  the order-create workflow only**, and tell users via comms to use the new app.
- **Recommendation.** Achieve read-only by disabling Bubble's order-create and payment
  workflows and pointing `graybag.com` DNS at the new site; leave data readable for support
  lookups. Confirm what "read-only" Bubble actually permits — this is a **validation** Andy /
  the Bubble editor must do.
- **Blocks launch?** Y (partial) — the break-glass story in `R3` depends on it. Owner: Andy
  (credentialed — Bubble editor).

### `[CO-03]` — Cutover-time in-flight orders and payments: how are they drained?
- At the moment Bubble goes read-only there may be Bubble orders that are **paid but not
  delivered** (for a future service date) and Bubble payments **in flight** (UPI collect
  pending). These do not fit the E16 historical-order migration cleanly because their money and
  fulfilment state is still moving.
- **Recommendation (built into the runbook §4).** Drain rather than migrate live state:
  (1) stop new Bubble payments at freeze; (2) let any Bubble in-flight payment settle or fail
  **on Bubble** during a fixed drain window before the migration snapshot is taken; (3) migrate
  the resulting settled orders as history with `order.status` already `paid`/`delivered`;
  (4) any Bubble payment still pending at snapshot time is listed on a manual worksheet and
  reconciled against the Razorpay dashboard by hand — it is not auto-migrated.
- **Blocks launch?** Y — `E16-01`/`E16-04` need to know whether future-dated paid Bubble orders
  come across as fulfillable orders or as closed history. Owner: Andy + build.

### `[CO-04]` — Do future-dated paid Bubble orders get fulfilled by the new kitchen ops, or refunded?
- A parent who paid on Bubble on Thursday for **next Tuesday's** lunch has a real obligation.
  Either the new stack must be able to show the kitchen that order (so it gets cooked), or those
  orders are refunded on Bubble before cutover and the parent re-orders on the new app.
- **Recommendation.** Migrate future-dated paid orders as real `paid` orders in the new schema
  so the kitchen packing list includes them, with the money represented as an **opening ledger
  credit** posture (no second charge). This is the honest option but it is the harder migration.
  The fallback — refund-and-reorder — is cleaner technically but charges/soft-inconveniences
  paying customers and risks a gap in coverage. **Andy decides**, ideally jointly with the
  kitchen.
- **Blocks launch?** Y. Owner: Andy (product/commercial) + build.

### `[CO-05]` — Legacy prepaid/wallet balances at cutover
- Ties to `[E00-18]` / `E16-16`. If off-system prepaid balances exist, they must land as
  **opening ledger credits** before the first new-stack order, or customers lose money. The
  runbook has a go/no-go check for this but cannot resolve whether balances exist.
- **Recommendation.** Resolve `E00-18` before scheduling the weekend; if balances exist,
  `E16-16` is a **blocking** predecessor of `E17-09`.
- **Blocks launch?** Y if balances exist. Owner: Andy.

### `[CO-06]` — Is the legacy Bubble exposure ([DP-03]) an already-notifiable breach, and does keeping Bubble live 30 days extend the exposure window?
- Not new — this is `[DP-03]`. Flagged here because the **cutover plan is the moment it becomes
  operational**: keeping Bubble read-only for 30 days (`R3`) keeps the publicly-readable
  `Order`/`Child` surface live for 30 more days unless it is locked down. The runbook adds a
  pre-cutover step to **lock down or take offline the public Bubble Data API** independently of
  the read-only decision, so break-glass does not mean "keep the exposure running".
- **Recommendation.** Fold into `E20-23` (prepare the facts) and ask the lawyer (`E20-01`)
  before the weekend, not after. If the exposure cannot be closed while keeping Bubble as
  break-glass, that trade-off is Andy's to make with legal input.
- **Blocks launch?** Y — this is a live regulatory clock, not a nicety. Owner: Andy + lawyer.

### `[CO-07]` — What is the go/no-go authority when the team is one person?
- Every go/no-go gate in the runbook names Andy as the decider. `[DP-01]`'s deputy question
  applies here too: if Andy is unavailable mid-weekend there is no second signer. The
  compensating control is that the runbook is written so the **default action at every failed
  gate is to NOT proceed and to roll back**, which is safe without a second human.
- **Recommendation.** Accept single-signer for v1; the rollback-by-default design is the
  mitigation. Revisit with `[DP-01]`.
- **Blocks launch?** N. Owner: Andy.

---

## Learnings

- **The in-flight problem is smaller than it looks if the freeze lands on a non-service day.**
  Because the current cities do not serve food on weekends, no `service_date` falls inside a
  weekend cutover, so the only live-money surface is *future-dated* paid orders and *pending*
  Bubble payments — both of which can be drained on Bubble before the migration snapshot rather
  than migrated mid-flight. This is the most useful framing for the whole weekend and it is why
  the runbook insists the freeze begin after the last weekday cutoff has passed.
- **"Keep Bubble 30 days" (`R3`) and "the Bubble exposure may be a breach" (`[DP-03]`) are in
  direct tension** and nobody had written that down. Break-glass insurance and a live public
  data exposure are the same 30 days. The runbook resolves it by locking the public Data API at
  freeze while keeping the data *readable to authenticated admin* for support — but whether
  Bubble permits that split is unverified (`[CO-02]`).
- **OTP re-login is not a migration step, it is a comms campaign with a technical backstop.**
  `U2` means every user re-authenticates once regardless; the risk is not technical (the auth
  flow is `E03-11`) but that a user doesn't know they must, tries their old password, and churns.
  The mitigation is comms sent *before* the weekend, a login screen that explains it, and
  `E16-12`'s list of users with no usable mobile number handled by a **separate** manual channel
  because those users cannot receive an OTP at all.
- **`E03-11`'s ambiguous-match-blocks-auto-claim rule is a cutover-day operational load, not
  just a code path.** The manual-review queue (`migration_review`) will have real rows on
  Monday morning and someone has to work them, or those families cannot log in. The runbook
  budgets for it.

---

## Decisions

Proposed for `docs/decisions.md` (Release section, after `R5`). These are runbook-shaped
choices, not yet ratified:

- **R6 (proposed).** The cutover freeze begins only **after the last weekday order cutoff has
  passed**, so no `service_date` falls inside the freeze window. Consequence: the freeze is a
  weekend (or holiday-week) event, and the in-flight surface reduces to future-dated paid orders
  and pending payments, which are *drained on Bubble* rather than migrated mid-flight.
- **R7 (proposed).** Bubble in-flight payments are **not migrated as live state.** They are
  drained (settle-or-fail on Bubble) before the migration snapshot; anything still pending at
  snapshot is reconciled by hand against the Razorpay dashboard. Rationale: the new stack's
  payment state machine must never inherit a half-open attempt it did not create (mirrors `L4` —
  choose the recoverable failure).
- **R8 (proposed).** Every go/no-go gate defaults to **roll back**, not proceed, so a single
  unavailable decision-maker fails safe. Rollback triggers are named per phase in the runbook.

---

## Proposed new backlog tasks

Target epic **E17** (release and cutover) unless noted. Append-only, never renumber (per
CLAUDE.md). Suggested ids continue the E17 series:

- `E17-14` (risk:critical) — **Drain plan for Bubble in-flight payments and future-dated paid
  orders** before the migration snapshot: fixed drain window, settle-or-fail on Bubble, manual
  worksheet for anything still pending. Resolves `[CO-03]`. (target: E17, closely tied to E16-01)
- `E17-15` (risk:critical) — **Lock down the public Bubble Data API at freeze** independently of
  the read-only decision, so 30-day break-glass does not extend the `[DP-03]` public exposure.
  Verify what Bubble read-only actually permits. (target: E17, ties to E20-23)
- `E17-16` — **OTP re-login comms campaign**: pre-cutover email + push (where a token survives),
  in-app login-screen explainer, and a separate manual outreach channel for `E16-12`'s
  no-mobile users. This is the *execution* of `E17-11`'s drafts. (target: E17)
- `E17-17` — **Cutover-day manual-review staffing**: budget time to work the `migration_review`
  (ambiguous phone match) queue from `E03-11` on the Monday. (target: E17)
- `E17-18` (risk:high) — **Reconciliation checkpoint at T+0 of new-stack live**: run the tier-2
  daily reconciliation (`E06-11`) against Razorpay for the beta+cutover window before opening
  ordering, so no pre-existing break is inherited silently. (target: E17)
- `E16-18` (risk:critical) — **Point-in-time restore rehearsal**: prove the new Supabase project
  can be restored to the pre-cutover snapshot within the rollback SLA the runbook assumes.
  (target: E16, feeds the runbook's rollback plan)
