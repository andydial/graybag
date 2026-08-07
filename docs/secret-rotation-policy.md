---
title: Secret rotation policy
status: draft for Andy's approval — this is backlog task E00-17
produced_by: Q13
sources: docs/payments-design.md §2, docs/decisions.md (A7, A8, PY-series), CLAUDE.md non-negotiables,
         planning/backlog E00, E01 (E01-07, E01-08a, E01-18), E06 (E06-14, E06-26, E06-28), E15
owner_actions: every rotation below that touches a provider dashboard, a registrar or a telco is
               (owner:andy) — the credentialed-action kind. This document PREPARES those; it does
               not perform them.
---

# Secret rotation policy

Every secret the system holds, where it lives, who can see it, how often it is rotated, the exact
procedure, and — the part that is usually missing and that caused the legacy incident — **what
breaks during the rotation window and how we keep it from breaking silently.**

This exists because `E00-01`/`E00-02` had to rotate a **live** Razorpay key, a Stripe test key and
two Bubble plugin secrets that were sitting in cleartext in the `.bubble` export
(`docs/learnings.md`, 2026-08-06). A rotation policy that is written down and rehearsed is the
difference between "we rotate on a schedule" and "we rotate in a panic, having discovered the leak
from a stranger".

The non-negotiables this serves: **#5** (never commit the `.bubble` export — it contains live
secrets), **#4** (children's data is regulated — a leaked service-role key is a DPDP breach, not
just an availability problem), and **#2** (default-deny authorization — the service-role key is the
one credential that bypasses RLS entirely, so it is the crown jewel).

---

## 0. Principles

1. **Two shapes of rotation, and they fail differently.**
   - *Caller-initiated* secrets (we present them when we call out) can be swapped **between
     requests** with zero downtime — change the value, redeploy, done. The Razorpay **key secret**,
     the SMS provider key and the JWT signing key (for *new* tokens) are like this.
   - *Callee-verified* secrets (someone presents them to us and we verify) **cannot** be swapped
     atomically with respect to messages already in flight. The Razorpay **webhook secret** is the
     worst case and gets its own dual-secret procedure (§2). Verifying old JWTs after a signing-key
     rotation is the same problem in a second place (§6).

2. **A secret lives in exactly one authoritative store per environment, and never in git.**
   Supabase Edge Function secrets (set via the CLI, `E01-07`), Supabase project settings, or the
   store consoles. Nothing payments- or auth-related reads from a committed `.env`
   (`docs/payments-design.md` §2.3). `E01-08a` runs **gitleaks** in pre-commit and CI; `E01-18`
   asserts no service-role key or Razorpay secret reaches a client bundle. Those two checks are what
   make "never in git" a control rather than a hope.

3. **Rotation on a schedule, and rotation on suspicion, are different triggers with the same
   procedure.** The cadences below are the routine clock. **Any** suspected exposure (a secret in a
   log, a laptop lost, a contractor offboarded, a screenshot in a support ticket) triggers an
   immediate out-of-band rotation of the affected secret *and* every secret that shared the exposure
   surface.

4. **Test/live isolation is a rotation concern, not just a deploy concern.** `E06-14`'s startup
   assertion — a payments Edge Function refuses to boot if `RAZORPAY_KEY_ID`'s prefix does not match
   `APP_ENV` (`rzp_test_` outside prod, `rzp_live_` in prod) — is what stops a rotation from
   accidentally pasting a live secret into staging. It runs on every rotation because every rotation
   redeploys.

5. **Every rotation is logged where a non-developer can read it.** A one-line entry: what, when, who,
   why (scheduled / suspected exposure), and confirmation the old value was revoked. Andy holds the
   provider dashboards; he needs the record even when the build side drove the mechanics.

---

## 1. The inventory

Grouped by store. "Who can see it" is the honest current answer, not the aspiration.

| Secret | Where it lives | Environments | Who can see it | Cadence | Rotation §|
|---|---|---|---|---|---|
| **Supabase `service_role` key** | Supabase project settings (issued by Supabase) | staging, prod (distinct) | Supabase project owners (Andy); injected as an Edge Function env var — no human copy | 180 days, + on any exposure | §3 |
| **Supabase `anon` / publishable key** | Supabase project settings; **ships in the mobile bundle by design** | staging, prod | Public. It is not a secret; RLS is the control | Only on project-key rotation; treat as a redeploy, not a leak | §3.3 |
| **Postgres DB password / pooler creds** | Supabase-managed | staging, prod | Supabase owner | 180 days; managed via Supabase | §3.4 |
| **Razorpay key id** (`rzp_test_…` / `rzp_live_…`) | Edge Function secret; **key id also ships in the app** | test (staging/local), live (prod) | Server + client. Public by design | Rotates only with the key secret (they are a pair) | §2.1 |
| **Razorpay key secret** | Edge Function secret, **server only** | test, live | Edge Functions only; Andy via dashboard | 180 days, + on exposure | §2.1 |
| **Razorpay webhook secret** | Edge Function secret, **server only**; chosen by us per endpoint | test (staging), live (prod) | Edge Functions only; Andy via dashboard | 180 days, + on exposure. **Dual-secret** | §2.2 |
| **SMS provider key** (MSG91 / Gupshup, `E00-09`) | Edge Function secret, server only | one account; env-scoped sender behaviour | Edge Functions only; Andy via provider portal | 180 days, + on exposure + on staff offboarding | §4 |
| **Sentry DSN** (`E15-01`) | Edge Function env + app/web build config | per project (mobile/web/functions) | **Semi-public** — a DSN can only *submit* events, not read them | On project rotation only; not a high-value secret | §5 |
| **Sentry auth token** (source-map upload, `E15-01`) | CI secret only (GitHub Actions) | CI | GitHub Actions; repo admins | 90 days, + on contributor offboarding | §5 |
| **JWT signing secret** (Supabase Auth JWT, `U3`) | Supabase-managed (GoTrue) | staging, prod | Supabase owner; never leaves Supabase | See §6 — Supabase-managed, coordinate with refresh-token TTL | §6 |
| **Better Stack / uptime + SMS-alert token** (`E15-03`) | Better Stack config; alert target is Andy's phone | one account | Andy | 180 days | §7 |
| **EAS / Expo build token, store API keys** (`E01`, `R2`) | EAS + store consoles; CI secrets for CD | CI, consoles | Andy (consoles); GitHub Actions (CI) | 180 days, + on offboarding | §7 |
| **GitHub Actions secrets** (deploy keys, Supabase CLI token, provider CI creds) | GitHub Actions encrypted secrets | CI | Repo admins; GitHub Actions | 90 days, + on offboarding | §7 |
| **Off-Supabase backup encryption key** (`E01-16`) | A separate secret manager, **never** in Supabase | one | Andy + whoever restores | 365 days; test the restore each rotation (`E01-17`) | §7 |
| **Legacy: live Razorpay pair, Stripe test key, 2 Bubble plugin secrets** | Were in the `.bubble` export | legacy | Anyone with the export file | **Already rotated** (`E00-01`/`E00-02`). Listed so they are not forgotten | §8 |

Cadence rationale: **180 days** for high-value provider secrets is the balance between "short enough
that a silent leak has a bounded lifetime" and "long enough that rotation friction does not tempt
someone to skip it or hard-code a value to avoid the dance". **90 days** for CI tokens because a CI
secret's blast radius is the whole pipeline and CI has more moving human hands. These are
recommendations for Andy to accept or shorten; see `[SEC-01]` in the merge notes.

---

## 2. Razorpay secrets

There are three, they verify three different directions, and conflating them is the classic way to
break a Razorpay integration (`docs/payments-design.md` §2.1). Rotation treats them separately.

### 2.1 Key id + key secret (the pair)

**What they are.** The key id identifies the account and is handed to the checkout SDK (public by
design). The key secret is HTTP Basic auth to `api.razorpay.com` **and** the HMAC key for the
**checkout callback** signature (`docs/payments-design.md` §5.3).

**Who breaks if leaked.** A leaked key secret lets an attacker impersonate us to Razorpay — create
orders, issue refunds, read payments. This is real-money and real-PII exposure. Rotate on the 180-day
clock and immediately on any suspicion.

**Procedure (owner:andy for the dashboard step).**
1. In the Razorpay dashboard, generate a new key id/secret pair for the relevant mode (test or live).
   Razorpay lets both the old and new key work briefly — confirm the overlap window at `E19-01`
   time; the design does not depend on a long one because this is a caller-initiated secret.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as Edge Function secrets for that project via the
   Supabase CLI. **Do not hand-edit** (`E01-07`).
3. Redeploy the payments Edge Functions. `E06-14`'s startup assertion verifies the key-id prefix
   matches `APP_ENV`; a wrong-mode paste is a hard boot failure, not a silent live-money incident.
4. Update the mobile app's shipped key id at the next build. **The key id in the old app keeps
   working** until you disable the old pair — so ship the new id first, then disable the old pair
   only after the old app version's traffic has drained (or immediately if this is a suspected leak
   and you accept that un-updated clients fail checkout until they update).
5. Revoke the old pair in the dashboard. Log the rotation.

**What breaks during rotation.**
- **Callback verification is keyed on the key secret.** A callback signed by a checkout SDK still
  holding the *old* key id will verify against the *old* key secret. If you revoke the old secret
  before old-app traffic drains, those callbacks fail `/verify` with a `400`
  (`docs/payments-design.md` §4.2). This is not silent — it alerts (`E15-05`) — but it is avoidable
  by draining first. The **webhook** is the independent second settlement path
  (`docs/payments-design.md` §3.6, `PY4`), so a customer whose callback fails still settles via the
  webhook. That redundancy is what makes key-secret rotation low-risk.
- In-flight API calls we initiate simply use whichever secret is deployed; no message is stranded.

### 2.2 Webhook secret — the dual-secret rotation

**What it is.** The HMAC key over the **raw webhook body** (`docs/payments-design.md` §5.1–5.2). It
belongs to the **Razorpay endpoint**, per environment, chosen by us when the endpoint is registered.
It is a **callee-verified** secret, so it cannot be swapped atomically with respect to events already
signed and in flight.

**Why a naive rotation is a silent settlement hole (`PY3`, `E06-28`).** Because the webhook handler
returns `200` to a bad signature (a `4xx` would make Razorpay retry a request we will never accept —
`docs/payments-design.md` §6.3), every event signed with the *old* secret between "we changed it in
Razorpay" and "we changed it in Supabase" fails verification, is recorded with
`signature_verified = false`, is acted on by nothing, and is **never retried by Razorpay**. No 5xx.
Sentry stays quiet. The symptom is "*some* payments are late", worsening as UPI intent app-switches
take their share of the traffic that would otherwise have settled via the callback path.

**Procedure — dual-secret (`E06-26`, `docs/payments-design.md` §2.4). owner:andy for the dashboard
step.** The verifier tries `RAZORPAY_WEBHOOK_SECRET`, and if that fails and
`RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is set, tries that too, recording which matched.

1. Set `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` to the **current** value. Redeploy. Now both old and new
   (once set) will verify.
2. Change the secret in the Razorpay dashboard for that endpoint.
3. Set `RAZORPAY_WEBHOOK_SECRET` to the **new** value. Redeploy.
4. **Wait one retry window** — 24h is the working assumption, **to be confirmed at `E19-01`**
   (`docs/payments-design.md` §2.4, item in §12 checklist). During this window events signed with
   either secret verify.
5. Unset `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`. Redeploy. Log the rotation.

**What breaks during rotation.** Nothing, **if** the dual-secret window is honoured. The one thing
that makes it dangerous is skipping step 1 or step 4. `E06-28`'s alert (≈100% signature failure since
a deploy, **or** zero verified events in a window in which orders were placed) is the backstop that
turns a botched rotation into a page instead of a slow, invisible drift.

### 2.3 A note on staging vs live

Test-mode and live-mode secrets are **different values and rotate independently**. `E06-14`'s two
assertions (startup prefix check + `E01-18` bundle check) are the guardrails. Never set the key secret
equal to the webhook secret "for convenience" — a leak of either would then be a leak of both
(`docs/payments-design.md` §2.1).

---

## 3. Supabase service-role key (and friends)

### 3.1 Service-role key — the crown jewel

**What it is.** The key an Edge Function uses to act as `service_role`, which **bypasses RLS
entirely** (`docs/authorization-model.md` §2.1). It is the single credential that defeats
non-negotiable #2. A leak is a full read/write breach of every order, every child record, the whole
ledger.

**Who can see it.** It must live **only** as an injected Edge Function environment variable and in
Supabase project settings. No human copy, no `.env`, never in a client bundle (`E01-18` asserts the
last one). If anyone has pasted it into a terminal, a chat, or a log, that is an exposure event.

**Procedure (owner:andy — Supabase dashboard).**
1. In Supabase project settings, roll the service-role key (this rolls the JWT secret family for that
   project — see §6; coordinate the two).
2. Update the injected Edge Function secret via the CLI. Redeploy all Edge Functions (not just
   payments — every write path uses service-role).
3. Confirm the authorization suite still passes against the environment (§9) and that Edge Functions
   boot. Revoke/confirm the old key is dead. Log it.

**What breaks during rotation.** Every Edge Function is briefly redeployed; in-flight writes should be
drained or will retry. Because Supabase rolling the key **also rolls the JWT signing secret**, active
user sessions are affected — see §6. Do this in a maintenance window and expect users to re-login.
Cadence 180 days, immediately on any suspicion.

### 3.2 The read-vs-write split limits the blast radius

By design (non-negotiable #1, the `api/` module rule), **reads may use the Supabase client with the
anon key under RLS; writes always go through Edge Functions** holding the service-role key. So the
service-role key is concentrated in one tier we control and rotate, not smeared across the app. This
is a rotation benefit worth stating: there is exactly one place to update it.

### 3.3 Anon / publishable key

Not a secret — it ships in the app and RLS is the control (`docs/authorization-model.md` §2.1, Rule
2: `anon` gets nothing, anywhere). It only "rotates" if the whole project key family is rolled, in
which case treat it as an app redeploy, not a leak. There is nothing to protect; there is only a
version to keep current in the client.

### 3.4 Database password / pooler credentials

Supabase-managed. Rotate on the 180-day clock through the dashboard; the Edge Functions and the
pooler pick up the change. Nothing here is hand-held into a client. `E15-09`/`E15-10`'s pooler
configuration is unaffected by a password change.

---

## 4. SMS provider key (MSG91 / Gupshup)

**What it is.** The API key used to send OTP-login, order-confirmation, pickup-code, refund and
cancellation messages (`E00-08`, `E00-09`, `E08`). Caller-initiated, so swappable between requests.

**Who breaks if leaked.** An attacker could send SMS on our sender ID (`GRYBAG`, `E00-07`) — brand
and cost abuse, and potentially a route to smishing our users. **DPDP note:** OTP and transactional
templates carry a phone number and an order reference; they must **never** carry a child's name,
class or section (non-negotiable #4). Rotation does not change that, but the audit that accompanies a
rotation is a good moment to confirm no template drifted into carrying regulated data.

**Procedure (owner:andy — provider portal).**
1. Generate a new API key in the provider portal.
2. Set it as an Edge Function secret via the CLI; redeploy the notification functions.
3. Send one test message on each template through the new key; confirm delivery.
4. Revoke the old key. Log it.

**What breaks during rotation.** Nothing if the new key is deployed before the old is revoked — SMS
sending is caller-initiated. If the old key is revoked first, OTP login and all transactional SMS
fail until the new key deploys, which is a login outage. Order the steps as above. Rotate on the
180-day clock, on exposure, **and on staff offboarding** (SMS keys are a common thing to have pasted
somewhere during setup).

---

## 5. Sentry

### 5.1 DSN

Semi-public: a DSN can only *submit* events, not read them, so it is low-value. It lives in the
app/web/Edge Function build config. It "rotates" only if you rotate the Sentry project key, which is
a redeploy. **The DPDP constraint dominates the rotation constraint here:** children's data must
never reach Sentry (non-negotiable #4). That is a scrubbing/beforeSend concern, not a key concern,
but a DSN rotation is a natural checkpoint to re-verify the scrubber (`E20-10`, `E15-11`).

### 5.2 Sentry auth token (source-map upload)

This one *is* sensitive — it can write to the Sentry org. It lives **only as a CI secret** in GitHub
Actions, never in the app. Rotate every 90 days and on any contributor offboarding.

**Procedure.** Generate a scoped token in Sentry (upload scope only, not org-admin), replace the
GitHub Actions secret, run a build to confirm source maps still upload, revoke the old token.

---

## 6. JWT signing secret and refresh tokens

**What it is.** Supabase Auth (GoTrue) signs session JWTs with a project secret. `auth.uid()` — the
foundation of the entire customer authorization plane (`docs/authorization-model.md` §3) — reads the
claims of a JWT verified against this secret. `U3` sets long-lived refresh tokens (90–180 days) with
Android SMS Retriever to keep OTP volume down.

**The rotation tension.** Rotating the signing secret **invalidates every JWT signed with the old
secret**. Because refresh tokens are long-lived, a hard rotation logs everyone out and forces
re-authentication (a fresh OTP for many users). This is the callee-verified problem again: tokens
already issued are "messages in flight".

**Recommendation.**
- Treat JWT-secret rotation as **coupled to service-role rotation** (§3.1) — Supabase rolls them
  together — and therefore do it on the same 180-day clock, in a maintenance window, communicated in
  advance, accepting the re-login.
- On a **suspected token/secret compromise**, rotate immediately and accept the mass re-login: a
  forced global logout is exactly the correct response to a suspected session-forgery capability.
- Do **not** shorten the refresh-token TTL purely to make rotation cheaper — that trades a rare
  planned event against a permanent increase in OTP cost and friction, which is the wrong side of
  `U3`. If Supabase offers asymmetric/JWKS signing keys with an overlap (verify old + new during a
  window), prefer that over a hard secret swap; **whether the project's Supabase plan exposes a
  zero-downtime JWT key rotation is an open item — `[SEC-02]`.**

**What breaks during rotation.** Active sessions until users re-authenticate. Nothing in the ledger
or orders is affected — those are server-side. Edge Functions using the service-role key are
unaffected by the *user* JWT secret except where §3.1 rolls both at once.

---

## 7. CI, build, uptime and backup secrets

These share one procedure because they are all caller-initiated CI/console tokens.

- **GitHub Actions secrets** (Supabase CLI token for deploys, provider CI creds): 90 days + on
  offboarding. Replace the encrypted secret, run the pipeline once to confirm, revoke the old.
  **Nothing merges without CI green** (non-negotiable #6), so a botched CI-secret rotation fails
  loudly and blocks merge — which is the desired failure direction.
- **EAS/Expo build token and store API keys** (`R2`): 180 days + on offboarding. Console-side
  (owner:andy) for the store keys; CI secret for the build token.
- **Better Stack uptime/alert token** (`E15-03`): 180 days. The alert *target* is Andy's phone
  number — treat a change of that number as a config change, not a secret rotation, but confirm the
  SMS alert still fires afterward (it is the "the site is down" path of last resort).
- **Off-Supabase backup encryption key** (`E01-16`): 365 days, and **every rotation must be followed
  by a restore drill** (`E01-17`) — a backup you cannot decrypt is not a backup. Store this key in a
  **different** secret manager from Supabase, so that a full Supabase compromise does not also hand
  over the escape hatch. Losing this key makes the off-vendor backups unrecoverable, so it is the one
  secret whose *loss* is as dangerous as its *leak*; keep a sealed offline copy.

---

## 8. Incident rotation — the legacy exposure, and the general drill

`E00-01`/`E00-02` already rotated the live Razorpay pair, a Stripe test key, and two Bubble plugin
secrets found in cleartext in the `.bubble` export. That is the template for a suspected exposure:

1. **Rotate the exposed secret immediately**, out of band, ignoring the schedule.
2. **Rotate every secret that shared the exposure surface.** The `.bubble` file held four unrelated
   secrets; one leaked file is four rotations, not one.
3. **Revoke the old values at the source**, not just replace them locally — a rotated-but-not-revoked
   secret is still live.
4. **Add the leak path to the guardrail** so it cannot recur: `E00-03` added `*.bubble` to
   `.gitignore`; `E01-08a` runs gitleaks in pre-commit and CI. A rotation without a guardrail change
   invites the same leak next week.
5. **Assess DPDP impact.** If the leaked secret could read children's data (service-role key, DB
   creds), the exposure is a personal-data breach and the `E20` breach-response path applies, not
   just this document.
6. **Log it**, including the assessment of what was reachable during the exposure window.

---

## 9. How rotation is verified

A rotation is not done when the new value is set — it is done when the system is proven still correct,
which is the same standard CLAUDE.md sets for a feature (tests green, CI green).

- **Payments secrets:** the payments Edge Functions boot (proving `E06-14`'s prefix assertion
  passed), a test-mode checkout completes end to end in staging, and `E06-28`'s webhook alert is
  quiet (proving the webhook secret verifies).
- **Service-role / DB:** the default-deny authorization suite (`supabase/tests/authorization.test.sql`,
  run via `supabase test db`) passes against the environment. See `docs/testing-strategy.md` §6 for
  how that suite gates CI — a rotation that somehow broke a policy path would surface there.
- **SMS / Sentry / CI:** the one-shot confirmation described in each section above.

---

## 10. What Andy must decide or do

- **Approve the cadences** (§1). They are recommendations; `[SEC-01]` in the merge notes lays out the
  trade-off.
- **Perform the dashboard/console/portal steps** — every step tagged owner:andy above is a
  credentialed action only he can do (Razorpay, Supabase project settings, SMS portal, stores, DNS).
- **Confirm the Razorpay webhook retry window** at `E19-01` so §2.2 step 4's "24h" is a fact, not an
  assumption.
- **Rule on `[SEC-02]`** — whether the Supabase plan offers zero-downtime JWT key rotation, which
  decides whether §6 is "maintenance window + re-login" or "seamless".
