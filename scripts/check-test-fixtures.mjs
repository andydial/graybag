#!/usr/bin/env node
// Asserts that pgTAP fixture UUIDs and supabase/seed.sql UUIDs are disjoint.
//
//   node scripts/check-test-fixtures.mjs
//
// WHY THIS EXISTS (E02-24)
//
// `supabase db reset` applies seed.sql and THEN runs the suites. Both used the same
// readable UUID prefixes — a0 = user, d1 = order, e1 = … — so seventeen ids collided.
// The first fixture insert died on `duplicate key value violates unique constraint
// "users_pkey"`, pg_prove reported `Tests: 0`, and the authorization suite — the one
// thing standing between us and the legacy app's public order table — did not run at
// all. A suite that reports zero tests is not a passing suite; it is silence.
//
// This check is static and takes milliseconds, so it runs in the smoke test rather
// than waiting for the 3-minute integration job to notice.
//
// THE RULE
//
//   Every UUID a test file INSERTS carries 7e57 ("test") in its second group.
//   No UUID in seed.sql may.
//
// seed.test.sql is exempt: its whole job is asserting seed.sql's contents, so it
// must name the very ids everything else has to avoid.
//
// UUIDS ARE NOT THE WHOLE STORY
//
// Namespacing the ids got the suite from line 147 to line 183, where it died on
// `city_code_key` — code = 'sas_nagar'. Primary keys were never the only uniqueness
// in the schema; there are ~40 unique constraints on natural keys, and seed.sql and
// the fixtures were picking the same slugs and the same phone numbers.
//
// So this also checks phone numbers, emails and slug-shaped codes. Values that are
// legitimately shared — status enums, given names, and composite keys whose parent
// id differs — are allowlisted below with the reason, because the alternative is a
// check nobody can keep green.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = join(ROOT, 'supabase', 'tests');
const SEED = join(ROOT, 'supabase', 'seed.sql');

// Files that legitimately reference seed data instead of creating their own.
const ASSERTS_THE_SEED = new Set(['seed.test.sql']);

const MARKER = '7e57';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const PHONE = /\+[1-9][0-9]{7,14}/g;
const EMAIL = /'[^']*@[^']*'/g;
// Slug-shaped literals — the schema's `code text not null unique` columns.
const SLUG = /'([a-z][a-z0-9_]{2,40})'/g;

// Values that appear in both seed.sql and the fixtures and are SAFE to share.
// Each needs a reason, so that adding to this list is a decision rather than a
// way of silencing the check.
const SHARED_ON_PURPOSE = new Map([
  // Status / enum / role values. Not unique columns at all.
  ['active', 'status enum'],
  ['authenticated', 'postgres role name'],
  ['draft', 'status enum'],
  ['father', 'guardian relationship enum'],
  ['mother', 'guardian relationship enum'],
  ['guardian', 'guardian relationship enum'],
  ['school', 'scope_type enum'],
  ['counter', 'delivery mode enum'],
  // Composite uniques whose OTHER column already differs between seed and tests.
  ['break_1', 'break_time is unique on (school_id, code); the school ids differ'],
]);

const readText = (path) => readFileSync(path, 'utf8');
const uuidsIn = (path) => new Set(readText(path).match(UUID) ?? []);
const phonesIn = (path) => new Set(readText(path).match(PHONE) ?? []);
const emailsIn = (path) => new Set(readText(path).match(EMAIL) ?? []);
const slugsIn = (path) =>
  new Set([...readText(path).matchAll(SLUG)].map((m) => m[1]).filter((s) => !SHARED_ON_PURPOSE.has(s)));
const secondGroup = (uuid) => uuid.split('-')[1];

const failures = [];

const seedUuids = uuidsIn(SEED);

// 1. seed.sql must not squat on the test marker.
const seedUsingMarker = [...seedUuids].filter((u) => secondGroup(u) === MARKER);
if (seedUsingMarker.length > 0) {
  failures.push(
    `supabase/seed.sql uses the ${MARKER} test marker on ${seedUsingMarker.length} id(s):\n` +
      seedUsingMarker.map((u) => `    ${u}`).join('\n') +
      `\n  The marker belongs to test fixtures. Renumber these in seed.sql.`,
  );
}

const testFiles = readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.sql'))
  .filter((f) => !ASSERTS_THE_SEED.has(f))
  .sort();

if (testFiles.length === 0) {
  failures.push(`No .test.sql files found in supabase/tests — has the suite moved?`);
}

for (const file of testFiles) {
  const found = uuidsIn(join(TESTS, file));

  // 2. Every fixture id must carry the marker.
  const unmarked = [...found].filter((u) => secondGroup(u) !== MARKER);
  if (unmarked.length > 0) {
    failures.push(
      `supabase/tests/${file} has ${unmarked.length} fixture id(s) without the ${MARKER} marker:\n` +
        unmarked.map((u) => `    ${u}`).join('\n') +
        `\n  Put ${MARKER} in the second group, e.g. a0000000-${MARKER}-0000-0000-000000000001`,
    );
  }

  // 3. Belt and braces — the actual property we care about is disjointness.
  const collisions = [...found].filter((u) => seedUuids.has(u));
  if (collisions.length > 0) {
    failures.push(
      `supabase/tests/${file} shares ${collisions.length} UUID(s) with seed.sql:\n` +
        collisions.map((u) => `    ${u}`).join('\n') +
        `\n  db reset seeds first, so these die on a duplicate key and the suite reports Tests: 0.`,
    );
  }

  // 4. Natural keys. ~40 unique constraints in 0001 are on these, not on the pk.
  const naturalKeys = [
    ['phone number', phonesIn(join(TESTS, file)), phonesIn(SEED), 'uq_app_user_phone'],
    ['email', emailsIn(join(TESTS, file)), emailsIn(SEED), 'uq_app_user_email'],
    ['slug/code', slugsIn(join(TESTS, file)), slugsIn(SEED), 'the `code text not null unique` columns'],
  ];

  for (const [label, mine, seeded, constraint] of naturalKeys) {
    const shared = [...mine].filter((v) => seeded.has(v));
    if (shared.length > 0) {
      failures.push(
        `supabase/tests/${file} shares ${shared.length} ${label}(s) with seed.sql:\n` +
          shared.map((v) => `    ${v}`).join('\n') +
          `\n  These collide on ${constraint}. Give the fixture its own value, or — if the\n` +
          `  value is genuinely safe to share — add it to SHARED_ON_PURPOSE with the reason.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('\ncheck-test-fixtures: FAIL\n');
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(
    '  Background: docs/learnings.md, "the authorization suite never runs from a clean\n' +
      '  database". A colliding fixture does not fail one test — it skips the whole file.\n',
  );
  process.exit(1);
}

const checked = testFiles.map((f) => basename(f)).join(', ');
console.log(
  `check-test-fixtures: ok — ${seedUuids.size} seed ids disjoint from fixtures in ${checked}` +
    (ASSERTS_THE_SEED.size ? ` (${[...ASSERTS_THE_SEED].join(', ')} exempt)` : ''),
);
