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

// ---------------------------------------------------------------------------
// Branch protection on the default branch (E01-02): PR required, CI must pass,
// no direct pushes, no force-push, no deletion.
//
// A ruleset rather than classic branch protection: it is the current API, and
// `bypass_actors: []` means the rule binds repository admins too. That is the point.
// Non-negotiable #6 says nothing merges without the smoke test green, and a rule the
// owner can walk past is a preference.
// ---------------------------------------------------------------------------

const RULESET = {
  name: 'main',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  bypass_actors: [],
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        // Zero, not one. Andy is the only developer, and GitHub does not let you
        // approve your own pull request — requiring an approval would block every
        // merge forever. The rule still forces the *pull request*, which is what
        // gives the status check something to run against.
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ['squash', 'merge', 'rebase'],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        // "strict" = the branch must be up to date with the base before merging, so
        // the check that passed is the check for the tree that actually lands.
        strict_required_status_checks_policy: true,
        // Each context matches the `name:` of a job. If a job is renamed, rename it
        // here in the same commit or the gate silently waits for a check that will
        // never report.
        //
        //   Smoke test                              -> .github/workflows/ci.yml
        //   Migrations, seed and authorization suite -> .github/workflows/integration.yml
        //
        // The integration job was added to this list on 2026-08-08. It had been
        // advisory, and on that day a PR merged with it RED — the authorization suite
        // was reporting `Tests: 0` and nothing stopped the merge. Non-negotiable #2
        // says that must be impossible, and a check nobody has to satisfy is not a
        // control (same reasoning as BP1).
        //
        // That job MUST NOT carry a `paths:` filter while it is required: a required
        // check that does not run leaves the PR waiting for a status forever. The
        // filter therefore lives inside the job, which always reports. See the trigger
        // note at the top of integration.yml.
        required_status_checks: [
          { context: 'Smoke test' },
          { context: 'Migrations, seed and authorization suite' },
        ],
      },
    },
  ],
};

console.log('\nbranch protection (default branch)');
console.log('  pull request required, 0 approvals (solo developer — see the script)');
console.log('  required checks  : Smoke test');
console.log('                     Migrations, seed and authorization suite');
console.log('  force-push       : blocked');
console.log('  deletion         : blocked');
console.log('  admin bypass     : none');

if (DRY) {
  console.log('  [dry run — nothing sent]');
} else {
  const existing = JSON.parse(api('GET', `repos/${REPO}/rulesets`));
  const mine = existing.find((r) => r.name === RULESET.name);
  if (mine) {
    api('PUT', `repos/${REPO}/rulesets/${mine.id}`, RULESET);
    console.log(`  updated ruleset ${mine.id}`);
  } else {
    const created = JSON.parse(api('POST', `repos/${REPO}/rulesets`, RULESET));
    console.log(`  created ruleset ${created.id}`);
  }
}

console.log(
  `\nVerify:  gh api repos/${REPO}/environments/production --jq '.protection_rules'\n` +
  `         gh api repos/${REPO}/rulesets --jq '.[] | {name, enforcement}'\n` +
  `Secrets for these environments are set by:  npm run secrets:set -- <env>\n`,
);
