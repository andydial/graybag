---
title: Pointing the web app at the production Supabase project
status: Written 2026-08-15 during an unattended run. **Not done** — see "Why this is not done".
blocks: the 19 August launch
---

# Production cutover — the web app's configuration

## Why this is not done

`~/.graybag-secrets/prod.env` **does not exist**. That directory holds `graybag-upload.keystore`
and nothing else. Either the payments thread has not stood the production project up yet, or it
has and the file was not written.

Nothing was guessed, and **`apps/web/.env` was not touched**, so staging is exactly as it was and
still works. Everything below is ready to run the moment the file appears; it is a five-minute
job, and none of it is a decision.

Recorded as `D-16F` in `docs/decisions-16aug.md`.

---

## The two values that matter

The web app reads exactly seven `PUBLIC_*` variables. Only two of them decide which database it
talks to:

| Variable | Staging today | Production |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | the staging project | **the production project** |
| `PUBLIC_SUPABASE_ANON_KEY` | the staging anon key | **the production anon key** |

Both are publishable by design — the anon key ships in the bundle, and **RLS is the control, not
the key** (`packages/shared/src/env.ts`). The one that must never appear here is
`SUPABASE_SERVICE_ROLE_KEY`; `config/eslint-api-module.js` fails the build if that name is even
written in application code, and `E01-18` asserts the built bundle is clean.

The other five are environment behaviour rather than identity:

| Variable | Production value | Why |
|---|---|---|
| `PUBLIC_APP_ENV` | `production` | |
| `PUBLIC_KITCHEN_TRANSPORT` | `live` | anything else renders the kitchen board from fixtures |
| `PUBLIC_ENQUIRY_ENDPOINT` | the production `enquiry-submit` URL | `E12-21`. Until it is set, **live enquiries go to the dev mock and are lost** |
| `PUBLIC_SITE_PUBLISHED` | leave unset until the DNS cutover | it is what lifts `Disallow: /` from `robots.txt` (`E12-10`) |
| `PUBLIC_SITE_STAGE` | leave unset | |

---

## Where they go — two places, and both are needed

**1. Netlify**, which is what the deployed site actually uses.
Site configuration → Environment variables. Set them for the **production** context only, so
deploy previews keep pointing at staging. A preview that writes to the production database is
worse than a preview that does not build.

**2. `apps/web/.env`**, which is only ever local development. Not committed, and not read by the
build on Netlify.

Do **not** put production values in `apps/web/.env` and leave them there. The next `npm run
dev:web` would then be a local browser session against the live database, which is precisely how
somebody marks a real class delivered while testing.

---

## Doing it

```bash
# 1. The file, once the payments thread writes it.
set -a; . ~/.graybag-secrets/prod.env; set +a
echo "$SUPABASE_URL"          # sanity — is this the production project?

# 2. Netlify, production context only.
cd apps/web
npx netlify env:set PUBLIC_SUPABASE_URL      "$SUPABASE_URL"      --context production
npx netlify env:set PUBLIC_SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY" --context production
npx netlify env:set PUBLIC_APP_ENV           production           --context production
npx netlify env:set PUBLIC_KITCHEN_TRANSPORT live                 --context production

# 3. Confirm what is set, per context, before building anything.
npx netlify env:list --context production
npx netlify env:list --context deploy-preview   # must still be staging
```

Then promote a build — `docs/netlify-deploys.md`. Production does not publish on its own; it
needs a commit whose subject carries `[promote]`, or `PROMOTE_TO_PRODUCTION=true`.

---

## Verifying the switch, in one command

```bash
# Against the deployed production site. The anon key in the bundle should be the production one.
curl -s https://graybag-web.netlify.app/_astro/*.js | grep -o 'https://[a-z0-9]*\.supabase\.co' | sort -u
```

One hostname, and it is the production project. If two appear, a stale build is still live.

Then the real check, which no grep can do for you: **sign in at `/signin` and open `/kitchen`.**
A production database with no seeded days shows an empty board, and that is the correct answer —
not a failure. `/admin/schools` is the better test, because a production project that has had
`tools/bulk-import` run against it will list the schools, and an empty list there means the
import has not happened yet.

---

## What must NOT be carried across

- **`.secrets.staging.env`** stays staging. It is gitignored and `chmod 600`; production gets its
  own file, and the two must never be sourced in the same shell — the importer would then write
  the wrong catalogue into the wrong database with no confirmation step.
- **The `noindex` header and `robots.txt`.** `netlify.toml` sets `X-Robots-Tag: noindex, nofollow`
  and `robots.txt` defaults to `Disallow: /`. Both lines say in place when to delete them: the
  DNS cutover (`E12-10`), **not** the production database cutover. They are different events and
  the marketing pages are not cleared to publish.
- **Staging's migration drift.** `docs/handover-web.md` §3: the enquiry table was applied to
  staging by hand as `0050` and is committed as `0057`, so a `supabase db push` against staging
  needs `supabase migration repair` first. Production has no such history and should take the
  migrations cleanly — but check `supabase_migrations.schema_migrations` before assuming it.

---

## The order this has to happen in

1. Payments thread stands up the production project and writes `~/.graybag-secrets/prod.env`.
2. Migrations `0001`–`0058` applied to production.
3. **`tools/bulk-import` run against production** — schools, dishes, menus. Dry run first;
   `docs/import-format.md`. This is the 17th.
4. Netlify environment variables set, production context only.
5. A build promoted with `[promote]`.
6. Sign in and check `/admin/schools` lists what was imported.

Steps 2 and 3 must not be swapped: the importer reads `school_config.service_days`, which `0058`
adds, and fails with a PostgREST "column does not exist" if the migrations are behind.
