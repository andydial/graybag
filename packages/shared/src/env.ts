/**
 * Environment and secret loading.
 *
 * The failure this file exists to prevent is the one that already happened once: a
 * **live** Razorpay key sitting somewhere it should not have been
 * (`docs/learnings.md`, 2026-08-06). Nothing here relies on anybody remembering which
 * key belongs in which environment — the prefix of the key is checked against
 * `APP_ENV` and the process refuses to start if they disagree.
 *
 * Two entry points, and the difference matters:
 *
 *   `loadClientEnv()`  — for the mobile app and the web client. Returns ONLY variables
 *                        that are safe to ship in a bundle, and throws if a server
 *                        secret is even present in the environment it was handed.
 *   `loadServerEnv()`  — for Edge Functions and CI. Returns the full set.
 *
 * Inventory, ownership and rotation cadence: `docs/secret-rotation-policy.md` §1.
 * How values get into each environment: `docs/environments.md`.
 */

export type AppEnv = 'local' | 'staging' | 'production';

const APP_ENVS: readonly AppEnv[] = ['local', 'staging', 'production'] as const;

/**
 * Razorpay key prefixes, per environment.
 *
 * `local` and `staging` both use the test account. There is no third Razorpay
 * account, so "staging must never hold a live key" is the whole rule.
 */
const REQUIRED_RAZORPAY_PREFIX: Record<AppEnv, 'rzp_test_' | 'rzp_live_'> = {
  local: 'rzp_test_',
  staging: 'rzp_test_',
  production: 'rzp_live_',
};

/** Variables that must never reach a client bundle (non-negotiable #1, `E01-18`). */
export const SERVER_ONLY_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_WEBHOOK_SECRET_PREVIOUS',
] as const;

export interface ClientEnv {
  appEnv: AppEnv;
  supabaseUrl: string;
  /** Publishable. Ships in the bundle by design — RLS is the control, not this key. */
  supabaseAnonKey: string;
  /** Public half of the Razorpay pair; the checkout SDK needs it client-side. */
  razorpayKeyId: string;
  sentryDsn?: string;
  /**
   * PostHog's **project** key (`E15-20`). Write-only and publishable — it can send events and
   * cannot read them, which is why it ships in the bundle like `supabaseAnonKey` does.
   *
   * **Optional on purpose.** Absent, `createAnalytics` returns a no-op and the app sends
   * nothing: staging and local builds have no key, and a funnel polluted by a developer's
   * tap-through is worse than no funnel because it looks like data.
   */
  posthogKey?: string;
}

export interface ServerEnv extends ClientEnv {
  supabaseServiceRoleKey: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  /**
   * Set only during a webhook-secret rotation, when events signed with either the
   * new or the previous secret must both verify (`docs/secret-rotation-policy.md` §2.2).
   */
  razorpayWebhookSecretPrevious?: string;
}

export class EnvError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Environment is not usable:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
    this.problems = problems;
  }
}

type Source = Record<string, string | undefined>;

function required(source: Source, name: string, problems: string[]): string {
  const value = source[name]?.trim();
  if (!value) {
    problems.push(`${name} is missing or empty.`);
    return '';
  }
  return value;
}

function optional(source: Source, name: string): string | undefined {
  const value = source[name]?.trim();
  return value ? value : undefined;
}

function readAppEnv(source: Source, problems: string[]): AppEnv {
  const raw = source['APP_ENV']?.trim();
  if (!raw) {
    problems.push(`APP_ENV is missing. Expected one of: ${APP_ENVS.join(', ')}.`);
    return 'local';
  }
  if (!(APP_ENVS as readonly string[]).includes(raw)) {
    problems.push(`APP_ENV is "${raw}". Expected one of: ${APP_ENVS.join(', ')}.`);
    return 'local';
  }
  return raw as AppEnv;
}

/**
 * The check this module exists for. A mismatch is always a deployment error, and it is
 * always dangerous — in one direction it charges real money from staging, in the other
 * it silently fails to charge in production.
 */
function checkRazorpayPrefix(appEnv: AppEnv, keyId: string, problems: string[]): void {
  if (!keyId) return; // already reported as missing
  const wanted = REQUIRED_RAZORPAY_PREFIX[appEnv];
  if (keyId.startsWith(wanted)) return;

  const looksLive = keyId.startsWith('rzp_live_');
  const detail = looksLive && appEnv !== 'production'
    ? ' This is a LIVE key outside production — real money would move. Stop and rotate it.'
    : '';
  problems.push(
    `RAZORPAY_KEY_ID must start with "${wanted}" when APP_ENV is "${appEnv}", ` +
    `but it starts with "${keyId.slice(0, 9)}".${detail}`,
  );
}

/**
 * Load the variables that are safe to ship in a client bundle.
 *
 * Throws if any server-only secret is present in `source` at all. A client build that
 * can see the service-role key is one careless `process.env` reference away from
 * shipping it, and that key bypasses RLS entirely (non-negotiable #2).
 */
export function loadClientEnv(source: Source = process.env): ClientEnv {
  const problems: string[] = [];

  const leaked = SERVER_ONLY_VARS.filter((name) => (source[name]?.trim() ?? '') !== '');
  if (leaked.length > 0) {
    problems.push(
      `Server-only secret(s) present in a client environment: ${leaked.join(', ')}. ` +
      `These must never be readable from a bundle — see docs/environments.md §4.`,
    );
  }

  const appEnv = readAppEnv(source, problems);
  const env: ClientEnv = {
    appEnv,
    supabaseUrl: required(source, 'SUPABASE_URL', problems),
    supabaseAnonKey: required(source, 'SUPABASE_ANON_KEY', problems),
    razorpayKeyId: required(source, 'RAZORPAY_KEY_ID', problems),
  };

  checkRazorpayPrefix(appEnv, env.razorpayKeyId, problems);

  const dsn = optional(source, 'SENTRY_DSN');
  if (dsn !== undefined) env.sentryDsn = dsn;

  const posthog = optional(source, 'POSTHOG_KEY');
  if (posthog !== undefined) env.posthogKey = posthog;

  if (problems.length > 0) throw new EnvError(problems);
  return env;
}

/** Load the full server-side set. Used by Edge Functions and by CI. */
export function loadServerEnv(source: Source = process.env): ServerEnv {
  const problems: string[] = [];

  const appEnv = readAppEnv(source, problems);
  const razorpayKeyId = required(source, 'RAZORPAY_KEY_ID', problems);
  checkRazorpayPrefix(appEnv, razorpayKeyId, problems);

  const env: ServerEnv = {
    appEnv,
    supabaseUrl: required(source, 'SUPABASE_URL', problems),
    supabaseAnonKey: required(source, 'SUPABASE_ANON_KEY', problems),
    razorpayKeyId,
    supabaseServiceRoleKey: required(source, 'SUPABASE_SERVICE_ROLE_KEY', problems),
    razorpayKeySecret: required(source, 'RAZORPAY_KEY_SECRET', problems),
    razorpayWebhookSecret: required(source, 'RAZORPAY_WEBHOOK_SECRET', problems),
  };

  const previous = optional(source, 'RAZORPAY_WEBHOOK_SECRET_PREVIOUS');
  if (previous !== undefined) env.razorpayWebhookSecretPrevious = previous;

  const dsn = optional(source, 'SENTRY_DSN');
  if (dsn !== undefined) env.sentryDsn = dsn;

  const posthog = optional(source, 'POSTHOG_KEY');
  if (posthog !== undefined) env.posthogKey = posthog;

  if (problems.length > 0) throw new EnvError(problems);
  return env;
}
