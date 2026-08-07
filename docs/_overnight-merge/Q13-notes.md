# Q13 merge notes — secret rotation policy + testing strategy

Produced by Q13. Files created:
- `docs/secret-rotation-policy.md` (backlog task E00-17)
- `docs/testing-strategy.md`

All cross-cutting output is here rather than in the shared docs, per isolation rules. Nothing in
`planning/`, `docs/open-questions.md`, `docs/decisions.md` or `docs/learnings.md` was touched.

---

## New open questions

Proposed for `docs/open-questions.md` on merge. IDs are provisional.

### [SEC-01] Secret rotation cadences — accept or shorten
- **Options.** (a) As recommended: 180 days for high-value provider secrets (Razorpay key secret,
  webhook secret, service-role, SMS, DB), 90 days for CI tokens, 365 days for the off-Supabase backup
  encryption key, plus immediate rotation on any suspected exposure. (b) Shorter (e.g. 90 days
  everywhere) — tighter leak-lifetime bound, more rotation friction, more chances to botch a dual-secret
  webhook rotation. (c) Compliance-driven — if a school contract or a payments partner imposes a
  specific cadence, that wins.
- **Recommendation.** (a). It bounds a silent leak's lifetime while keeping rotation rare enough that
  people actually do the dual-secret webhook dance correctly.
- **BLOCKS launch?** No. It is policy Andy ratifies; the mechanics work at any cadence.

### [SEC-02] Does the Supabase plan expose zero-downtime JWT key rotation?
- **Context.** Rotating the Supabase Auth JWT signing secret invalidates every JWT signed with the old
  one. With `U3`'s long-lived refresh tokens (90–180 days), a hard rotation logs everyone out (mass
  re-OTP). If Supabase offers asymmetric/JWKS signing with a verify-old-and-new overlap, rotation is
  seamless; if not, it is a maintenance-window + re-login event.
- **Options.** (a) Seamless via JWKS overlap if the plan supports it. (b) Maintenance window + accepted
  re-login on the 180-day clock, coupled to service-role rotation. (c) Only ever rotate the JWT secret
  on suspected compromise (accepting the mass logout as the correct incident response), never on a
  routine clock.
- **Recommendation.** (a) if available, else (b). Do NOT shorten the refresh-token TTL to make rotation
  cheaper — that permanently raises OTP cost against a rare event, the wrong side of `U3`.
- **BLOCKS launch?** No. Rotation is not a launch prerequisite; this just decides the UX of a future
  routine rotation. Needs Andy to check the plan (credentialed).

### [TEST-01] Coverage threshold numbers
- **Options.** (a) Recommended: 80% global line coverage, 90% floor on `packages/shared` (pure money /
  api / validation), with money-math and authorization held to effectively 100% by *suite completeness*
  (property tests + the exact-policy-set assertion) rather than by an lcov number. (b) Higher blanket
  gate (90–95% everywhere) — risks rewarding assertion-free tests on UI/glue. (c) Lower / advisory —
  contradicts `E01-12` and non-negotiable #6.
- **Recommendation.** (a). The real risk (money, authz) is already gated by specific-tests-present, not
  a percentage; a lower global number avoids gaming without lowering protection where it counts.
- **BLOCKS launch?** No, but E01-12 needs a ratified number before CI can enforce a gate. Non-blocking
  for launch, blocking for "CI is green means something".

---

## Learnings

- **A rotation policy without "what breaks during the window" is half a policy.** The dangerous case in
  this stack is the Razorpay **webhook secret**: it is callee-verified and the handler returns 200 to a
  bad signature, so a naive swap silently drops every event signed with the old secret between the two
  changes, with no 5xx and no Razorpay retry. The dual-secret (`_PREVIOUS`) window and `E06-28`'s alert
  are the mitigations; both are load-bearing and are captured in the policy and the testing doc.
- **Two shapes of secret rotation.** Caller-initiated (key secret, SMS key, API tokens) swap between
  requests with zero downtime. Callee-verified (webhook secret, JWT signing secret) cannot swap
  atomically w.r.t. in-flight messages and need an overlap window. Filing every secret into one of these
  two buckets is what makes each rotation procedure obvious.
- **Payment paths ARE testable in CI without live keys, but the fixtures encode assumptions until
  E19-01 returns.** The provider stub is authored from the `docs/payments-design.md` §12 twenty-item
  checklist (header names, signature encoding, event names, event-id header, retry window). It must be
  corrected to reality when the spike lands — treating the current stub as fact reintroduces the exact
  risk §0 of the payments doc warns about. HMAC verification, idempotency (via replaying the whole
  function against real Postgres constraints), and the dual-secret rotation path are all fully offline-
  testable. Native UPI intent is NOT — that stays with `E19-01` on a real device.
- **The authorization pgTAP suite needs the GoTrue auth schema present** (`app_user.id` → `auth.users`,
  `auth.uid()` reads `request.jwt.claims`), so CI must run `supabase start` — it cannot use a bare
  `postgres:16` image. This is a real constraint on `E01-08`'s CI design and is stated in the suite's
  own header.

---

## Decisions

(Proposed for `docs/decisions.md` on merge — not written to that file per isolation rules.)

- **Provider secrets are stored only as Supabase Edge Function env vars / project settings, never in a
  committed `.env`; the service-role key never has a human copy.** Why: it is the one credential that
  bypasses RLS (defeats non-negotiable #2); concentrating it in the Edge Function tier (which the `api/`
  write rule already mandates) means there is exactly one place to rotate and one place to leak from.
- **Coverage is a hard merge gate, but money and authorization correctness are gated by suite
  completeness (property tests + exact-policy-set `set_eq`), not by a coverage percentage.** Why: a
  percentage can be satisfied without asserting the thing that matters; an exact-policy-set assertion
  fails when a policy is *added* (the direction that leaks), which no coverage number would catch.
- **CI proves everything server-side and every signature/idempotency invariant offline; native UPI
  client behaviour is proven once by the E19-01 spike, not by CI.** Why: a CI stub cannot validate a
  native app-switch, and pretending it does hides the `E06-29` `<queries>` failure that only reproduces
  on a real Android 11+ device.

---

## Proposed new backlog tasks

Target epic **E00** (secret rotation is E00-17's home):
- `E00-19` Implement the rotation logbook + a scheduled reminder (calendar or Better Stack heartbeat)
  driving the §1 cadences, so 180/90/365-day rotations are prompted, not remembered. Unowned build work
  — the *reminder mechanism*, not the credentialed rotation itself. (Preparation for the owner:andy
  rotation actions.)

Target epic **E01** (foundations / CI):
- `E01-19` Provider stub server for Razorpay (answers `/v1/orders`, `/v1/payments/:id`,
  `/v1/payments/:id/refund`, `/v1/payments`, `/v1/refunds`, `/v1/settlements/recon/combined`) built from
  the `docs/payments-design.md` §12 checklist, used by the offline CI payment tests in
  `docs/testing-strategy.md` §5. Must be corrected against `E19-01`'s answers when they land.
  (Overlaps `E06-13`; if E06-13 already owns the fixtures, fold this in there instead of duplicating.)

Target epic **E06** (payments):
- Note: `E06-26` (webhook secret rotation runbook) already exists and feeds E00-17; the rotation policy
  §2.2 is written to be consistent with it. No new task needed — flagged so the merge does not create a
  duplicate.

No new `(owner:andy)` tasks proposed beyond the decisions/validations already implied by
`[SEC-01]`/`[SEC-02]`/`[TEST-01]` above (each is a decision or a validation Andy makes, not new build
work to assign).

---

## Human must check

- Ratify the cadence numbers (`[SEC-01]`) and the coverage numbers (`[TEST-01]`).
- Confirm the Razorpay webhook retry window at `E19-01` so the rotation policy §2.2 step 4's "24h" is
  fact.
- Confirm whether the Supabase plan supports zero-downtime JWT rotation (`[SEC-02]`).
- On merge, fold these open questions into `docs/open-questions.md`, the decisions into
  `docs/decisions.md`, and the tasks into the named epics (never renumbering existing tasks).
