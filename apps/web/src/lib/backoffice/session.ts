import { api, type ClientEnv } from '@graybag/shared';

/**
 * Back-office sign-in for the web app (`E12-06`).
 *
 * **Email OTP, no passwords** — `U1`, non-negotiable #7. The back office uses email rather than
 * Google because a kitchen account is an *organisational* identity that an administrator grants
 * and revokes, not a personal one; tying it to somebody's Google account makes offboarding a
 * conversation instead of a database row.
 *
 * The parent-facing app and this share `packages/shared/src/api/auth.ts`, so there is one OTP
 * implementation and one set of rules about what a wrong code does.
 *
 * ## Where the session is kept — `localStorage`, capped at 30 days (`E12-42`)
 *
 * **This reverses a deliberate earlier decision, so the reasoning for both is kept.** The session
 * used to live in `sessionStorage`: it survived a reload and a navigation and died when the tab
 * closed, on the argument that a kitchen tablet is shared and never locked, and that a session
 * left behind can read every child's name in the school.
 *
 * That argument was sound and the cost of it was not visible until the tool was in daily use.
 * `sessionStorage` is scoped to the **tab**, so closing the tab, restarting the tablet or opening
 * the board in a second window destroyed the session — and the operator did the email-and-OTP
 * dance again, including at 3am when a device had rebooted overnight. It was never token expiry:
 * `persistSession` and `autoRefreshToken` have always been on and the refresh path has always
 * worked. It was storage lifetime.
 *
 * Andy, 2026-09-08: a signed-in back-office user on the same browser stays signed in for **30
 * days** without re-entering an OTP.
 *
 * Three things make that safe enough to do:
 *
 *  - **The cap is real and client-side.** Supabase itself would keep this session alive for ever
 *    — `sessions_timebox` and `sessions_inactivity_timeout` are both `0` on both projects, so
 *    nothing server-side ever ends it. `SESSION_MAX_AGE_MS` is what bounds it, and it is measured
 *    from signing in and **never re-stamped on a refresh**, so it is a 30-day cap and not a
 *    window that slides forward for ever.
 *  - **Sign out works and is on the page.** It was not: `E10-55` moved the back office onto
 *    `BackofficeShell` and the only Sign out button in the product went with the nav it replaced.
 *    A long session with no way to end it is the version of this change that would have been
 *    wrong; the button lands in the same commit.
 *  - **The board still writes no child data to disk.** `MEMORY_ONLY` in `kitchen/types.ts` is
 *    untouched. What persists is a session, not a name.
 *
 * The residual risk is stated rather than argued away: on a **shared** tablet this leaves a
 * signed-in session for the next person until somebody signs out. That is the trade Andy asked
 * for, with his reason — the OTP dance was costing more, every day, than the exposure.
 */

const SESSION_PREFIX = 'gb.backoffice.';

/**
 * When a session started, so the 30-day cap has something to measure from.
 *
 * Under the same prefix as the session itself so `purgeSession` takes it away with everything
 * else — a stamp that outlived its session would date the *next* one from the *last* one's
 * sign-in, and the person would be signed out early for no reason they could see.
 */
const STARTED_AT_KEY = `${SESSION_PREFIX}started-at`;

/**
 * The last address that signed in on this browser, so `/signin` can prefill it (`E12-42`).
 *
 * **The address and nothing else.** Never a token, never a code, never a user id — a six-digit
 * code sitting in `localStorage` would turn "I have this device" into "I have this account", and
 * defeat the point of the second factor being sent somewhere else. `rememberEmail` refuses
 * anything that does not look like an email address, so the shape of the value is enforced at the
 * one place that writes it rather than trusted at the call sites.
 *
 * It deliberately **survives sign-out and expiry**. It is a convenience for a returning operator,
 * not a credential, and clearing it would mean the person who signs out is the one person who has
 * to retype their address.
 */
export const LAST_EMAIL_KEY = `${SESSION_PREFIX}last-email`;

/** 30 days, from Andy on 2026-09-08. Measured from signing in, never extended by a refresh. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The part of `localStorage` this file uses, as an interface.
 *
 * `apps/web` runs its unit tests in Node with no DOM, and the rules below — when a session has
 * expired, what a purge takes and what it leaves — are the part worth testing. Taking the storage
 * as an argument makes them testable with an object literal instead of a jsdom environment, which
 * is the same reasoning `configureApi` uses for the Supabase client.
 */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Has this session outlived the cap?
 *
 * An **absent** stamp is not expired. It is a session that predates this file — or one written by
 * a build that had not yet stamped it — and signing those people out on the deploy that gives
 * them longer sessions would be a perverse way to ship this. `persistentStore` stamps them on
 * first write instead.
 *
 * An **unreadable** stamp is expired. It should not be possible, and the safe direction for a
 * value we cannot interpret is the one that asks for the OTP rather than the one that skips it.
 */
export function sessionHasExpired(startedAt: string | null, now: number): boolean {
  if (startedAt === null) return false;
  const at = Number.parseInt(startedAt, 10);
  if (!Number.isFinite(at)) return true;
  return now - at >= SESSION_MAX_AGE_MS;
}

/**
 * Take away every back-office session key, and leave the remembered address.
 *
 * Keys are collected before anything is removed. Removing while walking `length`/`key(i)` skips
 * entries, because the indices shift underneath the loop — which would leave a refresh token
 * behind on a sign-out, and that is the one bug this function must not have.
 */
export function purgeSession(storage: KeyValueStorage): void {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(SESSION_PREFIX) && key !== LAST_EMAIL_KEY) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

/**
 * `localStorage`, wrapped to the shape `configureApi` wants, and capped at 30 days.
 *
 * Falls back to memory when storage is unavailable — a locked-down browser or private mode should
 * still be able to sign in for the length of one visit rather than fail at load. That fallback is
 * the old `sessionStorage` behaviour by another route, and it is the correct one there: a store
 * that cannot persist must not pretend to.
 */
function persistentStore() {
  const memory = new Map<string, string>();
  const backing: KeyValueStorage | null = (() => {
    try {
      const probe = `${SESSION_PREFIX}probe`;
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch {
      return null;
    }
  })();

  /**
   * The store, with the cap applied — checked on **every** access rather than once at load.
   *
   * A kitchen board is left open for a whole service and a tab can sit untouched for days. A cap
   * enforced only at start-up would let a session that expired an hour ago keep working until
   * somebody reloaded, which is precisely the window an expiry exists to close.
   */
  const live = (): KeyValueStorage | null => {
    if (!backing) return null;
    if (sessionHasExpired(backing.getItem(STARTED_AT_KEY), Date.now())) purgeSession(backing);
    return backing;
  };

  // `SessionStore` is async — Supabase's storage adapter may be backed by something that is,
  // and on React Native it is. Synchronous work wrapped in a resolved promise satisfies it.
  return {
    getItem: async (key: string) => {
      const store = live();
      return store ? store.getItem(SESSION_PREFIX + key) : (memory.get(key) ?? null);
    },
    setItem: async (key: string, value: string) => {
      const store = live();
      if (!store) {
        memory.set(key, value);
        return;
      }
      // Stamped the first time a session is written and **never re-stamped**. Supabase writes
      // this key again on every silent refresh, so re-stamping would push the deadline forward
      // roughly hourly and the cap would never be reached by anyone still using the tool — which
      // is the one population it is for.
      if (store.getItem(STARTED_AT_KEY) === null) store.setItem(STARTED_AT_KEY, String(Date.now()));
      store.setItem(SESSION_PREFIX + key, value);
    },
    removeItem: async (key: string) => {
      const store = live();
      if (store) store.removeItem(SESSION_PREFIX + key);
      else memory.delete(key);
    },
  };
}

/**
 * Remember the address that just signed in, so the next visit does not retype it.
 *
 * Refuses anything without an `@` and a dot after it. This is the only writer, so "the value under
 * this key is an email address" is a property of the code rather than a convention — and the test
 * that asserts a code is never stored has one function to point at.
 */
export function rememberEmail(email: string, storage: KeyValueStorage | null = safeLocalStorage()): void {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
  try {
    storage?.setItem(LAST_EMAIL_KEY, value);
  } catch {
    // A full or blocked store costs a prefill, nothing more. Never a failed sign-in.
  }
}

/** The address to prefill `/signin` with, or `''` when there is nothing to offer. */
export function lastEmail(storage: KeyValueStorage | null = safeLocalStorage()): string {
  try {
    return storage?.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

/** `localStorage`, or `null` where it throws — private mode, or a browser with storage blocked. */
function safeLocalStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let configured = false;

/**
 * Configure the `api/` module once, from the build's public environment.
 *
 * Both values are publishable by design — the anon key ships in the bundle and RLS is the
 * control, not the key (`env.ts`). `razorpayKeyId` is required by `ClientEnv` and irrelevant
 * here: the back office takes no payments, and an empty string is honest about that rather than
 * a copy of a key this surface has no use for.
 */
export function configureBackofficeApi(): void {
  if (configured) return;

  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Deliberately its own error rather than letting the first query fail oddly. `ux-spec`
    // §5.20 is the app's version of this lesson: an unconfigured client that opens anyway makes
    // every later screen fail in its own way, and an empty menu look like a data problem.
    throw new Error(
      'PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are not set. The back office cannot ' +
        'reach the server. In development, put them in apps/web/.env.',
    );
  }

  const env: ClientEnv = {
    appEnv: (import.meta.env.PUBLIC_APP_ENV ?? 'staging') as ClientEnv['appEnv'],
    supabaseUrl,
    supabaseAnonKey,
    razorpayKeyId: '',
  };

  api.configureApi(env, { sessionStore: persistentStore() });
  configured = true;
}

export interface SignedInUser {
  id: string;
  email: string | null;
}

export async function currentUser(): Promise<SignedInUser | null> {
  configureBackofficeApi();
  const user = await api.currentUser();
  return user ? { id: user.userId, email: user.email } : null;
}

export async function sendCode(email: string): Promise<void> {
  configureBackofficeApi();
  await api.sendEmailOtp(email);
}

export async function verifyCode(email: string, token: string): Promise<SignedInUser> {
  configureBackofficeApi();
  const user = await api.verifyEmailOtp(email, token);
  return { id: user.userId, email: user.email };
}

/**
 * End the session, and leave nothing of it behind.
 *
 * `api.signOut()` removes the key Supabase wrote; `purgeSession` removes the started-at stamp and
 * anything else under the prefix. Both, because they know about different keys and the stamp is
 * ours — leaving it would date the next session from this one's sign-in.
 *
 * The purge runs even when the server call fails. A sign-out that reports an error and leaves a
 * usable refresh token on a shared tablet is the worst of the possible outcomes: the person
 * believes they have signed out, and they have not.
 */
export async function signOut(): Promise<void> {
  configureBackofficeApi();
  try {
    await api.signOut();
  } finally {
    const store = safeLocalStorage();
    if (store) purgeSession(store);
  }
}

/**
 * How long before a resend is offered, and why it is anchored to a timestamp.
 *
 * A countdown driven by an in-memory tick restarts when the tab is backgrounded — which either
 * lets somebody spam resends or blocks a legitimate one. `ux-spec` §5.9.1 makes the same point
 * for the app, and a kitchen tablet is backgrounded constantly.
 */
export const RESEND_AFTER_MS = 30_000;

export function resendAvailableIn(sentAt: number, now: number): number {
  return Math.max(0, RESEND_AFTER_MS - (now - sentAt));
}

/** Six digits, and only six. Anything else is not worth a round trip. */
export function looksLikeCode(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}
