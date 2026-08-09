// @graybag/shared — types, validation, and the `api/` client module.
//
// Non-negotiable #1: every backend call from the mobile app goes through the `api/`
// module in this package. Reads may use the Supabase client; writes always go through
// Edge Functions. That module lands in Block 5 (E14-08); this file is its entry point.

export const PACKAGE_NAME = '@graybag/shared';

export {
  EnvError,
  SERVER_ONLY_VARS,
  loadClientEnv,
  loadServerEnv,
  type AppEnv,
  type ClientEnv,
  type ServerEnv,
} from './env.js';

export {
  ConfigUnavailableError,
  createConfigCache,
  gstSplitBps,
  type ConfigCache,
  type ConfigCacheOptions,
  type ConfigFetcher,
  type EffectiveConfig,
} from './config-cache.js';

// Network resilience (E14-09): retry with backoff and full jitter, a per-attempt timeout so
// no spinner can be infinite, and a deliberate refusal to retry anything that says the
// request itself was wrong.
export * as net from './net/index.js';

// The menu domain (E04-01/02/03). Pure rules — which menu a school sees today, whether an
// item is orderable on a weekday, what it costs there, and what we may say about its
// allergens. No fetching and no Date: see menu/dates.ts for why the second one matters.
export * as menu from './menu/index.js';

// Design tokens (E13-01). One source, two outputs, no third (S8): `apps/mobile` imports
// these objects directly and `apps/web` generates CSS custom properties from the same
// modules at build time. Components import the semantic roles, never the ramps (S7).
export * as design from './design/index.js';
