import { api, loadClientEnv, type ClientEnv } from '@graybag/shared';

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
    api.configureApi(readExpoClientEnv());
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
