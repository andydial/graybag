#!/usr/bin/env node
// Asserts the migration rules in docs/migrations.md. Runs in CI on every push.
//
//   node scripts/check-migrations.mjs

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMigrations } from './lib/check-migrations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = checkMigrations({
  upDir: join(ROOT, 'supabase', 'migrations'),
  downDir: join(ROOT, 'supabase', 'down'),
});

for (const { file, reason } of result.irreversible) {
  console.log(`  irreversible: ${file} — ${reason}`);
}

if (result.ok) {
  console.log(`check-migrations: ${result.checked} migration(s), all reversible or declared. OK`);
  process.exit(0);
}

console.error(`check-migrations: ${result.problems.length} problem(s) across ${result.checked} migration(s)\n`);
for (const { code, file, message } of result.problems) {
  console.error(`  [${code}] ${file}`);
  console.error(`      ${message}\n`);
}
console.error('See docs/migrations.md.');
process.exit(1);
