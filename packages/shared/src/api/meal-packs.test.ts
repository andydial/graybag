import { afterEach, describe, expect, it, vi } from 'vitest';

import { setApiTransport } from './client.js';
import { fetchMealPackOffers, fetchMealPackSurface } from './meal-packs.js';

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
    name: '10 meal pack',
    meals_count: 10,
    items_per_meal: 2,
    required_category_id: 'cat-drinks',
    net_price_paise: 300000,
    alacarte_reference_paise: 337500,
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
      name: '10 meal pack',
      mealsCount: 10,
      itemsPerMeal: 2,
      requiredCategoryId: 'cat-drinks',
      netPricePaise: 300000,
      alacarteReferencePaise: 337500,
      validityDays: 60,
    });
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

  it('refuses an offer missing its required category, which is the meal rule', async () => {
    withRpc(() => [{ ...OFFER, required_category_id: null }]);
    await expect(fetchMealPackOffers('s-1')).rejects.toThrow(/required category/);
  });

  it('returns an empty list without complaint when the school simply has none', async () => {
    // Distinct from the failure above: the server answered, and the answer is none.
    withRpc(() => []);
    expect(await fetchMealPackOffers('s-1')).toEqual([]);
  });
});
