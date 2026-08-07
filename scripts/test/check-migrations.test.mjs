import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkMigrations } from '../lib/check-migrations.mjs';

/**
 * Build a throwaway pair of directories.
 *   up:   { '0001_initial.sql': 'body', ... }
 *   down: { '0001_initial.down.sql': 'body', ... }
 */
function fixture(up = {}, down = {}) {
  const root = mkdtempSync(join(tmpdir(), 'graybag-migrations-'));
  const upDir = join(root, 'migrations');
  const downDir = join(root, 'down');
  mkdirSync(upDir);
  mkdirSync(downDir);
  for (const [name, body] of Object.entries(up)) writeFileSync(join(upDir, name), body);
  for (const [name, body] of Object.entries(down)) writeFileSync(join(downDir, name), body);
  return { root, upDir, downDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Run the checker over a fixture and return its result. */
function check(up, down) {
  const f = fixture(up, down);
  try {
    return checkMigrations({ upDir: f.upDir, downDir: f.downDir });
  } finally {
    f.cleanup();
  }
}

/** Assert that exactly the expected rule codes fired. */
function codes(result) {
  return result.problems.map((p) => p.code).sort();
}

test('a well-formed pair passes', () => {
  const r = check(
    { '0001_initial.sql': 'create table a();', '0002_policies.sql': 'create policy p on a;' },
    { '0001_initial.down.sql': 'drop table a;', '0002_policies.down.sql': 'drop policy p on a;' },
  );
  assert.equal(r.ok, true, JSON.stringify(r.problems, null, 2));
  assert.deepEqual(r.problems, []);
  assert.equal(r.checked, 2);
});

test('an empty migrations directory passes rather than crashing', () => {
  const r = check({}, {});
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

test('a migration with no down file fails', () => {
  const r = check({ '0001_initial.sql': 'create table a();' }, {});
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['missing-down']);
  assert.match(r.problems[0].message, /0001_initial\.down\.sql/);
});

test('a migration may declare itself irreversible, with a reason', () => {
  const r = check(
    { '0001_purge.sql': '-- irreversible: drops rows that cannot be reconstructed\ndelete from a;' },
    {},
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.irreversible.length, 1);
  assert.equal(r.irreversible[0].reason, 'drops rows that cannot be reconstructed');
});

test('an irreversible marker with no reason is rejected', () => {
  const r = check({ '0001_purge.sql': '-- irreversible:\ndelete from a;' }, {});
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['irreversible-without-reason']);
});

test('an irreversible migration must not also ship a down file', () => {
  const r = check(
    { '0001_purge.sql': '-- irreversible: no way back\ndelete from a;' },
    { '0001_purge.down.sql': 'insert into a values (1);' },
  );
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['irreversible-with-down']);
});

test('a down file with no corresponding migration fails', () => {
  const r = check({ '0001_initial.sql': 'x' }, {
    '0001_initial.down.sql': 'y',
    '0009_ghost.down.sql': 'z',
  });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['orphan-down']);
});

test('a badly named migration fails', () => {
  for (const bad of ['1_initial.sql', '0001-initial.sql', '0001_Initial.sql', 'initial.sql', '00001_x.sql']) {
    const r = check({ [bad]: 'x' }, {});
    assert.equal(r.ok, false, `expected ${bad} to be rejected`);
    assert.ok(codes(r).includes('bad-name'), `expected bad-name for ${bad}, got ${codes(r)}`);
  }
});

test('version numbers must not repeat', () => {
  const r = check(
    { '0001_a.sql': 'x', '0001_b.sql': 'y' },
    { '0001_a.down.sql': 'x', '0001_b.down.sql': 'y' },
  );
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('duplicate-version'));
});

test('version numbers must start at 0001 and not skip', () => {
  const gap = check(
    { '0001_a.sql': 'x', '0003_c.sql': 'y' },
    { '0001_a.down.sql': 'x', '0003_c.down.sql': 'y' },
  );
  assert.equal(gap.ok, false);
  assert.ok(codes(gap).includes('version-gap'));

  const late = check({ '0002_a.sql': 'x' }, { '0002_a.down.sql': 'x' });
  assert.equal(late.ok, false);
  assert.ok(codes(late).includes('version-gap'));
});

test('a down file whose slug does not match its migration fails', () => {
  const r = check({ '0001_initial.sql': 'x' }, { '0001_renamed.down.sql': 'y' });
  assert.equal(r.ok, false);
  // The migration has no down of its own name, and the down belongs to nothing.
  assert.deepEqual(codes(r), ['missing-down', 'orphan-down']);
});

test('an empty down file fails — a rollback that does nothing is worse than none', () => {
  const r = check({ '0001_initial.sql': 'create table a();' }, { '0001_initial.down.sql': '  \n\n' });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['empty-down']);
});

test('a down file that is only comments fails for the same reason', () => {
  const r = check({ '0001_initial.sql': 'create table a();' }, {
    '0001_initial.down.sql': '-- TODO: write this\n-- really, do it\n',
  });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['empty-down']);
});

test('non-.sql files in either directory are ignored', () => {
  const r = check(
    { '0001_initial.sql': 'x', '.gitkeep': '', 'README.md': '# notes' },
    { '0001_initial.down.sql': 'y', '.gitkeep': '' },
  );
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test('the real repository passes its own checker', async () => {
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = checkMigrations({
    upDir: join(root, 'supabase', 'migrations'),
    downDir: join(root, 'supabase', 'down'),
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems, null, 2));
  assert.ok(r.checked >= 2, `expected at least the two committed migrations, got ${r.checked}`);
});
