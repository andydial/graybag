import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNotProductionWrite,
  isProduction,
  projectRef,
  PRODUCTION_REF,
  STAGING_REF,
} from '../lib/prod-write-guard.mjs';

const PROD = `https://${PRODUCTION_REF}.supabase.co`;
const STAGING = `https://${STAGING_REF}.supabase.co`;

/** Run `fn` with `GRAYBAG_PROD_WRITE` set to `value`, restoring it afterwards. */
function withOverride(value, fn) {
  const before = process.env.GRAYBAG_PROD_WRITE;
  if (value === undefined) delete process.env.GRAYBAG_PROD_WRITE;
  else process.env.GRAYBAG_PROD_WRITE = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.GRAYBAG_PROD_WRITE;
    else process.env.GRAYBAG_PROD_WRITE = before;
  }
}

test('a staging or local target is never blocked', () => {
  withOverride(undefined, () => {
    assertNotProductionWrite(STAGING, 'a recipient');
    assertNotProductionWrite('http://127.0.0.1:54321', 'a recipient');
    assertNotProductionWrite('', 'a recipient');
    assertNotProductionWrite(undefined, 'a recipient');
  });
});

test('production is refused by default', () => {
  withOverride(undefined, () => {
    assert.throws(
      () => assertNotProductionWrite(PROD, 'a recipient and an order'),
      /Refusing to write to PRODUCTION/,
    );
  });
});

test('the refusal says what it would have written, so the log is useful', () => {
  withOverride(undefined, () => {
    assert.throws(
      () => assertNotProductionWrite(PROD, 'a recipient and an order'),
      /would {2}: a recipient and an order/,
    );
  });
});

test('a trivial override is refused — the hatch must cost a sentence', () => {
  // The failure mode this prevents: `GRAYBAG_PROD_WRITE=1` in a shell profile, set once during
  // a legitimate approved run, forgotten, and thereafter disabling the guard permanently.
  for (const trivial of ['1', 'true', 'yes', 'Y', 'ok', 'go']) {
    withOverride(trivial, () => {
      assert.throws(
        () => assertNotProductionWrite(PROD, 'a recipient'),
        /not a sentence anybody can be held to/,
        `"${trivial}" should not open the guard`,
      );
    });
  }
});

test('a short override is refused and says how short it was', () => {
  withOverride('Andy said ok', () => {
    assert.throws(() => assertNotProductionWrite(PROD, 'a recipient'), /only 12 characters/);
  });
});

test('a real approval passes, and is echoed so the terminal records it', () => {
  const reason = 'Andy approved 2026-08-19: one live payment to prove settlement';
  const written = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    withOverride(reason, () => {
      assertNotProductionWrite(PROD, 'one order and one payment');
    });
  } finally {
    process.stderr.write = original;
  }

  const output = written.join('');
  assert.match(output, /WRITING TO PRODUCTION/);
  assert.match(output, /one order and one payment/);
  assert.match(output, /Andy approved 2026-08-19/);
});

test('projectRef only recognises a real Supabase host', () => {
  assert.equal(projectRef(PROD), PRODUCTION_REF);
  assert.equal(projectRef(`https://${PRODUCTION_REF}.supabase.co/rest/v1/order`), PRODUCTION_REF);
  assert.equal(projectRef('https://example.com'), null);
  assert.equal(projectRef('postgresql://postgres:pw@localhost:5432/postgres'), null);
  assert.equal(projectRef(null), null);
});

test('production and staging are not confused', () => {
  assert.equal(isProduction(PROD), true);
  assert.equal(isProduction(STAGING), false);
  assert.notEqual(PRODUCTION_REF, STAGING_REF);
});

test('a pooler URI is recognised too — most writing scripts use psql, not REST', () => {
  const pooler = `postgresql://postgres.${PRODUCTION_REF}:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
  assert.equal(projectRef(pooler), PRODUCTION_REF);
  assert.equal(isProduction(pooler), true);
  withOverride(undefined, () => {
    assert.throws(() => assertNotProductionWrite(pooler, 'an order'), /Refusing to write/);
  });
  const stagingPooler = `postgresql://postgres.${STAGING_REF}:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
  assert.equal(isProduction(stagingPooler), false);
});
