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
import { chunkedStore, memoryStore, type SessionStore } from './session-storage.js';

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
  /**
   * `IS NULL` / `IS NOT NULL`. Added for `fetchRecipients`, and widening this interface is
   * deliberately a visible diff rather than a method appearing at a call site.
   *
   * `eq(column, null)` is not the same query — PostgREST renders it as `= null`, which is
   * never true — so a revoked `guardian_link` would have been filtered by nothing at all.
   */
  is(column: string, value: null | boolean): SelectBuilder;
  /**
   * `<=`. Added for `fetchPendingPolicies`, which must not gate anyone on a policy version
   * that is published but whose `effective_from` has not arrived.
   */
  lte(column: string, value: unknown): SelectBuilder;
  /**
   * `>=`. Added for `fetchMonthlyRevenue` (`E10-10`), which reads a date range rather than a
   * single service date — and widening this interface is deliberately a visible diff rather than
   * a method quietly appearing at a call site.
   */
  gte(column: string, value: unknown): SelectBuilder;
  /**
   * Negation of another operator — `not('published_at', 'is', null)` is `IS NOT NULL`.
   *
   * `is(column, null)` is the opposite query, and there is no `isNot`. Added for
   * `fetchPendingPolicies`: an unpublished draft must never gate an order.
   */
  not(column: string, operator: string, value: unknown): SelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder;
  /**
   * A row cap. Added for `fetchOrders` (`E06-40`), and widening this interface is deliberately a
   * visible diff rather than a method appearing at a call site.
   *
   * The orders list is unbounded by nature — a family ordering daily accrues hundreds of rows a
   * year — and an uncapped read on a school-gate connection is the performance priority this
   * project names first. The screen shows upcoming and recent; it has never needed everything.
   */
  limit(count: number): SelectBuilder;
}

export interface TableRef {
  select(columns: string): SelectBuilder;
}

/**
 * Edge Function invocation. The ONLY way this module writes anything (`A4`).
 *
 * `method` was added for `E05-02`, and widening this interface is deliberately a visible
 * diff rather than a new option appearing at a call site — that is what the module comment
 * above asks for. `recipients` is the first endpoint with two verbs: a POST that adds a
 * child and a PATCH that moves an existing one, where the id is part of the path so a
 * client cannot send one id in the URL and another in the body.
 */
export interface FunctionsRef {
  invoke(
    name: string,
    options: { body?: unknown; headers?: Record<string, string>; method?: string },
  ): PromiseLike<{ data: unknown; error: (Error & { context?: Response }) | null }>;
}

export interface ApiTransport {
  from(table: string): TableRef;
  functions?: FunctionsRef;
}

let transport: ApiTransport | null = null;

/**
 * The configured Supabase origin, kept so `storagePublicUrl` can build an absolute URL.
 *
 * The client itself does not expose the URL it was built with, and every alternative is worse:
 * re-reading `process.env` here would bypass `loadClientEnv`'s validation, and threading the
 * origin through every call site would put a copy of it in six screens.
 */
let origin: string | null = null;

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
export function configureApi(env: ClientEnv, options: { sessionStore?: SessionStore } = {}): void {
  // `E03-20`. Without a store the session lives in memory and every cold start is a fresh
  // OTP — which, for ~150 parents re-registering by hand under `SC3`, is the difference
  // between signing in once and signing in every morning.
  //
  // `persistSession` and `autoRefreshToken` are both on: the refresh token is long-lived
  // by decision `U3` (90-180 days), and the whole point of that decision is that a
  // returning parent does not see an OTP. `detectSessionInUrl` is off because there is no
  // URL — it is a browser concern and leaving it on makes the client look for one.
  origin = env.supabaseUrl.replace(/\/+$/, '');
  transport = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: chunkedStore(options.sessionStore ?? memoryStore()),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }) as unknown as ApiTransport;
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

/**
 * Call an Edge Function. Writes never touch a table from here — `A4`, non-negotiable #1.
 *
 * `functions.invoke` reports a non-2xx as an `error` whose `context` is the raw `Response`,
 * so the server's own refusal body is behind one more `await`. Reading it matters: the
 * checkout's 409 carries a `code` the app maps to a sentence a parent can act on, and
 * without this the whole class collapses into "something went wrong".
 */
export async function invokeFunction<T>(
  name: string,
  body: unknown,
  /** Defaults to POST, which is what every write was until `E05-02` added a PATCH. */
  method?: string,
): Promise<T> {
  const functions = getTransport().functions;
  if (!functions) {
    throw new ApiError(
      'The configured transport cannot invoke Edge Functions. configureApi() installs a ' +
        'real client; a test stub must provide `functions` to exercise a write.',
    );
  }

  const { data, error } = await functions.invoke(name, {
    body,
    ...(method === undefined ? {} : { method }),
  });
  if (!error) return data as T;

  const response = error.context;
  if (response) {
    try {
      const payload = (await response.json()) as { code?: string; message?: string; error?: string };
      throw new ApiError(payload.message ?? payload.error ?? error.message, payload.code);
    } catch (parsed) {
      if (parsed instanceof ApiError) throw parsed;
      // The body was not JSON. Fall through to the transport's own message rather than
      // losing the failure entirely.
    }
  }
  throw new ApiError(error.message);
}

/**
 * Turn a Storage key into an absolute public URL.
 *
 * `asset.path` — and therefore `public_menu.image_path` — holds a **key**, not a URL:
 * `dishes/<file>.png`. That is the right thing to store. `asset` has its own `bucket` column
 * and a `unique (bucket, path)`, both of which are meaningless if the path is a URL, and a URL
 * would bake one project's hostname into data that gets promoted between environments.
 *
 * But React Native's `<Image source={{ uri }}>` needs an absolute URL, so something has to do
 * the conversion. It belongs here, in the one module that knows which project is configured,
 * rather than in each screen — which is how six screens would come to hold six copies of a
 * hostname.
 *
 * Returns `null` for a null key or before `configureApi` has run: a bare key rendered as a URI
 * fails silently as a broken image, and a null at least reaches the "no photo" branch that
 * every dish surface already draws properly (`E21`'s pattern tile, never a grey box).
 */
export function storagePublicUrl(bucket: string, key: string | null): string | null {
  if (key === null || key === '') return null;
  if (origin === null) return null;
  // Already absolute — a caller that has done this once must not have it done twice.
  if (/^https?:\/\//i.test(key)) return key;
  return `${origin}/storage/v1/object/public/${bucket}/${key.replace(/^\/+/, '')}`;
}

/** The bucket dish photography lives in — `0002` §15 creates it, `E16-43` fills it. */
export const DISH_IMAGE_BUCKET = 'dish-images';

export type { SupabaseClient };
