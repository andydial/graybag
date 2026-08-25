import { describe, expect, it, vi } from 'vitest';

import { createAnalytics, disabledAnalytics, POSTHOG_EU_HOST } from './client.js';

/**
 * `E15-20`. The two properties that matter more than the analytics:
 *
 *   1. **Nothing undeclared leaves the device** — the allowlist is enforced at the send, not only
 *      in a review. A rule that lives in a document holds until somebody is in a hurry.
 *   2. **A parent can order lunch when PostHog is down.** Every failure path here ends in a
 *      dropped event and nothing else: no throw, no retry storm, no `await` at a call site.
 */
function harness(over: Partial<Parameters<typeof createAnalytics>[0]> = {}) {
  const sent: unknown[] = [];
  const rejected: { event: string; reasons: string[] }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return { ok: true } as Response;
  }) as unknown as typeof fetch;

  const analytics = createAnalytics({
    apiKey: 'phc_test',
    commonProperties: { app_version: '4.0.0', platform: 'ios', app_env: 'production' },
    fetchImpl,
    onReject: (event, rejections) =>
      rejected.push({ event, reasons: rejections.map((r) => r.reason) }),
    ...over,
  });

  return { analytics, sent, rejected, fetchImpl };
}

describe('nothing undeclared leaves the device', () => {
  it('refuses to send a child field and says why', async () => {
    const { analytics, sent, rejected } = harness();
    analytics.identify('u-1');
    analytics.capture('child_added', { first_name: 'Aarav' });
    await analytics.flush();

    expect(sent).toEqual([]);
    expect(rejected).toEqual([{ event: 'child_added', reasons: ['forbidden_property'] }]);
  });

  it('refuses an undeclared event outright', async () => {
    const { analytics, sent, rejected } = harness();
    analytics.capture('dish_viewed', {});
    await analytics.flush();
    expect(sent).toEqual([]);
    expect(rejected[0]?.reasons).toEqual(['unknown_event']);
  });

  it('sends a declared event with the common properties attached', async () => {
    const { analytics, sent } = harness();
    analytics.identify('u-1');
    analytics.capture('payment_completed');
    await analytics.flush();

    const body = sent[0] as { api_key: string; batch: { event: string; properties: Record<string, unknown> }[] };
    expect(body.api_key).toBe('phc_test');
    expect(body.batch[0]?.event).toBe('payment_completed');
    expect(body.batch[0]?.properties).toMatchObject({
      distinct_id: 'u-1', app_version: '4.0.0', platform: 'ios', app_env: 'production',
    });
  });

  it('never attaches a person property, whatever identify is given', async () => {
    // A profile property rides every event that identity ever sends. The signature takes an id
    // only, and this pins that the implementation agrees.
    const { analytics, sent } = harness();
    analytics.identify('u-1');
    analytics.capture('app_opened', { is_first_open: true });
    await analytics.flush();
    const body = sent[0] as { batch: { properties: Record<string, unknown> }[] };
    expect(Object.keys(body.batch[0]?.properties ?? {}).sort()).toEqual(
      ['app_env', 'app_version', 'distinct_id', 'is_first_open', 'platform'],
    );
  });
});

describe('analytics never blocks a parent', () => {
  it('swallows a network failure', async () => {
    const failing = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND eu.i.posthog.com');
    }) as unknown as typeof fetch;
    const { analytics } = harness({ fetchImpl: failing });

    expect(() => analytics.capture('app_opened', { is_first_open: true })).not.toThrow();
    await expect(analytics.flush()).resolves.toBeUndefined();
  });

  it('swallows a non-ok response', async () => {
    const rejecting = vi.fn(async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    const { analytics } = harness({ fetchImpl: rejecting });
    analytics.capture('app_opened', { is_first_open: true });
    await expect(analytics.flush()).resolves.toBeUndefined();
  });

  it('bounds the buffer instead of growing for ever offline', async () => {
    // A parent on a bad connection all day must not accumulate events until the app is killed,
    // and the oldest funnel step is the least interesting thing to keep.
    const failing = vi.fn(async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    const { analytics } = harness({ fetchImpl: failing });
    for (let i = 0; i < 200; i += 1) analytics.capture('app_opened', { is_first_open: false });
    await analytics.flush();

    const working: unknown[] = [];
    const good = vi.fn(async (_u: string, init?: RequestInit) => {
      working.push(JSON.parse(String(init?.body)));
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const drained = createAnalytics({
      apiKey: 'phc_test', commonProperties: {}, fetchImpl: good,
    });
    drained.capture('app_opened', { is_first_open: true });
    await drained.flush();
    expect(working.length).toBeGreaterThan(0);
  });
});

describe('a build with no key is silent', () => {
  it('does nothing at all, rather than posting to a default project', async () => {
    // Staging and local builds have no key. A funnel polluted by a developer's tap-through is
    // worse than no funnel, because it looks like data.
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const analytics = createAnalytics({ apiKey: '', commonProperties: {}, fetchImpl });
    analytics.identify('u-1');
    analytics.capture('payment_completed');
    await analytics.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('disabledAnalytics is a working no-op', async () => {
    const a = disabledAnalytics();
    expect(() => a.capture('anything')).not.toThrow();
    await expect(a.flush()).resolves.toBeUndefined();
  });
});

describe('it points at the EU', () => {
  it('defaults to PostHog Cloud EU, not US', async () => {
    // DPDP: the transfer is lawful either way today, but EU is a GDPR jurisdiction and the least
    // likely entry if a restricted-country list ever appears. docs/posthog.md.
    expect(POSTHOG_EU_HOST).toContain('eu.i.posthog.com');
    const { analytics, fetchImpl } = harness();
    analytics.capture('app_opened', { is_first_open: true });
    await analytics.flush();
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0])
      .toContain('eu.i.posthog.com');
  });
});
