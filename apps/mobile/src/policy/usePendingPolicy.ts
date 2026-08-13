import { useCallback, useEffect, useState } from 'react';
import { api } from '@graybag/shared';

import { useAudience } from '../session/audience';

/**
 * Whether this parent owes us a policy acceptance before their next order — `E20-36`.
 *
 * ## Why it is a hook and not a check inside `placeOrder`
 *
 * The gate has to be decided **before** the button is pressed. Doing the read inside the press
 * handler would put a network round trip between the tap and any response at all, on the one
 * screen where a stall reads as "the order failed" — and `AR7` treats the tap-to-first-order
 * path as the thing not to make worse. So the answer is fetched while the cart sits there and
 * the press is a synchronous decision on an answer already in hand.
 *
 * ## Not knowing means not blocking
 *
 * If the read fails — offline, backend down — `pending` stays empty and ordering proceeds. That
 * is deliberate and it is the smaller harm: the alternative is a parent unable to order because
 * a *policy* read timed out, which converts an unrelated outage into lost revenue and a support
 * call. The acceptance requirement is also enforced server-side at order creation
 * (`user_policy_acceptance`'s comment, `E20-03`), so a client that fails open cannot let an
 * order through that the server would refuse — it just fails later and more honestly than a
 * screen that will not open.
 *
 * ## Only for someone who could actually order
 *
 * `visitor` and `unknown` do not fetch. There is no user to have acceptances, the read would be
 * refused by RLS anyway, and firing it on every cold start would put a request in front of the
 * menu for someone who has not signed in — which is the shape `AR7` exists to forbid.
 */
export function usePendingPolicy(): {
  /** Versions still to accept. Empty means ordering is not gated. */
  pending: api.PendingPolicy[];
  /** True while the first read for this session is in flight. Never blocks the UI. */
  loading: boolean;
  /** Drop the named version from `pending` after it has been accepted. */
  clear: (versionId: string) => void;
  /** Re-read. Used after an acceptance fails, so a retry is not decided on stale state. */
  refresh: () => void;
} {
  const audience = useAudience();
  const signedIn = audience.kind === 'needsRecipient' || audience.kind === 'ordering';
  const userId = signedIn ? audience.userId : null;

  const [pending, setPending] = useState<api.PendingPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (userId === null) {
      setPending([]);
      return;
    }

    // `cancelled` rather than an AbortController: the read is a PostgREST call through the
    // api/ module, which does not take a signal, and the only thing that matters here is not
    // writing state into an unmounted tree.
    let cancelled = false;
    setLoading(true);

    api
      .fetchPendingPolicies()
      .then((versions) => {
        if (!cancelled) setPending(versions);
      })
      .catch(() => {
        // Fails open — see the note above. Deliberately not logged: `api/` already surfaces
        // failures, and a log line here would run on every cold start of every signed-in
        // install for a condition that is usually just "offline".
        if (!cancelled) setPending([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, nonce]);

  const clear = useCallback((versionId: string) => {
    setPending((held) => held.filter((v) => v.versionId !== versionId));
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { pending, loading, clear, refresh };
}
