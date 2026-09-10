/**
 * The PostHog client. `E15-20`.
 *
 * A `fetch` against PostHog's capture endpoint and nothing else — **no SDK, no native module, so
 * this ships over the air.** `posthog-react-native` needs `expo-file-system`, `expo-application`,
 * `expo-device` and `expo-localization` (or async-storage plus device-info) and we have none of
 * the six, so it would cost a binary and an App Store review. The web thread reached the same
 * conclusion from the other end: the native SDK cost them 88 KB gzipped and blew their
 * performance budget.
 *
 * The features an SDK would add are the ones being switched off anyway — autocapture, session
 * replay, automatic device properties. What genuinely remains is an offline queue, which is the
 * `pending` buffer below.
 *
 * ## Analytics never blocks a parent
 *
 * Every path here swallows its failure. `capture` returns `void` and is not awaited by callers;
 * a network error, a 500, a blocked host, an ad-blocker on the school wifi — all of them end as
 * a dropped event and nothing else. **A parent must be able to order lunch when PostHog is
 * down.** That is why there is no retry storm and no `await` at any call site.
 *
 * ## Nothing is sent that the schema does not declare
 *
 * Every event goes through `checkEvent` first (`events.ts`). A rejection is dropped and reported
 * to `onReject`, never sent — the allowlist is the control, not a suggestion.
 */
import { checkEvent, checkIdentify, type EventRejection } from './events.js';

/** PostHog Cloud **EU**. See `docs/posthog.md` for the DPDP reasoning. */
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com';

export interface AnalyticsConfig {
  /**
   * Which environment this bundle is. **Only used to decide how loudly to complain about a
   * missing key** — see `createAnalytics`.
   */
  appEnv?: string;
  /** `PUBLIC_POSTHOG_KEY`. Andy sets it; it is a write-only project key, not a secret. */
  apiKey: string;
  host?: string;
  /** Everything on every event: app version, platform, environment. */
  commonProperties: Record<string, string>;
  /** Injected so tests are not network-dependent. */
  fetchImpl?: typeof fetch;
  /** Told about anything refused or dropped, so a funnel cannot silently stop recording. */
  onReject?: (event: string, rejections: EventRejection[]) => void;
  now?: () => Date;
  /** Injected so a test can pin the anonymous id. See `anonymousId`. */
  newAnonId?: () => string;
}

export interface Analytics {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string) => void;
  /**
   * Forget who this is and start a new anonymous identity — `E15-24`.
   *
   * Called on sign-out. Without it the previous parent's `distinct_id` stayed in this closure for
   * the life of the process, so a second person signing in on the same handset had their pre-
   * sign-in taps attributed to the first — and, worse, the *reason* two `signin_started` events
   * ever landed: they came from re-sign-ins where a stale id was still set.
   */
  reset: () => void;
  /** Test seam and shutdown hook. Flushes whatever is buffered. */
  flush: () => Promise<void>;
}

/**
 * A no-op, used when no key is configured.
 *
 * **Staging and local builds have no key and must stay silent** — a funnel polluted by a
 * developer's tap-through is worse than no funnel, because it looks like data.
 */
export function disabledAnalytics(): Analytics {
  return { capture: () => {}, identify: () => {}, reset: () => {}, flush: async () => {} };
}

/**
 * An anonymous id for the events a parent sends **before** they sign in — `E15-24`.
 *
 * ## The bug this fixes, which cost thirty days of funnel data
 *
 * `capture` used to omit `distinct_id` entirely while `distinctId` was null. PostHog's capture
 * API **requires** it, so every event fired before sign-in was accepted by our `fetch` and
 * discarded at the far end. Nothing logged, nothing rejected locally, no symptom except numbers
 * that could not be true:
 *
 *   - `signin_started` fires on the sign-in screen, which is by definition signed out → 2 landed
 *     against 30 `signin_completed`.
 *   - `cart_started` fires on the 0→1 line transition, and `AR7` says the cart fills signed out →
 *     3 landed against 28 `add_to_cart_tapped`, because the later adds happen after the gate.
 *
 * Both were the same defect. The client's own tests never caught it because every one of them
 * called `identify()` first, so the signed-out branch was never exercised.
 *
 * ## Why in memory, and what that costs
 *
 * Persisting it would need a storage adapter, and this file ships **over the air** — no native
 * module, no `expo-file-system`, no async-storage. So the id lasts one app launch: a parent who
 * browses signed out across two launches is two anonymous people until they sign in, at which
 * point `$identify` merges *that launch's* anonymous events onto them. The alternative was
 * continuing to lose the events entirely.
 *
 * `crypto.randomUUID` is not reliably present on Hermes — the same constraint `newIdempotencyKey`
 * documents in `useCheckout` — so it is used when it exists and a random string otherwise. This
 * value identifies nobody and is not a secret; it is a bucket for one launch's taps.
 */
export function anonymousId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof globalCrypto?.randomUUID === 'function') return `anon-${globalCrypto.randomUUID()}`;
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const MAX_BUFFER = 50;

/** Why analytics is off, when it is. `null` means it is on. */
export type DisabledReason = 'no_key_expected' | 'no_key_in_production' | null;

let lastDisabledReason: DisabledReason = null;

/**
 * Why the last `createAnalytics` produced a no-op, for a diagnostic to render.
 *
 * A module-level read rather than a return value because the caller that wants to *display*
 * this — the build label — is nowhere near the caller that constructs it.
 */
export function analyticsDisabledReason(): DisabledReason {
  return lastDisabledReason;
}

export function createAnalytics(config: AnalyticsConfig): Analytics {
  if (!config.apiKey) {
    /**
     * **Silent in staging and local, LOUD in production.**
     *
     * Andy, 2026-08-25: *"a component that quietly does nothing is the failure shape that's cost
     * us days repeatedly."* He is right, and this is the exact shape: a production build with no
     * key sends nothing, looks completely healthy, and the first symptom is an empty dashboard
     * days later — which reads as "the events are wrong" rather than "there is no key".
     *
     * The distinction matters though. Staging and local builds are *supposed* to have no key —
     * that is what keeps a developer's tap-through out of the funnel — so shouting there would
     * train everyone to ignore the message, which is how a loud warning becomes a silent one.
     */
    const inProduction = config.appEnv === 'production';
    lastDisabledReason = inProduction ? 'no_key_in_production' : 'no_key_expected';
    if (inProduction) {
      console.error(
        'analytics: PRODUCTION build with no POSTHOG key — every event will be dropped. ' +
          'EXPO_PUBLIC_POSTHOG_KEY is inlined at bundle time, so setting it in EAS is not ' +
          'enough on its own; the bundle must be republished.',
      );
    }
    return disabledAnalytics();
  }
  lastDisabledReason = null;

  const host = config.host ?? POSTHOG_EU_HOST;
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const reject = config.onReject ?? (() => {});

  const makeAnonId = config.newAnonId ?? anonymousId;
  /**
   * **Never null.** It starts anonymous and becomes the parent's id at sign-in — see
   * `anonymousId` for the thirty days of events the old `null` cost.
   */
  let distinctId: string = makeAnonId();
  /** The anonymous id still waiting to be merged, or `null` once it has been. */
  let unmergedAnonId: string | null = distinctId;
  /**
   * Did anything actually go out under the anonymous id?
   *
   * The merge exists to rescue signed-out events. With none, there is nothing to rescue and the
   * `$identify` would be a network call that tells PostHog to alias an id it has never seen —
   * pure noise on a school-gate connection. It also keeps `identify()` on its own silent, which
   * is what the older tests in `client.test.ts` were really asserting.
   */
  let anonSentSomething = false;
  /**
   * The offline queue, bounded.
   *
   * Unbounded would be the obvious version and the wrong one: a parent on a bad connection for a
   * day would accumulate events until the app was killed, and the oldest funnel step is the
   * least interesting thing to keep. Dropping the oldest keeps the buffer honest about its size.
   */
  const pending: Record<string, unknown>[] = [];

  const send = async (batch: Record<string, unknown>[]): Promise<boolean> => {
    try {
      const response = await doFetch(`${host}/batch/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: config.apiKey, batch }),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    const ok = await send(batch);
    if (!ok) {
      // Put them back, oldest-first, still bounded. A failed flush must not lose the buffer and
      // must not grow it without limit either.
      pending.unshift(...batch);
      if (pending.length > MAX_BUFFER) pending.splice(0, pending.length - MAX_BUFFER);
    }
  };

  return {
    capture(event, properties = {}) {
      const merged = {
        ...config.commonProperties,
        ...properties,
        // Always present. PostHog discards an event without it, which is how every signed-out
        // event was lost — see `anonymousId`.
        distinct_id: distinctId,
      };

      const rejections = checkEvent(event, merged);
      if (rejections.length > 0) {
        reject(event, rejections);
        return; // Never sent. The allowlist is the control.
      }

      if (unmergedAnonId !== null && distinctId === unmergedAnonId) anonSentSomething = true;
      pending.push({ event, properties: merged, timestamp: now().toISOString() });
      if (pending.length > MAX_BUFFER) pending.shift();
      void flush();
    },

    identify(id) {
      // No person properties, ever — `checkIdentify` refuses all of them, and a profile property
      // is attached to every event that identity sends, past and future.
      const rejections = checkIdentify(id);
      if (rejections.length > 0) {
        reject('$identify', rejections);
        return;
      }
      if (id === distinctId) return;

      const anon = unmergedAnonId;
      distinctId = id;
      unmergedAnonId = null;

      /**
       * Merge this launch's anonymous events onto the parent — `E15-24`.
       *
       * Without this, fixing `distinct_id` would only move the problem: the signed-out events
       * would land but sit on a separate anonymous person, so `cart_started` and `signin_started`
       * would still be missing from the parent's funnel. `$identify` with `$anon_distinct_id` is
       * how PostHog is told the two are one person, and it applies retroactively.
       *
       * **This is the one payload that bypasses the allowlist, and it is built from two ids and
       * nothing else.** `$identify` is not in `ALLOWED_EVENTS` and `$anon_distinct_id` is not a
       * declared property, so `checkEvent` would refuse it — correctly, since it is PostHog
       * protocol rather than one of our events. It is constructed here from two values this
       * function already holds; no caller-supplied property reaches it, which is what keeps the
       * bypass from being a hole. `checkIdentify` above still refuses person properties.
       */
      if (anon !== null && anonSentSomething) {
        pending.push({
          event: '$identify',
          properties: { distinct_id: id, $anon_distinct_id: anon },
          timestamp: now().toISOString(),
        });
        if (pending.length > MAX_BUFFER) pending.shift();
        void flush();
      }
    },

    reset() {
      // A fresh anonymous identity, and a fresh merge pending for whoever signs in next. See
      // `Analytics.reset` for why a stale id is worse than no id.
      distinctId = makeAnonId();
      unmergedAnonId = distinctId;
      anonSentSomething = false;
    },

    flush,
  };
}
