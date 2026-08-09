/**
 * Sign-in — `E03`, decision `U1`. Email OTP today; Google and Apple join this surface.
 *
 * ## The shape of the problem
 *
 * `SC3` changed what this epic is for. ~150 Amity parents re-register from scratch in a
 * compressed window, by hand, on whichever app is live. Every step between opening the app
 * and a first order costs some of them, and `AR7` is now a revenue constraint rather than a
 * principle. So the rules this module is written to:
 *
 *   * **No passwords** (`U1`). Nothing here accepts one, and there is no path that could.
 *   * **No separate email-verification step** (`AR4`). Verification is a *property* of both
 *     mechanisms — Google verifies the address, and an OTP cannot succeed on an address the
 *     user cannot read. Adding a "check your email to confirm" screen after an OTP would be
 *     verifying the same fact twice, with a blocking screen in between.
 *   * **One account per human** (`E03-15`). The same address arriving via Google and via
 *     OTP must resolve to one account, never two — see `linkingPolicy` below.
 *
 * ## Why this is a thin wrapper and not a state machine
 *
 * Supabase Auth already owns token refresh, expiry and the storage adapter. Re-implementing
 * any of that here would be a second opinion about when a token is stale, and the two would
 * disagree in exactly the situation nobody tests: an app resumed after a week. What this
 * module owns is the *vocabulary* — the four calls the app needs, in our language, with our
 * errors — so that swapping the provider later touches this file and nothing else.
 */
import { getTransport, ApiError } from './client.js';

/** The provider surface this module needs. Kept narrow so a test double is three methods. */
export interface AuthTransport {
  auth: {
    signInWithOtp(credentials: { email: string }): PromiseLike<{
      error: { message: string; status?: number } | null;
    }>;
    verifyOtp(params: { email: string; token: string; type: 'email' }): PromiseLike<{
      data: { user: { id: string; email?: string } | null } | null;
      error: { message: string; status?: number } | null;
    }>;
    signOut(): PromiseLike<{ error: { message: string } | null }>;
    getSession(): PromiseLike<{
      data: { session: { user: { id: string; email?: string } } | null } | null;
    }>;
  };
}

export interface AuthUser {
  userId: string;
  email: string | null;
}

/** Raised when a sign-in attempt fails in a way the user can act on. */
export class AuthError extends ApiError {
  constructor(message: string, code?: string) {
    super(message, code);
    this.name = 'AuthError';
  }
}

function authOf(): AuthTransport['auth'] {
  const transport = getTransport() as unknown as Partial<AuthTransport>;
  if (!transport.auth) {
    throw new ApiError(
      'The configured transport has no auth surface. configureApi() installs a real ' +
        'Supabase client; a test stub must provide `auth` to exercise sign-in.',
    );
  }
  return transport.auth;
}

/**
 * Normalise an address before it is used as an identity.
 *
 * Lowercased and trimmed, because `Parent@School.edu` and `parent@school.edu` are the same
 * mailbox and must not become two accounts — that is `E03-15`'s failure mode arriving
 * through the front door rather than through account linking.
 *
 * Deliberately **not** doing anything cleverer. Stripping dots or `+tag` suffixes is a
 * Gmail-specific convention, it is wrong for most other providers, and applying it would
 * merge two addresses that a school's mail server treats as different people. `E19-04`
 * already found ~15 parents whose accounts differ only by domain spelling, and the ruling
 * there was the same: do not merge automatically, because a wrong merge shows one parent
 * another family's child.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True for something that could plausibly be delivered to. Not a validator. */
export function looksLikeEmail(email: string): boolean {
  const value = normaliseEmail(email);
  // One @, something either side, a dot in the domain, no whitespace. Deliberately loose:
  // a regex that rejects a valid address is worse than one that accepts an invalid one,
  // because the OTP simply never arrives and the user can see that for themselves — but a
  // rejection at the keyboard is a wall with no explanation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Send a one-time code to an email address.
 *
 * `shouldCreateUser` is left at Supabase's default of `true`, and that is the `AR7`
 * decision in one flag: a parent who has never used GrayBag types their address and gets a
 * code, with no separate "create an account" step, no password, and no second screen. Sign
 * up and sign in are the same act.
 */
export async function sendEmailOtp(email: string): Promise<void> {
  const address = normaliseEmail(email);
  if (!looksLikeEmail(address)) {
    throw new AuthError('That does not look like an email address.', 'invalid_email');
  }

  const { error } = await authOf().signInWithOtp({ email: address });
  if (error) throw new AuthError(describe(error), 'otp_send_failed');
}

/**
 * Exchange a code for a session.
 *
 * Returns the user rather than a boolean, because the caller needs the id to put in
 * `SessionContext` and asking for it in a second call would be a second round trip on the
 * slowest screen in the flow.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<AuthUser> {
  const address = normaliseEmail(email);
  const code = token.trim();
  if (code === '') throw new AuthError('Enter the code from your email.', 'missing_code');

  const { data, error } = await authOf().verifyOtp({ email: address, token: code, type: 'email' });
  if (error) throw new AuthError(describe(error), 'otp_verify_failed');

  const user = data?.user;
  if (!user) {
    // A success with no user is a provider contract violation rather than a user error, and
    // it must not present as "wrong code" — that would send someone to re-request a code
    // forever against a backend that is never going to give them a session.
    throw new AuthError('Signed in, but no account came back. Please try again.', 'no_user');
  }
  return { userId: user.id, email: user.email ?? null };
}

/** End the session. Never throws — a sign-out that fails must still sign you out locally. */
export async function signOut(): Promise<void> {
  try {
    await authOf().signOut();
  } catch {
    // Deliberately swallowed. If the network is down, the user still tapped "sign out" and
    // the app must honour it; the local session is cleared by the provider regardless, and
    // a stranded refresh token expires on its own.
  }
}

/** The current user, or `null`. Called at start-up to restore a session. */
export async function currentUser(): Promise<AuthUser | null> {
  const { data } = await authOf().getSession();
  const user = data?.session?.user;
  return user ? { userId: user.id, email: user.email ?? null } : null;
}

/**
 * What `E03-15` requires of whatever identity provider is in play, written down here
 * because it is a property of the *backend* and no client code can enforce it.
 *
 * Supabase links identities by verified email address when
 * "Confirm email" / identity linking is on, so a parent who signed up with Google and later
 * uses email OTP on the same address lands on one `auth.users` row. **If that setting is
 * ever off, this silently becomes two accounts** — two carts, two children lists, two order
 * histories, and a support conversation that cannot be resolved without a manual merge.
 *
 * There is no client-side check that can detect it: from here, two accounts look exactly
 * like one person signing in twice. So it is asserted at the only place it can be — a
 * project setting, and a test that signs in both ways and compares the ids, which needs a
 * real project and belongs with `E03-12`.
 */
export const linkingPolicy = {
  requirement: 'one auth.users row per verified email address, across Google, Apple and OTP',
  enforcedBy: 'Supabase identity linking on verified email — a project setting, not code',
  verifiedBy: 'E03-12: sign in via Google and via OTP on one address, assert one user id',
} as const;

function describe(error: { message: string; status?: number }): string {
  // Rate limiting is the one provider error worth translating, because it is the one a
  // parent can act on and the raw text ("For security purposes, you can only request this
  // after 51 seconds") reads as a fault rather than an instruction.
  if (error.status === 429 || /rate limit|only request this after/i.test(error.message)) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return error.message;
}
