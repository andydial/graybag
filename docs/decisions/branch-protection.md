# Decisions — Branch protection

`BP1`–`BP4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-02`.

| # | Decision | Why |
|---|---|---|
| BP1 | **A repository ruleset with `bypass_actors: []` — the rule binds repository admins too** | Non-negotiable #6 is that nothing merges without the smoke test green, with no override path *including for a one-line change*. A rule the owner can walk past is a preference, not a control, and the one-line change at 11pm is exactly when it gets walked past |
| BP2 | **Pull request required, but `required_approving_review_count: 0`** | GitHub does not allow approving your own pull request, and Andy is the only developer — requiring one approval would block every merge permanently. Zero still forces the *pull request*, which is what gives the status check something to run against and what produces a reviewable diff. Raise it to 1 the day there is a second developer |
| BP3 | **`strict_required_status_checks_policy: true` — a branch must be up to date with `main` before it can merge** | Otherwise the check that passed is a check for a tree that never existed on `main`. Costs a rebase on a busy repo; this one is not busy |
| BP4 | **The required check is named `Smoke test`, matching the `name:` of the job in `ci.yml`** | The coupling is invisible and silent: rename the job and the gate waits forever for a check that will never report, which looks like a hung PR rather than a broken rule. Renaming one means renaming both in the same commit |
