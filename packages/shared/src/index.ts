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
