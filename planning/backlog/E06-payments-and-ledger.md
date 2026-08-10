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

- [ ] `E06-02` (risk:critical) (mvp) Replace the hosted payment-link redirect with in-app checkout + **native UPI intent** (this is the "clunky" fix)
- [ ] `E06-03` (risk:critical) (mvp) Server-side **HMAC signature verification** on every webhook and callback. Never trust client-reported status
- [ ] `E06-04` (risk:critical) (mvp) Idempotent webhook handling — Razorpay retries; the same event must never double-credit
- [ ] `E06-05` (mvp) Order state machine: `draft -> pending_payment -> paid -> preparing -> delivered`, plus `cancelled` and `refunded`, with legal transitions enforced
- [ ] `E06-06` (risk:high) (mvp) Handle payment failure, timeout, app-kill-mid-payment, and duplicate payment
- [ ] `E06-07` (risk:critical) (mvp) **Ledger**: append-only credits/debits with reason codes. Every payment, refund, revenue share and future subscription writes here
- [ ] `E06-08` (mvp) Refunds — full order and **per-line** (one dish unavailable, deliver the rest)
- [ ] `E06-09` Refund to **wallet balance** (instant) as the default, with refund-to-source as an option
- [ ] `E06-10` (risk:high) Wallet balance usable at checkout (balance only; top-up UI is deferred). **Blocked on confirming RBI Prepaid Payment Instrument rules do not apply** to refund-only credit — see `docs/open-questions.md`
- [ ] `E06-11` (risk:high) (mvp) **Daily reconciliation job**: Razorpay settlement report vs internal ledger; alert on any mismatch
- [ ] `E06-12` (mvp) Razorpay MDR on refunds accounted against the **school's share**
- [ ] `E06-13` (mvp) Test-mode payment fixtures so E2E tests cover the full payment path in CI
- [ ] `E06-14` (mvp) Environment-scoped Razorpay keys verified — staging can never reach live keys

Added by Q06 (`docs/order-lifecycle.md`). Each references the section of that document it implements.

- [ ] `E06-15` (risk:critical) **Payment status monotonicity** (`L3`, §6.2) — webhook handling moves `payment.status` on a capture rank and never downgrades. Out-of-order delivery fixtures (`authorized` arriving after `captured`) are part of the test, not an afterthought
- [ ] `E06-16` (risk:high) (mvp) `GET /checkout/:group/status` — the app-kill-mid-payment path (§10.3). Reconciles against Razorpay rather than reporting our own row, and settles if a capture happened. Called on launch for every locally-known non-terminal group
- [ ] `E06-17` **In-flight reconcilers** — `payment` rows stuck at `created`/`authorized` past the TTL, and `refund` rows stuck at `pending`/`processing`, are asked about at Razorpay and closed (§11)
- [ ] `E06-18` (risk:high) **Duplicate capture path** (§10.6b) — record the second real capture and immediately raise a full refund to **source** with `reason_code = 'duplicate_payment'`, plus an alert. **Blocked on `[OL-05]`**: the schema currently cannot record it
- [ ] `E06-19` **Wallet-leg reversal** — a wallet hold taken at checkout is reversed by a `reversal_of_transaction_id` posting the moment the group closes, and a hold is never left outstanding against a dead checkout (§10.7). The nightly wallet-vs-ledger assertion in `E06-11` is what catches a missed one
- [ ] `E06-20` (risk:high) (mvp) Migration `0003` — the schema, config and seed additions `docs/order-lifecycle.md` §15 requires: `[OL-05]`'s duplicate-capture column and index change; the `pending_payment_ttl_minutes`, `payment_in_flight_grace_minutes` and `payment_retry_window_minutes` config settings on all three config tables; and the `checkout_expired` (and, if `[OL-02]` lands on auto-cancel, `cutoff_missed`) reason codes. Update `docs/data-model.md` §9.1 in the same PR
- [ ] `E06-21` (mvp) Correct the over-refund guard (§7.3) — it must sum refunds at `pending`, `processing` **and** `completed`, and take the `order_group` row lock, so two admins refunding the same order concurrently cannot both pass. `docs/data-model.md` §8.3 states it wrongly in both directions

Added by Q07 (`docs/payments-design.md`). Each references the section of that document it implements.

- [x] `E06-22` (risk:critical) **Ledger reason codes** (§10, §8.4 gap 2) — `ledger_transaction.reason_code` is `not null references reason_code(code)` and none of the eight seeded codes names a money movement, so no ledger posting can be written at all. Seed the `category = 'ledger'` vocabulary: `sale`, `provider_fee`, `settlement`, `wallet_hold`, `wallet_hold_reversal`, `refund_to_wallet`, `refund_to_source`, `revenue_share`, `refund_mdr_recovery`, `payout`, plus `provider_initiated` for `[PAY-07]`. **Blocks `E06-07` outright.** Migration `0003`, with `E06-20`. Correct `docs/data-model.md` §8.4's worked example **and `docs/order-lifecycle.md` §8.4 step 6** in the same PR — both omit the MDR posting (`docs/payments-design.md` §10 row 3), so the clearing account is permanently overstated by the fee and tier-3 reconciliation can never balance
- [ ] `E06-23` (risk:high) **Add `bank` to `ledger_account_type`** and seed `platform:bank` (§8.4 gap 1) — there is no cash account, so a settlement has nowhere to land and `provider:razorpay:clearing` never clears. Blocks tier-3 reconciliation *and* payouts (`E07-10`). Note `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, so the value lands in `0003` and its first use in `0004`
- [ ] `E06-24` Add `CHECK (destination <> 'source' or payment_id is not null)` to `refund` (§9.9) — nothing today prevents a refund to a source that does not exist. Migration `0003`
- [ ] `E06-25` (risk:high) **Razorpay payload redaction, with a test** (§3.7, §6.5) — no recipient name, class, section, allergen, dish name, card PAN or VPA may appear in an outbound Razorpay request or in `payment.notes` / `payment_webhook_event.payload`. The test seeds a sentinel recipient name and asserts it appears in neither. Non-negotiable #4
- [ ] `E06-26` **Webhook secret rotation runbook** (§2.4) — dual-secret verification via `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`, because the secret belongs to the Razorpay endpoint and cannot be swapped atomically with respect to events in flight. Feeds `E00-17`
- [ ] `E06-27` **Tier-3 settlement reconciliation** (§8.4) — ingest the Razorpay settlement recon report, backfill `provider_fee_paise` / `provider_tax_paise`, post the settlement to `platform:bank`, and assert `balance(provider:razorpay:clearing)` equals what Razorpay says is pending. Depends on `E06-23`
- [ ] `E06-28` (risk:high) **Distinguish a misconfigured webhook secret from an attack** (§5.6) — a wrong secret fails 100% of webhooks, records them all, returns `200` and therefore produces no 5xx and no retries. Alert on ~100% signature failure since a deploy, **and** on zero verified events in a window in which orders were placed. Under `E15-05`
- [ ] `E06-29` (mvp) **Expo config plugin for UPI app visibility** (§3.3) — Android 11+ `<queries>` for the UPI intent app chooser, plus iOS `LSApplicationQueriesSchemes`. Without it the app list is silently empty and checkout degrades to UPI collect/QR, which is the flow `E06-02` exists to replace. **Android half shipped 2026-08-09** — `apps/mobile/plugins/withUpiQueries.js`, permanently enabled, asserted in the built artefact by `E06-32`. **Left open for the iOS half**, which cannot be written or tested until the SDK is added to `apps/mobile` by `E06-02`

Added by Q15 (`docs/overnight-review.md` §2.2, §4.5, §5.3).

- [ ] `E06-30` (risk:high) **`order_group_status = 'payment_failed'` is currently unreachable.** `docs/order-lifecycle.md` §5 rule G3 requires every member cancelled with `cancel_reason_code = 'payment_failed'`, but §10.4 step 3 makes the sweeper write `checkout_expired` for **both** "every attempt terminally failed" and "never started". Every failed checkout therefore falls through to G4 (`cancelled`) and G3 never fires — while §12.1 scenario 5 asserts the group reaches `payment_failed`. Split the reason code on whether any attempt reached `failed`, and fix §10.4 in the same PR
- [x] `E06-31` **Define and assert the ledger sign convention.** `ledger_entry` carries a `ledger_direction` enum, and no document says which direction is positive for which `ledger_account_type`. Two nightly assertions run in opposite directions: the wallet is a liability (posting #1 **debits** it when the customer spends, so its balance is credits − debits, invariant `I8`) and `provider:razorpay:clearing` is an asset (posting #2 **debits** it on capture, so its balance is debits − credits, `docs/payments-design.md` §8.3). A single-signed `balance()` helper is wrong for half the accounts. **Done 2026-08-10, migration `0013`, decision `M9` — and resolved structurally rather than by picking a convention:** a CHECK constraint pins `normal_balance` per `account_type`, `ledger_balance()` is the only reader and consults the account, and `assert_ledger_integrity()` checks structural invariants instead of recomputing a derived balance. `supabase/tests/ledger.test.sql`, 14 assertions
- [x] `E06-32` (risk:high) **Assert the UPI `<queries>` block in the built artefact**, rather than assuming our config plugin is what puts it there. Static analysis during `E19-01` setup found the block is also supplied by `com.razorpay:standard-core`, which `com.razorpay:checkout` pulls in at version `LATEST` — so the thing `E06-29` depends on is partly a floating third-party dependency we do not control. `scripts/verify-apk-upi-queries.mjs` decodes the binary `AndroidManifest.xml` out of an APK and asserts both the `upi` scheme query and the six explicit PSP packages, turning a silent degradation to UPI collect/QR into a failed check. Pairs with `E19-08` (pin the version). **Was filed as a second `E06-30`** — a duplicate id, since `E06-30` was already taken by the `payment_failed` task above. Renumbered to the next free id rather than left colliding; nothing referenced it yet

- [ ] `E06-16` (risk:medium) Replace the invented "5–7 working days" refund timing on Order detail with a figure somebody has confirmed, per instrument. It is a sentence a parent plans around; see `docs/open-questions.md`
