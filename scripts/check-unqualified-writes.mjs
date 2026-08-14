#!/usr/bin/env node
/**
 * No `DELETE` or `UPDATE` without a `WHERE`, anywhere in a migration.
 *
 *   node scripts/check-unqualified-writes.mjs
 *
 * # Why this exists
 *
 * **Hosted Supabase loads `safeupdate`. A local `supabase start` does not.** So an unqualified
 * write passes every pgTAP assertion, on every run, and raises `21000: DELETE requires a WHERE
 * clause` for every real request through PostgREST or an Edge Function.
 *
 * That has now happened twice:
 *
 *   * `E05-21` / `0019` — `create_checkout` clearing `tmp_checkout_lines`. Every order failed.
 *   * `E06-38` / `0051` — `post_ledger_transaction` clearing `tmp_posting`. **Every settlement
 *     failed**, so a captured payment never became a paid order and a parent's money sat with
 *     the provider while the app showed "still confirming".
 *
 * The second one took a day to find, was reported by Andy from a log line he read by hand, and
 * was invisible to a test suite that was green throughout. The class is named in `0019`: **a
 * check that exists only in the deployed environment.** The fix for the class is not another
 * pgTAP test — pgTAP runs where the guard is absent — it is this, a static check that runs
 * everywhere.
 *
 * # What it looks at, and what it deliberately does not
 *
 * Only `supabase/migrations/`. It matches a `delete from` or `update` statement up to its
 * terminating semicolon and fails when that span has no `where`.
 *
 * Two shapes are excluded because they are not bare writes and flagging them would make the
 * check something people switch off:
 *
 *   * **`on conflict … do update set`** — the conflict target *is* the qualification.
 *   * **`update` inside a comment**, which is how `assert_order_status_transition` reads.
 *
 * A `truncate` is not matched. It is a different statement, `safeupdate` permits it, and it is a
 * legitimate way to clear a temp table.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** Strip `--` line comments and `/* *\/` blocks, so prose cannot trip or hide a match. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      // A `--` inside a string literal is not a comment. Rare in these files; handled by only
      // cutting when the marker is outside an odd number of quotes.
      const idx = line.indexOf('--');
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      const quotes = (before.match(/'/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}

/**
 * Occurrences that are already fixed by a later migration.
 *
 * **Migrations are immutable history**, so the offending line stays on disk for ever even after a
 * `create or replace` supersedes it. Each entry names the migration that fixed it, so this list
 * is a record of the two times this happened rather than a way of silencing the check — and
 * anything not on it fails.
 *
 * Keyed by `file:statement`, not by file, so a *second* unqualified write added to one of these
 * same migrations would still be caught.
 */
const SUPERSEDED = new Map([
  ['0014_create_checkout.sql:delete from tmp_checkout_lines;', 'fixed by 0019 (E05-21)'],
  ['0038_ledger_posting.sql:delete from tmp_posting;', 'fixed by 0051 (E06-38)'],
]);

const failures = [];

for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
  const sql = stripComments(raw);

  // **An UPDATE statement always has SET**, and requiring it is what separates a write from a
  // trigger definition — `create trigger … after insert or update on "order"` is not a write and
  // there are seventy of them in `0001`. A first version without this reported 60+ false
  // positives, which is a check nobody would keep.
  //
  // `on conflict … do update set` is excluded for free: there is no table name between `update`
  // and `set`, so the pattern does not match it at all.
  const STATEMENTS = /\b(delete\s+from\s+("?[a-z_][a-z0-9_."]*)|update\s+("?[a-z_][a-z0-9_."]*)\s+set\b)([\s\S]*?);/gi;

  for (const match of sql.matchAll(STATEMENTS)) {
    const statement = match[0];
    const verb = match[1].toLowerCase().startsWith('delete') ? 'DELETE' : 'UPDATE';

    if (/\bwhere\b/i.test(statement)) continue;

    const normalised = statement.replace(/\s+/g, ' ').trim();
    if (SUPERSEDED.has(`${file}:${normalised}`)) continue;

    const line = raw.slice(0, raw.indexOf(statement.split('\n')[0])).split('\n').length;
    failures.push({
      file,
      line,
      verb,
      snippet: statement.replace(/\s+/g, ' ').slice(0, 120),
    });
  }
}

if (failures.length > 0) {
  console.error('\ncheck-unqualified-writes: FAIL\n');
  for (const f of failures) {
    console.error(`  supabase/migrations/${f.file}:${f.line} — ${f.verb} with no WHERE`);
    console.error(`    ${f.snippet}\n`);
  }
  console.error('  Hosted Supabase loads `safeupdate` and rejects these with `21000`. A local');
  console.error('  `supabase start` does not, so pgTAP will stay green while every real request');
  console.error('  fails. Add `where true` — the precedent is `0019` — or use `truncate` for a');
  console.error('  temp table. Background: E05-21, and E06-38 which cost a day of settlements.\n');
  process.exit(1);
}

console.log(
  `check-unqualified-writes: ok — every DELETE and UPDATE in ${readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length} migration(s) is qualified`,
);
