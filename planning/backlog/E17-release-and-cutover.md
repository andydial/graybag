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
