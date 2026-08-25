import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { analyticsClient } from '@graybag/shared';

import { readExpoClientEnv } from '../env/configure';

/**
 * The app's one analytics instance. `E15-20`.
 *
 * A module singleton rather than a context, deliberately: the emitters are one-line calls from
 * nine places including a navigator effect and an api-layer callback, and threading a provider
 * to all of them would be ceremony around something that has no per-tree state.
 *
 * ## It is off unless a key is configured
 *
 * `EXPO_PUBLIC_POSTHOG_KEY` is optional. Absent — which is every staging and local build —
 * `createAnalytics` returns a no-op that makes no network call at all. A funnel polluted by a
 * developer's tap-through is worse than no funnel, because it looks like data.
 *
 * ## It never blocks a parent
 *
 * `track` swallows everything, including a failure to *read the environment*. `readExpoClientEnv`
 * throws when the app is misconfigured, and `App.tsx` already handles that for the api client;
 * analytics must not turn the same condition into a second crash on a screen that is trying to
 * explain the first.
 */
const instance = (() => {
  try {
    const env = readExpoClientEnv();
    return analyticsClient.createAnalytics({
      apiKey: env.posthogKey ?? '',
      commonProperties: {
        app_version: String(Constants.expoConfig?.version ?? 'unknown'),
        platform: Platform.OS,
        app_env: env.appEnv,
      },
      // Reported, never silent. A funnel that quietly stops recording a step is the failure this
      // guards; `checkEvent`'s rejection reasons say which property was refused.
      onReject: (event, rejections) => {
        console.warn(
          `analytics: refused "${event}" — ${rejections.map((r) => `${r.reason}:${r.detail}`).join(', ')}`,
        );
      },
    });
  } catch {
    /**
     * **A local literal, not `analyticsClient.disabledAnalytics()`.**
     *
     * The fallback must not depend on the module whose absence it is covering. It did, and
     * `useCheckout.test.ts` — which mocks `@graybag/shared` wholesale — turned a missing export
     * into a suite that could not even load. The same shape would happen in a build where the
     * shared bundle failed to resolve: the guard would throw from inside the catch, so the very
     * failure it exists to absorb would take the app down with it.
     */
    return { capture: () => {}, identify: () => {}, flush: async () => {} };
  }
})();

/**
 * Emit one funnel event.
 *
 * Deliberately not `async` and never awaited at a call site — see `client.ts`. The name and
 * properties are checked against the allowlist before anything is sent, so a call that drifts
 * from `docs/posthog.md` is dropped rather than delivered.
 */
export function track(event: string, properties: Record<string, unknown> = {}): void {
  instance.capture(event, properties);
}

/** The parent's `app_user.id`, and nothing else. Never an email — `docs/posthog.md` §3. */
export function identifyParent(userId: string): void {
  instance.identify(userId);
}

/** Test seam and shutdown hook. */
export function flushAnalytics(): Promise<void> {
  return instance.flush();
}
