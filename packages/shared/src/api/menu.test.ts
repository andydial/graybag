import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  ApiError,
  ApiNotConfiguredError,
  MenuPayloadError,
  fetchMenu,
  fetchMenuVersion,
  setApiTransport,
} from './index.js';
import { fakeTransport } from './test-support.js';

/** Install a fake transport answering with `data`, and hand back what it recorded. */
function stub(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const fake = fakeTransport(result.data, result.error);
  setApiTransport(fake.transport);
  return { transport: fake.transport, calls: fake.queries };
}

/** One row of `public_menu`, in the shape PostgREST returns. */
const row = (over: Record<string, unknown> = {}) => ({
  dish_id: 'd1',
  // Not the dish id. `create_checkout` identifies a line by the `menu_item`, and
  // `public_menu` did not carry it until migration `0017` — which is why the app could
  // browse a menu it had no way to order from (`E05-16`).
  menu_item_id: 'mi1',
  name: 'Veg Sandwich',
  description: 'Grilled',
  category_id: 'c1',
  category_label: 'Quick Bites',
  ingredients_text: 'bread, veg',
  price_paise: 8000,
  image_path: 'dishes/veg.jpg',
  allergens_declared_none: false,
  allergens: [{ allergenId: 'a1', presence: 'contains' }],
  ...over,
});

afterEach(() => setApiTransport(null));

describe('configuration', () => {
  it('fails with a diagnosable error rather than a null dereference', async () => {
    setApiTransport(null);
    await expect(fetchMenu('s1')).rejects.toBeInstanceOf(ApiNotConfiguredError);
  });
});

describe('fetchMenu', () => {
  beforeEach(() => setApiTransport(null));

  it('reads public_menu, filtered to the school', async () => {
    const { calls } = stub({ data: [], error: null });

    await fetchMenu('school-7');

    expect(calls[0]?.table).toBe('public_menu');
    expect(calls[0]?.filters).toEqual([{ column: 'school_id', value: 'school-7' }]);
  });

  it('makes ONE request, not four', async () => {
    // Drawing this from base tables needs the assignment, the items, the overrides and the
    // allergens. Four dependent round trips on a cold open, against mid-range Androids on
    // unreliable connections, is the difference between a menu that appears and one that
    // is still arriving. public_menu collapses them and carries no extra authority.
    const { calls } = stub({ data: [row()], error: null });

    await fetchMenu('s1');

    expect(calls).toHaveLength(1);
  });

  it('groups rows into the cache shape', async () => {
    stub({ data: [row()], error: null });

    const menu = await fetchMenu('s1');

    expect(menu.categories).toEqual([{ id: 'c1', label: 'Quick Bites' }]);
    expect(menu.dishes[0]).toMatchObject({ id: 'd1', name: 'Veg Sandwich', pricePaise: 8000 });
    expect(menu.dishes[0]?.allergens).toEqual([{ allergenId: 'a1', presence: 'contains' }]);
  });

  it('treats a school with no menu as empty, not as an error', async () => {
    // AR7: a missing menu must not be a wall in front of browsing, and it must not be a
    // retry button in front of someone with nothing to retry.
    stub({ data: null, error: null });

    await expect(fetchMenu('s1')).resolves.toEqual({ categories: [], dishes: [] });
  });

  it('raises an ApiError carrying the provider code', async () => {
    stub({ data: null, error: { message: 'permission denied', code: '42501' } });

    await expect(fetchMenu('s1')).rejects.toMatchObject({ name: 'ApiError', code: '42501' });
  });

  it('does not silently turn a policy denial into an empty menu', async () => {
    // Under [AUTH-01] this is sharper than it was. An RLS policy that stops matching rows
    // returns an empty list, exactly like a school with no menu — so the error branch is
    // the only thing that can tell "denied" from "nothing there". Drop it and a broken
    // policy ships as a school that appears to sell no food.
    stub({ data: null, error: { message: 'boom' } });

    await expect(fetchMenu('s1')).rejects.toBeInstanceOf(ApiError);
  });

  it('collapses duplicate categories across rows', async () => {
    stub({
      data: [row(), row({ dish_id: 'd2', menu_item_id: 'mi2', name: 'Paneer Wrap' })],
      error: null,
    });

    const menu = await fetchMenu('s1');

    expect(menu.categories).toEqual([{ id: 'c1', label: 'Quick Bites' }]);
    expect(menu.dishes).toHaveLength(2);
  });

  describe('payload validation', () => {
    const rejects = async (data: unknown, pattern: RegExp) => {
      stub({ data, error: null });
      await expect(fetchMenu('s1')).rejects.toBeInstanceOf(MenuPayloadError);
      stub({ data, error: null });
      await expect(fetchMenu('s1')).rejects.toThrow(pattern);
    };

    it('refuses a non-integer price', async () => {
      // Non-negotiable #3: money is integer paise. A float accepted here rounds somewhere
      // downstream and the difference lands on an invoice.
      await rejects([row({ price_paise: 80.5 })], /not a non-negative integer/);
    });

    it('refuses a negative price', async () => {
      await rejects([row({ price_paise: -1 })], /not a non-negative integer/);
    });

    it('refuses a dish with no id', async () => {
      await rejects([row({ dish_id: 42 })], /has no id/);
    });

    it('refuses a dish with no menuItemId, because it could not be ordered', async () => {
      // The failure this prevents is not a crash — it is a menu that renders perfectly and
      // whose every add-to-cart produces a checkout the server rejects. `E05-16`, one layer
      // on: `public_menu` joined `menu_item` and never selected its id, so no sequence of
      // calls the app could make produced a valid order line.
      await rejects([row({ menu_item_id: undefined })], /has no menuItemId/);
    });

    it('refuses a row with no category', async () => {
      await rejects([row({ category_id: null })], /has no categoryId/);
    });
  });

  it('defaults an unrecognised allergen presence to the more cautious value', async () => {
    // Under-warning about an allergen is the one failure in this payload that can hurt a
    // child. An unknown value must not become "no warning".
    stub({ data: [row({ allergens: [{ allergenId: 'a1', presence: 'wat' }] })], error: null });

    const menu = await fetchMenu('s1');
    expect(menu.dishes[0]?.allergens[0]?.presence).toBe('contains');
  });

  it('treats a missing allergens array as none rather than throwing', async () => {
    stub({ data: [row({ allergens: null })], error: null });

    const menu = await fetchMenu('s1');
    expect(menu.dishes[0]?.allergens).toEqual([]);
  });
});

describe('fetchMenuVersion', () => {
  beforeEach(() => setApiTransport(null));

  it('returns the version from a primary-key lookup', async () => {
    const { calls } = stub({ data: [{ version: 7 }], error: null });

    await expect(fetchMenuVersion('s1')).resolves.toBe(7);
    expect(calls[0]?.table).toBe('school_menu_version');
    expect(calls[0]?.filters).toEqual([{ column: 'school_id', value: 's1' }]);
  });

  it('parses a bigint delivered as a string', async () => {
    // PostgREST renders bigint as a string rather than a number once it passes 2^53, and
    // a version compared as a string would order "10" before "9". The version will not get
    // that large, but parsing means the day it does is not the day cache invalidation
    // starts silently failing.
    stub({ data: [{ version: '4294967296' }], error: null });

    await expect(fetchMenuVersion('s1')).resolves.toBe(4294967296);
  });

  it('returns null for a school that has no menu', async () => {
    stub({ data: [], error: null });

    await expect(fetchMenuVersion('s1')).resolves.toBeNull();
  });

  it('refuses a version that is not a number', async () => {
    stub({ data: [{ version: 'not-a-version' }], error: null });

    await expect(fetchMenuVersion('s1')).rejects.toBeInstanceOf(MenuPayloadError);
  });
});
