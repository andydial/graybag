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
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// Files that legitimately reference seed data instead of creating their own.
const ASSERTS_THE_SEED = new Set(['seed.test.sql']);

const MARKER = '7e57';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const PHONE = /\+[1-9][0-9]{7,14}/g;
const EMAIL = /'[^']*@[^']*'/g;
// Slug-shaped literals — the schema's `code text not null unique` columns.
//
// **Colons are in the character class deliberately.** Ledger account codes look like
// `provider:razorpay:clearing`, and without the colon this pattern matched none of them — which
// is how `0035` seeding the chart of accounts silently collided with the fixtures in
// `ledger.test.sql` and `authorization.test.sql` and took both files down on the next clean
// reset. Two suites, including the authorization one, reporting an error and no `not ok`.
const SLUG = /'([a-z][a-z0-9_:.]{2,60})'/g;

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
  // The same enum as `guardian` beside it — `E05-38` asserts an adult's link says `self`
  // rather than `guardian`. A relationship value, not a code on a unique column.
  ['self', 'guardian relationship enum'],
  // `E09-33` looks these up rather than inserting them — `select id from allergen where code =
  // 'milk'`. Referencing the seeded taxonomy is the point: the kitchen badge renders the real
  // enumerated code, and a fixture inventing its own would prove the badge against a vocabulary
  // that does not ship.
  ['milk', 'allergen code, read from the seeded taxonomy and never inserted by a test'],
  ['tree_nut', 'allergen code, read from the seeded taxonomy and never inserted by a test'],
  ['school', 'scope_type enum'],
  // `E10-21`. `food_type` is an enum — `create type food_type as enum ('veg','non_veg','egg')` —
  // so these are literals, not codes on a unique column, and two fixtures naming `veg` collide
  // with nothing. They appear in tests because `0059` refuses an unmarked dish on an active menu,
  // so any fixture that puts a dish on a menu now has to say what the dish is.
  ['veg', 'food_type enum'],
  ['non_veg', 'food_type enum'],
  ['egg', 'food_type enum'],
  ['counter', 'delivery mode enum'],
  // Composite uniques whose OTHER column already differs between seed and tests.
  ['break_1', 'break_time is unique on (school_id, code); the school ids differ'],
]);

const readText = (path) => readFileSync(path, 'utf8');

/**
 * **Namespaced** codes seeded by a migration — `provider:razorpay:clearing`, `platform:revenue`,
 * `platform:tax_payable:cgst`.
 *
 * ## Why colons, and only colons
 *
 * Migrations seed data as well as defining schema — `0013` the reason codes, `0029` the break
 * windows, `0035` the chart of accounts — and this check only ever compared fixtures against
 * `supabase/seed.sql`. So when `0035` seeded `provider:razorpay:clearing`, the fixtures in
 * `ledger.test.sql` and `authorization.test.sql` that already used that code collided on
 * `ledger_account_code_key`, and **both files died on the next clean reset** — including the
 * authorization suite, with an error and not one `not ok`. Exactly the `E02-24` failure this
 * script exists to prevent, one source of truth along.
 *
 * The obvious generalisation — every slug a migration inserts — is **wrong, and was tried**: an
 * insert also carries enum values and foreign keys (`'debit'`, `'platform'`,
 * `'migration_opening_balance'`), and flagging those produced 31 false positives on one file.
 * Telling a `code` column's value from a `reason_code` foreign key needs the insert's column
 * list parsed, which is a real piece of work and is `E02-25`.
 *
 * A colon is the cheap, precise signal in the meantime: every namespaced code in this schema has
 * one, and no enum value, permission slug or status does. It closes the hole that actually bit
 * without a rule nobody can keep green.
 *
 * Memoised: it reads every migration, and it is called once per test file.
 */
/** Slug-shaped literals inside this file's own `insert` statements. See the use site. */
const slugsInserted = (path) => {
  const sql = readText(path);
  const found = new Set();
  for (const m of sql.matchAll(/\binsert\s+into\b[\s\S]*?;/gi)) {
    for (const slug of m[0].matchAll(SLUG)) {
      if (!SHARED_ON_PURPOSE.has(slug[1])) found.add(slug[1]);
    }
  }
  return found;
};

let migrationSlugCache = null;
function migrationSeededSlugs() {
  if (migrationSlugCache !== null) return migrationSlugCache;

  const found = new Set();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = readText(join(MIGRATIONS, file));
    // Each `insert` up to its terminating semicolon. Crude, and right for this shape of file:
    // a semicolon inside a dollar-quoted policy document belongs to a statement that is not an
    // insert of a code.
    for (const m of sql.matchAll(/\binsert\s+into\b[\s\S]*?;/gi)) {
      for (const slug of m[0].matchAll(SLUG)) {
        if (slug[1].includes(':') && !SHARED_ON_PURPOSE.has(slug[1])) found.add(slug[1]);
      }
    }
  }
  migrationSlugCache = found;
  return found;
}
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
    // **Migrations seed data too**, and for a long time this check did not look at them.
    // `0013` seeds reason codes, `0035` seeds the chart of accounts, `0029` seeds break
    // windows — all on unique natural keys, all applied before any suite runs, and all
    // invisible here until a fixture collided with one. Only literals inside an `insert`
    // are considered; every other string in a migration is DDL, not data.
    // **Only what the test INSERTS**, not everything it mentions. A suite that asserts
    // `self_meal_service` exists, or cites `migration_opening_balance` as a reason code, is
    // *referencing* seeded data — which is correct and must stay possible. A duplicate key can
    // only come from an insert, so that is what is compared.
    ['slug/code', slugsInserted(join(TESTS, file)), migrationSeededSlugs(), 'a namespaced code seeded by a migration'],
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
