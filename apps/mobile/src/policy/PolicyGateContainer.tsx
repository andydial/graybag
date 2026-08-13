import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { api } from '@graybag/shared';

import { PolicyGateScreen } from '../status/PolicyGateScreen';

/**
 * The gate's caller — `E20-36`.
 *
 * `PolicyGateScreen` was written, styled and tested, and `onAccept`, `onNotNow` and `accepting`
 * had **no caller anywhere in the app**. This file is the thing that was missing: one of the six
 * v1 compliance controls had never run, while the code read as though it had.
 *
 * ## Both answers return the parent to what they were doing
 *
 * Accept records the acceptance and goes back. "Not now" goes back too, and that is the design
 * rather than a shortcut — `AR7` forbids a wall in front of browsing, and the screen's own note
 * says removing the second button would turn this into one. What changes is only whether the
 * *next* order is gated.
 *
 * ## A failed acceptance keeps the gate open
 *
 * If the write fails the screen stays put and shows why. Navigating back on failure would leave
 * a parent believing they had accepted something the database has no record of — which is worse
 * than an error message, because the next refusal would come from checkout with no explanation.
 */
export function PolicyGateContainer({
  version,
  onAccepted,
}: {
  /** The version being accepted. `null` renders nothing — see `RootNavigator`'s route. */
  version: api.PendingPolicy | null;
  /** Called after a successful acceptance so the caller can drop it from its pending list. */
  onAccepted: (versionId: string) => void;
}) {
  const navigation = useNavigation();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (version === null) return null;

  const accept = () => {
    setAccepting(true);
    setError(null);
    api
      .acceptPolicyVersion(version.versionId)
      .then(() => {
        onAccepted(version.versionId);
        navigation.goBack();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : 'We could not record that just now. Please try again.',
        );
      })
      .finally(() => setAccepting(false));
  };

  return (
    <PolicyGateScreen
      // A published version may carry no `summary_of_changes`. Rendering an empty panel would
      // ask a parent to accept a change we decline to describe, so the fallback says plainly
      // that the document changed and points at where to read it.
      summary={
        version.summaryOfChanges ??
        'We have updated this policy. You can read the full document from Account → Privacy.'
      }
      onAccept={accept}
      onNotNow={() => navigation.goBack()}
      accepting={accepting}
      error={error}
    />
  );
}
