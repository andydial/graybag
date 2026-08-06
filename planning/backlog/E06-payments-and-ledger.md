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

Added by Q06 (`docs/order-lifecycle.md`). Each references the section of that document it implements.

- [ ] `E06-15` (risk:critical) **Payment status monotonicity** (`L3`, §6.2) — webhook handling moves `payment.status` on a capture rank and never downgrades. Out-of-order delivery fixtures (`authorized` arriving after `captured`) are part of the test, not an afterthought
- [ ] `E06-16` (risk:high) `GET /checkout/:group/status` — the app-kill-mid-payment path (§10.3). Reconciles against Razorpay rather than reporting our own row, and settles if a capture happened. Called on launch for every locally-known non-terminal group
- [ ] `E06-17` **In-flight reconcilers** — `payment` rows stuck at `created`/`authorized` past the TTL, and `refund` rows stuck at `pending`/`processing`, are asked about at Razorpay and closed (§11)
- [ ] `E06-18` (risk:high) **Duplicate capture path** (§10.6b) — record the second real capture and immediately raise a full refund to **source** with `reason_code = 'duplicate_payment'`, plus an alert. **Blocked on `[OL-05]`**: the schema currently cannot record it
- [ ] `E06-19` **Wallet-leg reversal** — a wallet hold taken at checkout is reversed by a `reversal_of_transaction_id` posting the moment the group closes, and a hold is never left outstanding against a dead checkout (§10.7). The nightly wallet-vs-ledger assertion in `E06-11` is what catches a missed one
- [ ] `E06-20` (risk:high) Migration `0003` — the schema, config and seed additions `docs/order-lifecycle.md` §15 requires: `[OL-05]`'s duplicate-capture column and index change; the `pending_payment_ttl_minutes`, `payment_in_flight_grace_minutes` and `payment_retry_window_minutes` config settings on all three config tables; and the `checkout_expired` (and, if `[OL-02]` lands on auto-cancel, `cutoff_missed`) reason codes. Update `docs/data-model.md` §9.1 in the same PR
- [ ] `E06-21` Correct the over-refund guard (§7.3) — it must sum refunds at `pending`, `processing` **and** `completed`, and take the `order_group` row lock, so two admins refunding the same order concurrently cannot both pass. `docs/data-model.md` §8.3 states it wrongly in both directions
