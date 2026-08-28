// `E17-64`. Every secret a deploy workflow reads must be one `secrets:set` actually sets.
//
// `SUPABASE_DB_PASSWORD` was read by both deploy workflows and set by neither, and the gap was
// invisible for a specific reason worth stating: both workflows reference the **unscoped** name
// `secrets.SUPABASE_DB_PASSWORD`, and one repository-level secret holding *staging's* password
// satisfies both. Staging deploys succeeded, so the wiring looked configured. A production deploy
// would have passed its own credential guard — the name resolves — and then authenticated
// `db push` against production with staging's password.
//
// That is the failure mode this file exists to prevent, and it is worse than a missing secret: a
// missing one fails loudly at the guard, while a wrong-environment one authenticates somewhere.
//
// The test is deliberately derived from the workflows rather than from a hand-kept list. A new
// `secrets.FOO` in a deploy workflow fails here until `set-secrets.mts` knows how to set it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The names `set-secrets.mts` pushes to GitHub, parsed from the source rather than duplicated. */
function githubSecretsFromScript() {
  const src = read('scripts/set-secrets.mts');
  const block = src.match(/const GITHUB_SECRETS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'could not find GITHUB_SECRETS in scripts/set-secrets.mts');
  return [...block[1].matchAll(/'([A-Z_][A-Z_0-9]*)'/g)].map((m) => m[1]);
}

/** Every `secrets.NAME` a workflow interpolates. */
function secretsReadBy(workflow) {
  const found = [...read(`.github/workflows/${workflow}`).matchAll(/secrets\.([A-Z_][A-Z_0-9]*)/g)];
  return [...new Set(found.map((m) => m[1]))];
}

const DEPLOY_WORKFLOWS = ['deploy-production.yml', 'deploy-staging.yml'];

for (const workflow of DEPLOY_WORKFLOWS) {
  test(`every secret ${workflow} reads is one secrets:set can set`, () => {
    const settable = githubSecretsFromScript();
    const missing = secretsReadBy(workflow).filter((n) => !settable.includes(n));
    assert.deepEqual(
      missing,
      [],
      `${workflow} reads ${missing.join(', ')}, which secrets:set never sets. ` +
        'Add it to GITHUB_SECRETS in scripts/set-secrets.mts and to .env.example, or the value ' +
        'silently falls through to whatever a repository-level secret happens to hold — which for ' +
        'SUPABASE_DB_PASSWORD was staging\'s password.',
    );
  });
}

test('SUPABASE_DB_PASSWORD is settable — the specific gap E17-64 found', () => {
  // Named explicitly as well as covered by the loop above, so that deleting the workflows or
  // renaming the file cannot quietly retire the regression this was written for.
  assert.ok(
    githubSecretsFromScript().includes('SUPABASE_DB_PASSWORD'),
    'SUPABASE_DB_PASSWORD must be in GITHUB_SECRETS',
  );
});

test('.env.example documents every secret the script would push', () => {
  // The example file is the only instruction anyone gets for building `.secrets.<env>.env`.
  // A name the script sets but the template omits produces a file that validates and deploys
  // with a hole in it.
  const example = read('.env.example');
  const undocumented = githubSecretsFromScript().filter(
    (n) => !new RegExp(`^${n}=`, 'm').test(example),
  );
  assert.deepEqual(undocumented, [], `.env.example is missing: ${undocumented.join(', ')}`);
});
