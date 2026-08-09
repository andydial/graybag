/**
 * OTA updates and the path back (`E14-11`).
 *
 * `R2` ships via iOS Phased Release and an Android staged rollout, halted on Sentry error
 * spikes. OTA is the faster lever underneath that: a JS-only fix reaches users in minutes
 * rather than in a review cycle. It is also the faster way to break every install at once,
 * which is why the rollback path is written here alongside the update path rather than being
 * discovered during an incident.
 *
 * **`runtimeVersion` is `appVersion`** (`app.json`). An update only reaches builds carrying
 * the same app version, so a JS bundle can never land on a binary whose native side it needs.
 * The cost is that a native change forces a real build; that cost is the guarantee.
 *
 * **The update is fetched in the background and applied on the next launch, never mid-session.**
 * Reloading under a user is the one thing OTA can do that a store release cannot, and doing it
 * while somebody is mid-checkout is how a payment ends up in a state nobody can reconcile
 * (`L4`, `[OL-05]`). There is no code path here that reloads without being asked.
 */

export interface UpdatesApi {
  isEnabled: boolean;
  checkForUpdateAsync: () => Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync: () => Promise<{ isNew: boolean }>;
  reloadAsync: () => Promise<void>;
}

export type OtaOutcome =
  | { status: 'disabled' }
  | { status: 'none' }
  | { status: 'ready' }
  | { status: 'failed'; error: unknown };

/**
 * Check for an update and download it. **Does not apply it.**
 *
 * Returns `ready` when a new bundle is on disk and will be used at the next cold start. The
 * caller decides what to do with that — for v1 the answer is "nothing, it applies itself next
 * launch", and `E14-12`'s force-upgrade is the separate mechanism for the case where waiting
 * is not acceptable.
 *
 * **Every failure is swallowed into a return value, never thrown.** An update check is not
 * something the user asked for, and a failed one must not be visible to them: the app they
 * have works, and the correct behaviour when the network is bad is to carry on with it (`P8`,
 * `MC3`). Failing loudly here would turn a routine offline moment into an error screen.
 */
export async function fetchUpdateInBackground(Updates: UpdatesApi): Promise<OtaOutcome> {
  // False in Expo Go and in a dev client, which is most of the time during development.
  if (!Updates.isEnabled) return { status: 'disabled' };

  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return { status: 'none' };

    const { isNew } = await Updates.fetchUpdateAsync();
    return isNew ? { status: 'ready' } : { status: 'none' };
  } catch (error) {
    return { status: 'failed', error };
  }
}

/**
 * Apply a downloaded update by restarting.
 *
 * Deliberately separate from fetching, and deliberately explicit. The only legitimate callers
 * are a user tapping "Restart to update" and `E14-12`'s force-upgrade gate. **Nothing may call
 * this from a timer, a focus listener or an app-state change** — those all fire while somebody
 * is doing something, and the something might be paying.
 */
export async function applyUpdateNow(Updates: UpdatesApi): Promise<void> {
  await Updates.reloadAsync();
}

/**
 * The rollback path, written down because `E14-11` asks for one and because the moment you
 * need it is the worst moment to be reading documentation.
 *
 * OTA has **no** "undo" command. `eas update:rollback` does not exist as an inverse; what you
 * do is publish a *new* update whose contents are the previous good commit:
 *
 * ```sh
 * # 1. What is live, and on which channel?
 * eas update:list --branch production
 *
 * # 2. Republish the last good commit as a new update on the same channel.
 * git checkout <last-good-sha>
 * eas update --branch production --message "rollback to <sha>"
 * git checkout -
 *
 * # 3. Confirm it is the newest on that branch.
 * eas update:list --branch production
 * ```
 *
 * **A bad *native* build cannot be fixed this way** — an OTA update cannot replace native
 * code, and `runtimeVersion` will correctly refuse to deliver a bundle to a binary it does not
 * match. That case is a store rollback: halt the phased release (`R2`), and for Android
 * promote the previous release from the internal track.
 *
 * **The 30-day Bubble break-glass (`R3`) is a different lever again** and outranks both during
 * cutover: if the new stack is unusable, the answer is to send people back to Bubble, not to
 * keep publishing updates at it.
 */
export const ROLLBACK_RUNBOOK = 'see applyUpdateNow’s neighbouring doc comment in ota.ts';
