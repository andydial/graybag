import { useCallback, useEffect, useState } from 'react';
import { api } from '@graybag/shared';

import { useSession } from './SessionContext';

/**
 * Read the people this account can order for — **the only way a screen may.**
 *
 * ## Why this exists one layer below where the guard used to be
 *
 * `E03-26` gated `OrderTargetContext` on the session and asserted "no screen renders recipient
 * data without a session". That was not the property it tested. `ChildrenScreen` — the
 * "Who to order for" list — never used the context: it called `api.fetchRecipients()` in its own
 * effect, so gating the context left it untouched, and the structural guard walked every file
 * looking for `useOrderTarget(` and passed it. Andy found it on his phone the same evening:
 * signed out, his children were still listed.
 *
 * The mistake was placing the guard per-consumer. A screen is one of many; the **network read is
 * one door**, and this is it. Anything that wants recipients comes through here, and
 * `recipient-disclosure.test.tsx` fails the build if a file outside this module calls
 * `api.fetchRecipients` directly.
 *
 * ## Two sessions, and only one of them the user can leave
 *
 * `api.fetchRecipients` gates on `currentUser()` — the Supabase session in the keychain. Screens
 * gate on `SessionContext`. Those are different things and they disagreed: nothing in the app
 * ever called `api.signOut()`, so the keychain session survived a "sign out" that only ever
 * existed in the UI. Signing out now clears both (`useSignOut` below), and this hook refuses to
 * read at all unless the *app* says there is a session — so even if they drift again, the drift
 * cannot put a child's name on screen.
 */
export type RecipientsState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: readonly api.ApiRecipient[] }
  | { kind: 'signedOut' }
  | { kind: 'failed'; error: unknown };

export function useRecipients(): RecipientsState & { reload: () => void } {
  /**
   * **The session, not the audience.**
   *
   * An earlier draft gated this on `useAudience()`, which folds in the order *target*'s
   * hydration — so this hook silently required `OrderTargetProvider` as well, and any screen
   * mounted without one sat on `loading` forever. Wrong question: "who is selected to eat" has
   * nothing to do with "may I read this account's people". This asks only what it needs.
   */
  const { status } = useSession();
  const [state, setState] = useState<RecipientsState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // `unknown` holds — the stored session has not been read back. `signedOut` is a settled no.
  const mayRead = status === 'signedIn';
  const settledOut = status === 'signedOut';

  useEffect(() => {
    if (settledOut) {
      /**
       * Signed out is `signedOut` — **unless the client is not configured at all**, which is a
       * different sentence and a different screen (§5.21: N3 "you cannot see this" against N2
       * "we could not ask"). Telling someone to sign in when the app cannot reach the server
       * sends them to a sign-in that will also fail.
       *
       * `fetchRecipients` distinguishes them for free: no session resolves to `[]`, an
       * unconfigured transport throws. **The rows are discarded unread** — this call is asked
       * only which of the two situations it is in, never for its contents, so the gate holds
       * even if the two session notions ever drift apart again.
       */
      let live = true;
      api
        .fetchRecipients()
        .then(() => {
          if (live) setState({ kind: 'signedOut' });
        })
        .catch((error: unknown) => {
          if (live) setState({ kind: 'failed', error });
        });
      return () => {
        live = false;
      };
    }
    if (!mayRead) {
      setState({ kind: 'loading' });
      return;
    }

    let live = true;
    setState({ kind: 'loading' });
    api
      .fetchRecipients()
      .then((rows) => {
        if (live) setState({ kind: 'ready', rows });
      })
      .catch((error: unknown) => {
        // The error is carried, never read for text: an RLS refusal or a PostgREST failure can
        // quote the row it refused, and that row is a person (§13.3). Callers classify by shape.
        if (live) setState({ kind: 'failed', error });
      });
    return () => {
      live = false;
    };
  }, [mayRead, settledOut, attempt]);

  return { ...state, reload };
}

/**
 * Leave. **Both sessions**, in that order.
 *
 * The app had a Sign out row wired to nothing — `screens/index.tsx` never passed `onSignOut`, so
 * tapping it did precisely nothing while looking like it had worked. Underneath that, no code
 * path in the app had ever called `api.signOut()`, so even a wired-up local sign-out would have
 * left the keychain session intact and every read still succeeding.
 *
 * The Supabase session goes first: if that fails there is no point telling the UI the user is
 * out, because the next read would contradict it. If it succeeds, the app session follows and
 * `OrderTargetProvider` clears the target on the same transition.
 */
export function useSignOut(): () => Promise<void> {
  const { setSession } = useSession();
  return useCallback(async () => {
    await api.signOut();
    setSession({ status: 'signedOut', userId: null });
  }, [setSession]);
}
