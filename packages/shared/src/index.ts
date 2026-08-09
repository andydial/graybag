// @graybag/shared — types, validation, and the `api/` client module.
//
// Non-negotiable #1: every backend call from the mobile app goes through the `api/`
// module in this package. Reads may use the Supabase client; writes always go through
// Edge Functions.

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

// Ordering (E05). The calendar endpoint's decisions, and the rules between a cart and an
// order. The cutoff arithmetic itself is NOT here — it is §9.1's, it lives in SQL, and the
// client compares the instant this returns rather than recomputing it.
export * as ordering from './ordering/index.js';

// The one place paise become a string (design/type.ts's rule). Indian grouping, always two
// decimals, and a refusal to render a float — a component that formats money itself is the
// bug this module exists to make unnecessary.
export * as money from './money/index.js';

// The cart domain (E05-04). Pure, immutable operations — the cart has no table, because a
// cart is a draft of an intention and the order is the record. Carries the price the app
// displayed, which is the evidence L7's abort-on-mismatch check needs.
export * as cart from './cart/index.js';

// Design tokens (E13-01). One source, two outputs, no third (S8): `apps/mobile` imports
// these objects directly and `apps/web` generates CSS custom properties from the same
// modules at build time. Components import the semantic roles, never the ramps (S7).
export * as design from './design/index.js';

// The api/ module (A4, non-negotiable #1). The one place that knows Supabase exists, and
// the only directory permitted to import it — config/eslint-api-module.js fails the build
// anywhere else. Menu reads today; E03, E05 and E06 join this surface rather than growing
// a second one.
export * as api from './api/index.js';
