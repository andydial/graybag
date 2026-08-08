import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

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
  status: 'signedOut' | 'signedIn';
  userId: string | null;
}

interface SessionValue extends Session {
  /** Test/`E03` seam. Not a login — it records the outcome of one. */
  setSession: (next: Session) => void;
}

const SIGNED_OUT: Session = { status: 'signedOut', userId: null };

const SessionContext = createContext<SessionValue>({
  ...SIGNED_OUT,
  setSession: () => {},
});

export function SessionProvider({
  children,
  initial = SIGNED_OUT,
}: {
  children: ReactNode;
  initial?: Session;
}) {
  const [session, setSession] = useState<Session>(initial);
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
