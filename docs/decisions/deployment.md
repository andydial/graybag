# Decisions — Deployment

`DP1`–`DP5` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-14`.

| # | Decision | Why |
|---|---|---|
| DP1 | **The production approval gate is a GitHub Environment required-reviewer rule, not a step in the workflow** | An environment rule pauses the job before any step runs *and* before the environment's secrets are exposed to it. A gate written as a workflow step can be edited away by the very pull request it is meant to guard; repository configuration cannot |
| DP2 | **staging deploys only from `main`, production only from `v*` tags — enforced by deployment branch policies, not convention** | `workflow_dispatch` would otherwise let anyone run the production workflow against any ref. The policy makes the ref restriction part of the environment rather than something the workflow has to remember to check |
| DP3 | **Deploy concurrency queues (`cancel-in-progress: false`) rather than cancelling** | `db push` applies migrations in order. Two runs interleaving against one database is a corrupted migration history repaired by hand, and a cancelled half-applied deploy is worse than a slow one |
| DP4 | **Production re-runs the full smoke test; staging does not** | A tag can be moved, and it can be cut from a commit that never had a CI run of its own. Trusting "it was green on main" is trusting something that may never have been true for that exact tree |
| DP5 | **The repository is PUBLIC** | Andy's decision, taken with the exposure stated: branch protection and environment approval rules are unavailable on free-plan private repositories, and the alternative was $4/month or losing both controls. Recorded because it is not a neutral choice — the published history permanently contains ten weights of **VAG Rounded Next**, a commercial typeface whose licence has never been checked (`E19-03`, `[DS-02]`), and `docs/authorization-model.md` + `docs/legacy-bubble-schema.md`, which map a legacy system that today exposes every order and every child's allergies publicly. Going private later does not retract clones, forks or search indexes. **Revisit `E19-03` with urgency, and treat the legacy exposure as one more reason to finish the migration** |
