# Decisions — Migrations

`MG1`–`MG6` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-10` while building `scripts/check-migrations.mjs` and writing `docs/migrations.md`.

| # | Decision | Why |
|---|---|---|
| MG1 | **Rollbacks live in `supabase/down/`, a sibling of `supabase/migrations/`, never a subdirectory of it** | The Supabase CLI applies what it finds in the migrations directory. `0001`'s rollback is `drop schema public cascade` — the cost of the CLI ever picking that up as a forward migration is the entire database, so the two are kept in directories that cannot be confused |
| MG2 | **Every migration is reversible or carries `-- irreversible: <reason>`. The reason is mandatory and the checker rejects an empty one** | Irreversibility is a legitimate engineering answer; *silent* irreversibility is not. Requiring a sentence turns "nobody wrote a down migration" into a decision somebody made and signed |
| MG3 | **A rollback containing only comments fails the check** | A `-- TODO` down migration is worse than none: the checker would go green, and it would be trusted exactly once, during an incident, when it silently does nothing |
| MG4 | **Down migrations must never widen access. `0002`'s rollback deliberately leaves the `anon` revokes in place** | Reversing a security tightening in a rollback script is a policy regression in the one file nobody reviews under pressure. It contradicts `[AZ-03]` (`anon` holds exactly zero policies), so the rollback ends at *more* denial than it started, never less. If those grants are ever wanted back it happens in a forward migration with the authorization suite asserting it |
| MG5 | **Versions are four digits, consecutive from `0001`, and permanent — the checker fails on a gap or a duplicate** | A gap means a migration was deleted or a branch renumbered one, and either way the order applied to some database no longer matches the order committed. Catching it at merge is the only cheap moment. Consequence to accept: two branches both adding `0003` is a real merge conflict, and the checker cannot tell you which one is safe to move |
| MG6 | **Migration immutability is documented now and enforced once staging exists, not faked in the meantime** | `0001`/`0002` have never been applied anywhere, so there is nothing to diverge from and a checksum manifest would only add friction to pre-deployment edits. From `E01-04` onward `supabase migration list` compares local versions against the remote `schema_migrations` table, which is a real check rather than a self-referential one |
