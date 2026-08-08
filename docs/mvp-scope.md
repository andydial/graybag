---
title: MVP scope
status: agreed 2026-08-07 — supersedes the earlier 288-task version
---

# MVP scope — the actual minimum

## The rule

**174 tasks are in v1. Everything else is fast-follow.** The list is explicit and lives in
`scripts/tag-mvp.mjs`. Anything not named there — including anything added later — is
fast-follow by default.

> **173 → 174 on 2026-08-08.** Andy scoped `E02-24` into v1: the authorization suite was
> reporting `Tests: 0` and passing, because its fixture ids collided with `seed.sql`. A suite
> that silently tests nothing is false confidence, which is the one thing non-negotiable #2
> exists to prevent — so the fix is v1, not fast-follow. This is the only id added to the list
> since it was written, and it was added by Andy's explicit decision, not by drift.

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

## Signup-to-first-order conversion is a named v1 requirement

Agreed 2026-08-08 (decision `AR7`). This sits with the scope decisions above rather than in a
performance or design doc, because it is a **goal of v1**, not a quality attribute of it. The
funnel is the thing being replaced; an app that is technically correct and converts worse than
the Bubble one has wasted the migration.

**The path from opening the app to paying for a first order must be as close to frictionless as
we can make it.** Concretely, for v1:

- **Google one-tap is the front door.** No passwords, no email/password form, no phone OTP
  (`U1`).
- **No separate email-verification step** — Google verifies the address, and an email OTP cannot
  succeed on an address the user cannot read (`AR4`). Adding a verification screen would be pure
  friction with no security gain.
- **No unnecessary fields at signup.** Anything that can be collected later, on the screen that
  actually needs it, is collected later. Mobile number is a profile field acquired post-login
  (`E03-17`), not a signup field — and after the migration nobody has one anyway.
- **Adding a child must not be a wall in front of the menu.** Browsing works before any dependent
  exists. The child is required to *order*, not to *look*, and the prompt belongs at the point of
  ordering where its purpose is obvious.
- **No blocking step that can be deferred.** Consent at child creation (`E20`) and the
  policy-version gate are legal requirements and stay — they are the exception, and they sit at
  the moment they are actually about.

**Any task that adds a step to that path needs an explicit justification recorded with it.** This
is a scope constraint, not a suggestion: the reason the previous plan drifted from 161 tasks to
288 was that nobody had to argue for an addition. Same rule here, applied to the funnel rather
than the task list.

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
