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
 * ## Where the session is kept — `localStorage`, two windows (`E12-42`)
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
 * ## Two windows, not one — Andy, 2026-09-08
 *
 * *"Make the 30 days slide: each successful refresh extends the expiry to 30 days from that
 * moment, so a device in regular use never sees an OTP. Keep the absolute cap sensible — 90 days
 * from original sign-in — so an abandoned device does eventually expire."*
 *
 *  - **Idle window, 30 days, sliding.** Measured from the last session write and pushed forward
 *    by every one. A tablet used weekly never reaches it.
 *  - **Absolute window, 90 days, fixed.** Measured from the original sign-in and **never**
 *    extended. It is what makes the sliding window safe to have.
 *
 * The first version of this shipped a single 30-day window measured from sign-in and never
 * re-stamped, on the reasoning that a sliding window "would never be reached by anyone still
 * using the tool, which is the one population it is for". That reasoning was right about the
 * mechanism and wrong about the goal: a device *in regular use* never seeing an OTP is the point,
 * not a hole. What the objection was actually describing is a session with no ceiling at all —
 * and the absolute cap is the ceiling, so both properties can be had at once. Two windows is the
 * correct shape; one was a false economy.
 *
 * Three things make the whole arrangement safe enough to do:
 *
 *  - **Both caps are client-side, because nothing else will do it.** `sessions_timebox` and
 *    `sessions_inactivity_timeout` are both `0` on production and staging, so Supabase never ends
 *    this session. These two constants are the only bound that exists.
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
 * When this session was originally signed into. Written once, **never** moved.
 *
 * The absolute 90-day window is measured from here, and the whole value of that window is that no
 * amount of use can push it forward. Under the same prefix as the session itself so
 * `purgeSession` takes it away with everything else — a stamp that outlived its session would
 * date the *next* one from the *last* one's sign-in, and the person would be signed out early for
 * no reason they could see.
 */
const STARTED_AT_KEY = `${SESSION_PREFIX}started-at`;

/**
 * When the session was last written, which is what the sliding 30-day window measures from.
 *
 * Updated by every session write. Supabase writes this store on sign-in, on each silent refresh
 * (roughly hourly, driven by `jwt_exp: 3600`), and on user changes — so a write is evidence that
 * an authenticated client is running, which is exactly what "still in use" means here. A *read*
 * does not extend it: a tab sitting on a stale page with no working refresh is not a device in
 * regular use, and treating it as one would make the idle window unreachable.
 */
const LAST_SEEN_KEY = `${SESSION_PREFIX}last-seen-at`;

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

/**
 * The sliding window: 30 days since the last session write, pushed forward by every one.
 *
 * Andy, 2026-09-08 — *"so a device in regular use never sees an OTP"*.
 */
export const SESSION_IDLE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The ceiling: 90 days from the original sign-in, and nothing extends it.
 *
 * This is what makes the sliding window above safe to have. Without it a tablet refreshing hourly
 * would hold a session for ever, which is not a long session but an unbounded one.
 */
export const SESSION_ABSOLUTE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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

/** The two stamps, as they come out of storage. */
export interface SessionWindow {
  /** Original sign-in. Feeds the absolute 90-day window. */
  startedAt: string | null;
  /** Last session write. Feeds the sliding 30-day window. */
  lastSeenAt: string | null;
}

/**
 * Has this session outlived **either** window?
 *
 * Both are checked, and either one ends it: 30 days since the last write, or 90 days since the
 * original sign-in whatever has happened in between.
 *
 * Three cases are deliberate rather than incidental:
 *
 *  - **Both stamps absent → live.** A session written by a build that predates them, which must
 *    not be signed out by the deploy that lengthens sessions. `persistentStore` stamps it on the
 *    first write instead.
 *  - **`lastSeenAt` absent but `startedAt` present → measure the idle window from `startedAt`.**
 *    This is the real upgrade path, not a hypothetical: the first version of `E12-42` wrote only
 *    `started-at`, so every session created by it arrives here with exactly this shape. Treating
 *    the missing stamp as "never seen" would sign those people out immediately; treating it as
 *    absent-therefore-fine would leave them with no idle window at all.
 *  - **An unreadable stamp → expired.** It should not be possible, and the safe direction for a
 *    value we cannot interpret is the one that asks for an OTP, not the one that skips it.
 */
export function sessionHasExpired({ startedAt, lastSeenAt }: SessionWindow, now: number): boolean {
  if (startedAt === null && lastSeenAt === null) return false;

  const started = parseStamp(startedAt);
  // Falls back to the sign-in stamp, which is the only honest reading when the session was
  // written by the build before this one.
  const seen = lastSeenAt === null ? started : parseStamp(lastSeenAt);

  if (started === null || seen === null) return true;

  return (
    now - started >= SESSION_ABSOLUTE_MAX_AGE_MS || now - seen >= SESSION_IDLE_MAX_AGE_MS
  );
}

/** A stamp as milliseconds, or `null` when it cannot be read as one. */
function parseStamp(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
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
 * Once a window has closed in this tab, it stays closed until a new sign-in — `E12-42`.
 *
 * **A sliding window opens a hole that a fixed one did not, and this is the plug.** Purging
 * expired keys is not enough on its own: the Supabase client that has been running in this tab
 * still holds the session *in memory*, and its next silent refresh writes it straight back. With
 * the old fixed stamp that was survivable, because `started-at` was absent afterwards and got
 * re-stamped to a value that was still ninety days from nothing. With a sliding window it is a
 * resurrection: the write sets `last-seen-at` to now, and the session that just expired is good
 * for another thirty days without anybody authenticating.
 *
 * So expiry is latched in memory. Reads return nothing and writes are refused for the life of the
 * tab, whatever the client does afterwards — and `resetSessionWindow` is the only way back, which
 * `verifyCode` calls after an OTP is actually accepted.
 */
let windowClosed = false;

/**
 * Start a fresh pair of windows. Called after a **successful** OTP verification, never before.
 *
 * Both stamps are written explicitly rather than left to `setItem`'s absent-key path. Signing in
 * on a browser that still carries an 89-day-old `started-at` would otherwise inherit it and expire
 * the new session a day later, for reasons the person could not possibly work out.
 */
export function resetSessionWindow(storage: KeyValueStorage | null = safeLocalStorage()): void {
  windowClosed = false;
  if (!storage) return;
  const now = String(Date.now());
  try {
    storage.setItem(STARTED_AT_KEY, now);
    storage.setItem(LAST_SEEN_KEY, now);
  } catch {
    // A store that refuses the stamps costs a shorter session, never a failed sign-in.
  }
}

/**
 * `localStorage`, wrapped to the shape `configureApi` wants, with both windows applied.
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
   * The store, with both windows applied — checked on **every** access rather than once at load.
   *
   * A kitchen board is left open for a whole service and a tab can sit untouched for days. A cap
   * enforced only at start-up would let a session that expired an hour ago keep working until
   * somebody reloaded, which is precisely the window an expiry exists to close.
   *
   * Returns `null` once a window has closed, so the caller takes the same path as "no storage at
   * all" — reads find nothing and writes go to memory that no later page load will read.
   */
  const live = (): KeyValueStorage | null => {
    if (!backing || windowClosed) return null;
    const expired = sessionHasExpired(
      { startedAt: backing.getItem(STARTED_AT_KEY), lastSeenAt: backing.getItem(LAST_SEEN_KEY) },
      Date.now(),
    );
    if (expired) {
      purgeSession(backing);
      windowClosed = true;
      return null;
    }
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
      const now = String(Date.now());
      /*
       * `started-at` is written only when absent, and **never moved** — the 90-day ceiling is
       * worth nothing if use can push it forward. `last-seen-at` is written on every session
       * write, which is what makes the 30-day window slide.
       *
       * Supabase writes this store on sign-in, on each silent refresh, and on user changes, and
       * `chunkedStore` splits a session across several keys — so this runs a handful of times an
       * hour. Two `localStorage` writes at that rate cost nothing worth throttling for, and a
       * throttle would be one more piece of state to get wrong.
       */
      if (store.getItem(STARTED_AT_KEY) === null) store.setItem(STARTED_AT_KEY, now);
      store.setItem(LAST_SEEN_KEY, now);
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

/**
 * Exchange a code for a session, and start both windows fresh.
 *
 * **The latch is opened before the exchange, and the stamps are written after it.** Those two
 * halves are at different points on purpose, and putting both at the end does not work: Supabase
 * persists the new session *during* `verifyEmailOtp`, so a latch still closed at that moment
 * sends the freshly minted token to the in-memory fallback and it is gone on the next page load —
 * the person signs in, lands on the board, and is signed out again by their first reload.
 *
 * Opening it early resurrects nothing. The latch only ever closes alongside a `purgeSession`, so
 * the store it reopens is empty; and on the common path — a page loaded after the window shut —
 * there is no in-memory client left to write anything back.
 *
 * The stamps are written after success and never before, so a wrong code at `/signin` cannot
 * extend anybody's session.
 */
export async function verifyCode(email: string, token: string): Promise<SignedInUser> {
  configureBackofficeApi();
  windowClosed = false;
  const user = await api.verifyEmailOtp(email, token);
  resetSessionWindow();
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
