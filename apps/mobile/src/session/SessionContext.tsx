import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@graybag/shared';

/**
 * Who is using the app, as far as navigation needs to know.
 *
 * **Real auth is `E03`.** This is the seam navigation is built against, not an
 * implementation: it holds whether there is a session and nothing else, because that is the
 * only fact routing depends on. When `E03` lands it replaces the body of this provider and
 * no screen changes.
 *
 * The default is deliberately `signedOut`, and it is the whole point. `AR7` makes
 * signup-to-first-order conversion a primary v1 goal, and the legacy funnel is the thing
 * being replaced — so the app must be fully browsable before anyone identifies themselves.
 * A default of "signed in" in the provider would let a screen be written that only works
 * for an authenticated user, and nothing would notice until a real first-run.
 */
export interface Session {
  /**
   * `unknown` until the stored session has been read back.
   *
   * **It is a third state because the alternative caused a data-protection defect.** Defaulting
   * to `signedOut` while the Supabase client still held a valid persisted session meant the app
   * had two answers to "am I signed in": this context said no, and every read said yes. Account
   * offered a Sign in button while the cart rendered a child's first name — children's data on
   * screen for whoever was holding the phone.
   *
   * A screen must render neither state until this resolves. It takes one keychain read.
   */
  status: 'unknown' | 'signedOut' | 'signedIn';
  userId: string | null;
  /**
   * The signed-in address, when the provider gave us one.
   *
   * **Null means "we do not know the address", never "there is no session".** Account used to
   * infer the second from the first — `email === null` fell into the same branch as
   * `access !== 'signedIn'` and printed "Not signed in" — so a signed-in parent was told they
   * were not, while every other screen disagreed. An identity provider is not obliged to return
   * an address, and a screen must not read one field as an answer about another.
   */
  email: string | null;
}

interface SessionValue extends Session {
  /** Test/`E03` seam. Not a login — it records the outcome of one. */
  setSession: (next: Session) => void;
}

const SIGNED_OUT: Session = { status: 'signedOut', userId: null, email: null };
const UNKNOWN: Session = { status: 'unknown', userId: null, email: null };

/**
 * **No provider means `unknown`, not signed out.**
 *
 * The difference decides what a component does when it is mounted outside the tree — and the
 * safe behaviour is to withhold, not to assert. `signedOut` is a claim ("there is nobody here"),
 * and a default should never make a claim it has not checked.
 */
const SessionContext = createContext<SessionValue>({
  ...UNKNOWN,
  setSession: () => {},
});

export function SessionProvider({
  children,
  initial = UNKNOWN,
}: {
  children: ReactNode;
  initial?: Session;
}) {
  const [session, setSession] = useState<Session>(initial);

  /**
   * Restore the session from where it actually lives.
   *
   * **This context was never the source of truth and behaved as though it were.** It started
   * `signedOut` and only `SignInScreen` ever wrote it — while the Supabase client persisted its
   * own session to the keychain (`persistSession: true`, `secureSessionStore`) and happily
   * answered reads after a restart.
   *
   * So the app held two answers to one question, and they disagreed on every cold start: this
   * one said signed out, the network said signed in. Account rendered a Sign in button, the
   * cart rendered a child's first name, and Home said there was nobody to order for — three
   * screens, three states, one user.
   *
   * The client's stored session is the authority, because it is the thing the server will
   * actually accept. This reads it back and mirrors it. Anything that wants "am I signed in"
   * asks here, and here asks the one place that knows.
   */
  useEffect(() => {
    let live = true;
    api
      .currentUser()
      .then((user) => {
        if (!live) return;
        setSession(
          user === null
            ? SIGNED_OUT
            : { status: 'signedIn', userId: user.userId, email: user.email },
        );
      })
      .catch(() => {
        // A failed read is not a signed-in user. Falling back to signed-out is the safe
        // direction: it withholds, where the opposite would show a child's name on a guess.
        if (live) setSession(SIGNED_OUT);
      });
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo(() => ({ ...session, setSession }), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/**
 * The one question routing asks.
 *
 * Written as a named helper rather than `status === 'signedIn'` inline so that every place
 * that gates on identity is greppable — `AR7` says any task adding a step between opening
 * the app and paying for a first order needs an explicit justification, and that review is
 * only possible if the gates are findable.
 */
export function requiresSignIn(session: Session): boolean {
  return session.status !== 'signedIn';
}

/**
 * Is it safe to render anything about a recipient?
 *
 * **Only when we positively know there is a session.** `unknown` is not a maybe to be resolved
 * optimistically — it is the window in which the old code showed a child's first name to
 * whoever was holding an unauthenticated phone.
 *
 * Every surface that draws a name, a class, a school or an allergy asks this first (§13.3,
 * non-negotiable #4).
 */
export function mayShowRecipientData(session: Session): boolean {
  return session.status === 'signedIn';
}
