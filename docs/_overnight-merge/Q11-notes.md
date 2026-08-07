# Q11 notes — privacy policy, terms, refund policy

Cross-cutting output from Q11. Nothing here was written into the shared docs
(`open-questions.md`, `decisions.md`, `learnings.md`, backlog, etc.) per the isolation rule —
merge from here.

Files produced: `docs/privacy-policy.md`, `docs/terms.md`, `docs/refund-policy.md`. All three
are **templates for a lawyer** (`E20-06`), written for the real stack (Razorpay, an SMS provider,
Sentry, Better Stack, Supabase in Mumbai) and grounded in `docs/dpdp-compliance.md`,
`docs/payments-design.md` and `docs/decisions.md`. Every unresolved value is a `«…-PENDING-…»`
token so `E20-22` (the `G3`-style placeholder guard) catches it in a production build.

No contradiction with `docs/dpdp-compliance.md` was found — the three documents implement what
that spec's §2.6 says `Q11` must contain (notice content per §3.3, grievance block per §7.2,
retention statement per §6.2/§6.6, the survives-erasure wording per §6.6, the Razorpay disclosure
per payments §3.7). Where a number was needed it was written as the *proposal* from §6.2 with a
token, never as a decided value.

---

## New open questions

These are customer-facing / commercial values the policy drafts surfaced. Most are **not** new
DPDP questions (those are already `[DP-01]`…`[DP-07]`); they are the "what do we actually tell the
customer" side, which needs Andy and, for two of them, the lawyer.

- **[PP-01] Customer self-cancellation window.** How long before the kitchen cutoff may a customer
  cancel their own order and get a full refund? The system has `customer_cancellation_cutoff_minutes`
  and `customer_cancellation_allowed` (lifecycle T10) but the number is unchosen.
  Options: (a) same as the order cutoff — cancel any time up to cutoff; (b) a buffer (e.g. 60 min
  before cutoff) so the kitchen's headcount is stable earlier; (c) no self-cancel, contact-us only.
  Recommendation: (a) or a small buffer, as config per kitchen. **Does NOT block launch** (a value
  can ship), but a value must be chosen before the refund policy is published. Owner: Andy (product).

- **[PP-02] Post-delivery / problem-with-order refund stance.** §2.3 of the refund policy currently
  says post-delivery refunds are goodwill-only and at GrayBag's discretion. Is there a stated window
  to report a problem (e.g. "same day"), and is any category automatic (wrong item delivered)?
  Recommendation: state a same-day report window and make "wrong item / not delivered" an automatic
  refund; keep "didn't like it" as discretionary. **Does NOT block launch.** Owner: Andy (product),
  with a light legal check on the wording.

- **[PP-03] Allergy liability wording.** Terms §8 and the privacy notice both say the allergy warning
  is an aid, not a guarantee, and that a serious-allergy child must not rely on the app alone. The
  exact liability wording (`«ALLERGY-LIABILITY-WORDING-PENDING-E20-01»`) is health-and-safety
  language and **must** be drafted/approved by a lawyer. Recommendation: do not soften it; if
  anything, strengthen the "do not rely solely on the app" line. **BLOCKS launch** — shipping an app
  that shows allergy warnings for children without reviewed liability wording is the single riskiest
  gap in these documents. Owner: Andy → lawyer (`E20-01`).

- **[PP-04] Liability cap wording.** Terms §10 caps liability at the order value with a carve-out for
  death/personal injury. `«LIABILITY-CAP-WORDING-PENDING-E20-01»` needs a lawyer — a cap that tries
  to exclude what cannot be excluded under Indian law is unenforceable and looks bad.
  **Does NOT block launch** independently but rides with `E20-01`. Owner: lawyer.

- **[PP-05] Wallet credit and RBI PPI.** Terms §5 states wallet credit is refund-only store credit
  and cash top-up is not offered. `[DM-15]`/open-questions already flags the RBI Prepaid Payment
  Instrument question for cash top-up; the drafts assume refund-only credit is outside PPI regulation.
  Recommendation: keep top-up out of v1 (already the plan); have the lawyer confirm refund-only credit
  needs no PPI licence before we describe it as "store credit". **Does NOT block launch** for v1
  (no top-up), but the sentence should be lawyer-checked. Owner: lawyer (`E20-01`).

- **[PP-06] Minimum age to hold an account.** Terms §2 states 18+. The system has `is_self` recipients
  (a college student ordering for themselves may be 17). Is an account holder required to be 18, and
  what about a 16–17 self-ordering college student? Recommendation: keep account holder = 18+; a minor
  eats via a guardian's account. **Does NOT block launch.** Owner: Andy (product), light legal check.

---

## Learnings

- **The refund policy is almost entirely already-decided.** Unlike the privacy notice (blocked on
  `E20-01`) and the retention numbers (blocked on `E00-10`), the refund *mechanics* are fully pinned
  down by `docs/order-lifecycle.md` T10–T13 and `docs/payments-design.md` §9. The only genuinely open
  parts are customer-facing values (the cancellation window, the post-delivery stance) — see [PP-01],
  [PP-02]. Worth knowing: the refund policy could be published with far fewer legal unknowns than the
  privacy policy, if the two [PP] values are set.

- **The invoice carries a child's first name and survives erasure — this MUST be disclosed in the
  privacy notice, not buried.** `G7` + `D15` mean a DPDP erasure request cannot remove a child's first
  name from a retained tax invoice. §6.6 of the compliance spec is explicit that failing to tell the
  parent this up front is "a complaint we caused ourselves". Both the privacy policy (§5) and the terms
  (§4) now say it in plain words. Keep it that way through legal review — a lawyer trimming it for
  brevity would reintroduce the exact problem.

- **Three documents, one placeholder guard.** All `«…-PENDING-…»` tokens follow the `G3`/`E20-22`
  convention so a single CI check covers invoices, the grievance block, and these three policies. The
  token names encode the owner task (`-PENDING-E20-01`, `-PENDING-E00-10`, `-PENDING-E20-21`,
  `-PENDING-ANDY`), so a reviewer can see at a glance who unblocks each.

---

## Decisions

Non-obvious choices made while drafting (none override an existing `docs/decisions.md` entry;
these are Q11-local and can be folded into the decision log by the merger if wanted):

- **The three policies cross-reference rather than duplicate.** Refund detail lives only in
  `refund-policy.md`; Terms §6 summarises and links; the privacy notice does not restate refund
  mechanics. Rationale: the same instinct as the `api/` module rule (`A4`) and the token source
  (`S8`) — one source per fact, so a change to the cancellation window edits one document, not three.
  The refund policy is declared "part of the Terms" so it is contractually binding.

- **Retention numbers in the privacy notice are written as the §6.2 *proposals* with tokens, never
  as decided values.** Consistent with `C6` and `[DP-02]`: inventing a number in a published policy
  would be inventing the law. The parent-facing table quotes the proposed number in prose ("proposed:
  8 years") next to the token, so the lawyer edits a number rather than a blank.

- **Allergy disclaimer is stated in both the Terms and the privacy notice, and flagged as the top
  launch risk.** A food business serving children that shows allergy warnings has a duty-of-care
  surface these documents must address head-on. Marked `[PP-03]`, BLOCKS launch.

- **Cross-border wording distinguishes adult data (may leave India via Sentry/Expo/email) from child
  data (never leaves India by design).** This mirrors `[DP-05]` and the §5.3 egress rules exactly, so
  the notice does not over-claim "all your data stays in India" — which would be false for Sentry and
  Expo, and a false privacy claim is itself a problem.

---

## Proposed new backlog tasks

Append-only; never renumber. Suggested ids follow the existing E20/E07/E00 sequences (last existing:
E20-23, E07-* see that file, E00-* see that file). The merger should confirm the next free id.

- **E20 (target epic E20-compliance-and-data-protection):**
  - `E20-24` Draft privacy policy, terms and refund policy delivered as `docs/{privacy-policy,terms,refund-policy}.md` (Q11). Legal review of all three is `E20-01`; this task is the drafting, done.
  - `E20-25` (risk:high) (owner:andy) Lawyer to review and approve the **allergy liability** and **liability cap** wording in `docs/terms.md` §8 and §10 (`[PP-03]`, `[PP-04]`) — health-and-safety language, must not ship unreviewed. Rides with `E20-01`.
  - `E20-26` Wire the three policy documents into the app policy gate (`E20-03`) and the website footer / app Settings → Privacy, rendered from static build not a public table read (`[AZ-03]`). The grievance block (`§7.2`) must be reachable without an account.
  - `E20-27` Extend the `E20-22` placeholder guard to scan `docs/privacy-policy.md`, `docs/terms.md` and `docs/refund-policy.md` for `«…-PENDING-…»` tokens in any production/published build.

- **E00 (target epic E00-now-lead-time-and-security), owner:andy — decisions:**
  - `E00-XX` (owner:andy) Decide the customer **self-cancellation window** and the **post-delivery
    refund stance** for the refund policy (`[PP-01]`, `[PP-02]`). These are product decisions the
    refund policy is blocked on for its final customer-facing values; drafts ship with tokens until set.

- **E07 (target epic E07-invoicing-and-gst):** no new task — the invoice-side facts these policies
  quote (`«GRAYBAG-GSTIN-PENDING-E00-10»`, signature treatment, inclusive/exclusive price) are already
  owned by existing `E00-10` / `E07-02` / `[GST-01]` / `[GST-05]`. The policy drafts reference those
  tokens rather than creating duplicates.

---

## What BLOCKS launch (summary)

1. **[PP-03] Allergy liability wording** (`«ALLERGY-LIABILITY-WORDING-PENDING-E20-01»` in terms.md §8,
   echoed in privacy-policy.md §2.2 / §4.3). A children's food app that shows allergy warnings must not
   ship without lawyer-reviewed liability language. Owner: Andy → lawyer, via `E20-01`.
2. **All `-PENDING-E20-01` tokens** (legal entity name, DSR deadlines, breach timelines, cross-border,
   RBI PPI, jurisdiction) — the whole privacy notice is provisional on `E20-01`, which is `(owner:andy)`
   and not done. Publishing before it returns would be publishing unreviewed legal claims.
3. **`-PENDING-E20-21` grievance-officer identity** (name, title, email, address) — DPDP requires a
   published grievance contact; the four tokens block launch, as `docs/dpdp-compliance.md` §7.2 already
   states. Owner: Andy.
4. **`-PENDING-E00-10` invoice values** (GSTIN, retention years, signature treatment) — the terms and
   the retention table quote them; already owned, but they gate a compliant published policy.

Not blocking: [PP-01], [PP-02], [PP-05], [PP-06] can ship with a chosen default and be refined.
