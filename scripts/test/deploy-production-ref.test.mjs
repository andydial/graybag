// `E17-63`. The production deploy workflow must refuse a non-tag ref *itself*, out loud.
//
// The failure this guards against leaves no evidence, which is what makes it expensive. The
// `production` environment admits only `v*` tags, so a `workflow_dispatch` from `main` is
// rejected by GitHub before the runner starts — the run exists, fails in a second, records zero
// steps and writes no logs. On 2026-08-25 exactly that happened and was read as "the Migrations
// job failed"; the Migrations job had never begun, and eight migrations and nine Edge Functions
// sat unapplied for three days behind an apparently-attempted deploy.
//
// So the assertions below are all about ONE property: the job that refuses the ref must not be
// gated by the same environment it is explaining. If a later edit adds `environment: production`
// to `preflight`, the guard becomes invisible in precisely the case it exists for, and the
// workflow silently returns to the 2026-08-25 behaviour while still looking correct in the diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = parse(readFileSync(join(ROOT, '.github/workflows/deploy-production.yml'), 'utf8'));

test('the ref guard is NOT gated by the environment it exists to explain', () => {
  // The single load-bearing assertion. A gated guard cannot report the gate.
  assert.ok(wf.jobs.preflight, 'deploy-production.yml has no `preflight` job');
  assert.equal(
    wf.jobs.preflight.environment,
    undefined,
    'the preflight job must have no `environment:` — otherwise the branch policy rejects it ' +
      'before it can say that the branch policy rejects it, and the run goes back to failing ' +
      'in one second with no logs',
  );
});

test('the guard refuses anything that is not a tag, and fails when it does', () => {
  const steps = wf.jobs.preflight.steps ?? [];
  const guard = steps.find((s) => String(s.if ?? '').includes('ref_type'));
  assert.ok(guard, 'no step in `preflight` is conditional on `github.ref_type`');
  assert.match(
    String(guard.if),
    /github\.ref_type\s*!=\s*'tag'/,
    'the guard must trigger on a non-tag ref',
  );
  // A guard that reports and continues is a comment. It has to stop the deploy.
  assert.match(String(guard.run), /\bexit 1\b/, 'the guard must fail the job, not just log');
  assert.match(String(guard.run), /::error::/, 'the failure must surface in the run summary');
});

test('the deploy job depends on the guard, so a refused ref cannot proceed', () => {
  const needs = [wf.jobs.database.needs].flat().filter(Boolean);
  assert.ok(
    needs.includes('preflight'),
    'the `database` job must `needs: preflight`, or the guard fails beside the deploy ' +
      'rather than in front of it',
  );
});

test('the deploy job is still gated on the production environment', () => {
  // The guard is legibility, never the control. The approval that actually protects production
  // is the environment's required-reviewer rule, which cannot be edited away in the same PR it
  // guards. Adding the guard must not have quietly replaced it.
  assert.equal(wf.jobs.database.environment, 'production');
});

test('the guard tells the reader how to deploy, not merely that they cannot', () => {
  const run = String(wf.jobs.preflight.steps.find((s) => String(s.if ?? '').includes('ref_type')).run);
  assert.match(run, /git tag v/, 'the error must carry the command that does work');
});
