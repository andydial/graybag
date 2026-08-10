import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

/**
 * Whether the app can currently reach GrayBag — `E14-26`.
 *
 * ## Why this exists
 *
 * Six screens take an `offline` or `stale` prop and **nothing supplied it**, so every offline
 * state in the product was unreachable: written, styled, tested, and impossible to see. The
 * same shape as the other orphans, in a place where the consequence is that a parent on a
 * patchy connection gets a blank screen instead of an explanation.
 *
 * ## Why it does not use NetInfo
 *
 * `@react-native-community/netinfo` and `expo-network` are both **native** modules. Adding one
 * means a new dev-client build before anything runs — and a JS bundle that calls a native
 * module the installed client does not have does not degrade, it throws on load. Shipping that
 * overnight would replace "the offline state is invisible" with "the app does not open", which
 * is a much worse trade.
 *
 * So this is pure JavaScript and works in the client that is already installed. `E14-28` swaps
 * in a real link-layer signal when a new build is due; only this file changes.
 *
 * ## What it actually measures, and what it does not
 *
 * **It measures reachability of our own backend, not the radio.** That is the more useful
 * question — a phone with four bars behind a hotel captive portal is "connected" to NetInfo
 * and useless to us — but it is also a weaker signal: it can only learn from a request that
 * has already been made, or from a probe.
 *
 * Two inputs:
 *
 * 1. **Real traffic.** `report()` is called by whatever performs a request. Success means
 *    online, immediately and for free.
 * 2. **A probe**, on returning to the foreground and after a failure. One `HEAD` against the
 *    Supabase URL, which costs a few bytes.
 *
 * `null` — **unknown** — is a first-class state and the initial one. A screen must not render
 * "you are offline" before anything has been tried; that is the §5.21 rule applied to the
 * network, and it is why this is not `boolean`.
 */
export type Connectivity = 'online' | 'offline' | 'unknown';

interface ConnectivityValue {
  status: Connectivity;
  /** `true` only when we have positively established that we cannot reach the backend. */
  offline: boolean;
  /** Called by request code: `true` on success, `false` on a network-shaped failure. */
  report: (reachable: boolean) => void;
  /** Ask now. Resolves to the new status. */
  probe: () => Promise<Connectivity>;
}

const ConnectivityContext = createContext<ConnectivityValue>({
  status: 'unknown',
  offline: false,
  report: () => {},
  probe: async () => 'unknown',
});

/**
 * Is this the kind of error that means "the network did not carry the request"?
 *
 * A 404 or a 403 is the server answering — the connection worked perfectly. Treating those as
 * offline would tell a parent their signal is bad when the truth is that we asked for the wrong
 * thing, which sends them to reboot their router over our bug.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch's own failure mode
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('timeout') ||
    message.includes('unable to resolve host')
  );
}

export function ConnectivityProvider({
  children,
  /** The URL to probe. Defaults to the configured Supabase host. */
  probeUrl = process.env.EXPO_PUBLIC_SUPABASE_URL,
  initial = 'unknown',
}: {
  children: ReactNode;
  probeUrl?: string | undefined;
  initial?: Connectivity;
}) {
  const [status, setStatus] = useState<Connectivity>(initial);
  // A probe in flight, so a burst of failures does not become a burst of probes.
  const probing = useRef<Promise<Connectivity> | null>(null);

  const probe = useCallback(async (): Promise<Connectivity> => {
    if (probing.current) return probing.current;
    if (probeUrl === undefined || probeUrl === '') {
      // No configured backend is not an offline phone. `configureApiFromEnvironment` already
      // reports that case, and claiming "offline" here would send someone to check their wifi
      // over a build problem.
      setStatus('unknown');
      return 'unknown';
    }

    const run = (async (): Promise<Connectivity> => {
      try {
        // `HEAD` on the REST root: a few bytes, no auth, and it is the exact host every real
        // request uses — so a DNS or captive-portal failure shows up here identically.
        await fetch(`${probeUrl}/rest/v1/`, { method: 'HEAD' });
        setStatus('online');
        return 'online';
      } catch (error) {
        const next: Connectivity = isNetworkFailure(error) ? 'offline' : 'online';
        setStatus(next);
        return next;
      } finally {
        probing.current = null;
      }
    })();

    probing.current = run;
    return run;
  }, [probeUrl]);

  const report = useCallback(
    (reachable: boolean) => {
      if (reachable) {
        setStatus('online');
        return;
      }
      // A failed request is a hypothesis, not a verdict — one request can fail for reasons
      // that have nothing to do with the connection. Confirm it before telling anyone.
      void probe();
    },
    [probe],
  );

  useEffect(() => {
    void probe();
    const subscription = AppState.addEventListener('change', (next) => {
      // Coming back to the foreground is exactly when the answer is most likely to have
      // changed and most likely to matter — someone has walked out of the school building.
      if (next === 'active') void probe();
    });
    return () => subscription.remove();
  }, [probe]);

  const value = useMemo<ConnectivityValue>(
    () => ({ status, offline: status === 'offline', report, probe }),
    [status, report, probe],
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityValue {
  return useContext(ConnectivityContext);
}
