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
}

export interface Analytics {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string) => void;
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
  return { capture: () => {}, identify: () => {}, flush: async () => {} };
}

const MAX_BUFFER = 50;

export function createAnalytics(config: AnalyticsConfig): Analytics {
  if (!config.apiKey) return disabledAnalytics();

  const host = config.host ?? POSTHOG_EU_HOST;
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const reject = config.onReject ?? (() => {});

  let distinctId: string | null = null;
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
        ...(distinctId === null ? {} : { distinct_id: distinctId }),
      };

      const rejections = checkEvent(event, merged);
      if (rejections.length > 0) {
        reject(event, rejections);
        return; // Never sent. The allowlist is the control.
      }

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
      distinctId = id;
    },

    flush,
  };
}
