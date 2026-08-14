---
title: Netlify — previews, and how production is promoted
status: Written 2026-08-15. `E12-30`.
---

# Deploys

## How you promote a build to production

**Push a commit whose subject line contains `[promote]`.** That is the whole procedure. Every
pull request already gets its own preview URL automatically, and every push to `main` builds
nothing at all — the `ignore` hook in `apps/web/netlify.toml` skips the production build unless
the tip commit's subject carries the marker, so the live site simply stays as it was. When you
are ready to ship what is on `main`, make an empty commit that says so — `git commit --allow-empty
-m "[promote] release 2026-08-19"` and push it — and that one build runs and publishes. If you
would rather not add a commit, open the Netlify dashboard, choose **Trigger deploy → Deploy site**
and set `PROMOTE_TO_PRODUCTION=true` for that run; the gate accepts either. Both are deliberate
acts by you, and neither can be caused by merging a pull request.

---

## What is set up

| Context | When | Builds? |
|---|---|---|
| `deploy-preview` | Every pull request | **Always.** Its own URL, posted on the PR |
| `branch-deploy` | A push to any branch that is not the production branch | Always |
| `production` | A push to `main` | **Only with `[promote]` or `PROMOTE_TO_PRODUCTION=true`** |

A skipped production build is not a failure. Netlify records it as "Build skipped" and leaves the
currently published deploy live and untouched.

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
