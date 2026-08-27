/**
 * Nothing may run after `check-build.mjs` reports — `E10-63`.
 *
 *   node --test scripts/test/check-build-order.test.mjs
 *
 * ## Why this test exists
 *
 * `check-build.mjs` collects failures into `problems`, prints them, and exits. A check written
 * **below** that block records its failures into an array that has already been printed, so it can
 * never fail the build. It looks exactly like a working check: it is in the file, it is written
 * correctly, and it is dead.
 *
 * This project has now done that **twice**:
 *
 * | | |
 * |---|---|
 * | `E12-36` | the inline-script guard, placed after `process.exit(1)` |
 * | `E10-63` | the back-office stylesheet guard, same place, same way |
 *
 * The second time is what makes it worth a test rather than a comment. Both were caught only
 * because somebody deliberately broke the thing being guarded and noticed nothing happened —
 * which is a habit, not a mechanism.
 *
 * ## What it checks
 *
 * That the report block is last. Not that any particular check exists, and not what any of them
 * do: only that the file's structure cannot silently swallow one.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../../apps/web/scripts/check-build.mjs', import.meta.url));

test('the report block is the last executable code in check-build.mjs', () => {
  const source = readFileSync(SCRIPT, 'utf8');

  const marker = source.indexOf('if (problems.length) {');
  assert.ok(
    marker > 0,
    'could not find the report block — this test is no longer guarding what it thinks it is',
  );

  const after = source.slice(source.indexOf('}', source.indexOf('process.exit(1);', marker)) + 1);

  /*
   * Comments and blank lines are fine after the report; a statement is not. Anything that runs
   * there records into `problems` after `problems` has been printed, which is a check that cannot
   * fail — the failure mode this whole file exists for.
   */
  const executable = after
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('*') &&
      !line.startsWith('/*') && !line.startsWith('*/'));

  assert.deepEqual(
    executable, [],
    'Something runs after check-build.mjs reports and exits. Its failures land in an array that\n' +
      '      has already been printed, so that check can never fail the build — it only looks like\n' +
      '      it can. Move it above the `// ---- report` divider.\n' +
      `      Found: ${executable.slice(0, 3).join(' | ')}`,
  );
});

test('the back-office stylesheet guard is above the report, where it can fire', () => {
  // The specific check that was dead. Named, because it is the one that let /orders reach
  // production rendering as raw HTML.
  const source = readFileSync(SCRIPT, 'utf8');
  const guard = source.indexOf('uses the back-office shell but links no stylesheet');
  const report = source.indexOf('if (problems.length) {');

  assert.ok(guard > 0, 'the back-office stylesheet guard has gone');
  assert.ok(
    guard < report,
    'the back-office stylesheet guard is below the report block, so it cannot fail the build',
  );
});
