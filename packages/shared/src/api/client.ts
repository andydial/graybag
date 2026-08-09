/**
 * The one place in the codebase that knows Supabase exists.
 *
 * Non-negotiable #1 and `A4`: every backend call from the app goes through this module.
 * Reads may use the Supabase client; **writes always go through Edge Functions.** ESLint
 * enforces both halves — `config/eslint-api-module.js` bans the import everywhere else and
 * bans `.insert()` / `.update()` / `.upsert()` / `.delete()` even in here.
 *
 * The promise that buys: "put a dedicated API server in front of this later" stays a
 * base-URL change rather than a rewrite. That promise is only true while the number of
 * files holding a client is one, and it degrades one convenient import at a time.
 *
 * ## Why the client is injected rather than constructed at import time
 *
 * A module-level `createClient(...)` would read the environment as a side effect of being
 * imported, which makes it impossible to unit-test anything downstream without a real URL,
 * and makes a missing variable a crash at startup rather than a diagnosable error at the
 * call site. `configureApi()` is called once from the app's entry point; tests call it with
 * a stub. The same pattern `setMenuCache` already uses in `apps/mobile`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ClientEnv } from '../env.js';

/**
 * The subset of the Supabase client this module actually uses.
 *
 * Narrow on purpose: a test double implements three methods rather than the whole surface,
 * and widening it is a visible diff rather than a quiet new dependency.
 */
export interface ApiTransport {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

let transport: ApiTransport | null = null;

/** Thrown when the module is used before `configureApi()` has run. */
export class ApiNotConfiguredError extends Error {
  constructor() {
    super(
      'The api/ module has not been configured. Call configureApi(env) once at app start, ' +
        'before any screen renders.',
    );
    this.name = 'ApiNotConfiguredError';
  }
}

/** Raised for any backend failure. Carries the provider code where there is one. */
export class ApiError extends Error {
  // `| undefined` is required by exactOptionalPropertyTypes: an optional property and a
  // property that may hold undefined are different types under it, and this one is assigned.
  readonly code?: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * Build a real Supabase client from the loaded environment and install it.
 *
 * `persistSession` is off and `autoRefreshToken` is on by default in the SDK; both are left
 * alone here because `E03` owns session storage and will configure them deliberately rather
 * than inheriting a decision made in passing during `E14`.
 */
export function configureApi(env: ClientEnv): void {
  transport = createClient(env.supabaseUrl, env.supabaseAnonKey) as unknown as ApiTransport;
}

/** Install a stub. Tests only. */
export function setApiTransport(next: ApiTransport | null): void {
  transport = next;
}

/** The configured transport, or a diagnosable error. */
export function getTransport(): ApiTransport {
  if (transport === null) throw new ApiNotConfiguredError();
  return transport;
}

/**
 * Call a Postgres function and unwrap Supabase's `{ data, error }` envelope.
 *
 * Centralised because every read in this module goes through it, and because the envelope
 * is the one place a backend failure can be silently treated as an empty result: `data`
 * is `null` both when the call failed and when the function legitimately returned nothing.
 * Collapsing that distinction is how an empty Menu tab ends up with no error anywhere.
 */
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getTransport().rpc(fn, args);
  if (error) throw new ApiError(error.message, error.code);
  return data as T;
}

export type { SupabaseClient };
