---
title: MVP scope
status: agreed 2026-08-07 — supersedes the earlier 288-task version
---

# MVP scope — the actual minimum

## The rule

**173 tasks are in v1. Everything else is fast-follow.** The list is explicit and lives in
`scripts/tag-mvp.mjs`. Anything not named there — including anything added later — is
fast-follow by default.

That default is deliberate. The previous version used an exclude-list, so every review pass
quietly added tasks to v1 and a 161-task plan became 288 without anyone deciding it should.

**To put something in v1 you have to add its id to that list, on purpose.**

## What v1 is

A parent at a Mohali school opens the app, signs in with Google, adds their child, browses
the menu, pays by UPI, gets a confirmation email with a GST invoice. The kitchen sees the
order on a web dashboard, marks it delivered, refunds it if the dish is unavailable. All 400
existing users and their order history come across from Bubble. Bubble is switched off.

That is the whole of v1.

## Scope decisions

| | Decision | Why |
|---|---|---|
| **Cities** | **Mohali only** for v1 | Same state as the kitchen, so GST is a simple CGST 2.5% + SGST 2.5%. Chandigarh (UT) and Panchkula (Haryana) are different state codes and would drag in IGST, place-of-supply derivation and possibly extra registrations. Add them as a fast-follow once live |
| **GST** | Flat **5%**, shown as CGST 2.5% + SGST 2.5%. No accountant gate | Correct for intra-Punjab supply. Andy reconciles anything else at filing time. The invoice must still *show* a split — that part is not optional |
| **Auth** | Google Sign-In, Sign in with Apple, email OTP. No passwords | See `docs/decisions.md` U1. Removes DLT's weeks of lead time from the critical path |
| **Tests** | ~60s smoke on every push; **full suite overnight with automatic fixes** | Solo developer, pre-launch. The smoke test exists so the overnight run isn't debugging a typo across eight hours of work, not for safety |
| **Compliance** | Six tasks in v1, nineteen deferred | Consent at child creation cannot be retrofitted for people who already signed up, and both stores refuse to publish without a live privacy policy and data-deletion URL. The rest — erasure pipeline, breach runbook, DSR alerting, processor register, purge job, legal review — waits |
| **Push notifications** | None in v1 | Prod has none today. The 9pm cutoff reminder is the strongest fast-follow candidate |

## What ships despite not being in production today

Parity cannot mean parity with today's mistakes.

- **Authorization / RLS + its test suite.** Today every order and every child's allergies are world-readable. This is the single thing the migration exists to fix
- **Webhook signature verification and idempotency.** Without them anyone can mark an order paid, and Razorpay's retries double-count
- **GST invoices.** You already charge 5%; invoicing it properly is a legal obligation
- **The ledger.** No visible wallet in v1, but retrofitting a ledger after money has moved is genuinely painful
- **UI/UX and performance.** The entire reason for migrating. Shipping the old experience on a new stack wastes the quarter

## Deferred — 197 tasks

Push notifications · school monthly PDF reports · revenue-share and payout reports (stays a
spreadsheet) · kitchen production and packing aggregates · 4-digit pickup codes · wallet
balance and refund-to-wallet · allergen blocking warnings (tags still import) · offline
reads · load testing, product analytics, cost monitoring · audit log, metrics dashboard,
view-as-user · automated retention purge, erasure pipeline, breach runbook, DSR alerting ·
Chandigarh and Panchkula (IGST) · phone OTP · SEO polish and Lighthouse budgets · subscriptions,
cash top-up, capacity limits, delivery role, WhatsApp.

Nothing is deleted. It is all still in `planning/backlog/`, just untagged.

## The one number the task count hides

`E14-14` — "screens rebuilt to the new design system" — is a single line worth roughly a
quarter of the entire build. Split it per screen when you reach it. Do not read 173 as
173 equal units.

## Estimate

**7–9 weeks** at 20–30 hrs/week.
