---
title: Environments and secrets
status: agreed 2026-08-07 — E01-07
---

# Environments and secrets

Three environments, one rule: **a secret is set by a command, never typed into a dashboard,
and never committed.**

The *inventory* — every secret, who can see it, how often it rotates, and the procedure for
rotating each one — lives in `docs/secret-rotation-policy.md` §1 and is not repeated here.
This document covers what the environments are and how values get into them.

## 1. The three environments

| `APP_ENV` | Database | Razorpay | Deployed by |
|---|---|---|---|
| `local` | Supabase CLI stack in Docker (`E01-06`) | test account, `rzp_test_…` | nothing — it is your machine |
| `staging` | Supabase project, Mumbai `ap-south-1` (`E01-04`) | test account, `rzp_test_…` | merge to `main` (`E01-14`) |
| `production` | Supabase project, Mumbai `ap-south-1` (`E01-05`) | live account, `rzp_live_…` | tagged release + manual approval (`E01-14`) |

`local` and `staging` share the **same Razorpay test account**. There is no third account,
so the rule reduces to a single sentence: *staging must never hold a live key.*

## 2. Test/live isolation is enforced, not remembered

`packages/shared/src/env.ts` refuses to load an environment whose `RAZORPAY_KEY_ID` prefix
contradicts its `APP_ENV`. A live key outside production fails with a message that says so in
capitals, because the failure mode is real money moving from a test run.

The check runs in three places, deliberately:

1. **Before a secret is sent anywhere** — `npm run secrets:set` validates the file first, so a
   live key never reaches the staging secret store to begin with.
2. **At Edge Function boot** (`E06-14`) — so a value changed by any other route still fails
   loudly, at deploy time, rather than at the first payment.
3. **In the unit suite** — `packages/shared/src/env.test.ts`, so the rule cannot be softened
   without a test going red.

`loadClientEnv()` additionally **refuses to run at all** if a server-only secret is merely
*present* in the environment it was handed. A client build that can see
`SUPABASE_SERVICE_ROLE_KEY` is one careless `process.env` reference from shipping the one
credential that bypasses RLS entirely (non-negotiable #2). `E01-18` asserts the same property
against the built bundle; this asserts it at the source.

## 3. Setting secrets

```bash
cp .env.example .secrets.staging.env      # fill in from the password manager
npm run secrets:set -- staging --dry      # shows what would change, sends nothing
npm run secrets:set -- staging
```

`.secrets.<environment>.env` is gitignored and lives only on Andy's machine. The script:

- refuses if the file's own `APP_ENV` is not the environment named on the command line, so
  `secrets:set -- staging` against a file of production values is not one typo away;
- validates the whole file with the same loader the application boots with;
- writes GitHub Actions **environment** secrets (used by CI and the deploy workflows) and
  Supabase **Edge Function** secrets (the only place the payment secrets are readable).

**Why not the dashboards.** Hand-editing is how the legacy app ended up with a live Razorpay
key in an export (`docs/learnings.md`, 2026-08-06). A dashboard has no validation, no record
of what changed, and no way to tell afterwards whether staging and production diverged.

## 4. What is allowed in a client bundle

| Variable | In the bundle? |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | **Yes.** The anon key is publishable by design; RLS is the control |
| `RAZORPAY_KEY_ID` | **Yes.** The checkout SDK needs it. It is the public half of the pair |
| `SENTRY_DSN` | **Yes.** A DSN can submit events, not read them |
| `SUPABASE_SERVICE_ROLE_KEY` | **Never** |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET*` | **Never** |

## 5. Local development

Local needs no real secrets. The Supabase CLI prints a fixed anon key and service-role key for
its local stack, and Razorpay is stubbed offline (`docs/testing-strategy.md` §5.1) — so `local`
runs without a Razorpay account at all. The `rzp_test_` prefix rule still applies to anything
that *is* set, so a stray live key on a laptop fails the same way it would in CI.
