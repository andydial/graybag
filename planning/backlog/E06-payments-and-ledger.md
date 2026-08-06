---
id: E06
title: Payments — Razorpay & Ledger
phase: 4
risk: critical
status: not-started
depends_on: [E02, E05]
summary: Razorpay checkout with native UPI, webhooks with signature verification, refunds, and the money ledger. Highest-risk epic in the build.
---

## Why this is the riskiest epic

Real money, live users, and the legacy implementation has a public webhook endpoint (`payment_processed`) with no visible server-side signature verification. Stripe is being dropped entirely; Razorpay only.

The de-risking spike now lives in **`E19-01`** and runs in phase 1, long before this epic starts. Do not begin E06 design until it has an answer.

## Tasks

- [ ] `E06-02` (risk:critical) Replace the hosted payment-link redirect with in-app checkout + **native UPI intent** (this is the "clunky" fix)
- [ ] `E06-03` (risk:critical) Server-side **HMAC signature verification** on every webhook and callback. Never trust client-reported status
- [ ] `E06-04` (risk:critical) Idempotent webhook handling — Razorpay retries; the same event must never double-credit
- [ ] `E06-05` Order state machine: `draft -> pending_payment -> paid -> preparing -> delivered`, plus `cancelled` and `refunded`, with legal transitions enforced
- [ ] `E06-06` (risk:high) Handle payment failure, timeout, app-kill-mid-payment, and duplicate payment
- [ ] `E06-07` (risk:critical) **Ledger**: append-only credits/debits with reason codes. Every payment, refund, revenue share and future subscription writes here
- [ ] `E06-08` Refunds — full order and **per-line** (one dish unavailable, deliver the rest)
- [ ] `E06-09` Refund to **wallet balance** (instant) as the default, with refund-to-source as an option
- [ ] `E06-10` (risk:high) Wallet balance usable at checkout (balance only; top-up UI is deferred). **Blocked on confirming RBI Prepaid Payment Instrument rules do not apply** to refund-only credit — see `docs/open-questions.md`
- [ ] `E06-11` (risk:high) **Daily reconciliation job**: Razorpay settlement report vs internal ledger; alert on any mismatch
- [ ] `E06-12` Razorpay MDR on refunds accounted against the **school's share**
- [ ] `E06-13` Test-mode payment fixtures so E2E tests cover the full payment path in CI
- [ ] `E06-14` Environment-scoped Razorpay keys verified — staging can never reach live keys
