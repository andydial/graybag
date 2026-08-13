---
title: Testing strategy
status: draft recommendation — feeds E01-11 and E01-12
produced_by: Q13
sources: CLAUDE.md (Testing, non-negotiables #1/#2/#3/#4/#6), planning/backlog E01 (E01-08…E01-12,
         E01-18), E06 (E06-13, E06-15, E06-25, E06-28), E02 (E02-09/E02-18, Q04),
         docs/payments-design.md §5–§7, docs/authorization-model.md, supabase/tests/authorization.test.sql
---

# Testing strategy

What we test, at which level, what number gates a merge, and — the two things this codebase cannot
get wrong — **how payment paths are tested without live Razorpay keys** (§5) and **how the
default-deny authorization suite gates CI** (§6).

The governing rule is CLAUDE.md: *"A task is not done when the code works — it is done when the tests
prove it works and CI is green."* And non-negotiable #6: **nothing merges without CI green, no
exceptions, including for small changes.** This document defines what "green" means.

The stack fixes the tools (`E01-11`): **Vitest** for unit, **real Postgres + pgTAP** for the database
layer, **Deno's test runner** for Edge Functions, **Maestro or Detox** for mobile E2E,
**Playwright** for web E2E.

---

## 1. The four levels, and where the line is

The line between levels here is drawn by **what is real**, not by folk definitions. It matters
because this system's correctness lives in Postgres (RLS, constraints, triggers) and at the Razorpay
boundary, not in application glue — so the weight of testing sits lower than in a typical app.

| Level | What is real | What is faked | Runs where | Speed |
|---|---|---|---|---|
| **Unit** | One module's pure logic | Everything I/O — DB, network, clock | Vitest (TS), in-proc | ms |
| **Integration** | A **real Postgres** with migrations applied; a real Edge Function against it; Razorpay in **test mode or stubbed** | The mobile/web UI, and the live Razorpay account | CI ephemeral DB (`E01-08`) | seconds |
| **Authorization (pgTAP)** | Real Postgres, real RLS policies, impersonated roles | Nothing — it *is* the database | `supabase test db` | seconds |
| **E2E** | A running app driving a seeded backend end to end | Razorpay (test mode) and the SMS provider are stubbed | Maestro/Detox (mobile), Playwright (web) | minutes |

### 1.1 Unit — the money arithmetic lives here

Non-negotiable #3: **all money is integer paise, never floats.** The functions that compute
totals, the GST per-line split (`G1`), refund apportionment (`docs/payments-design.md` §9.3), and
MDR attribution (§9.6) are pure and are unit-tested exhaustively. Two of these are explicitly
**property tests, not example tests**, because the bug hides in the residual:

- **Refund per-line apportionment** (§9.3 rule 3): for every `(line_total, n)`, the sum over *any*
  partition of *n* units must equal `line_total` exactly — the last unit carries the remainder.
- **GST rounding** (`G1`): per line, per component, half-up; the invoice is the sum of its lines and
  never recomputes tax. Assert `round_off_paise = 0` under tax-exclusive pricing.

Any test that would introduce a float into a money path is itself a bug. There is no `toBeCloseTo`
on a paise value.

### 1.2 Integration — the constraints and the Edge Functions

This is where the bulk of confidence comes from, because idempotency in this system is enforced by
**database constraints, not application logic** (`D16`, `docs/payments-design.md` §7). You cannot
unit-test a unique constraint; you need the real Postgres. Integration tests run migrations into an
ephemeral DB (`E01-08`, `E01-09`), then exercise Edge Functions against it.

### 1.3 E2E — the flows a broken deploy would sever

Kept deliberately few and high-value: OTP login, add a dependent, browse the assigned menu, checkout,
the app-kill-mid-payment recovery (`E06-16`), and a refund. E2E is slow and flaky-prone; it proves the
wiring, not the logic — the logic is proven below it. Mobile E2E requires an **EAS development build,
not Expo Go**, because the Razorpay RN SDK is a native module (`docs/payments-design.md` §3.2,
`[PAY-01]`).

---

## 2. Coverage threshold — recommendation

**Recommend a single global line-coverage gate of 80%, with two carve-outs that are held to 100%
by targeted assertion rather than by the percentage** (`E01-12`).

Why 80% and not higher globally: a blanket 90–95% gate on a codebase with a React Native UI, Expo
config plugins and generated types buys coverage of glue that E2E already exercises, and it does it by
tempting people to write assertion-free tests that touch lines without proving anything. 80% is high
enough that a whole untested module fails the gate, low enough that it does not reward gaming.

The carve-outs, where the real risk is, are gated by *specific tests being present and green*, not by
a coverage number:

1. **Money and authorization are effectively 100%, enforced by suite completeness, not by lcov.**
   The authorization suite asserts an **exact policy set** (§6) — adding or removing a policy fails
   CI regardless of line coverage. The payment idempotency layers (`docs/payments-design.md` §7.1)
   are each covered by a named integration test. These are stronger than a percentage: a percentage
   can be satisfied without asserting the thing that matters.

2. **A per-package floor prevents one well-covered package from masking a bare one.** `packages/shared`
   (the `api/` module, validation, money math) should carry a higher floor — recommend **90%** —
   because it is pure and there is no excuse; `apps/mobile` UI can sit at the 80% global line.

The exact numbers are Andy's to ratify; the reasoning above is the recommendation and the trade-off
is laid out as `[TEST-01]` in the merge notes. What is **not** negotiable is that the number is a
**hard gate**, not a report — `E01-12` says "must be green before any merge", and non-negotiable #6
backs it.

---

## 3. What gates a merge

CI (`E01-08`, GitHub Actions) must be green, which means **all** of these pass on the PR branch:

1. **Typecheck** (TS across all packages).
2. **Lint** — including the two custom lint rules that enforce non-negotiable #1: every backend call
   goes through the `api/` module, and **writes go through Edge Functions**. A write issued directly
   from the client via the Supabase client is a lint failure, not a review comment.
3. **Unit tests** (Vitest) at the coverage threshold (§2).
4. **Integration tests** against a seeded ephemeral Postgres (`E01-08`, `E01-13` fixtures).
5. **The pgTAP authorization suite** (`supabase test db`) — §6. This is the non-negotiable #2 gate.
6. **Edge Function tests** (Deno), including the payment paths of §5.
7. **Security gates** (`E01-08a`): gitleaks secret scan, `npm audit`, Dependabot/Renovate; and
   **`E01-18`** — no `service_role` key or Razorpay secret in the mobile bundle or web client build.
8. **E2E** on the critical flows (§1.3). If E2E is too slow for every PR, it runs on the merge queue /
   pre-merge to `main` — but it must pass before code reaches `main`, never after.

Branch protection (`E01-02`) makes these required checks. There is no override path, including for a
one-line change (non-negotiable #6). A red suite is a blocked merge, full stop.

---

## 4. DPDP constraint on the tests themselves

Non-negotiable #4: children's data is regulated. This binds the test suite, not just production:

- **No test may log a real child's name, class, section or allergy**, and no test fixture may send
  such data to Sentry or analytics. Fixtures use obviously-synthetic names (the pgTAP suite uses
  "Aarav", "Bela", etc.).
- **`E06-25` is a test, and it is in this suite**: seed a recipient with a distinctive **sentinel**
  name and assert the sentinel appears in **no** outbound Razorpay request body and **no** stored
  `payment.notes` / `payment_webhook_event.payload`. This is exactly the rule a well-meaning "add the
  child's name so support can find it" PR breaks in one line, so it must be a test, not a convention.
- The redaction of `payment_webhook_event.payload` (`docs/payments-design.md` §6.5 — strip
  `card.*` beyond last4/network, `vpa`, `email`/`contact`, unknown `notes`, anything matching
  `/token|secret|signature/i`) is asserted against a fixture webhook body carrying all of them.

---

## 5. Testing payments without live Razorpay keys

This is the crux. `E06-13` — "test-mode payment fixtures so E2E tests cover the full payment path in
CI" — must hold **without a live Razorpay account and without a real handset in CI**. Three techniques,
applied at different levels.

> **And not only in CI. 2026-08-13.**
>
> This section was written as though a handset were available outside CI, with a human to hold it.
> **Andy is in Australia and has no working UPI**, permanently — so "a person can just run it by
> hand" is not a fallback that exists for this project.
>
> Every manual payment test therefore uses the same instruments CI does: test VPAs
> `success@razorpay` / `failure@razorpay` entered in checkout's **UPI ID** field, or test card
> `4111 1111 1111 1111`. Open checkout **on a laptop** — a phone with a UPI app installed may go
> straight to the intent chooser and never offer the field.
>
> The one thing no instrument substitutes for is the app-switch itself (`docs/payments-design.md`
> §14.1, scenario 40): the UPI chooser, `LSApplicationQueriesSchemes`, the Android `<queries>`
> block, and the process being killed while another app holds the foreground. That needs a real
> handset in India at release, and it needs an owner who is not Andy.

### 5.1 The provider boundary is a seam we own

Every Razorpay HTTP call is made from an Edge Function through **one provider client module**, the
same discipline as the `api/` rule. In CI that module points at either **Razorpay test mode** (a real
`rzp_test_` account, no real money) or a **local stub** (a fixture server that answers
`POST /v1/orders`, `GET /v1/payments/:id`, `POST /v1/payments/:id/refund`, etc. from canned responses).

- **Test mode** is used where we want to prove we speak the protocol correctly and is the path `E19-01`
  validates for real. It needs a `rzp_test_` key in a CI secret; no live money moves.
- **The stub** is used for the deterministic, offline, always-runnable CI path: no network, no secret,
  reproducible failures. **The stub is authored from the `E19-01` verification checklist**
  (`docs/payments-design.md` §12) — the header names, signature encoding, event names and event-id
  header are exactly the twenty items marked "[verify in E19-01]". Until `E19-01` returns, the stub
  encodes our *assumptions*; when it returns, the stub is corrected to reality and every dependent test
  moves with it. **Do not treat the stub's current shape as fact** — that is precisely the trap
  `docs/payments-design.md` §0 warns about.

Crucially, **the client is never a source of truth about money** (`PY4`, `E06-03`): `/verify` fetches
the payment from Razorpay before settling, and `GET /checkout/:group/status` reconciles against the
provider. So the fixtures that matter are the *provider's* responses and the *webhook* bodies, not the
app's reported outcome. This is what makes the whole path testable server-side, with the app stubbed.

### 5.2 Webhook signature verification — tested against real HMAC, both directions

The two signatures use two keys and two messages (`docs/payments-design.md` §5.1) and are the highest
single risk (`E06-03`, critical). Tests, all offline:

- **Webhook HMAC over the raw body.** Compute `HMAC-SHA256(webhook_test_secret, raw_bytes)` in the
  test, set it as the `X-Razorpay-Signature` header, POST the **exact bytes** to the handler. Assert
  it verifies. This proves the §5.2 raw-body rule: the handler must `req.text()` **first** and
  `JSON.parse` only after verifying — a test that builds the body, re-serialises it, and signs the
  re-serialised form will *fail to verify*, which is itself the proof that re-serialisation changes the
  bytes.
- **Callback signature.** Compute `HMAC-SHA256(key_test_secret, order_id + "|" + payment_id)` and post
  it to `/verify`; assert it verifies, and assert a **wrong** signature yields `400` + an alert hook
  (§4.2 — a client sending a bad signature is a bug or an attempt).
- **Negative and constant-time.** A tampered body, a wrong secret, an empty signature — each must fail.
  The comparison is constant-time (§5.4); the test asserts the *outcome*, and a lint/review check
  asserts the *implementation* uses `timingSafeEqual`, since timing itself is not unit-testable.
- **The dual-secret rotation path (§2.2 of the rotation policy, `E06-26`).** Sign a webhook with the
  *previous* secret while `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is set; assert it still verifies and
  records which secret matched. This is the test that proves a rotation will not silently drop events.
- **The misconfig alert (`E06-28`, `PY3`).** Feed a run of webhooks all failing verification; assert
  the ≈100%-since-deploy alert fires, **and** assert the "zero verified events while orders exist"
  alert fires (it catches a webhook that was never registered, which produces no rows to compute a
  rate from). Both halves are asserted because both are silent in production.

### 5.3 Idempotency — replay the whole function, don't check a flag

Idempotency is a property of the **set** of nine database constraints (`docs/payments-design.md`
§7.1), so it is tested at the integration level against real Postgres, and it is tested by **replaying
the entire settlement, not by asserting a boolean** (`D16`):

- **Webhook replay** (`E06-04`, the load-bearing one): deliver the same `payment.captured` event
  twice — Razorpay retries — and assert exactly **one** settlement: one sale posting, one invoice
  number consumed, one pickup code, one ledger transaction. The second delivery must be refused by the
  `payment_webhook_event_unique (provider, provider_event_id)` constraint and the `ON CONFLICT DO
  NOTHING` return-200 path, not by application logic. This is `E06-13` scenario 7, and the spec says
  assert it by **replaying the whole function**.
- **Callback + webhook race**: the same capture arriving via both `/verify` and the webhook must settle
  once — the `uq_payment_one_capture_per_group` and per-payment constraints do the work; the group
  advisory lock (§7.3) makes the loser see committed state and return cleanly.
- **Client checkout idempotency** (§7.2): same `Idempotency-Key` + same body → replay the stored
  response; same key + **different** body → `409 idempotency_key_reused`. Both asserted.
- **Monotonicity** (`E06-15`, `L3`): deliver `authorized` **after** `captured` and assert the payment
  is **not** downgraded. Out-of-order delivery is part of the test by construction, not an afterthought
  — an integration test that only ever delivers events in order proves nothing about the real webhook
  stream.

### 5.4 The refund and reconciliation paths

- **Refund idempotency** (§7.4): the adopt-or-create sequence — our `refund.id` is generated *before*
  the provider call and sent in `notes.graybag_refund_id`, so a timed-out refund that actually
  succeeded is *adopted* on retry, not re-issued. The stub simulates "the POST timed out but the refund
  exists"; the test asserts no double refund. This is real money out if wrong, so it is a required
  case.
- **Reconciliation break classes** (`E06-11`, `docs/payments-design.md` §8.2): feed the daily job a
  stubbed Razorpay payments/refunds list that manufactures each break class (B1–B8) and assert the
  correct response — **only B3 self-heals**; everything else alerts and waits. The ledger zero-sum and
  wallet-balance assertions (§8.3) run against real fixture ledger data.

### 5.5 What still needs `E19-01` and a real device

Some things genuinely cannot be proven in CI and are honestly out of scope for the automated suite:
native UPI intent app-switch and return, the Android 11+ `<queries>` package-visibility failure
(`E06-29`), and auto-capture behaviour under UPI intent. These are the `E19-01` spike's job on a real
mid-range Android (`E19-07`), not CI's. The strategy is: **CI proves everything server-side and every
signature/idempotency invariant offline; the spike proves the native client behaviours once.** Do not
pretend a CI stub validates native UPI — it validates our handling of the provider responses UPI
produces.

---

## 6. The default-deny authorization suite in CI

`supabase/tests/authorization.test.sql` (Q04, `E02-09`) is the direct control for non-negotiable #2.
The legacy Bubble app exposed every order and every child record publicly; this suite is *the thing
that makes that impossible to regress*. It is a required CI check (§3 item 5) and blocks merge like any
other.

**What makes it more than a normal test suite:**

- **It asserts an exact policy set** (`set_eq`, Part 2), so it fails when a policy is **removed** and —
  the direction that actually leaks — when one is **added**. Adding a permissive policy can only widen
  access; a `set_eq` over the 179 policies catches the widening. Changing the policy set therefore
  *requires* updating §8 of `docs/authorization-model.md` in the same PR. That coupling is the whole
  mechanism.
- **It asserts the harness before trusting a single deny** (Part 0b). A broken impersonation setup
  makes every deny pass for the wrong reason — "sees zero rows" is true if the query silently ran as
  `postgres` with RLS bypassed. Four assertions confirm the role actually switched and `auth.uid()`
  reads the impersonated subject before any deny is believed. Any CI run where Part 0b fails must be
  treated as the suite lying, not as a pass.
- **It asserts structural invariants** (Part 1): RLS on every table in `public` and `migration`; no
  policy grants `anon`/`PUBLIC`; every `SECURITY DEFINER` function pins `search_path`; every view is
  `security_invoker`; `created_by_user_id` never appears in a policy (`D10`); no class-3 table has an
  `authenticated` write policy; `auth.uid()` is always wrapped in a scalar subquery.

**The CI constraint this imposes (`E01`'s design):** the suite **cannot run against a bare
`postgres:16` container**. `app_user.id` is a foreign key to `auth.users(id)`, and impersonation reads
`auth.uid()` from `request.jwt.claims` — so the **auth schema (GoTrue) must exist**. CI runs it via
`supabase start && supabase test db`, i.e. a real Supabase local stack, not a plain Postgres image.
This is called out in the suite's header and is a hard requirement on the CI job, not a nicety.

**Status gate:** the suite has been *written* but, per its own header and `docs/authorization-model.md`,
**never run** — that is `E02-18`, and until it is green `E02-08`/`E02-09` are not done. So the *first*
job CI's authorization stage must accomplish is to make this suite green against `0001` + `0002`; every
run after that is regression protection. This is the single highest-value test in the repo.

---

## 7. Summary — the shape of "green"

A PR is mergeable when, and only when: typecheck + lint (incl. the `api/`-module and Edge-Function-write
rules) + unit (≥80% global, ≥90% shared) + integration + the pgTAP authorization suite + Edge Function
tests (incl. the §5 payment paths) + security gates (gitleaks, `npm audit`, no-secret-in-bundle) + the
critical E2E flows are all green. No override. That set is what non-negotiable #6 means in practice, and
this document is what `E01-11` and `E01-12` build.
