import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isProtectedAccount, planGrants } from '../lib/grants.mjs';

const p = (code, scopes = ['platform'], sensitive = false) => ({ code, scopes, sensitive });

// ---------------------------------------------------------------------------------- the canary

test('the customer persona cannot be granted anything', () => {
  // The rail that matters. `authorization.test.sql` asserts this account holds zero grants, and
  // `docs/environments.md` explains why: it is the only thing proving parent RLS restricts. One
  // grant and both the proof and the test that guards it fail silently and simultaneously.
  assert.equal(isProtectedAccount('anuragdial+parent@gmail.com'), true);
});

test('the rail follows the +parent tag onto any inbox', () => {
  // `docs/environments.md` tells people to recreate the persona on an address they know receives.
  // A rail pinned to one literal address would not survive its own documentation.
  assert.equal(isProtectedAccount('someone.else+parent@example.org'), true);
  assert.equal(isProtectedAccount('QA+Parent@Example.COM'), true, 'case must not matter');
});

test('ordinary accounts are not caught by it', () => {
  // A rail that blocks real operators gets deleted, and takes the protection with it.
  for (const email of ['anuragdial@gmail.com', 'cook@graybag.com', 'parent@graybag.com']) {
    assert.equal(isProtectedAccount(email), false, email);
  }
});

test('a missing address is not accidentally protected', () => {
  // Falsy input must not read as "safe" — it means the caller has a bug, and the caller checks
  // for a missing email separately.
  assert.equal(isProtectedAccount(undefined), false);
  assert.equal(isProtectedAccount(null), false);
});

// ----------------------------------------------------------------------------------- the plan

test('granting reports only what is not already held', () => {
  const plan = planGrants([p('dish.edit'), p('menu.edit')], new Set(['dish.edit']), 'grant');
  assert.deepEqual(plan.changes.map((x) => x.code), ['menu.edit']);
  assert.deepEqual(plan.noop.map((x) => x.code), ['dish.edit']);
});

test('revoking reports only what is actually held', () => {
  // The mirror case, and the one that would otherwise print a confident list of revocations that
  // revoke nothing.
  const plan = planGrants([p('dish.edit'), p('menu.edit')], new Set(['dish.edit']), 'revoke');
  assert.deepEqual(plan.changes.map((x) => x.code), ['dish.edit']);
  assert.deepEqual(plan.noop.map((x) => x.code), ['menu.edit']);
});

test('a permission with no platform scope is skipped, not quietly narrowed', () => {
  // Every permission in the current catalogue allows platform scope, so this is a guard against a
  // future one that does not. Granting it at some other scope because platform was unavailable
  // would hand out reach nobody chose, and the run would report success.
  const plan = planGrants([p('local.only', ['school']), p('dish.edit')], new Set(), 'grant');
  assert.deepEqual(plan.skipped.map((x) => x.code), ['local.only']);
  assert.deepEqual(plan.changes.map((x) => x.code), ['dish.edit']);
});

test('re-running a completed grant changes nothing', () => {
  // Idempotence, because this script is documented as safe to re-run and somebody will.
  const all = [p('dish.edit'), p('menu.edit')];
  const plan = planGrants(all, new Set(['dish.edit', 'menu.edit']), 'grant');
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.noop.length, 2);
});
