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

Added by Q07 (`docs/payments-design.md`). Each references the section of that document it implements.

- [ ] `E06-22` (risk:critical) **Ledger reason codes** (§10, §8.4 gap 2) — `ledger_transaction.reason_code` is `not null references reason_code(code)` and none of the eight seeded codes names a money movement, so no ledger posting can be written at all. Seed the `category = 'ledger'` vocabulary: `sale`, `provider_fee`, `settlement`, `wallet_hold`, `wallet_hold_reversal`, `refund_to_wallet`, `refund_to_source`, `revenue_share`, `refund_mdr_recovery`, `payout`, plus `provider_initiated` for `[PAY-07]`. **Blocks `E06-07` outright.** Migration `0003`, with `E06-20`. Correct `docs/data-model.md` §8.4's worked example in the same PR — it omits the MDR posting, so the clearing account is permanently overstated
- [ ] `E06-23` (risk:high) **Add `bank` to `ledger_account_type`** and seed `platform:bank` (§8.4 gap 1) — there is no cash account, so a settlement has nowhere to land and `provider:razorpay:clearing` never clears. Blocks tier-3 reconciliation *and* payouts (`E07-10`). Note `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, so the value lands in `0003` and its first use in `0004`
- [ ] `E06-24` Add `CHECK (destination <> 'source' or payment_id is not null)` to `refund` (§9.9) — nothing today prevents a refund to a source that does not exist. Migration `0003`
- [ ] `E06-25` (risk:high) **Razorpay payload redaction, with a test** (§3.7, §6.5) — no recipient name, class, section, allergen, dish name, card PAN or VPA may appear in an outbound Razorpay request or in `payment.notes` / `payment_webhook_event.payload`. The test seeds a sentinel recipient name and asserts it appears in neither. Non-negotiable #4
- [ ] `E06-26` **Webhook secret rotation runbook** (§2.4) — dual-secret verification via `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`, because the secret belongs to the Razorpay endpoint and cannot be swapped atomically with respect to events in flight. Feeds `E00-17`
- [ ] `E06-27` **Tier-3 settlement reconciliation** (§8.4) — ingest the Razorpay settlement recon report, backfill `provider_fee_paise` / `provider_tax_paise`, post the settlement to `platform:bank`, and assert `balance(provider:razorpay:clearing)` equals what Razorpay says is pending. Depends on `E06-23`
- [ ] `E06-28` (risk:high) **Distinguish a misconfigured webhook secret from an attack** (§5.6) — a wrong secret fails 100% of webhooks, records them all, returns `200` and therefore produces no 5xx and no retries. Alert on ~100% signature failure since a deploy, **and** on zero verified events in a window in which orders were placed. Under `E15-05`
- [ ] `E06-29` **Expo config plugin for UPI app visibility** (§3.3) — Android 11+ `<queries>` for the UPI intent app chooser, plus iOS `LSApplicationQueriesSchemes`. Without it the app list is silently empty and checkout degrades to UPI collect/QR, which is the flow `E06-02` exists to replace
