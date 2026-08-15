---
title: Pointing the web app at the production Supabase project
status: Written 2026-08-15 during an unattended run. **Not done** — see "Why this is not done".
blocks: the 19 August launch
---

# Production cutover — the web app's configuration

## Status — the environment is set; the migrations are not

**Done, 2026-08-15.** `~/.graybag-secrets/prod.env` appeared and the four `PUBLIC_*` variables are
set on Netlify's **production context only**. Read back per context to confirm:

| Context | `PUBLIC_SUPABASE_URL` | `PUBLIC_APP_ENV` |
|---|---|---|
| `production` | `bdamkuugbqjajbndjoxn` (prod) | `production` |
| `deploy-preview` | `jcagqjsibcpjyskvebeq` (staging) | `staging` |

Staging is untouched and previews still point at it. `apps/web/.env` was not modified.

### NOT done, and it blocks promoting a build

**Production is missing `0057_enquiry` and `0058_service_days`.** Checked against the live
project rather than assumed:

```
school_config.service_days    HTTP 400   ← 0058 not applied
platform_config.service_days  HTTP 400   ← 0058 not applied
enquiry                       HTTP 404   ← 0057 not applied
ops_alert                     HTTP 200   ← 0056 IS applied
```

Prod is at `main`'s head *as it was before #51 merged*. Those two migrations reached `main` when
#51 merged, minutes after this check.

**If a build is promoted before they are applied**, `/admin/config` and the school-config half of
`/admin/schools` return `400` — they read `service_days` — and `tools/bulk-import` fails on its
first snapshot read for the same reason. Nothing a parent touches is affected; the enquiry form
posts to an Edge Function that is not deployed to prod either.

Applying them is deliberately **not** done here: Andy's instruction was to do the web config
*"once mobile has applied migrations"*, which puts the prod migration step with that thread, and
a production migration during launch week is not something to do on an inferred authorisation.

Because production does **not** auto-deploy (`E12-30`), nothing has changed on the live site and
nothing will until somebody promotes. Setting the variables early is therefore safe: it removes a
step from the critical path without taking any risk.

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

The variable names in `prod.env` are `SUPABASE_PROD_*`, not `SUPABASE_*` — an earlier draft of
this document guessed the shorter names and was wrong.

```bash
# 1. The file.
set -a; . ~/.graybag-secrets/prod.env; set +a
echo "$SUPABASE_PROD_URL"     # sanity — is this the production project?

# 2. Netlify, production context only. Already done, 2026-08-15.
cd apps/web
npx netlify env:set PUBLIC_SUPABASE_URL      "$SUPABASE_PROD_URL"      --context production
npx netlify env:set PUBLIC_SUPABASE_ANON_KEY "$SUPABASE_PROD_ANON_KEY" --context production
npx netlify env:set PUBLIC_APP_ENV           production                --context production
npx netlify env:set PUBLIC_KITCHEN_TRANSPORT live                      --context production

# Do NOT pass --secret on a PUBLIC_* variable. It has to be inlined into the client bundle at
# build time, and it is publishable by design — RLS is the control, not the key. Passing it was
# the one mistake made here and it was undone immediately.

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

## Lifting `noindex` — prepared, deliberately not pulled

The site is held out of search two ways, and **both must come off together or neither works**:

1. `robots.txt` renders `Disallow: /` unless `PUBLIC_SITE_PUBLISHED=true`
2. `netlify.toml` sets `X-Robots-Tag: noindex, nofollow` on `/*`

Two mechanisms because they fail differently: a header covers a crawler that ignores `robots.txt`,
and `robots.txt` covers one that never requests the page.

### What has to be true first

Every one of these, and none is a judgement call:

| # | Condition | How to check | Today |
|---|---|---|---|
| 1 | **The DNS cutover has happened** (`E12-10`) and the site answers on `graybag.com` | `curl -sI https://graybag.com` | **not done** — the site is only on `graybag-web.netlify.app` |
| 2 | **The legal pages are cleared to publish.** They are the reason the marketing site has been held back, not the app | Andy's confirmation. `E20-01` | **not confirmed** |
| 3 | **No `«…-PENDING-…»` token on any published surface** | `npm run check:placeholders` | see the register |
| 4 | **The enquiry form reaches production**, not the dev mock | `PUBLIC_ENQUIRY_ENDPOINT` set on the production context | **done, 2026-08-15** |
| 5 | **An enquiry notification actually arrives** | submit one, then check Resend | **done, 2026-08-15** |
| 6 | **`check:launch` has no blockers** | `npm run check:launch` | **2 blockers** |
| 7 | **A production build is promoted after the flip** | the variable is baked in at build time, so setting it changes nothing until you rebuild | — |

Condition 7 is the one that catches people. `PUBLIC_SITE_PUBLISHED` is read at **build** time by
`robots.txt.ts`, so setting it in Netlify and not promoting leaves `Disallow: /` on the live site,
and removing the header without rebuilding leaves the two mechanisms disagreeing.

### The flip, when the conditions hold

```bash
cd apps/web
npx netlify env:set PUBLIC_SITE_PUBLISHED true --context production
# then delete the X-Robots-Tag block in apps/web/netlify.toml, commit, and promote:
#   docs/netlify-deploys.md
```

Then verify **both**, on the live host:

```bash
curl -sI https://graybag.com/ | grep -i x-robots-tag     # expect nothing
curl -s  https://graybag.com/robots.txt | head -3        # expect Allow, not Disallow
```

If only one of the two changes, the site is in the state the two mechanisms exist to prevent.

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

1. ~~Payments thread stands up the production project and writes `~/.graybag-secrets/prod.env`.~~ **Done.**
2. **Migrations `0001`–`0058` applied to production. ← THE OUTSTANDING STEP.** Prod is at `0056`;
   `0057_enquiry` and `0058_service_days` landed on `main` when #51 merged and are not on prod.
3. **`tools/bulk-import` run against production** — schools, dishes, menus. Dry run first;
   `docs/import-format.md`. This is the 17th.
4. ~~Netlify environment variables set, production context only.~~ **Done, and verified per context.**
5. A build promoted with `[promote]`.
6. Sign in and check `/admin/schools` lists what was imported.

Steps 2 and 3 must not be swapped: the importer reads `school_config.service_days`, which `0058`
adds, and fails with a PostgREST "column does not exist" if the migrations are behind.
