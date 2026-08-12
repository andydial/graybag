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
 * ## Where the session is kept, and why not `localStorage`
 *
 * A kitchen tablet is shared and is never locked. `localStorage` would leave a signed-in
 * back-office session on the device for the next person, and that session can read every child's
 * name in the school.
 *
 * So the session lives in **`sessionStorage`**: it survives a reload and a navigation, which is
 * what makes the tool usable, and it dies when the tab closes. That is a deliberate trade
 * against `U3`'s long-lived refresh token, which exists for a parent on their own phone — the
 * opposite device.
 *
 * It is cheap and reversible: one line here, and nothing else knows the difference.
 */

const SESSION_PREFIX = 'gb.backoffice.';

/**
 * `sessionStorage`, wrapped to the shape `configureApi` wants.
 *
 * Falls back to memory when storage is unavailable — a locked-down browser or private mode
 * should still be able to sign in for the length of one visit rather than fail at load.
 */
function tabScopedStore() {
  const memory = new Map<string, string>();
  const available = (() => {
    try {
      const probe = `${SESSION_PREFIX}probe`;
      sessionStorage.setItem(probe, '1');
      sessionStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  })();

  // `SessionStore` is async — Supabase's storage adapter may be backed by something that is,
  // and on React Native it is. Synchronous work wrapped in a resolved promise satisfies it.
  return {
    getItem: async (key: string) =>
      available ? sessionStorage.getItem(SESSION_PREFIX + key) : (memory.get(key) ?? null),
    setItem: async (key: string, value: string) => {
      if (available) sessionStorage.setItem(SESSION_PREFIX + key, value);
      else memory.set(key, value);
    },
    removeItem: async (key: string) => {
      if (available) sessionStorage.removeItem(SESSION_PREFIX + key);
      else memory.delete(key);
    },
  };
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

  api.configureApi(env, { sessionStore: tabScopedStore() });
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

export async function signOut(): Promise<void> {
  configureBackofficeApi();
  await api.signOut();
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
