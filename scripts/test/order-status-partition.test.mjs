/**
 * The three status sets must partition `order_status` exactly — `E11-17`.
 *
 *   node --test scripts/test/order-status-partition.test.mjs
 *
 * ## What this protects
 *
 * `admin-reports.ts` sorts every order status into one of three sets:
 *
 * ```
 * EARNED    paid, preparing, delivered      money we have
 * IN_FLIGHT draft, pending_payment          placed, not paid
 * LOST      cancelled, refunded             counted, never revenue
 * ```
 *
 * Three screens then compute the paid-order count as **`orders - cancelled - pending`** rather
 * than by counting `EARNED` directly. That subtraction is correct only while the three sets cover
 * the enum with no gaps and no overlaps. It is an invariant nobody would think to check, and it is
 * invisible in the diff that breaks it: adding one value to `order_status` in a migration — a
 * `payment_failed`, an `expired` — makes every one of those screens report a paid-order count that
 * is too high by exactly the number of orders in the new state.
 *
 * It would also fire the self-contradiction guard `E11-17` added to `/reports`, which compares the
 * subtraction against a direct `EARNED` count and tells the reader the numbers disagree. That
 * guard is a good backstop and a bad diagnosis: it names truncation, which would be the wrong
 * cause. Better to fail here, in the pull request that adds the status, and say so precisely.
 *
 * ## Read from the source, not restated
 *
 * Both halves are parsed out of the files that define them — the enum from the migration, the sets
 * from the module. A test that hardcodes its own copy of either list passes forever after the
 * thing it guards has changed, which is the failure mode this repo has already been bitten by
 * twice (`E15-23`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const at = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const SCHEMA = at('supabase/migrations/0001_initial_schema.sql');
const REPORTS = at('packages/shared/src/api/admin-reports.ts');

/** `create type order_status as enum ('draft', …);` → the values. */
function enumValues() {
  const sql = readFileSync(SCHEMA, 'utf8');
  const match = /create type order_status\s+as enum \(([^)]*)\)/.exec(sql);
  assert.ok(match, 'could not find the order_status enum — this test is no longer guarding');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** `const EARNED = new Set(['paid', …]);` → the members. */
function setMembers(name) {
  const ts = readFileSync(REPORTS, 'utf8');
  const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`).exec(ts);
  assert.ok(match, `could not find ${name} in admin-reports.ts — this test is no longer guarding`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('every order status is in exactly one of the three sets', () => {
  const statuses = enumValues();
  assert.ok(statuses.length >= 7, `only found ${statuses.length} statuses; the parse is wrong`);

  const sets = {
    EARNED: setMembers('EARNED'),
    IN_FLIGHT: setMembers('IN_FLIGHT'),
    LOST: setMembers('LOST'),
  };
  const all = [...sets.EARNED, ...sets.IN_FLIGHT, ...sets.LOST];

  const uncovered = statuses.filter((s) => !all.includes(s));
  assert.deepEqual(
    uncovered, [],
    `order_status has ${uncovered.length} value(s) in no set: ${uncovered.join(', ')}.\n` +
      `      Three screens compute paid orders as \`orders - cancelled - pending\`, which counts ` +
      `these as paid.\n      Add each to EARNED, IN_FLIGHT or LOST in packages/shared/src/api/` +
      `admin-reports.ts.`,
  );

  const duplicated = all.filter((s, i) => all.indexOf(s) !== i);
  assert.deepEqual(
    duplicated, [],
    `these statuses are in more than one set and would be counted twice: ${duplicated.join(', ')}`,
  );

  const invented = all.filter((s) => !statuses.includes(s));
  assert.deepEqual(
    invented, [],
    `these are classified but are not order_status values: ${invented.join(', ')}. ` +
      `Either the enum dropped them or the set has a typo, and a typo here silently moves ` +
      `orders out of revenue.`,
  );
});
