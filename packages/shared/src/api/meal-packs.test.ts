import { afterEach, describe, expect, it, vi } from 'vitest';

import { setApiTransport } from './client.js';
import {
  fetchMealPackBalances,
  fetchMealPackOffers,
  fetchMealPackSurface,
  packThisOrderDrawsFrom,
  startMealPackPurchase,
} from './meal-packs.js';

/**
 * `E21-32`. The surface rule, at the boundary where the app meets the server.
 *
 * The three cases Andy named are the three this file is about — and the third, a parent who owns
 * a pack at a school we later switch off, is the one that would have been missed by gating
 * everything on a single "are packs available here" flag.
 */

/** Install a transport whose `rpc` returns whatever the test says. */
function withRpc(impl: (fn: string, args?: Record<string, unknown>) => unknown) {
  setApiTransport({
    from: () => {
      throw new Error('This test should not touch a table.');
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      try {
        return { data: impl(fn, args), error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message, code: 'X' } };
      }
    },
  } as never);
}

afterEach(() => {
  setApiTransport(null);
  vi.restoreAllMocks();
});

describe('fetchMealPackSurface — the whole rule, in one answer', () => {
  it('case 1: neither. Nothing renders and nothing navigates', async () => {
    withRpc(() => [{ can_buy: false, has_balance: false }]);
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({
      canBuy: false,
      hasBalance: false,
    });
  });

  it('case 2: packs are sold here, so the offers surface is reachable', async () => {
    withRpc(() => [{ can_buy: true, has_balance: false }]);
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({ canBuy: true, hasBalance: false });
  });

  it('case 3: the school was switched off, and the balance SURVIVES it', async () => {
    // The case that matters. Withdrawing an offer stops selling; it must never strand meals
    // somebody has already paid for. `canBuy` false with `hasBalance` true is exactly that state,
    // and the app must keep the balance, the planner and the cart toggle.
    withRpc(() => [{ can_buy: false, has_balance: true }]);
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({ canBuy: false, hasBalance: true });
  });

  it('asks the server about THIS parent and THIS school, not one or the other', async () => {
    const seen: Record<string, unknown>[] = [];
    withRpc((_fn, args) => {
      seen.push(args ?? {});
      return [{ can_buy: true, has_balance: true }];
    });
    await fetchMealPackSurface('user-42', 'school-7');
    expect(seen[0]).toEqual({ p_user_id: 'user-42', p_school_id: 'school-7' });
  });

  it('renders NOTHING when the read fails, because the two mistakes are not symmetric', async () => {
    // Failing closed costs a sale the parent can still make later. Failing open offers to take
    // money for something we may not sell at that school.
    withRpc(() => {
      throw new Error('network down');
    });
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({
      canBuy: false,
      hasBalance: false,
    });
  });

  it('renders nothing when the server answers with a shape nobody expected', async () => {
    withRpc(() => 'not a row');
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({
      canBuy: false,
      hasBalance: false,
    });
  });

  it('treats a missing flag as false rather than truthy', async () => {
    // `undefined` must not become `true` through a loose check. A pack surface that appears
    // because a field was absent is the failure this guards.
    withRpc(() => [{}]);
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({
      canBuy: false,
      hasBalance: false,
    });
  });

  it('does not accept a truthy string as a yes', async () => {
    withRpc(() => [{ can_buy: 'yes', has_balance: 1 }]);
    expect(await fetchMealPackSurface('u-1', 's-1')).toEqual({
      canBuy: false,
      hasBalance: false,
    });
  });
});

describe('fetchMealPackOffers', () => {
  const OFFER = {
    id: 'o-1',
    name: 'Pack 1',
    net_price_paise: 300000,
    items_count: 20,
    bonus_items_count: 2,
    bonus_window_days: 30,
    validity_days: 60,
  };

  it('reads offers through the definer function, never a table', async () => {
    const calls: string[] = [];
    withRpc((fn) => {
      calls.push(fn);
      return [OFFER];
    });
    const offers = await fetchMealPackOffers('s-1');
    expect(calls).toEqual(['meal_pack_offers_for_school']);
    expect(offers[0]).toEqual({
      id: 'o-1',
      name: 'Pack 1',
      netPricePaise: 300000,
      itemsCount: 20,
      bonusItemsCount: 2,
      bonusWindowDays: 30,
      validityDays: 60,
    });
  });

  it('carries no meal rule any more — one item is one item', async () => {
    // The old shape required `items_per_meal` and `required_category_id` and threw without them.
    // Both are gone: any menu item counts as one item, no price cap, no category exclusion
    // (Andy, 2026-09-16, "This is deliberate — do not add a cap"). An offer with neither column
    // must parse cleanly, which is what says the rule was removed rather than defaulted.
    withRpc(() => [OFFER]);
    const [offer] = await fetchMealPackOffers('s-1');
    expect(offer).not.toHaveProperty('itemsPerMeal');
    expect(offer).not.toHaveProperty('requiredCategoryId');
  });

  it('THROWS on failure rather than returning an empty list', async () => {
    // Deliberately unlike fetchMealPackSurface. By the time this runs the parent is looking at a
    // screen that promised offers, and `[]` would read as "there are none" when the truth is
    // "we could not ask" — the same confusion §5.21 exists to prevent.
    withRpc(() => {
      throw new Error('network down');
    });
    await expect(fetchMealPackOffers('s-1')).rejects.toThrow();
  });

  it('refuses a price that is not an integer, rather than rounding it', async () => {
    // All money is integer paise (non-negotiable #3). A float here means the server sent
    // something wrong, and silently flooring it would put a wrong price in front of a parent.
    withRpc(() => [{ ...OFFER, net_price_paise: 300000.5 }]);
    await expect(fetchMealPackOffers('s-1')).rejects.toThrow(/integer/);
  });

  it('returns an empty list without complaint when the school simply has none', async () => {
    // Distinct from the failure above: the server answered, and the answer is none.
    withRpc(() => []);
    expect(await fetchMealPackOffers('s-1')).toEqual([]);
  });
});

describe('fetchMealPackBalances', () => {
  const BALANCE = {
    id: 'p-1',
    school_id: 's-1',
    school_name: 'Amity International',
    name: 'Pack 1',
    items_total: 22,
    items_remaining: 2,
    items_reserved: 0,
    valued_remaining: 0,
    bonus_remaining: 2,
    bonus_items: 2,
    bonus_granted: true,
    bonus_window_ends_at: '2026-10-16T00:00:00Z',
    bonus_still_possible: false,
    purchased_at: '2026-09-16T00:00:00Z',
    expires_at: '2026-11-15T00:00:00Z',
    status: 'active',
    price_paid_paise: 300000,
    cgst_paise: 7500,
    sgst_paise: 7500,
  };

  it('carries NO recipient — a pack never learns which child ate', async () => {
    // Non-negotiable #4, asserted as an absence because that is the whole guarantee. The old
    // design had recipient_id on the redemption; the rebuild does not have the column at all,
    // so there is nothing to strip and nothing to forget to strip.
    withRpc(() => [BALANCE]);
    const [balance] = await fetchMealPackBalances('u-1');
    expect(Object.keys(balance ?? {}).join(' ')).not.toMatch(/recipient|child|class|section/i);
  });

  it('keeps the server order rather than sorting — earliest expiry first is the spend rule',
    async () => {
      withRpc(() => [
        { ...BALANCE, id: 'soonest', expires_at: '2026-10-01T00:00:00Z' },
        { ...BALANCE, id: 'later', expires_at: '2026-12-01T00:00:00Z' },
      ]);
      const balances = await fetchMealPackBalances('u-1');
      expect(balances.map((b) => b.id)).toEqual(['soonest', 'later']);
    });

  it('refuses a status it does not recognise', async () => {
    // A new pack state added server-side without the app learning about it would otherwise
    // render as whatever the last branch happens to be.
    withRpc(() => [{ ...BALANCE, status: 'frozen' }]);
    await expect(fetchMealPackBalances('u-1')).rejects.toThrow(/unknown status/);
  });
});

describe('packThisOrderDrawsFrom', () => {
  const pack = (over: Partial<Parameters<typeof packThisOrderDrawsFrom>[0][number]>) =>
    ({
      id: 'p',
      schoolId: 's-1',
      schoolName: 'Amity',
      name: 'Pack 1',
      itemsTotal: 20,
      itemsRemaining: 5,
      itemsReserved: 0,
      bonusItems: 0,
      bonusRemaining: 0,
      bonusGranted: false,
      bonusStillPossible: false,
      bonusWindowEndsAt: '',
      purchasedAt: '',
      expiresAt: '',
      status: 'active' as const,
      pricePaidPaise: 300000,
      cgstPaise: 7500,
      sgstPaise: 7500,
      ...over,
    });

  it('picks the first pack at that school, which is the earliest expiry', () => {
    const chosen = packThisOrderDrawsFrom(
      [pack({ id: 'first' }), pack({ id: 'second' })],
      's-1',
    );
    expect(chosen?.id).toBe('first');
  });

  it('ignores a pack bought at another school — P22, bought here, spent here', () => {
    expect(packThisOrderDrawsFrom([pack({ schoolId: 's-other' })], 's-1')).toBeNull();
  });

  it('ignores a pack whose items are all already held by another checkout', () => {
    // itemsRemaining is what the parent owns; itemsReserved is what is spoken for. Spendable is
    // the difference, and a pack with nothing spendable is not the one this order draws from.
    expect(
      packThisOrderDrawsFrom([pack({ itemsRemaining: 2, itemsReserved: 2 })], 's-1'),
    ).toBeNull();
  });

  it('ignores an expired or exhausted pack', () => {
    expect(packThisOrderDrawsFrom([pack({ status: 'expired' })], 's-1')).toBeNull();
    expect(packThisOrderDrawsFrom([pack({ status: 'exhausted' })], 's-1')).toBeNull();
  });
});

describe('startMealPackPurchase — the CALL, not the result', () => {
  /**
   * `E21-91`. These assert what reaches the transport, and they exist because nothing did.
   *
   * The purchase was broken in production-shaped code for a day and every test passed, because
   * the only stub for `functions.invoke` was `async () => ({ data, error })` — it ignored its
   * arguments completely. So a call with the WRONG SHAPE was indistinguishable from a right one:
   * the wrapper takes `(name, body, method)` positionally, the code passed
   * `(name, { method, body, headers })`, and the entire options object went out as the body.
   *
   * The server saw `{"method":…,"body":{…},"headers":{…}}`, read `body.offer_id` as `undefined`
   * and returned 400 to every attempt. Andy found it by tapping a dead button; the Edge Function
   * logs found it by showing a 233-byte request body where 150 was expected.
   *
   * A mock that accepts anything proves the function was called. It does not prove it was called
   * correctly, and "called correctly" is the whole of a transport wrapper's job.
   */
  function captureInvoke() {
    const calls: { name: string; body: unknown; method: unknown }[] = [];
    setApiTransport({
      from: () => { throw new Error('This test should not touch a table.'); },
      rpc: async () => ({ data: null, error: null }),
      functions: {
        invoke: async (name: string, options?: { body?: unknown; method?: unknown }) => {
          // Recorded the way supabase-js actually receives it: a name, then ONE options object
          // whose `body` is what crosses the wire.
          calls.push({ name, body: options?.body, method: options?.method });
          return {
            data: {
              order_group_id: 'g-1',
              meal_pack_id: 'p-1',
              payable_paise: 315_000,
              net_price_paise: 300_000,
              cgst_paise: 7_500,
              sgst_paise: 7_500,
            },
            error: null,
          };
        },
      },
    } as never);
    return calls;
  }

  const input = {
    offerId: 'c7f3a1e2-4b8d-4c1a-9e2f-6d5b8a3c1f04',
    schoolId: '77308e75-d8e9-47ba-a503-7c38d482a72c',
    idempotencyKey: 'buy-123-abc',
  };

  it('sends the OFFER AND SCHOOL AT THE TOP LEVEL of the body', async () => {
    const calls = captureInvoke();
    await startMealPackPurchase(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('buy-meal-pack');
    // The exact three keys `buy-meal-pack` reads. Nested under `body`, as they were, every one
    // of these is `undefined` at the server and the purchase is refused.
    expect(calls[0]?.body).toEqual({
      offer_id: input.offerId,
      school_id: input.schoolId,
      idempotency_key: input.idempotencyKey,
    });
  });

  it('does NOT smuggle an options object into the body', async () => {
    // The failure stated as an absence, because that is how it looked: a body carrying `method`
    // or `headers` is the wrapper being called as though it were supabase-js.
    const calls = captureInvoke();
    await startMealPackPurchase(input);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('method');
    expect(body).not.toHaveProperty('headers');
    expect(body).not.toHaveProperty('body');
  });

  it('sends the idempotency key where the SERVER reads it', async () => {
    // It cannot go in a header — `invokeFunction` has no headers parameter — and the Edge
    // Function reads `headers.get('Idempotency-Key') || body.idempotency_key` for that reason.
    // Without it the server returns 400 before it looks at anything else.
    const calls = captureInvoke();
    await startMealPackPurchase(input);
    expect((calls[0]?.body as Record<string, unknown>).idempotency_key).toBe('buy-123-abc');
  });

  it('refuses a blank key before the transport, and does not call out at all', async () => {
    const calls = captureInvoke();
    await expect(startMealPackPurchase({ ...input, idempotencyKey: '   ' }))
      .rejects.toThrow(/idempotency key/i);
    expect(calls).toHaveLength(0);
  });

  it('returns the money the server sent, unaltered', async () => {
    captureInvoke();
    const started = await startMealPackPurchase(input);
    expect(started.payablePaise).toBe(315_000);
    expect(started.netPricePaise + started.cgstPaise + started.sgstPaise).toBe(315_000);
  });
});
