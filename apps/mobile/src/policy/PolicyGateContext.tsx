import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from '@graybag/shared';

import { usePendingPolicy } from './usePendingPolicy';

/**
 * One answer to "does this parent owe us a policy acceptance" — `E20-36`.
 *
 * ## Why a context rather than route params
 *
 * The cart decides whether to open the gate; the gate screen needs the version; and after an
 * acceptance both have to agree it is gone. Passing the version as a navigation param would
 * give the two screens **two copies of the same answer**, and the accepted-but-still-pending
 * state that follows is exactly the class of bug `useAudience` was written to end — seven call
 * sites each deriving session state independently.
 *
 * So the read happens once, above the navigator, and both sides read the same value.
 */
interface PolicyGateValue {
  /** Versions still to accept. Empty means ordering is not gated. */
  pending: api.PendingPolicy[];
  /** True while the first read for this session is in flight. Never blocks the UI. */
  loading: boolean;
  /** Drop a version once accepted. */
  clear: (versionId: string) => void;
  /** Re-read, after a failure. */
  refresh: () => void;
}

/**
 * The default is "nothing pending", which is the fail-open direction — see `usePendingPolicy`.
 * A component reading this without a provider does not gate anyone, and the orphan guard is
 * what makes sure there *is* a provider rather than every screen quietly reading this default.
 * That is the exact defect (`OrderTargetProvider`) this file was written in the shadow of.
 */
const PolicyGateContext = createContext<PolicyGateValue>({
  pending: [],
  loading: false,
  clear: () => {},
  refresh: () => {},
});

export function PolicyGateProvider({ children }: { children: ReactNode }) {
  const { pending, loading, clear, refresh } = usePendingPolicy();
  const value = useMemo(
    () => ({ pending, loading, clear, refresh }),
    [pending, loading, clear, refresh],
  );
  return <PolicyGateContext.Provider value={value}>{children}</PolicyGateContext.Provider>;
}

export function usePolicyGate(): PolicyGateValue {
  return useContext(PolicyGateContext);
}

/**
 * The version to show, or `null` when nothing is pending.
 *
 * One at a time, oldest-effective first (`fetchPendingPolicies` returns newest first, so this
 * takes the last). Two policies changing at once is rare, and stacking two full-screen consent
 * gates back to back is how people learn to tap through them.
 */
export function useNextPendingPolicy(): api.PendingPolicy | null {
  const { pending } = usePolicyGate();
  return pending.length === 0 ? null : (pending[pending.length - 1] ?? null);
}
