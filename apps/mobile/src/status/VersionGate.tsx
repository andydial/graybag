import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@graybag/shared';

import { UpdateRequiredScreen } from './UpdateRequiredScreen';

/**
 * The force-update gate. `E17-46`.
 *
 * Wraps the whole app: when the server says this build is below the floor, nothing else is
 * reachable. That is the point — a parent on 3.7.0 after the 19th must not be able to reach a
 * checkout that will fail against a schema their build does not know about.
 *
 * ## Children render while the answer is unknown, and that is deliberate
 *
 * The check is one round trip. Blocking first paint on it would put a spinner in front of every
 * cold start for the sake of a condition that is false for almost everybody, almost always — and
 * `AR7` is explicit that nothing should be a wall in front of browsing. So the app opens
 * normally and the gate closes a moment later if it has to.
 *
 * The cost is a parent on an old build seeing one frame of the menu. That is acceptable; the
 * alternative is every parent seeing a spinner.
 *
 * ## It never blocks on failure
 *
 * `fetchVersionSupport` resolves rather than throws, and resolves to `supported: true` on any
 * error. A gate that closed when it could not reach the server would lock every parent out of
 * the app during an outage — using the mechanism whose entire job is to tell them how to keep
 * ordering. "Too old" is a claim that needs evidence.
 *
 * ## The version comes from the binary
 *
 * `Constants.expoConfig.version`, not a literal — the same source `BuildLabel` uses, so it cannot
 * drift from what was actually shipped. `null` when it cannot be read, which the server treats
 * as unknown and therefore admits.
 */
export function VersionGate({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState<api.VersionSupport | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const version = Constants.expoConfig?.version ?? null;
      const support = await api.fetchVersionSupport(version);
      // Only an explicit refusal closes the gate. `fetchVersionSupport` never throws, so
      // reaching here with `supported: true` covers both "you are fine" and "we could not tell".
      if (!cancelled && !support.supported) setBlocked(support);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (blocked !== null) {
    return (
      <UpdateRequiredScreen
        message={blocked.message}
        minimumVersion={blocked.minimumVersion}
      />
    );
  }

  return <>{children}</>;
}
