import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { findDisagreements, parseTask } from '../check-mvp.mjs';

describe('parseTask', () => {
  test('reads an untagged task', () => {
    const t = parseTask('- [ ] `E04-11` Read-only offline: cached menu browsable with no network');
    assert.equal(t.id, 'E04-11');
    assert.deepEqual(t.markers, []);
    assert.equal(t.isMvp, false);
  });

  test('reads a tagged task', () => {
    const t = parseTask('- [ ] `E04-12` (mvp) Category browse tabs plus search');
    assert.equal(t.isMvp, true);
    assert.deepEqual(t.markers, ['(mvp)']);
  });

  test('reads markers in any order', () => {
    assert.equal(parseTask('- [ ] `E09-11` (owner:andy) (risk:high) (mvp) Decide').isMvp, true);
    assert.equal(parseTask('- [ ] `E09-11` (mvp) (owner:andy) (risk:high) Decide').isMvp, true);
  });

  test('reads a completed task', () => {
    assert.equal(parseTask('- [x] `E12-01` (mvp) Home page rebuilt').isMvp, true);
  });

  test('**does not** treat "(mvp)" inside a description as a marker', () => {
    // This is the regression that mattered. `E01-25` is a task *about* the mvp marker, so its
    // description contains the literal string. A whole-line search reports it as tagged and the
    // reconciliation then chases a disagreement that does not exist — which is exactly what
    // happened with a one-line `.includes('(mvp)')` check while this was being written.
    const t = parseTask(
      '- [ ] `E01-25` (risk:medium) Four tasks carry `(mvp)` in the markdown but are absent from the list',
    );
    assert.equal(t.isMvp, false);
    assert.deepEqual(t.markers, ['(risk:medium)']);
  });

  test('ignores lines that are not tasks', () => {
    assert.equal(parseTask('## Tasks'), null);
    assert.equal(parseTask('Some prose mentioning `E04-01` in passing.'), null);
    assert.equal(parseTask(''), null);
  });
});

describe('findDisagreements', () => {
  const tasks = [
    { id: 'E01-01', isMvp: true, file: 'E01.md', line: 3 },
    { id: 'E01-02', isMvp: false, file: 'E01.md', line: 4 },
    { id: 'E01-03', isMvp: true, file: 'E01.md', line: 5 },
  ];

  test('finds nothing when both sides agree', () => {
    const d = findDisagreements(tasks, new Set(['E01-01', 'E01-03']));
    assert.deepEqual(d.taggedNotListed, []);
    assert.deepEqual(d.listedNotTagged, []);
    assert.deepEqual(d.listedNotFound, []);
  });

  test('catches a task tagged in markdown but missing from the list', () => {
    // The dangerous direction: the old rewriting script would have stripped this task from v1.
    const d = findDisagreements(tasks, new Set(['E01-01']));
    assert.deepEqual(d.taggedNotListed.map((t) => t.id), ['E01-03']);
  });

  test('catches an id in the list that the markdown has not marked', () => {
    const d = findDisagreements(tasks, new Set(['E01-01', 'E01-02', 'E01-03']));
    assert.deepEqual(d.listedNotTagged.map((t) => t.id), ['E01-02']);
  });

  test('catches an id in the list with no task behind it', () => {
    const d = findDisagreements(tasks, new Set(['E01-01', 'E01-03', 'E01-99']));
    assert.deepEqual(d.listedNotFound, ['E01-99']);
  });

  test('reports where a disagreement lives, because naming one side is not enough', () => {
    const d = findDisagreements(tasks, new Set(['E01-01']));
    assert.equal(d.taggedNotListed[0].file, 'E01.md');
    assert.equal(d.taggedNotListed[0].line, 5);
  });
});

describe('the real backlog', () => {
  test('agrees with the real include list', async () => {
    // The check itself, run against the repository. This is what fails CI when someone tags a
    // task in markdown without adding the id, or adds an id for a task that does not exist.
    const { MVP, readBacklog } = await import('../check-mvp.mjs');
    const { fileURLToPath } = await import('node:url');
    const { join, dirname } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

    const d = findDisagreements(readBacklog(join(root, 'planning', 'backlog')), MVP);
    assert.deepEqual(
      { tagged: d.taggedNotListed.map((t) => t.id), listed: d.listedNotTagged.map((t) => t.id), missing: d.listedNotFound },
      { tagged: [], listed: [], missing: [] },
    );
  });
});
