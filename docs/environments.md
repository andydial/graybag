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

## Seeding staging

```bash
npm run db:seed:staging
```

Applies `supabase/seeds/staging-menu.sql` to the **linked** remote project. First done
2026-08-10, which is when a staging build first showed food.

**Two seed files, and the difference is people.**

| File | Applied to | Contains |
|---|---|---|
| `supabase/seed.sql` | local and CI only, by `db reset` | Everything, including six users and six children — the pgTAP authorization suite needs real subjects to impersonate |
| `supabase/seeds/staging-menu.sql` | staging, by the script above | The menu side only. No `auth.users`, no `app_user`, no `recipient`, no `guardian_link` |

`seed.sql`'s own header says *never into staging or production*, and that rule stands. The
staging file is not an exception to it — it is a different file with a different contents
rule. Synthetic children are not regulated data, but the cheapest way never to leak a
fixture child is to keep one out of a hosted database (non-negotiable #4).

The script exists because `supabase db push --include-seed` has **no flag for which seed
file to use** — it reads `sql_paths` from `supabase/config.toml`, the same list
`db reset` uses locally. Swapping that by hand and forgetting to swap it back means the
next `db reset` quietly drops the suite's fixtures. The script restores the file in a
`finally`, and on SIGINT.

**The data is fixtures, not the real menu.** Real menus arrive with `E04-13`, blocked on
`[MI-01]` — the source workbook is not in the repository.

### The CLI version matters

`supabase@2.112.0` **cannot link at all**: it fails parsing the API's api-keys response
with a `SchemaError` on a timestamp, so every `link`, `migration list --linked` and
`db push --linked` dies. `2.113.0` fixes it. The dependency is pinned at `^2.113.0`; if a
deploy ever fails with `LegacyLinkApiKeysNetworkError`, that is this.

Two other things that bit on the way through, both worth recognising on sight:

- **`Cannot find project ref`** even though `supabase link` succeeded — the CLI writes
  `supabase/.temp/linked-project.json` but some commands still look for the older
  `supabase/.temp/project-ref`. Writing the bare ref into that file fixes it.
- **`IPv6 is not supported on your current network`** — the direct `db.<ref>.supabase.co`
  host is IPv6-only. A successful `link` records the IPv4 pooler and the error goes away,
  which is why the fix is to link rather than to fight the resolver.


---

## 6. Project configuration the repo does not own

**`supabase/config.toml` configures the local stack and nothing else.** Every hosted-project
setting below lives in the Supabase dashboard: it is not in a migration, not in a test, and
invisible to CI. That is the whole problem — **it looks configured because nothing says
otherwise.**

It cost a day on 2026-08-10. The magic-link email template still used `{{ .ConfirmationURL }}`,
so Supabase emailed a *link* while the app sat waiting for a six-digit code, and the link opened
a blank page because Site URL was never set. Nothing in this repository could have caught it,
and nothing would have caught it again the day we point at production — with real parents on the
other end.

### The checklist, per environment

Run `npm run check:config` (staging) rather than reading this by eye. The list is here so a
human can see *what* is being asserted and *why*; the script is what actually asserts it.

| # | Setting | Required value | Symptom when wrong |
|---|---|---|---|
| 1 | **Auth → Email templates → Magic Link** | Contains `{{ .Token }}`, **not** `{{ .ConfirmationURL }}` | A parent gets a link instead of a code; the app waits for a code that never arrives |
| 2 | **Auth → Email OTP length** | **6** | The screen says "six-digit code" and the email carries eight |
| 3 | **Auth → Email OTP expiry** | ≥ 600s. 3600s is fine | Too short and a parent who switches to Mail and back is already too late |
| 4 | **Auth → URL Configuration → Site URL** | The real host. **Never `localhost`** | Every generated link opens a blank page on the recipient's phone |
| 5 | **Auth → URL Configuration → Redirect allow-list** | Includes the app scheme for that environment — `graybag-dev://`, `graybag-staging://`, `graybag://` | Deep links and any future OAuth callback cannot return to the app |
| 6 | **Auth → Rate limits → Emails sent** | ≥ 10/hour for staging; sized to the school roll for production | **Project-wide, not per user.** At 2/hour the third parent signing in at the school gate gets nothing and reports the app as broken |
| 7 | **Auth → SMTP** | A real sender (Resend/SES/Postmark) with SPF and DKIM | Supabase's built-in sender is a handful of messages an hour with no delivery guarantee. For an OTP-only product that means **nobody can sign in**. Blocks production |
| 8 | **Auth → Signup enabled** | On | First sign-in *is* registration (`AR4`); off, no parent can ever create an account |
| 9 | **Auth → Email autoconfirm** | **Off** | On, an address is trusted without the code — anyone can sign in as any email they can spell |
| 10 | **Auth → Providers** | Email only in v1. Google/Apple **off** until their client ids exist | A provider button that cannot work is a dead end on the one gated screen |

### Current state — staging, 2026-08-10

Items 1, 8 and 9 pass. **2, 4, 5 and 6 fail**, and 7 warns (fine for staging, blocks production).
`npm run check:config` prints the live answer; do not trust this paragraph, which is a snapshot.

### Why this is not in the smoke test

Every failure here is fixed in a dashboard by Andy, not in a pull request. A red smoke test that
no code change can turn green trains people to ignore the smoke test. It runs in
`integration.yml`, and it is a gated step in the cutover runbook.

## The Android upload keystore — 2026-08-12

**Location: `~/.graybag-secrets/graybag-upload.keystore`** (`600`, in a `700` directory). It is
**not in this repository and must never be**: a leaked upload keystore lets someone submit builds
as us. The password is in Andy's password manager, deliberately *not* stored beside the key —
a key and its password in one directory is one compromise, not two.

| | |
|---|---|
| Alias | `graybag_app_keys` |
| Type | PKCS12, `PrivateKeyEntry` |
| SHA-256 | `58:12:81:6E:6A:02:9A:DB:68:E3:73:55:27:EB:68:FD:84:38:1C:BC:10:8D:FA:28:34:7E:34:CC:6B:E3:C8:DE` |
| SHA-1 | `94:CD:13:95:C7:F4:C0:9F:7D:EC:4B:F3:08:67:7B:48:D4:E7:8E:DA` |
| Subject | `CN=Andy Dial, OU=graybag, O=graycord, L=melbourne, ST=victoria, C=au` |
| Valid | 2025-05-18 → **2052-10-03** |
| Package | `com.Gracord.Graybag` — matches `app.config.js` |

The fingerprints are recorded here **because they are not secret** — Play Console publishes them
— and because the whole point of an upload key is being able to check that the thing you are
about to sign with is the thing Google expects.

**This is the UPLOAD key, not the app signing key.** Google holds the app signing key, so a
compromise here is recoverable with an upload key reset. That is why registering it with EAS
(which puts the private key on Expo's servers) is an acceptable trade for cloud builds, and why
`credentials.json` local signing was rejected: it would mean no build without Andy's laptop.

### Registering it with EAS

`eas credentials` is **menu-driven only** — there is no flag to upload a keystore, and
`credentials:configure-build` is interactive too. It therefore needs a human session, and it
should be a human session rather than an automated one: the same menu offers **"Set up a new
keystore"**, which generates a *fresh* upload key. Choosing it by accident is what forces the
upload key reset this whole exercise exists to avoid.

```
npx eas-cli credentials --platform android
  → Build Credentials
  → production (or whichever profile)
  → Keystore: Manage everything needed to build your project
  → Set up a new keystore            ← NOT this one
  → Upload a keystore                ← this one
      path:        ~/.graybag-secrets/graybag-upload.keystore
      alias:       graybag_app_keys
      passwords:   from the password manager (keystore and key password are the same here)
```

Afterwards the fingerprint EAS reports must equal the SHA-256 above, and that must equal the
**Upload key certificate** in Play Console → Test and release → Setup → App signing. Note that
page shows the *App signing key* certificate too; they are different keys and comparing the wrong
block is the easy mistake.
