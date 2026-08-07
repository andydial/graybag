#!/usr/bin/env node
// Configures the GitHub repository itself: deployment environments and their
// protection rules.
//
//   node scripts/setup-github.mjs            # apply
//   node scripts/setup-github.mjs --dry      # show what would change
//
// Idempotent — safe to re-run, and re-running is how you repair a rule somebody
// switched off in the web UI.
//
// This lives in the repository rather than in someone's memory for the same reason
// secrets are set by a script (EN4): a rule clicked into a settings page has no
// record of who set it, when, or what it used to be.
//
// The production approval gate is here, NOT in the deploy workflow. An environment
// rule pauses the job before any step runs and before the environment's secrets are
// exposed, and it cannot be edited by the pull request it is meant to guard.

import { spawnSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const REPO = process.env['GRAYBAG_REPO'] ?? 'andydial/graybag';

function gh(args, { allowFail = false, input } = {}) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  if (r.status !== 0) {
    if (allowFail) return null;
    console.error(`\ngh ${args.join(' ')}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return r.stdout.trim();
}

function api(method, path, body) {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json'];
  if (body !== undefined) return gh([...args, '--input', '-'], { input: JSON.stringify(body) });
  return gh(args);
}

// ---------------------------------------------------------------------------

const owner = REPO.split('/')[0];
const viewer = JSON.parse(gh(['api', 'user']));
if (viewer.login !== owner) {
  console.log(`note: authenticated as ${viewer.login}, configuring ${REPO}`);
}

/**
 * staging    — deploys from `main`, no approval. Staging exists to be broken.
 * production — deploys from `v*` tags only, and pauses for a human first.
 */
const ENVIRONMENTS = [
  {
    name: 'staging',
    reviewers: [],
    branchPolicy: { protected_branches: false, custom_branch_policies: true },
    policies: [{ name: 'main', type: 'branch' }],
  },
  {
    name: 'production',
    reviewers: [{ type: 'User', id: viewer.id }],
    branchPolicy: { protected_branches: false, custom_branch_policies: true },
    policies: [{ name: 'v*', type: 'tag' }],
  },
];

for (const env of ENVIRONMENTS) {
  const body = {
    wait_timer: 0,
    prevent_self_review: false,
    reviewers: env.reviewers,
    deployment_branch_policy: env.branchPolicy,
  };

  console.log(`\n${env.name}`);
  console.log(`  approval required : ${env.reviewers.length > 0 ? `yes (${viewer.login})` : 'no'}`);
  console.log(`  deploys from      : ${env.policies.map((p) => `${p.name} (${p.type})`).join(', ')}`);

  if (DRY) {
    console.log('  [dry run — nothing sent]');
    continue;
  }

  api('PUT', `repos/${REPO}/environments/${env.name}`, body);

  // Branch/tag policies are a sub-resource and are additive, so reconcile rather
  // than blindly POST — otherwise every run adds another duplicate `main` rule.
  const existing = JSON.parse(
    api('GET', `repos/${REPO}/environments/${env.name}/deployment-branch-policies`),
  ).branch_policies ?? [];

  const wanted = new Set(env.policies.map((p) => `${p.type}:${p.name}`));
  for (const p of existing) {
    if (!wanted.has(`${p.type}:${p.name}`)) {
      api('DELETE', `repos/${REPO}/environments/${env.name}/deployment-branch-policies/${p.id}`);
      console.log(`  removed stale policy ${p.type}:${p.name}`);
    }
  }
  const have = new Set(existing.map((p) => `${p.type}:${p.name}`));
  for (const p of env.policies) {
    if (have.has(`${p.type}:${p.name}`)) continue;
    api('POST', `repos/${REPO}/environments/${env.name}/deployment-branch-policies`, p);
    console.log(`  added policy ${p.type}:${p.name}`);
  }

  console.log('  applied');
}

console.log(
  `\nVerify:  gh api repos/${REPO}/environments/production --jq '.protection_rules'\n` +
  `Secrets for these environments are set by:  npm run secrets:set -- <env>\n`,
);
