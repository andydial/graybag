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
export interface ProviderError {
  message: string;
  code?: string;
}

export interface QueryResult {
  data: unknown;
  error: ProviderError | null;
}

/**
 * The fluent subset of PostgREST's query builder this module uses.
 *
 * Structural rather than imported from `@supabase/supabase-js` so a test double is an
 * object literal instead of a mocked client — and so that widening what we depend on is a
 * visible change to this interface rather than a new method call somewhere in a query.
 */
export interface SelectBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): SelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder;
}

export interface TableRef {
  select(columns: string): SelectBuilder;
}

export interface ApiTransport {
  from(table: string): TableRef;
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
 * Run a read and unwrap PostgREST's `{ data, error }` envelope.
 *
 * Centralised because every read in this module goes through it, and because the envelope
 * is the one place a backend failure can be silently treated as an empty result: `data` is
 * `null` both when the request failed and when the query legitimately matched nothing.
 * Collapsing that distinction is how an empty Menu tab ends up with no error anywhere —
 * and under `[AUTH-01]` it is doubly important, because a policy that stops matching rows
 * looks exactly like a school with no menu.
 */
export async function runQuery<T>(build: (t: ApiTransport) => SelectBuilder): Promise<T[]> {
  const { data, error } = await build(getTransport());
  if (error) throw new ApiError(error.message, error.code);
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new ApiError('Expected a list of rows from the backend.');
  return data as T[];
}

export type { SupabaseClient };
