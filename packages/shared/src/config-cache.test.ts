import { describe, expect, it, vi } from 'vitest';
import {
  ConfigUnavailableError,
  createConfigCache,
  gstSplitBps,
  type EffectiveConfig,
} from './config-cache.js';

const CONFIG: EffectiveConfig = {
  timezone: 'Asia/Kolkata',
  orderCutoffTime: '00:00',
  orderCutoffDaysBefore: 0,
  maxAdvanceOrderDays: 14,
  minAdvanceOrderDays: 0,
  defaultDeliveryMode: 'classroom',
  allowClassroomDelivery: true,
  allowCounterPickup: true,
  pickupCodeEnabled: true,
  priceIsTaxInclusive: false,
  cgstRateBps: 250,
  sgstRateBps: 250,
  igstRateBps: 0,
  refundDefaultDestination: 'wallet',
  walletAtCheckoutEnabled: true,
  allergenWarningEnabled: true,
  customerCancellationAllowed: true,
  customerCancellationCutoffMinutes: 0,
  // `0037`. Defaults as the platform row carries them: `L9`'s 15-minute grace, and `[OL-03]`'s
  // provisional 30 for the TTL and the retry window.
  pendingPaymentTtlMinutes: 30,
  paymentInFlightGraceMinutes: 15,
  paymentRetryWindowMinutes: 30,
};

/** A clock the test moves by hand, so nothing sleeps. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const SCHOOL = '50000000-0000-0000-0000-000000000001';

describe('createConfigCache', () => {
  it('fetches once and serves the second call from cache', async () => {
    const fetch = vi.fn().mockResolvedValue(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });

    expect(await cache.get(SCHOOL)).toEqual(CONFIG);
    expect(await cache.get(SCHOOL)).toEqual(CONFIG);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches per school rather than globally', async () => {
    const fetch = vi.fn().mockResolvedValue(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });

    await cache.get('school-a');
    await cache.get('school-b');
    await cache.get('school-a');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
  });

  it('refetches once the TTL has passed', async () => {
    const fetch = vi.fn().mockResolvedValue(CONFIG);
    const c = clock();
    const cache = createConfigCache({ fetch, ttlMs: 1000, now: c.now });

    await cache.get(SCHOOL);
    c.advance(999);
    await cache.get(SCHOOL);
    expect(fetch).toHaveBeenCalledTimes(1);

    c.advance(2);
    await cache.get(SCHOOL);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops one school and leaves the others', async () => {
    const fetch = vi.fn().mockResolvedValue(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });

    await cache.get('school-a');
    await cache.get('school-b');
    cache.invalidate('school-a');

    await cache.get('school-a');
    await cache.get('school-b');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('clear drops everything', async () => {
    const fetch = vi.fn().mockResolvedValue(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });
    await cache.get(SCHOOL);
    cache.clear();
    expect(cache.size()).toBe(0);
    await cache.get(SCHOOL);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('the three properties that are quiet when wrong', () => {
  // 1. resolve_effective_config returns a NULL composite for an unknown school, and a
  //    composite-returning function in FROM position yields one row regardless. If the
  //    cache stored that, an unknown school would look configured for the whole TTL.
  it('throws rather than caching a null resolution', async () => {
    const fetch = vi.fn().mockResolvedValue(null);
    const cache = createConfigCache({ fetch, ...clock() });

    await expect(cache.get(SCHOOL)).rejects.toBeInstanceOf(ConfigUnavailableError);
    expect(cache.size()).toBe(0);
  });

  it('treats undefined the same as null', async () => {
    const fetch = vi.fn().mockResolvedValue(undefined);
    const cache = createConfigCache({ fetch, ...clock() });
    await expect(cache.get(SCHOOL)).rejects.toBeInstanceOf(ConfigUnavailableError);
  });

  it('names the school in the error, and says platform defaults do NOT apply', async () => {
    const cache = createConfigCache({ fetch: async () => null, ...clock() });
    await expect(cache.get(SCHOOL)).rejects.toThrow(SCHOOL);
    await expect(cache.get(SCHOOL)).rejects.toThrow(/never that platform defaults apply/);
  });

  it('retries after a null resolution instead of remembering it', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });

    await expect(cache.get(SCHOOL)).rejects.toBeInstanceOf(ConfigUnavailableError);
    expect(await cache.get(SCHOOL)).toEqual(CONFIG);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // 2. A failed fetch on a flaky connection must be retried on the next call, not
  //    remembered as "no config" until the TTL expires.
  it('does not cache a rejected fetch', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });

    await expect(cache.get(SCHOOL)).rejects.toThrow('network down');
    expect(cache.size()).toBe(0);
    expect(await cache.get(SCHOOL)).toEqual(CONFIG);
  });

  // 3. Six components mounting at once must not issue six round trips on the
  //    connection that is already the bottleneck.
  it('shares one in-flight request across concurrent callers', async () => {
    let release!: (v: EffectiveConfig) => void;
    const fetch = vi.fn().mockImplementation(
      () => new Promise<EffectiveConfig>((resolve) => { release = resolve; }),
    );
    const cache = createConfigCache({ fetch, ...clock() });

    const all = Promise.all([cache.get(SCHOOL), cache.get(SCHOOL), cache.get(SCHOOL)]);
    expect(fetch).toHaveBeenCalledTimes(1);

    release(CONFIG);
    expect(await all).toEqual([CONFIG, CONFIG, CONFIG]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a failed in-flight request rejects every caller and is not retained', async () => {
    let fail!: (e: Error) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise((_r, reject) => { fail = reject; }))
      .mockResolvedValueOnce(CONFIG);
    const cache = createConfigCache({ fetch, ...clock() });

    const a = cache.get(SCHOOL);
    const b = cache.get(SCHOOL);
    fail(new Error('boom'));

    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(await cache.get(SCHOOL)).toEqual(CONFIG);
  });

  it('does not let one school\'s in-flight request serve another school', async () => {
    const fetch = vi.fn().mockImplementation(async (id: string) => ({ ...CONFIG, timezone: id }));
    const cache = createConfigCache({ fetch, ...clock() });

    const [a, b] = await Promise.all([cache.get('school-a'), cache.get('school-b')]);
    expect(a.timezone).toBe('school-a');
    expect(b.timezone).toBe('school-b');
  });
});

describe('gstSplitBps', () => {
  it('splits 5% as CGST 2.5 + SGST 2.5 with no IGST — SC1, Mohali only', () => {
    expect(gstSplitBps(CONFIG)).toEqual({ cgstBps: 250, sgstBps: 250, igstBps: 0 });
  });

  it('the split sums to the 500 bps the invoice must show', () => {
    const { cgstBps, sgstBps, igstBps } = gstSplitBps(CONFIG);
    expect(cgstBps + sgstBps + igstBps).toBe(500);
  });
});
