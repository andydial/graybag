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
- [ ] `E17-02` Set up EAS Build + Submit against the existing Apple and Google accounts
- [ ] `E17-03` Store listing copy, screenshots and privacy links prepared for Andy to submit
- [ ] `E17-04` (owner:andy) **Submit** the Apple App Privacy questionnaire and Google Data Safety form — answers drafted for you from `E20`; you sign them off in the consoles
- [ ] `E17-05` (risk:high) Review both stores' policies on apps used by children; confirm no additional obligations apply
- [ ] `E17-06` (owner:andy) TestFlight build + Play internal testing track, ~15 beta users invited
- [ ] `E17-07` (risk:critical) **Beta period** — real orders, real payments, monitored daily. Exit criteria, to be confirmed but written as numbers now:
      - at least 40 successful real orders across at least 8 distinct users
      - zero unreconciled payments for the whole period (`E06-11`)
      - payment success rate at or above 97%
      - crash-free sessions at or above 99.5%
      - zero signature-verification failures
      - at least one full refund and one partial refund executed end to end
- [ ] `E17-08` Cutover runbook with a timed, step-by-step sequence and named go/no-go checks
- [ ] `E17-09` Cutover weekend execution: migrate, validate, switch Bubble to read-only, DNS cutover for graybag.com
- [ ] `E17-10` (risk:critical) Phased store rollout. **Halt immediately** on any of:
      - any webhook signature-verification failure
      - payment success rate dropping below 95% over any rolling hour
      - more than 20 unhandled errors per hour attributable to the new build
      - any reconciliation mismatch
- [ ] `E17-11` Draft customer comms for the one-time OTP re-login; Andy approves and sends
- [ ] `E17-12` (owner:andy) Support plan for the first two weeks (who answers, how fast, what the common issues will be)
- [ ] `E17-13` Decommission Bubble after 30 days; export and archive everything first
- [ ] `E17-14` (risk:critical) **Drain plan for Bubble in-flight payments and future-dated paid orders** before the migration snapshot: fixed drain window, settle-or-fail on Bubble, manual worksheet for anything still pending, reconciled by hand against the Razorpay dashboard. Resolves `[CO-03]`; closely tied to `E16-01`
- [ ] `E17-15` (risk:critical) **Lock down the public Bubble Data API at freeze** independently of the read-only decision, so 30-day break-glass (`R3`) does not extend the `[DP-03]` public exposure. Verify what Bubble read-only actually permits (`[CO-02]`). Ties to `E20-23`
- [ ] `E17-16` **OTP re-login comms campaign**: pre-cutover email + push (where a token survives), an in-app login-screen explainer, and a separate manual outreach channel for `E16-12`'s no-mobile users who cannot receive an OTP. Execution of `E17-11`'s drafts (`U2`)
- [ ] `E17-17` **Cutover-day manual-review staffing**: budget time to work the `migration_review` (ambiguous phone match) queue from `E03-11` on the Monday, or those families cannot log in
- [ ] `E17-18` (risk:high) **Reconciliation checkpoint at T+0 of new-stack live**: run the tier-2 daily reconciliation (`E06-11`) against Razorpay for the beta+cutover window before opening ordering, so no pre-existing break is inherited silently
- [ ] `E17-19` (risk:high) Cross-check `docs/store-submission.md`'s App Privacy and Data Safety answers against the **final** `docs/privacy-policy.md` (Q11) and reconcile any divergence — the store answers were derived from `docs/dpdp-compliance.md`, not the policy, which did not yet exist. Blocks `E17-04` (`[SS-01]`, `[SS-02]`)
- [ ] `E17-20` Wire the App Store "account deletion" support answer + URL and the Play Store "Data deletion" URL to the in-app erasure flow (`E03-08` / `E20-18`), so both stores' deletion requirements point at a real, reachable path
- [ ] `E17-21` Produce the store **screenshot assets** from the shot-list in `docs/store-submission.md` §5 on the required device sizes, once the app shell (`E14`) and design system (`E13`) render real screens. Use synthetic/sentinel child data only — never a real child's name, class or allergy in a store screenshot (DPDP tier S/P; CLAUDE.md #4)
- [ ] `E17-22` Verify the store listing text against each store's **field length limits** (App Store 30-char name / 30-char subtitle / 100-char promotional text; Play 30-char title / 80-char short description / 4000-char full description) before submission
