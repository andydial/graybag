---
title: Netlify — previews, and how production is promoted
status: Written 2026-08-15. `E12-30`.
---

# Deploys

## How you promote a build to production

**Open a pull request with one empty commit and merge it with `[promote]` in the subject.** That
is the whole procedure. Every pull request already gets its own preview URL automatically, and
every push to `main` builds nothing at all — the `ignore` hook in `apps/web/netlify.toml` skips
the production build unless the tip commit's subject carries the marker, so the live site simply
stays as it was. When you are ready to ship what is on `main`, run `git checkout -b promote-$(date
+%F) && git commit --allow-empty -m "[promote] release" && git push -u origin HEAD`, open the PR,
and merge it with **`--squash --subject "[promote] release 2026-08-19"`** — the squash subject is
what lands on `main`, and that is the line the gate reads. If you would rather not touch git at
all, open the Netlify dashboard, choose **Trigger deploy → Deploy site** and set
`PROMOTE_TO_PRODUCTION=true` for that run; the gate accepts either. Both are deliberate acts by
you, and neither can be caused by merging an ordinary pull request.

---

## What is set up

| Context | When | Builds? |
|---|---|---|
| `deploy-preview` | Every pull request | **Always.** Its own URL, posted on the PR |
| `branch-deploy` | A push to any branch that is not the production branch | Always |
| `production` | A push to `main` | **Only with `[promote]` or `PROMOTE_TO_PRODUCTION=true`** |

A skipped production build is not a failure. Netlify records it as "Build skipped" and leaves the
currently published deploy live and untouched.

## READ THIS FIRST — the gate is inert until the repository is connected

**The Netlify site has no Git repository attached.** Checked on 2026-08-15:
`build_settings.repo_url`, `provider`, `cmd` and `base` are all null, and the most recent deploy
before today carried no commit ref at all.

That means **none of this file has ever actually run**. Netlify has never built from a push, so:

- deploy previews on pull requests do not exist;
- the `ignore` hook in `netlify.toml` — the whole promote gate — has never been evaluated;
- every production deploy so far, including today's, was a manual `netlify deploy --prod`.

The gate is correct and tested (`scripts/test/netlify-gate.test.mjs` runs the shell wrapper and
asserts its inverted exit codes), and it will start working the moment a repository is connected.
Until then it protects nothing, and **the only thing standing between a mistake and production is
whoever types the deploy command**.

Connecting it needs the Netlify account and GitHub authorisation, so it is `E12-33` and it is
Andy's. Until it is done, promoting is:

```bash
set -a; . ~/.graybag-secrets/prod.env; set +a
PUBLIC_APP_ENV=production \
PUBLIC_SUPABASE_URL="$SUPABASE_PROD_URL" \
PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_PROD_ANON_KEY" \
PUBLIC_KITCHEN_TRANSPORT=live \
PUBLIC_ENQUIRY_ENDPOINT="$SUPABASE_PROD_URL/functions/v1/enquiry-submit" \
npm run build:web
cd apps/web && npx netlify deploy --prod --dir dist
```

**Do not put those values in `apps/web/.env`.** A local `npm run dev:web` would then be a browser
session against the live database, which is how somebody marks a real class delivered while
testing.

## Why it is a pull request and not a plain push

The first version of this document said "make an empty commit and push it", and that **does not
work**: `main` is protected, and a direct push is rejected with `GH013 — changes must be made
through a pull request`. Found by trying to follow it.

The marker therefore has to arrive on `main` as the **squash subject** of a merged PR, which is
why the command above passes `--subject` explicitly. Merging without it puts GitHub's default
subject on `main` — `Title (#nn)` — and the gate, correctly, skips the build. If you promote and
nothing deploys, that is the first thing to check.

## The bit that is still yours to do

The gate stops production being **built**. Netlify's dashboard also has an auto-publishing switch,
which stops a built deploy being **published**. They guard different halves and both are worth
having — the repository gate is reviewed like code and cannot be quietly flipped; the dashboard
switch catches anything that reaches the build stage another way.

Turning it on needs the Netlify account, so it is yours: **Site configuration → Build & deploy →
Continuous deployment → Stop auto publishing**. Tracked as `E12-31`.

## Why a build gate rather than only the dashboard switch

The dashboard switch works, and it is invisible from the repository, reversible by anyone with
dashboard access, and it leaves a fully built deploy sitting one click away from live. The gate
in `netlify.toml` is reviewed like code, travels with the branch, and means production is not
built at all — there is nothing sitting there to publish by accident.

## The inverted exit code, because it will catch somebody

Netlify's `ignore` command answers **"may I skip this build?"**:

```
exit 0  →  SKIP the build.  The live site is untouched.
exit 1  →  BUILD it.
```

That is backwards from every other exit code in this repository. It is why the decision lives in
`scripts/lib/netlify-gate.mjs` as a pure function with a test, and why
`scripts/netlify-should-build.sh` does nothing but translate — reversing the two fails **open**,
and production would publish on every push.

`scripts/test/netlify-gate.test.mjs` runs the shell wrapper for real and asserts the actual exit
codes, not just the module's answer.

## What the gate deliberately does not accept

- **`[promote]` in the commit body.** Only the subject line counts. A body is where such a string
  turns up by accident — a quoted review comment, a pasted log, a reference to this document.
- **`PROMOTE_TO_PRODUCTION` set to anything but `true`.** `1`, `yes` and `false` all fail closed.
  A variable left set in the dashboard would otherwise turn the gate off permanently and silently.
- **An empty commit message.** A shallow clone with no readable history fails closed.

The one case that fails **open** is the gate itself failing to run — if `node` cannot evaluate it,
the build proceeds and says so on stderr. A site frozen by a typo in the gate is worse than a
build that needed a second look.

## Related

- The site is held out of search by `robots.txt` and an `X-Robots-Tag` header until the DNS
  cutover (`E12-10`). **Promoting to production does not lift that** — they are separate, and
  deliberately so: the back office needs to be reachable before the marketing pages are cleared
  to publish.
- `E01-20` — `Deploy to staging` in GitHub Actions has never succeeded. Unrelated to this, and
  still open.
