---
id: E17
title: Release, Beta & Cutover
phase: 8
risk: critical
status: not-started
depends_on: [E06, E07, E09, E10, E14, E15, E16, E20]
summary: Closed beta with real money, then a cutover weekend, then a phased store rollout with a halt button.
---

## Agreed rollout

1. **Closed beta, ~2 weeks** — ~15 invited users (team, friendly parents, staff) on TestFlight and Play internal testing, placing real orders with real money. Bubble keeps serving everyone else.
2. **Cutover weekend** — migrate all data, Bubble goes read-only.
3. **Phased store rollout** — iOS Phased Release (7 days), Android staged rollout 5% -> 20% -> 50% -> 100%, halted on any Sentry error spike.
4. **Keep the Bubble subscription 30 days** as break-glass, then cancel.

Note: Android supports halt-and-revert; **iOS has no true rollback**, so a fix means a new build through review (24–48h). OTA updates cover most JS-level fixes without review.

## Tasks

- [ ] `E17-01` (owner:andy) Confirm Play App Signing / upload key status (low risk — mandatory since Aug 2021, so almost certainly enabled)
- [ ] `E17-02` (mvp) Set up EAS Build + Submit against the existing Apple and Google accounts
- [ ] `E17-03` (mvp) Store listing copy, screenshots and privacy links prepared for Andy to submit
- [ ] `E17-04` (owner:andy) (mvp) (risk:critical) **BLOCKED ON `E20-26`/`E20-10` — do not submit while an unscrubbed Sentry is wired up.** Answering "not collected" then is a false statement to two app stores. **Submit** the Apple App Privacy questionnaire and Google Data Safety form — answers drafted for you from `E20`; you sign them off in the consoles
- [ ] `E17-05` (risk:high) Review both stores' policies on apps used by children; confirm no additional obligations apply
- [ ] `E17-06` (owner:andy) (mvp) TestFlight build + Play internal testing track, ~15 beta users invited
- [ ] `E17-07` (risk:critical) (mvp) **Beta period** — real orders, real payments, monitored daily. Exit criteria, to be confirmed but written as numbers now:
      - at least 40 successful real orders across at least 8 distinct users
      - zero unreconciled payments for the whole period (`E06-11`)
      - payment success rate at or above 97%
      - crash-free sessions at or above 99.5%
      - zero signature-verification failures
      - at least one full refund and one partial refund executed end to end
- [ ] `E17-08` (mvp) Cutover runbook with a timed, step-by-step sequence and named go/no-go checks
- [ ] `E17-09` (mvp) Cutover weekend execution: migrate, validate, switch Bubble to read-only, DNS cutover for graybag.com
- [ ] `E17-10` (risk:critical) (mvp) Phased store rollout. **Halt immediately** on any of:
      - any webhook signature-verification failure
      - payment success rate dropping below 95% over any rolling hour
      - more than 20 unhandled errors per hour attributable to the new build
      - any reconciliation mismatch
- [ ] `E17-11` (mvp) Draft customer comms for the one-time OTP re-login; Andy approves and sends
- [ ] `E17-12` (owner:andy) (mvp) Support plan for the first two weeks (who answers, how fast, what the common issues will be)
- [ ] `E17-13` (mvp) Decommission Bubble after 30 days; export and archive everything first
- [ ] `E17-14` (risk:critical) **Drain plan for Bubble in-flight payments and future-dated paid orders** before the migration snapshot: fixed drain window, settle-or-fail on Bubble, manual worksheet for anything still pending, reconciled by hand against the Razorpay dashboard. Resolves `[CO-03]`; closely tied to `E16-01`
- [ ] `E17-15` (risk:critical) **Lock down the public Bubble Data API at freeze** independently of the read-only decision, so 30-day break-glass (`R3`) does not extend the `[DP-03]` public exposure. Verify what Bubble read-only actually permits (`[CO-02]`). Ties to `E20-23`
- [ ] `E17-16` **OTP re-login comms campaign**: pre-cutover email + push (where a token survives), an in-app login-screen explainer, and a separate manual outreach channel for `E16-12`'s no-mobile users who cannot receive an OTP. Execution of `E17-11`'s drafts (`U2`)
- [ ] `E17-17` **Cutover-day manual-review staffing**: budget time to work the `migration_review` (ambiguous phone match) queue from `E03-11` on the Monday, or those families cannot log in
- [ ] `E17-18` (risk:high) **Reconciliation checkpoint at T+0 of new-stack live**: run the tier-2 daily reconciliation (`E06-11`) against Razorpay for the beta+cutover window before opening ordering, so no pre-existing break is inherited silently
- [ ] `E17-19` (risk:high) Cross-check `docs/store-submission.md`'s App Privacy and Data Safety answers against the **final** `docs/privacy-policy.md` (Q11) and reconcile any divergence — the store answers were derived from `docs/dpdp-compliance.md`, not the policy, which did not yet exist. Blocks `E17-04` (`[SS-01]`, `[SS-02]`)
- [ ] `E17-20` Wire the App Store "account deletion" support answer + URL and the Play Store "Data deletion" URL to the in-app erasure flow (`E03-08` / `E20-18`), so both stores' deletion requirements point at a real, reachable path
- [ ] `E17-21` Produce the store **screenshot assets** from the shot-list in `docs/store-submission.md` §5 on the required device sizes, once the app shell (`E14`) and design system (`E13`) render real screens. Use synthetic/sentinel child data only — never a real child's name, class or allergy in a store screenshot (DPDP tier S/P; CLAUDE.md #4)
- [ ] `E17-22` Verify the store listing text against each store's **field length limits** (App Store 30-char name / 30-char subtitle / 170-char promotional text; Play 30-char title / 80-char short description / 4000-char full description) before submission
- [x] `E17-23` Fix the stale forward task-ID references and measurable slips the store-submission pack and runbook accumulated when Q13/Q14 took the ID range Q12 reserved: store-submission.md E17-14→19/15→20/16→21/17→22 and E20-24→28; decisions.md `SUB1` and open-questions.md Q12 preamble E17-14→19; refund-policy.md PY3→[PAY-03] and the M5/kitchen MDR wording; keyword count 83→80 and subtitle 28→29; and the runbook's dead `_overnight-merge` reference + "proposed" labels. Done in the review-fix pass (review finding #11/#26/#28/§3.3)
- [x] `E17-24` Correct the cutover-runbook clock: `T+32h` was mislabelled Monday 06:00 (that is `T+56h`); soak is Sat 12:00 → Mon 06:00 = 42h, not 18h. All labels (§2 rows H/I, §6 Phase H & I, §8.2, §10 G5) now consistent, anchored on the fixed business constraint that ordering reopens before the first weekday cutoff. Feeds precondition P3. Done in the review-fix pass (review finding #12)
- [ ] `E17-26` (owner:andy) **Register an iOS device UDID for internal-distribution builds** — `eas device:create`. The `staging` profile is `distribution: internal`, which on iOS is ad-hoc: it needs an Apple Developer login (interactive, with 2FA) and at least one registered device, neither of which can be done unattended. Android needs nothing here — EAS generates the keystore itself
- [ ] `E17-27` (owner:andy) **App Store Connect app id (`ascAppId`)** for `eas submit`. Deliberately absent from `eas.json` (see `docs/decisions/environments.md`) — a guessed value submits to somebody else's listing. Not needed until the first submit
- [ ] `E17-25` **Decouple Gate G3 (point of no return) from the overnight run.** Reach the reversible Gate G2 overnight, then a mandatory operator rest gate, then sign G3 fresh (Sat afternoon or Sun morning) — the weekend freeze has slack (42h soak, no Sat/Sun service). Implements the option chosen in `[CO-08]` (review finding #23)
- [x] `E17-28` **Split the non-production app identity** — `com.gracord.graybag.staging` / `com.Gracord.Graybag.staging`, display name "GrayBag Staging", its own URL scheme. An internal build must install *beside* the live store app, never over it

- [ ] `E17-29` Keep `docs/andy-prep/` matching reality — when Andy submits a form or gets an answer, fold it back into the repo so the drafts do not drift into fiction
