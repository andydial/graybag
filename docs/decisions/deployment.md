# Decisions — Deployment

`DP1`–`DP7` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-14`.

| # | Decision | Why |
|---|---|---|
| DP1 | **The production approval gate is a GitHub Environment required-reviewer rule, not a step in the workflow** | An environment rule pauses the job before any step runs *and* before the environment's secrets are exposed to it. A gate written as a workflow step can be edited away by the very pull request it is meant to guard; repository configuration cannot |
| DP2 | **staging deploys only from `main`, production only from `v*` tags — enforced by deployment branch policies, not convention** | `workflow_dispatch` would otherwise let anyone run the production workflow against any ref. The policy makes the ref restriction part of the environment rather than something the workflow has to remember to check |
| DP3 | **Deploy concurrency queues (`cancel-in-progress: false`) rather than cancelling** | `db push` applies migrations in order. Two runs interleaving against one database is a corrupted migration history repaired by hand, and a cancelled half-applied deploy is worse than a slow one |
| DP4 | **Production re-runs the full smoke test; staging does not** | A tag can be moved, and it can be cut from a commit that never had a CI run of its own. Trusting "it was green on main" is trusting something that may never have been true for that exact tree |
| DP5 | **The repository is PUBLIC** | Andy's decision, taken with the exposure stated: branch protection and environment approval rules are unavailable on free-plan private repositories, and the alternative was $4/month or losing both controls. Recorded because it is not a neutral choice — the published history permanently contains ten weights of **VAG Rounded Next**, a commercial typeface whose licence has never been checked (`E19-03`, `[DS-02]`), and `docs/authorization-model.md` + `docs/legacy-bubble-schema.md`, which map a legacy system that today exposes every order and every child's allergies publicly. Going private later does not retract clones, forks or search indexes. **Revisit `E19-03` with urgency, and treat the legacy exposure as one more reason to finish the migration** |
| DP6 | **A job that reports a gate must not be behind that gate** — the ref check runs in a job with no `environment:` key | `E17-63`, 2026-08-28. `DP2` is right and stays, but its consequence is invisible: a `workflow_dispatch` from a branch is refused by the environment's branch policy *before the runner starts*, so the run has **zero steps and no logs at all**. On 2026-08-25 that was read as "the Migrations job failed" — it had never begun — and eight migrations plus nine Edge Functions sat unapplied for three days behind an apparently-attempted deploy. An ungated job always runs and can therefore explain the gate. Had the guard been gated on `production` like the job it protects, it would have been silenced by exactly the rule it exists for, so `deploy-production-ref.test.mjs` asserts the **absence** of the `environment:` key. The guard is legibility; `DP1`'s required-reviewer rule remains the control |
| DP7 | **Production release tags are dated — `vYYYY.MM.DD`, with a trailing letter for a second release in one day — not semver** | `E17-63`, 2026-08-28, on cutting the first tag the repository has ever had. What ships to production is a schema, a set of Edge Functions and a site, none of which has a version; the thing that *does* have one is the mobile app, currently `4.0.0` in `app.json` and owned by the stores. A repo tag reading `v4.0.1` would be read as an app version by everyone including us, and the two move independently — an OTA changes the app without a tag, and a migration changes production without touching the app. Dated tags also match the existing house style for the web promotion marker (`[promote] release 2026-08-28b`), so one release vocabulary covers both |

### The production deploy credentials, reconciled between two threads — 2026-08-28

Two threads found the same fault — `Deploy to production` could not authenticate — and fixed it two
different ways within a day of each other. `E01-31` (web, PR #154) changed the workflow file;
`E17-64` (mobile) created the secrets in the `production` **environment**, which shadows the
repo-level ones because the job carries `environment: production`. Andy's reconciliation is the
**union**, and the reasoning for each half is different enough to be worth keeping.

| # | Decision | Why |
|---|---|---|
| DP8 | **The project ref is hardcoded in the workflow, not read from a secret** | It is not a secret — it is in every Supabase URL the app ships with, and it is in this repo's `.env.example`. Storing it as one bought nothing and cost the deploy: `SUPABASE_PROJECT_REF` existed at no level, so the credential guard failed on every run and the failure looked like a permissions problem rather than a missing constant. A **visible deploy target** is also the property you want when reading a workflow to answer "which project does this write to?" — the answer should not require the ability to list secrets. Staging already hardcodes its own |
| DP9 | **The database password is an `environment`-scoped secret, never a repo-level one** | This is the half `E01-31` got wrong, and the reason is sharper than "two passwords need two names". A **repo-level secret is readable by any workflow, including one with no `environment:` key** — and `deploy-production.yml` deliberately has an ungated `preflight` job (`DP6`) precisely so the guard runs before the approval gate. Environment scoping is what makes the production password unreachable from anything that has not passed the gate. Renaming it to `PRODUCTION_SUPABASE_DB_PASSWORD` at repo level, as #154 proposed, would have removed the *confusion* with staging's while leaving the *exposure* exactly as it was |

**`E01-31` is closed rather than merged.** Its file change is right and is carried into the mobile
thread's follow-up; its secret change is superseded by `DP9`. Recorded here rather than left in a
closed pull request, because a closed PR is not the decision log and nobody reads one on purpose.
