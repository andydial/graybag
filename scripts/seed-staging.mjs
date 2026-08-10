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
/**
 * Which seed file to apply. Defaults to the real catalogue (`E16-44`); the old synthetic
 * `staging-menu.sql` is still selectable by name for a from-scratch project that wants
 * obviously-fake schools.
 *
 *   node scripts/seed-staging.mjs                    # catalogue.sql — the real Sky Bites menu
 *   node scripts/seed-staging.mjs staging-menu.sql   # the synthetic fixture set
 */
const SEED_FILE = process.argv[2] ?? 'catalogue.sql';
const SEED = `./seeds/${SEED_FILE}`;

if (SEED_FILE.includes('/') || SEED_FILE.includes('..')) {
  console.error(`Seed file must be a bare name inside supabase/seeds/, not a path: ${SEED_FILE}`);
  process.exit(1);
}

if (!existsSync(join(ROOT, 'supabase', 'seeds', SEED_FILE))) {
  console.error(`Cannot find supabase/seeds/${SEED_FILE}. Nothing to seed.`);
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

  console.log(`Seeding the LINKED remote project from supabase/seeds/${SEED_FILE}`);
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
