#!/usr/bin/env node
/**
 * Seed the staging database with `supabase/seeds/staging-menu.sql`.
 *
 *     npm run db:seed:staging
 *
 * ## Why this exists rather than a one-line npm script
 *
 * `supabase db push --include-seed` has no flag for *which* seed file to use — it reads
 * `sql_paths` from `supabase/config.toml`, which is also what `supabase db reset` uses
 * locally. So seeding staging means pointing that list somewhere else for the duration of
 * one command.
 *
 * Doing that by hand is a footgun with a long fuse: leave the swap in place, and the next
 * `db reset` silently drops the six users and six children the pgTAP authorization suite
 * impersonates, and the suite fails somewhere that has nothing to do with the edit. So the
 * swap is made here, in a `try`/`finally`, and the original file is restored even if the
 * push fails or the process is interrupted.
 *
 * The restore is byte-for-byte from a copy taken before the edit, not a reverse edit, so a
 * config file that has drifted from what this script expects comes back exactly as it was.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'supabase', 'config.toml');
const SEED = './seeds/staging-menu.sql';

if (!existsSync(join(ROOT, 'supabase', 'seeds', 'staging-menu.sql'))) {
  console.error(`Cannot find supabase/seeds/staging-menu.sql. Nothing to seed.`);
  process.exit(1);
}

const original = readFileSync(CONFIG, 'utf8');

// Match the whole assignment rather than one known value, so this works regardless of what
// the list currently holds.
const SQL_PATHS = /^sql_paths\s*=\s*\[.*\]$/m;
if (!SQL_PATHS.test(original)) {
  console.error(
    'supabase/config.toml has no `sql_paths = [...]` line under [db.seed].\n' +
      'The CLI reads the seed file list from there, so this script cannot point it at the\n' +
      'staging seed. Add the line back, or seed by hand and say so in the commit.',
  );
  process.exit(1);
}

let restored = false;
const restore = () => {
  if (restored) return;
  writeFileSync(CONFIG, original);
  restored = true;
};

// Cover the paths a `finally` does not: Ctrl-C, and a kill that JS can observe.
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restore();
  process.exit(143);
});

try {
  writeFileSync(CONFIG, original.replace(SQL_PATHS, `sql_paths = ["${SEED}"]`));

  console.log(`Seeding the LINKED remote project from supabase/seeds/staging-menu.sql`);
  console.log('This file carries no users, no children and no orders — see its header.\n');

  // `supabase@latest` on purpose: 2.112.0 cannot parse the API's api-keys response and
  // fails every `link`. See docs/learnings.md, 2026-08-10.
  const result = spawnSync(
    'npx',
    ['-y', 'supabase@latest', 'db', 'push', '--linked', '--include-seed', '--yes'],
    { stdio: 'inherit', cwd: ROOT },
  );
  process.exitCode = result.status ?? 1;
} finally {
  restore();
  console.log('\nsupabase/config.toml restored.');
}
