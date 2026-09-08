import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const runGate = (env, cwd = ROOT) => {
  try {
    execFileSync('bash', [join(ROOT, 'scripts', 'netlify-should-build.sh')], {
      cwd,
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

/*
 * ---------------------------------------------------------------------------------------------
 * The same four cases again, run from `apps/web` — `E12-43`.
 *
 * **This is the case that was broken, and it was broken from the day the gate was written.**
 * Netlify runs the `ignore` command from the site's **base directory**, which is `apps/web`, not
 * the repository root. The wrapper imported `./scripts/lib/netlify-gate.mjs` — relative to the
 * CWD — which does not exist there. `node` threw `ERR_MODULE_NOT_FOUND`, the decision came back
 * empty, and the wrapper's "do not freeze the site" fallback chose BUILD. The gate was open for
 * every production build, and every merge to `main` published straight to production.
 *
 * The tests above passed throughout, because they ran it from the root, where the relative path
 * resolves. They asserted the right behaviour from the wrong directory — which is worse than not
 * testing it, because it reported the gate as proven.
 *
 * `WEB` is read from `netlify.toml`'s own location rather than hard-coded, so moving the site's
 * base directory breaks this test rather than silently reopening the gate.
 */
const WEB = join(ROOT, 'apps', 'web');

test('netlify.toml still lives in the directory these tests assume is the base', () => {
  // If this fails, the base directory moved and the `../../` in netlify.toml's ignore command —
  // and the CWD below — need to move with it.
  assert.ok(existsSync(join(WEB, 'netlify.toml')));
});

test('from the site base: an ungated production build skips', () => {
  assert.equal(runGate({ CONTEXT: 'production' }, WEB), 0);
});

test('from the site base: a deploy preview builds', () => {
  assert.equal(runGate({ CONTEXT: 'deploy-preview' }, WEB), 1);
});

test('from the site base: an explicit promotion builds', () => {
  assert.equal(runGate({ CONTEXT: 'production', PROMOTE_TO_PRODUCTION: 'true' }, WEB), 1);
});

test('from the site base: the [promote] marker builds', () => {
  assert.equal(
    runGate({ CONTEXT: 'production', COMMIT_MESSAGE: '[promote] release 2026-09-08' }, WEB),
    1,
  );
});

test('the gate is never open merely because it failed to run', () => {
  // The regression in one assertion. Whatever goes wrong inside the wrapper, an ungated
  // production build must not publish — and "the module could not be found" was exactly the
  // thing that went wrong, from exactly this directory.
  assert.equal(runGate({ CONTEXT: 'production', COMMIT_MESSAGE: 'no marker here' }, WEB), 0);
});

test('the wrapper still reads git when no message is injected', () => {
  // The fallback has to keep working — on Netlify nothing sets COMMIT_MESSAGE, and a gate that
  // silently stopped reading the commit would fail open on every build.
  const script = readFileSync(join(ROOT, 'scripts', 'netlify-should-build.sh'), 'utf8');
  assert.match(script, /COMMIT_MESSAGE:-\$\(git log -1/);
});
