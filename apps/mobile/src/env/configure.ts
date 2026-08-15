import { api, loadClientEnv, type ClientEnv } from '@graybag/shared';

import { secureSessionStore } from '../session/secureSessionStore';

/**
 * Turn Expo's injected `EXPO_PUBLIC_*` variables into the shape `loadClientEnv` validates,
 * and hand the result to the `api/` module.
 *
 * ## Why the names are rewritten here
 *
 * `loadClientEnv` is shared with Edge Functions and CI, where the variables are plain
 * `SUPABASE_URL` and friends. Expo requires the `EXPO_PUBLIC_` prefix for anything that is
 * to reach the bundle at all — a variable without it is silently `undefined` at runtime,
 * which is one of the more expensive ways to spend an afternoon.
 *
 * Rather than teach the shared loader about Expo's convention, the prefix is stripped at the
 * one boundary that has it. That keeps `SERVER_ONLY_VARS` meaningful: a server secret cannot
 * acquire an `EXPO_PUBLIC_` prefix by accident, because nothing here would map it.
 *
 * **Each name is read as a literal `process.env.EXPO_PUBLIC_X`, not built dynamically.**
 * Metro inlines these at build time by static analysis; `process.env[name]` with a computed
 * `name` inlines to nothing and every value is `undefined` in a release build while working
 * perfectly in development.
 */
export function readExpoClientEnv(): ClientEnv {
  return loadClientEnv({
    APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    RAZORPAY_KEY_ID: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
    SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  });
}

/**
 * Configure the backend client at start-up.
 *
 * Returns whether it succeeded rather than throwing, and that is deliberate. An app with no
 * environment should still *open* — the design system, the navigation and every empty state
 * are worth showing, and a white screen with a stack trace tells a parent nothing. What must
 * not happen is a call going out against a half-configured client, so the `api/` module stays
 * unconfigured and raises `ApiNotConfiguredError` at the call site, naming itself.
 *
 * The failure is logged rather than swallowed: `console.error` is permitted here by the lint
 * config, and this is exactly the case it is permitted for.
 */
export function configureApiFromEnvironment(): boolean {
  try {
    // E03-20: the session goes in the keychain, so a returning parent is not asked for a
    // new code every time the app is killed.
    api.configureApi(readExpoClientEnv(), { sessionStore: secureSessionStore });
    return true;
  } catch (error) {
    // No PII can appear in this message — it names environment variables, never a user
    // (non-negotiable #4).
    console.error(
      'The backend client could not be configured; the app will open without one.',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Which `EXPO_PUBLIC_*` variables are absent, by name.
 *
 * For the Can't-connect screen's diagnostics (§5.20). **Names only — never values.** A
 * screenshot of that screen is going to be pasted into a chat, and an anon key in it would be
 * a key in a chat log for ever.
 *
 * Each name is read as a literal `process.env.EXPO_PUBLIC_X`, exactly as `readExpoClientEnv`
 * does, because Metro inlines these by static analysis and a computed lookup inlines to
 * nothing — working perfectly in development and reporting everything missing in a release
 * build, which would be a diagnostic that lies.
 */
export function missingClientEnvNames(): string[] {
  const present: [string, string | undefined][] = [
    ['EXPO_PUBLIC_APP_ENV', process.env.EXPO_PUBLIC_APP_ENV],
    ['EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY],
    // **`E01-28`: this line was missing, and its absence made the diagnostic lie.**
    //
    // `loadClientEnv` requires `RAZORPAY_KEY_ID` (see its `required(...)` call), so a build
    // without it fails to configure and lands on `CantConnectScreen`. That screen then listed
    // the three names above, found them all present, and reported **nothing missing** — while
    // the app was unusable for want of the one name it did not check.
    //
    // A diagnostic that omits a required variable is worse than no diagnostic: it actively
    // sends the reader somewhere else. This file's own header warns that a computed lookup
    // would produce "a diagnostic that lies"; an incomplete literal list does the same thing.
    ['EXPO_PUBLIC_RAZORPAY_KEY_ID', process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID],
  ];
  return present.filter(([, value]) => value === undefined || value === '').map(([name]) => name);
}
