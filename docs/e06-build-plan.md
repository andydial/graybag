---
title: E06 — payments build plan
status: PLAN. No code that MOVES MONEY has been written. Order creation has — see below.
---

# E06 build plan

Written 2026-08-09, after `E19-01` returned. Revised 2026-08-11 — see §0, which is the part to
read if you last read this plan when it was written.

**Nothing that moves money has been built.** No Razorpay call, no webhook endpoint, no ledger
posting, no refund. What HAS been built, and what the original front matter's "no payment code
has been written" was read as denying:

- **`create_checkout` (`0014`, `0019`)** — order creation, the `order_group`, cutoff
  snapshotting, price re-checks, and `break_time_id` per line. Tested (`checkout.test.sql`, 27
  assertions). This is step 6's server half and it exists.
- **The ledger's structure (`0013`)** — `normal_balance` pinned per account type,
  `ledger_balance()`, `assert_ledger_integrity()`, and the eleven `ledger` reason codes.
- **`OrderPlacedScreen` and `PaymentWaitingScreen`** — built, tested, unrouted. `placedOrder()`
  refuses anything that is not `paid` with a four-digit pickup code, so step 7's return path
  has a typed landing zone waiting for it.

Rebuilding any of that is the failure this paragraph exists to prevent.

This is the order to build the rest in, where the risk actually sits, and what should be decided
before code rather than during it.

The design is `docs/payments-design.md` (Q07) and `docs/order-lifecycle.md` §8–§11 (Q06). This
document does not restate them. It says what to do first and what will hurt.

---

## 0. What has changed since this plan was written

Added 2026-08-11. The plan below is unchanged except where a row here says otherwise; read this
first if you last read it on 2026-08-09.

**Three of §5's five "decide before code" questions are answered, and they were the expensive
ones.**

| | Then | Now |
|---|---|---|
| `E06-31` sign convention | §5 row 2, and §4.2 — *"the failure mode I would bet on actually happening"* | **Settled structurally, `0013` / `M9`**, and better than this plan proposed. A CHECK pins `normal_balance` per account type; `ledger_balance()` is the only reader and consults the account; the nightly check compares `wallet_balance` against the ledger rather than recomputing a derived balance, because two derivations sharing one sign error agree with each other. §4.2 is designed out, not mitigated |
| `E06-22` ledger reason codes | §4.1, *"the ledger cannot record anything today"* | **Seeded by `0013`** — eleven `category = 'ledger'` codes. The first `insert into ledger_transaction` no longer fails |
| `[OL-02]` grace window | §5 row 3, value undecided | **`L9`.** Settlement inside `cutoff_at + grace` is honoured, after it refused and auto-refunded. Per-kitchen config, **default 15 minutes**, never shown to a parent and never counted down at them |
| `[PAY-02]` refund split | §5 row 5, *"needs Andy"* | **`PY5`.** Wallet-funded portion to the wallet, remainder to the requested destination, capped at what source actually captured — two rows sharing a `correlation_id`. The over-refund guard enforces the cap independently |
| MDR posting missing from the docs | §3 step 1, *"do the documentation corrections in the same PR"* | **Done.** `order-lifecycle.md` §8.4 step 6 now posts the MDR separately and says what happens if it does not |

**What is left of step 1**, therefore, is two things rather than five: `E06-23` (`bank` on
`ledger_account_type` plus the seeded `platform:bank` — `M9` deferred it deliberately, because
`ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it) and `[OL-05]`'s
`duplicate_of_payment_id` column, which still does not exist and still blocks `E06-18`.

**Step 5 is unchanged and is now the largest single unknown by a distance.** All seven
`E19-07` rows are open. The advice to hold it before the client work matters *more* now, not
less: the risks that used to compete with it for attention have been resolved, and
`fee`/`tax`-at-capture still decides whether `E07-11` can compute MDR at refund time at all.

**Constraints this plan predates and does not mention:**

- **`E07-20`** (risk:critical, **in the MVP list**) — checkout must refuse in production while
  `seller_gstin` or `sac_code` is a placeholder, with a boot assertion in the shape of
  `E06-14`'s key-prefix check. That lands in step 6, and it is a launch blocker.
- **`E07-22`** — `invoice.buyer_name_snapshot` is `not null` and every account in the system
  has a null name. Under **CGST Rule 46(f)** a buyer name is not required at all on a B2C supply
  below ₹50,000, so the `not null` is stricter than the law and would refuse an invoice the law
  permits — the constraint, not GST, would be the thing that stops an order. Awaiting Andy's
  ruling on `E07-22`; settle it **as invoicing is built**, not after.
- **`S21`** — Place Order and Pay take motion Ending B: no timeout, and the app polls
  `GET /checkout/:group/status`. That makes `E06-16` a dependency of the *interface*, not only
  of the recovery paths in step 7.
- **`P19`** — `create_checkout` takes a required `break_time_id` per line, the picker is live,
  and all three schools have windows since `0029`.
- **`E07-21` is struck** (2026-08-11). It required deriving the CGST/SGST-vs-IGST split in the
  cart and checkout pricing path on the basis of "three launch cities span three state codes".
  `SC1` is Mohali only and non-negotiable #7 forbids the IGST path outright. What survives of
  its concern is a **one-time check**, not a pricing path — see `docs/gst-invoicing.md` §3.2.

---

## 1. What the spike settled, and what it did not

**Settled, and it removes work:**

| | |
|---|---|
| `[PAY-01]` | The official RN SDK. Demonstrated on a handset, not recommended on paper |
| Auto-capture | A real UPI intent payment shows **`captured`**, not `authorized` (`[OL-01]`) |
| Callback signature | `HMAC-SHA256(key_secret, "order_id\|payment_id")` hex — verified against a real payment |
| UPI package visibility | Declared by us permanently (`E06-29`), asserted in the built APK (`E06-32`), upstream pinned (`E19-08`) |

**Not settled, and every one of these is a `E19-07` row that still needs a webhook endpoint:**

- the exact webhook event set and whether `X-Razorpay-Event-Id` is present;
- the retry policy, the retry window, and the response timeout;
- how long a **UPI collect** can stay pending before Razorpay expires it;
- whether refunds accept an idempotency key header;
- whether `fee` and `tax` arrive on `payment.captured` or only at settlement;
- the settlement recon report's shape and retention;
- the payments-list `from`/`to` semantics and page-size cap.

**This is the single most important thing on this page:** four of those seven are load-bearing
for tier-2 and tier-3 reconciliation, and one of them (`fee`/`tax` at capture) decides whether
`E07-11` can compute MDR at refund time at all. **They need one sitting with a public webhook
endpoint and a Razorpay dashboard subscription, and that sitting should happen before step 5
below, not after it.**

---

## 2. What captured-not-authorized actually changes

It removes a branch from the state machine rather than confirming one.

- `payment.status = 'authorized'` becomes a **transient** state, seen only in out-of-order
  webhook delivery. It is not a state an order sits in while somebody decides whether to cook.
- `L5` — never cook against an authorization — **stays in the design as a guard.** It now
  guards a case that should not arise in normal operation rather than a routine one. Guards
  against things that "cannot happen" are precisely the ones worth keeping: the cost is one
  condition, and the failure it prevents is a kitchen cooking food nobody has paid for.
- `[OL-02]` (the cutoff passing while a payment is in flight) is **not** made easier. The money
  is taken at capture, so "just don't capture" was never available and still is not.

**The temptation this creates, named so it can be refused:** because capture is now known to be
immediate, it becomes tempting to treat a successful Razorpay callback as sufficient to release
an order to the kitchen. It is not. §3.6 is unchanged — a verified signature proves the callback
body was not tampered with, not that money moved. The server still fetches the payment from
Razorpay before settling, and the webhook remains an independent second path precisely so the
app's cooperation is optional. What `B6` buys is that the *server-confirmed* capture arrives
promptly, so the waiting state is short — not that it can be skipped.

---

## 3. Build order

Nine steps. Each is green before the next starts. Steps 1–4 need no Razorpay account at all.

### Step 1 — Migration `0003`-equivalent: the schema E06 cannot be written without

`E06-20`, `E06-22`, `E06-23`, `E06-24`, `E06-31`.

Everything else waits on this, and three of them are hard blockers rather than conveniences:

- **`E06-22` — ledger reason codes.** `ledger_transaction.reason_code` is
  `not null references reason_code(code)` and **none of the eight seeded codes names a money
  movement**. Not "the vocabulary is thin" — *no ledger posting can be written at all* today.
  This blocks `E06-07` outright.
- **`E06-23` — `bank` on `ledger_account_type`,** and the seeded `platform:bank`. There is no
  cash account, so a settlement has nowhere to land and `provider:razorpay:clearing` never
  clears. Note `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, so
  the value lands in one migration and its first use in the next.
- **`E06-31` — the ledger sign convention.** `ledger_entry` carries a direction enum and no
  document says which direction is positive for which account type. The wallet is a liability
  and the clearing account is an asset; a single-signed `balance()` helper is wrong for half
  the accounts, and the nightly assertions run in opposite directions. Write the per-account-
  type normal-balance table into `docs/data-model.md` §8.4 and unit-test both directions
  **before** anything posts.

Do the documentation corrections in the same PR — `docs/data-model.md` §8.4's worked example
and `docs/order-lifecycle.md` §8.4 step 6 both omit the MDR posting, which leaves the clearing
account permanently overstated by the fee and makes tier-3 reconciliation impossible to
balance.

### Step 2 — The ledger (`E06-07`), and nothing else

Append-only, double-entry, balanced at commit (`I10`). No Razorpay anywhere near it. This is
pure SQL and pure domain code and it is entirely testable without a provider.

Build it before anything that posts to it. A ledger retrofitted under a working payment flow
is a ledger whose invariants were negotiated against code that already existed.

### Step 3 — The state machine (`E06-05`, `E06-15`)

Order states with legal transitions enforced, and `L3`'s capture-rank monotonicity: a webhook
moves `payment.status` up a rank and never down. **Out-of-order delivery fixtures are part of
the test, not an afterthought** — `authorized` arriving after `captured` is normal, not exotic.

### Step 4 — Signature verification (`E06-03`) and the webhook endpoint (`E06-04`)

Both signatures, the raw-body rule (§5.2), fixed-length comparison, and idempotency at all four
layers of §7.1. Always `200` (§6.3).

`E06-28` belongs here rather than later: a wrong webhook secret fails 100% of webhooks, records
them all, returns `200`, and therefore produces no 5xx and no retries — it is indistinguishable
from an attack and from silence. Alert on ~100% signature failure since a deploy **and** on
zero verified events in a window in which orders were placed.

### Step 5 — The `E19-07` sitting

Stop. Stand up a public webhook endpoint, subscribe it in the dashboard, and answer the seven
open rows in §1. Everything after this point is designed against assumptions that these
answers either confirm or invalidate, and finding out at step 8 costs a rewrite of step 6.

### Step 6 — Checkout (`E06-02`), the client half

Add `react-native-razorpay` to `apps/mobile`, the iOS half of `E06-29`
(`LSApplicationQueriesSchemes`), the order-creation call, and the return path. `E06-32` already
asserts the Android manifest; extend it to the iOS plist in the same PR.

`E06-25` — payload redaction with its sentinel test — ships **with** the first outbound call,
not after it. Non-negotiable #4: no recipient name, class, section, allergen, dish name, PAN or
VPA in an outbound Razorpay request or in `payment.notes`.

### Step 7 — The recovery paths (`E06-16`, `E06-06`, `E06-17`)

`GET /checkout/:group/status` is a **launch blocker, not a nicety.** A UPI intent payment
app-switches away from our process by construction, and on a mid-range Android under memory
pressure the OS may not bring it back. On this product "app killed mid-payment" is the normal
path with bad luck attached.

`E06-18` (duplicate capture) is blocked on `[OL-05]` until step 1 lands its column.

### Step 8 — Refunds (`E06-08`, `E06-21`, `E06-09`)

Per-line as well as whole-order. `E06-21` first: the over-refund guard must sum refunds at
`pending`, `processing` **and** `completed`, and take the `order_group` row lock, or two admins
refunding the same order concurrently both pass. `docs/data-model.md` §8.3 currently states it
wrongly in both directions.

### Step 9 — Reconciliation (`E06-11`, `E06-27`)

Tier 2 daily, tier 3 settlement. Depends on `E06-23` from step 1 and on the recon-report
answers from step 5.

---

## 4. Where I expect the risk

Ordered by expected cost, not by likelihood.

### 4.1 The ledger cannot record anything today — and it is invisible

`E06-22`. Every seeded `reason_code` is a cancellation or refund reason; none names a money
movement. The first `insert into ledger_transaction` fails on a foreign key. This is cheap to
fix and expensive to discover late, because it will be discovered by whoever is building
step 6 under time pressure, not by whoever is building step 2.

**Mitigation: it is step 1.**

### 4.2 The sign convention is undefined, and both nightly assertions will look right

`E06-31`. The wallet is a liability; `provider:razorpay:clearing` is an asset. Their balances
run in opposite directions. A `balance()` helper with one sign will produce plausible numbers
for both and be wrong for one — and the nightly assertion that is supposed to catch a drift
will be the thing computing it wrongly. **This is the failure mode I would bet on actually
happening**, because nothing about it looks like a bug: the numbers are numbers.

**Mitigation:** the normal-balance table and both-direction unit tests, in step 1, before any
posting exists to be consistent with.

### 4.3 The seven unanswered `E19-07` rows

Specifically: if `fee` and `tax` are **not** on `payment.captured`, then `E07-11` cannot compute
MDR at refund time and `M5`'s "refund MDR comes out of the school's share" has nothing to
compute against until settlement lands, days later. That is not a code change; it is a change to
when a school's payout can be calculated, and it reaches `E07-10` and `E11-01`.

**Mitigation:** step 5, before the client work.

### 4.4 Idempotency is a database constraint, and one layer of it is not yet real

`D16`'s `unique (order_group_id) where status = 'captured'` is the guarantee that two payments
never settle one checkout — and `[OL-05]` is its unwritten consequence: when a customer really
is charged twice, the second capture **cannot be written at all**, so the one correct response
(record it, then refund it) is the one thing the schema forbids. `E06-18` is blocked until the
`duplicate_of_payment_id` column exists.

**Mitigation:** step 1 again. The general rule worth keeping: *a uniqueness constraint that
protects an internal invariant must not also prevent recording something the outside world has
already done.*

### 4.5 The app-kill path is the normal path

Not a risk to the code so much as to the estimate. `E06-16` plus `E06-06` plus `E06-17` is
roughly as much work as the happy path, and it is easy to plan as though it were an edge case.
It is not an edge case on a UPI product.

### 4.6 Test-mode fixtures (`E06-13`)

Every scenario in `docs/payments-design.md` §14 except #40 is testable without a live account.
#40 — UPI intent happy path on a real handset — is not, and must never be mocked around. If it
cannot be run, say so; do not simulate it and call it covered.

---

## 5. What I would want decided before writing code

Five, in the order they bite. Four are already recorded as open questions; the fifth is new.

| | Question | Why it must be answered first | Recommendation |
|---|---|---|---|
| 1 | **`[PAY-05]` / `E06-22`** — the ledger reason-code vocabulary | Blocks `E06-07` outright; nothing can post | Seed the ten names in `docs/payments-design.md` §10, plus `provider_initiated`. This is a naming decision, not a design one — it needs a yes, not a discussion |
| 2 | **`E06-31`** — which direction is positive, per account type | Both nightly assertions are wrong in a way that looks right | Per-account-type normal balance, written into `docs/data-model.md` §8.4, unit-tested both ways |
| 3 | **`[OL-02]`** — the cutoff passes while payment is in flight | Decides whether a late capture is honoured, refunded, or held. It is a **kitchen-operations** question: how long can the kitchen still add a sandwich to the run? | Grace window as config (`payment_in_flight_grace_minutes`), defaulting to something the kitchen confirms. A kitchen that cannot absorb late orders sets it to 0 and gets a hard cutoff |
| 4 | **`[OL-03]`** — how long a `pending_payment` checkout is held | Too short manufactures the late-capture path; too long fills the order list with zombies. Its floor is a Razorpay fact we do not have yet (step 5) | 30 minutes as config, **and** the sweeper reconciles against Razorpay before cancelling rather than trusting the clock |
| 5 | **`[PAY-02]`** — how a refund splits across wallet-funded and source-funded portions | `E06-08` cannot be written without it, and getting it wrong refunds real money to the wrong place | Recorded in `docs/open-questions.md`; needs Andy |

**`[OL-06]`** (the price changed between building the cart and paying) is already recommended as
abort-with-`price_changed` and is `L7`. It does not block the start of `E06`, but it is a UX
cost on a real path — a kitchen editing prices at 8pm — and Andy may prefer to forbid same-day
price edits instead. Worth confirming during step 6 rather than before step 1.

---

## 6. What must not be built

- **No payment code before step 1's migration.** Anything that posts to a ledger that cannot
  accept postings is code written against a fiction.
- **No mocking around the handset test.** Scenario #40 is live-only.
- **No release of an order to a kitchen on a client-reported success.** The guard stands
  whatever the spike returned.
- **No wallet top-up.** `E06-10` is blocked on confirming RBI Prepaid Payment Instrument rules
  do not apply to refund-only credit. Refund credit is usually fine; **cash top-up of stored
  value is regulated.** Ask before building it.
