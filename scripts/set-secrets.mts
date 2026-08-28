#!/usr/bin/env -S npx tsx
/**
 * Push one environment's secrets to the two places that hold them.
 *
 *   npm run secrets:set -- staging
 *   npm run secrets:set -- production --dry
 *
 * Reads `.secrets.<environment>.env` from the repository root — a file that is
 * gitignored, never committed, and lives only on Andy's machine. Everything in it is
 * validated by the SAME loader the application boots with (`@graybag/shared`), so a
 * live Razorpay key cannot be pushed to staging: the validation fails before a single
 * value leaves the machine.
 *
 * This exists so that no secret is ever typed into a web dashboard. Hand-editing is
 * how the legacy app ended up with a live key in an export (docs/learnings.md,
 * 2026-08-06), and a dashboard leaves no record of what changed or when.
 *
 * See docs/environments.md §3 for the procedure and docs/secret-rotation-policy.md
 * for cadence and ownership.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EnvError, loadServerEnv, type AppEnv } from '../packages/shared/src/env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Which secrets go where. Deliberately explicit — a wrong entry here is a leak.
 *
 * `SUPABASE_DB_PASSWORD` was **missing from this list until `E17-64`**, and the omission was
 * invisible for a specific reason: `deploy-staging.yml` and `deploy-production.yml` both read the
 * unscoped name `secrets.SUPABASE_DB_PASSWORD`, and a repository-level secret holding *staging's*
 * password satisfies both. Staging deploys therefore succeeded, which is exactly what made it look
 * configured. A production deploy would have passed the credential guard — the name resolves — and
 * then authenticated `db push` against production with staging's password.
 *
 * A secret that must differ per environment and is stored once at repository level is worse than a
 * missing one, because the missing one fails loudly at the guard.
 */
const GITHUB_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
] as const;

const EDGE_FUNCTION_SECRETS = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_WEBHOOK_SECRET_PREVIOUS',
  'SENTRY_DSN',
  'APP_ENV',
] as const;

const ENVIRONMENTS: readonly AppEnv[] = ['local', 'staging', 'production'];

function die(message: string): never {
  console.error(`\nsecrets: ${message}\n`);
  process.exit(1);
}

/** Minimal `KEY=value` reader. No interpolation, no export prefixes, no surprises. */
function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  body.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq === -1) die(`line ${i + 1} of the secrets file is not KEY=value: ${line.slice(0, 40)}`);
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  });
  return out;
}

function run(command: string, args: string[], input?: string): void {
  const r = spawnSync(command, args, { input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.error) die(`could not run ${command}: ${r.error.message}`);
  if (r.status !== 0) die(`${command} ${args[0]} exited ${r.status}`);
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const target = args.find((a) => !a.startsWith('--'));

if (!target || !ENVIRONMENTS.includes(target as AppEnv)) {
  die(`usage: npm run secrets:set -- <${ENVIRONMENTS.join('|')}> [--dry]`);
}
const appEnv = target as AppEnv;

const file = join(ROOT, `.secrets.${appEnv}.env`);
if (!existsSync(file)) {
  die(
    `${file} does not exist.\n` +
    `  Copy .env.example to .secrets.${appEnv}.env and fill it in from the password manager.\n` +
    `  It is gitignored. Do not commit it, and do not paste these values into a dashboard.`,
  );
}

const values = parseEnvFile(readFileSync(file, 'utf8'));

// The file must declare the environment it is for, and it must be the one asked for.
// Otherwise "npm run secrets:set -- staging" against a file full of production values
// is a single typo away, and it is the exact typo that moves real money.
if (values['APP_ENV'] !== appEnv) {
  die(
    `${file} has APP_ENV="${values['APP_ENV'] ?? '(unset)'}" but you asked to set "${appEnv}".\n` +
    `  Refusing. The file must name the environment it belongs to.`,
  );
}

try {
  loadServerEnv(values);
} catch (e) {
  if (e instanceof EnvError) {
    die(`${file} is not a usable ${appEnv} environment:\n  - ${e.problems.join('\n  - ')}`);
  }
  throw e;
}

const projectRef = values['SUPABASE_PROJECT_REF'];
if (!projectRef) die(`${file} has no SUPABASE_PROJECT_REF — needed to target the right Supabase project.`);

console.log(`\nsecrets: ${appEnv} (project ${projectRef})${dry ? '  [dry run — nothing will be sent]' : ''}\n`);

// GitHub Actions environment secrets — used by CI and the deploy workflows.
for (const name of GITHUB_SECRETS) {
  const value = values[name];
  if (!value) {
    console.log(`  github  ${name.padEnd(32)} skipped (not set)`);
    continue;
  }
  console.log(`  github  ${name.padEnd(32)} ${dry ? 'would set' : 'setting'}`);
  if (!dry) run('gh', ['secret', 'set', name, '--env', appEnv, '--body', value]);
}

// Supabase Edge Function secrets — the only place the payment secrets are readable.
const edgePairs = EDGE_FUNCTION_SECRETS.filter((n) => values[n]).map((n) => `${n}=${values[n]}`);
for (const name of EDGE_FUNCTION_SECRETS) {
  console.log(`  edge    ${name.padEnd(32)} ${values[name] ? (dry ? 'would set' : 'setting') : 'skipped (not set)'}`);
}
if (!dry && edgePairs.length > 0) {
  run('npx', ['--yes', 'supabase', 'secrets', 'set', '--project-ref', projectRef, ...edgePairs]);
}

console.log(
  `\nsecrets: ${dry ? 'dry run complete — nothing was sent' : `${appEnv} updated`}.\n` +
  `Log the change per docs/secret-rotation-policy.md §0.5 if this was a rotation.\n`,
);
