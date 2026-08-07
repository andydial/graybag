---
title: Database migrations
status: agreed 2026-08-07 — E01-10
---

# Database migrations

Every schema change ships as a **reversible migration**. This document is the rule;
`scripts/check-migrations.mjs` is the enforcement, and it runs in the smoke test on every
push, so a migration that breaks these rules cannot merge.

## 1. Layout

```
supabase/migrations/0001_initial_schema.sql     the change
supabase/down/0001_initial_schema.down.sql      how to undo it
```

Up migrations live where the Supabase CLI expects them. Rollbacks live in a **sibling**
directory, not a subdirectory of `migrations/`, so there is no chance of the CLI picking one
up and applying a `drop schema public cascade` as though it were a forward migration.

## 2. Naming

`NNNN_lower_snake_case.sql`, four digits, starting at `0001`, consecutive, no gaps.

- **Version numbers are permanent.** Never renumber, never reuse. A version is the identity
  of a change that may already be applied to staging, to production, or to a colleague's
  local database.
- Two branches that both add `0003` is a **merge conflict you must resolve by renumbering the
  one that has not been applied anywhere**, not by picking one. The checker catches the
  duplicate; it cannot tell you which is safe to move.
- The rollback is named after the migration it reverses, with `.down.sql`.

## 3. Reversibility

Every migration needs one of two things:

1. **A rollback file** that returns the database to the state before the migration ran. It
   must contain actual SQL — the checker rejects an empty or comment-only rollback, because a
   rollback that silently succeeds while doing nothing is worse than not having one. You will
   trust it exactly once, in the worst possible circumstances.

2. **An explicit declaration that it cannot be reversed**, as a comment in the migration:

   ```sql
   -- irreversible: drops the pre-migration phone column after backfill; the
   -- original values only exist in the Bubble export from here on.
   ```

   The reason is required. The point is not to make irreversibility hard, it is to make it a
   decision on the record rather than an omission nobody noticed.

**Reversing a security tightening is a special case: don't.** `0002`'s rollback deliberately
does not re-grant to `anon` what `0002` revoked. A down migration that widens access is the
last place anyone is looking for a policy regression. If those grants are ever needed again
it happens in a forward migration, with the authorization suite asserting the new state.

## 4. Rollback is not the first tool you reach for

A rollback is for a **failed deploy** — the migration applied, something is wrong, nothing has
written data under the new schema yet. It is not for undoing a change that has been live and
serving customers.

Once real rows exist under the new shape, the honest options are a **forward fix migration**
or a **restore from backup** (`E01-15`, `E01-17`). `0001`'s rollback drops every table in the
database; it exists so a botched first deploy into a fresh project can be cleaned up, and it
says so in its own header in capitals.

## 5. Immutability

**Never edit a migration that has been applied anywhere.** Not to fix a typo in a comment, not
to add a missing index. The applied database will not re-run it, so the file and the database
diverge silently and every environment created afterwards differs from the ones created
before.

Right now this rule is a convention, because no environment exists to have applied anything —
`0001` and `0002` have never been run. From the moment staging exists (`E01-04`) it becomes
checkable: `supabase migration list` prints local versions against the remote
`supabase_migrations.schema_migrations` table, and any local change to an already-applied
version is a discrepancy. Wire that into CI when staging lands.

## 6. Working on a migration

```bash
# new migration — pick the next free number
$EDITOR supabase/migrations/0003_add_bank_ledger_account.sql
$EDITOR supabase/down/0003_add_bank_ledger_account.down.sql

npm run check:migrations     # naming, sequence, reversibility
supabase db reset            # replays every migration from scratch into local Postgres
supabase test db             # the pgTAP authorization suite must still be green
```

`supabase db reset` replaying cleanly from `0001` is the closest thing to proof that the set is
coherent, and it is why the numbering must stay gapless.

### A Postgres constraint that has already bitten this schema

`ALTER TYPE ... ADD VALUE` cannot be *used* in the same transaction that adds it, and a
Supabase migration file is one transaction. So a new enum value lands in one migration and its
first use in the next — see `[PAY-05]` in `docs/open-questions.md`, where `bank` must be added
to `ledger_account_type` in `0003` and can only be referenced from `0004`.

## 7. What the checker enforces

| Code | Rule |
|---|---|
| `bad-name` | Filename is `NNNN_lower_snake_case.sql` / `.down.sql` |
| `duplicate-version` | No two migrations share a version |
| `version-gap` | Versions run consecutively from `0001` |
| `missing-down` | Every migration has a rollback or an `-- irreversible:` marker |
| `empty-down` | A rollback contains SQL, not just comments |
| `irreversible-without-reason` | The marker carries a reason |
| `irreversible-with-down` | A migration is not both irreversible and reversible |
| `orphan-down` | Every rollback belongs to a migration |

What it deliberately does **not** check: whether the rollback is *correct*. Nothing short of
applying it can tell you that, which is what `supabase db reset` and the restore drill
(`E01-17`) are for.
