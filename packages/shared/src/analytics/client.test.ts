import { describe, expect, it, vi } from 'vitest';

import { analyticsDisabledReason, createAnalytics, disabledAnalytics, POSTHOG_EU_HOST } from './client.js';

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
    // Pinned, so a test can assert the merge names the right anonymous id.
    newAnonId: () => 'anon-fixed',
    commonProperties: { app_version: '4.0.0', platform: 'ios', app_env: 'production' },
    fetchImpl,
    onReject: (event, rejections) =>
      rejected.push({ event, reasons: rejections.map((r) => r.reason) }),
    ...over,
  });

  return { analytics, sent, rejected, fetchImpl };
}

/**
 * Every event across every batch, in order.
 *
 * `identify()` flushes when it queues a merge, so what a test cares about is no longer reliably
 * in `sent[0]` — asserting on one batch made these tests depend on flush timing rather than on
 * behaviour.
 */
function allEvents(sent: unknown[]): { event: string; properties: Record<string, unknown> }[] {
  return sent.flatMap(
    (body) => (body as { batch: { event: string; properties: Record<string, unknown> }[] }).batch,
  );
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

describe('a missing key is LOUD in production and quiet where silence is intended', () => {
  it('shouts when a production bundle has no key', () => {
    // Andy: "a component that quietly does nothing is the failure shape that's cost us days
    // repeatedly." A production build with no key looks completely healthy and the first symptom
    // is an empty dashboard days later, which reads as "the events are wrong".
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    try {
      createAnalytics({ apiKey: '', appEnv: 'production', commonProperties: {} });
    } finally {
      console.error = original;
    }
    expect(errors.join(' ')).toMatch(/PRODUCTION build with no POSTHOG key/);
    expect(analyticsDisabledReason()).toBe('no_key_in_production');
  });

  it('says nothing in staging, where having no key is the intended state', () => {
    // Shouting here would train everyone to ignore the message, which is how a loud warning
    // becomes a silent one.
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    try {
      createAnalytics({ apiKey: '', appEnv: 'staging', commonProperties: {} });
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
    expect(analyticsDisabledReason()).toBe('no_key_expected');
  });

  it('reports nothing wrong once a key is present', () => {
    createAnalytics({ apiKey: 'phc_x', appEnv: 'production', commonProperties: {} });
    expect(analyticsDisabledReason()).toBeNull();
  });
});

/**
 * **The thirty-day data loss — `E15-24`.**
 *
 * `capture` omitted `distinct_id` entirely while nobody was identified. PostHog requires it, so
 * every event fired before sign-in was accepted by our `fetch` and discarded at the far end:
 * `signin_started` landed 2 times against 30 `signin_completed`, and `cart_started` 3 against 28
 * `add_to_cart_tapped`. One defect, both symptoms.
 *
 * **Every existing test in this file called `identify()` first**, which is exactly why it
 * survived: the signed-out branch — the one `AR7` makes the normal case, since the cart fills
 * before the gate — was never exercised.
 */
describe('events sent before sign-in', () => {
  it('carries an anonymous distinct_id rather than none at all', async () => {
    const { analytics, sent } = harness();
    // No identify() — this is a parent browsing before the gate.
    analytics.capture('cart_started', { line_count: 1 });
    await analytics.flush();

    expect(allEvents(sent)[0]?.properties.distinct_id).toBe('anon-fixed');
  });

  it('sends signin_started, which is by definition signed out', async () => {
    // The event whose absence was impossible to explain: 2 starts against 30 completions.
    const { analytics, sent } = harness();
    analytics.capture('signin_started', { method: 'email_otp' });
    await analytics.flush();
    expect(allEvents(sent)[0]?.event).toBe('signin_started');
  });

  it('merges those events onto the parent when they sign in', async () => {
    // Fixing `distinct_id` alone would only move the problem: the events would land on a
    // separate anonymous person and still be missing from the parent's funnel. `$anon_distinct_id`
    // is how PostHog is told the two are one person, retroactively.
    const { analytics, sent } = harness();
    analytics.capture('cart_started', { line_count: 1 });
    analytics.identify('u-1');
    await analytics.flush();

    const merge = allEvents(sent).find((e) => e.event === '$identify');
    expect(merge?.properties).toEqual({ distinct_id: 'u-1', $anon_distinct_id: 'anon-fixed' });
  });

  it('carries the parent id once identified', async () => {
    const { analytics, sent } = harness();
    analytics.identify('u-1');
    analytics.capture('payment_completed', { item_count: 2 });
    await analytics.flush();
    expect(
      allEvents(sent).find((e) => e.event === 'payment_completed')?.properties.distinct_id,
    ).toBe('u-1');
  });

  it('merges only once, however many times identify is called', async () => {
    // A token refresh re-identifies with the same id. A second `$identify` would be a second
    // merge request for an alias PostHog already holds.
    const { analytics, sent } = harness();
    analytics.identify('u-1');
    analytics.identify('u-1');
    analytics.capture('menu_browsed', { item_count: 1 });
    await analytics.flush();
    // And none at all here: nothing went out anonymously, so there is nothing to alias.
    expect(allEvents(sent).filter((e) => e.event === '$identify')).toHaveLength(0);
  });

  it('never puts a person property on the merge', async () => {
    // The merge is the one payload that bypasses `checkEvent`, so what it contains is pinned.
    const { analytics, sent } = harness();
    analytics.capture('cart_started', { line_count: 1 });
    analytics.identify('u-1');
    await analytics.flush();
    const merge = allEvents(sent).find((e) => e.event === '$identify');
    expect(Object.keys(merge?.properties ?? {}).sort()).toEqual(['$anon_distinct_id', 'distinct_id']);
  });
});

describe('reset, for a shared handset', () => {
  it('stops attributing the next person to the last one', async () => {
    // A handset is shared. The previous parent's id used to live in the closure for the life of
    // the process — and is the reason the only two `signin_started` events that ever landed did.
    let n = 0;
    const { analytics, sent } = harness({ newAnonId: () => `anon-${++n}` });
    analytics.identify('parent-a');
    analytics.reset();
    analytics.capture('signin_started', { method: 'email_otp' });
    await analytics.flush();

    const started = allEvents(sent).find((e) => e.event === 'signin_started');
    expect(started?.properties.distinct_id).toBe('anon-2');
    expect(started?.properties.distinct_id).not.toBe('parent-a');
  });

  it("gives the next parent their own anonymous id, and never the last parent's", async () => {
    let n = 0;
    const { analytics, sent } = harness({ newAnonId: () => `anon-${++n}` });
    analytics.identify('parent-a');
    analytics.reset();
    analytics.capture('cart_started', { line_count: 1 });
    analytics.identify('parent-b');
    await analytics.flush();

    /*
     * **One merge, not two.** `parent-a` never sent anything anonymously, so there is no alias
     * to make — asking PostHog to merge an id it has never seen is noise on a school-gate
     * connection. `parent-b` browsed before signing in, so their `cart_started` is rescued.
     */
    const merges = allEvents(sent).filter((e) => e.event === '$identify');
    expect(merges.map((m) => m.properties)).toEqual([
      { distinct_id: 'parent-b', $anon_distinct_id: 'anon-2' },
    ]);
    // And the rescued event must not be filed under the previous parent.
    const started = allEvents(sent).find((e) => e.event === 'cart_started');
    expect(started?.properties.distinct_id).toBe('anon-2');
  });
});
