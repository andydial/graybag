# Decisions — CI

`CI1`–`CI4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-08` while building `.github/workflows/ci.yml` and `integration.yml`.

| # | Decision | Why |
|---|---|---|
| CI1 | **The PR gate is the smoke test only — typecheck, lint, migration rules, unit tests. Anything needing a real Postgres runs in a separate workflow** | CLAUDE.md's testing rhythm is explicit: ~60s on every push, the full suite overnight. A Supabase stack takes minutes to come up, and paying that on every commit is how a team learns to work around CI. Locally the smoke test runs in 6s. **Note this resolves a conflict**: `E01-08`'s own wording asks for "integration tests against a seeded ephemeral DB" in the CI pipeline, which the newer CLAUDE.md rhythm contradicts. CLAUDE.md wins; the integration job exists, it is just not the per-push gate |
| CI2 | **The integration workflow also runs on any PR touching `supabase/**`, not only nightly** | A schema change is exactly the change the smoke test cannot judge. Running it on the PRs that could break it, rather than discovering it eight hours later, costs a few minutes on a small fraction of PRs |
| CI3 | **The Supabase CLI is a devDependency, not `supabase/setup-cli`** | One pinned version for CI and laptops both. A migration that replays in CI and not on a developer's machine — or the reverse — is a debugging session with no useful outcome |
| CI4 | **The smoke test includes `node scripts/build-backlog.mjs`** | The build fails on a malformed epic file, and a missing `## Tasks` heading otherwise silently drops a whole section from the dashboard Andy works from. It costs about a second |
