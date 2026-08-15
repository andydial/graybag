import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldBuild } from '../lib/netlify-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a deploy preview always builds — previews are the point of previews', () => {
  assert.equal(shouldBuild({ context: 'deploy-preview' }).build, true);
  assert.equal(shouldBuild({ context: 'branch-deploy' }).build, true);
});

test('production does NOT build on an ordinary push', () => {
  // The whole feature. A merge to `main` must not reach the live site.
  const d = shouldBuild({ context: 'production', commitMessage: 'E10-06: the config screen' });
  assert.equal(d.build, false);
  assert.match(d.reason, /production is gated/);
});

test('production builds when the commit subject carries [promote]', () => {
  const d = shouldBuild({ context: 'production', commitMessage: '[promote] release 2026-08-19' });
  assert.equal(d.build, true);
});

test('the marker is recognised anywhere in the subject, and case-insensitively', () => {
  assert.equal(shouldBuild({ context: 'production', commitMessage: 'release 2026-08-19 [PROMOTE]' }).build, true);
});

test('a [promote] in the commit BODY does not promote', () => {
  // Body text is exactly where such a string turns up by accident — a quoted review comment, a
  // pasted log, a reference to this very file. Only the subject is a deliberate act.
  const d = shouldBuild({
    context: 'production',
    commitMessage: 'E12-30: the deploy gate\n\nPushing a commit with [promote] in the subject ships it.',
  });
  assert.equal(d.build, false);
});

test('PROMOTE_TO_PRODUCTION=true builds, for a manually triggered deploy', () => {
  assert.equal(shouldBuild({ context: 'production', promoteFlag: 'true' }).build, true);
  assert.equal(shouldBuild({ context: 'production', promoteFlag: 'TRUE' }).build, true);
});

test('any other value of PROMOTE_TO_PRODUCTION does not build', () => {
  // A variable left set to "false" or "1" must not ship. Only the exact intent counts.
  for (const flag of ['false', '1', 'yes', '', undefined]) {
    assert.equal(shouldBuild({ context: 'production', promoteFlag: flag }).build, false, `flag=${flag}`);
  }
});

test('an empty commit message fails closed', () => {
  // A shallow clone with no git history must not promote by accident.
  assert.equal(shouldBuild({ context: 'production', commitMessage: '' }).build, false);
});

test('an unrecognised context builds rather than silently freezing', () => {
  // Only production is gated. A new Netlify context that stopped building would be a broken
  // preview nobody could explain.
  assert.equal(shouldBuild({ context: 'some-future-context' }).build, true);
});

// ---------------------------------------------------------------------------- the shell wrapper

/**
 * The exit codes are the part most likely to be wrong, and they are INVERTED — Netlify asks
 * "may I skip?", so 0 skips and 1 builds. Reversing them fails open and publishes production on
 * every push, so the wrapper is exercised for real rather than assumed to match the module.
 */
const runGate = (env) => {
  try {
    execFileSync('bash', [join(ROOT, 'scripts', 'netlify-should-build.sh')], {
      cwd: ROOT,
      // `COMMIT_MESSAGE` is pinned rather than left to the repository's HEAD. The first version
      // of this test let the script read `git log -1`, so it passed only while HEAD did not
      // contain `[promote]` — and failed the moment a real promote was merged, reporting a gate
      // bug that did not exist. That is `docs/learnings.md`'s rule exactly: assert the behaviour,
      // never today's contents.
      env: { ...process.env, PROMOTE_TO_PRODUCTION: '', COMMIT_MESSAGE: 'an ordinary commit', ...env },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return 0;
  } catch (cause) {
    return cause.status;
  }
};

test('the wrapper exits 0 (skip) for an ungated production build', () => {
  assert.equal(runGate({ CONTEXT: 'production' }), 0);
});

test('the wrapper exits 1 (build) for a deploy preview', () => {
  assert.equal(runGate({ CONTEXT: 'deploy-preview' }), 1);
});

test('the wrapper exits 1 (build) when promotion is explicitly requested', () => {
  assert.equal(runGate({ CONTEXT: 'production', PROMOTE_TO_PRODUCTION: 'true' }), 1);
});

test('the wrapper exits 1 (build) when the commit subject carries the marker', () => {
  // The end-to-end path a real promote takes, through the shell rather than the module.
  assert.equal(runGate({ CONTEXT: 'production', COMMIT_MESSAGE: '[promote] release 2026-08-19' }), 1);
});

test('the wrapper still reads git when no message is injected', () => {
  // The fallback has to keep working — on Netlify nothing sets COMMIT_MESSAGE, and a gate that
  // silently stopped reading the commit would fail open on every build.
  const script = readFileSync(join(ROOT, 'scripts', 'netlify-should-build.sh'), 'utf8');
  assert.match(script, /COMMIT_MESSAGE:-\$\(git log -1/);
});
