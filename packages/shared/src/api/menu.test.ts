import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  ApiError,
  ApiNotConfiguredError,
  MenuPayloadError,
  fetchMenu,
  fetchMenuVersion,
  setApiTransport,
  type ApiTransport,
} from './index.js';

/** A transport that returns whatever it is given, and records how it was called. */
function stub(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const transport: ApiTransport = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { transport, calls };
}

const dish = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'Veg Sandwich',
  description: 'Grilled',
  categoryId: 'c1',
  ingredientsText: 'bread, veg',
  pricePaise: 8000,
  imageUri: 'dishes/veg.jpg',
  allergensDeclaredNone: false,
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

  it('passes the school id to the AUTH-01 function', async () => {
    const { transport, calls } = stub({ data: { categories: [], dishes: [] }, error: null });
    setApiTransport(transport);

    await fetchMenu('school-7');

    expect(calls).toEqual([{ fn: 'get_school_menu', args: { p_school_id: 'school-7' } }]);
  });

  it('returns the payload in the cache shape', async () => {
    const { transport } = stub({
      data: { categories: [{ id: 'c1', label: 'Quick Bites' }], dishes: [dish()] },
      error: null,
    });
    setApiTransport(transport);

    const menu = await fetchMenu('s1');

    expect(menu.categories).toEqual([{ id: 'c1', label: 'Quick Bites' }]);
    expect(menu.dishes[0]).toMatchObject({ id: 'd1', name: 'Veg Sandwich', pricePaise: 8000 });
    expect(menu.dishes[0]?.allergens).toEqual([{ allergenId: 'a1', presence: 'contains' }]);
  });

  it('treats a school with no menu as empty, not as an error', async () => {
    // AR7: a missing menu must not be a wall in front of browsing, and it must not be a
    // retry button in front of someone with nothing to retry.
    const { transport } = stub({ data: null, error: null });
    setApiTransport(transport);

    await expect(fetchMenu('s1')).resolves.toEqual({ categories: [], dishes: [] });
  });

  it('raises an ApiError carrying the provider code', async () => {
    const { transport } = stub({ data: null, error: { message: 'permission denied', code: '42501' } });
    setApiTransport(transport);

    await expect(fetchMenu('s1')).rejects.toMatchObject({ name: 'ApiError', code: '42501' });
  });

  it('does not silently turn a backend failure into an empty menu', async () => {
    // The envelope collapses "call failed" and "returned nothing" into data === null. If
    // the error branch is ever dropped, an outage renders as a school with no dishes and
    // no error anywhere — which is the hardest possible thing to notice.
    const { transport } = stub({ data: null, error: { message: 'boom' } });
    setApiTransport(transport);

    await expect(fetchMenu('s1')).rejects.toBeInstanceOf(ApiError);
  });

  describe('payload validation', () => {
    const rejects = async (data: unknown, pattern: RegExp) => {
      const { transport } = stub({ data, error: null });
      setApiTransport(transport);
      await expect(fetchMenu('s1')).rejects.toBeInstanceOf(MenuPayloadError);
      await expect(fetchMenu('s1')).rejects.toThrow(pattern);
    };

    it('refuses a non-integer price', async () => {
      // Non-negotiable #3: money is integer paise. A float accepted here rounds somewhere
      // downstream and the difference lands on an invoice.
      await rejects({ categories: [], dishes: [dish({ pricePaise: 80.5 })] }, /not a non-negative integer/);
    });

    it('refuses a negative price', async () => {
      await rejects({ categories: [], dishes: [dish({ pricePaise: -1 })] }, /not a non-negative integer/);
    });

    it('refuses a dish with no id', async () => {
      await rejects({ categories: [], dishes: [dish({ id: 42 })] }, /has no id/);
    });

    it('refuses a category with no label', async () => {
      await rejects({ categories: [{ id: 'c1' }], dishes: [] }, /has no id or label/);
    });

    it('refuses a response that is not an object', async () => {
      await rejects('not a menu', /not an object/);
    });
  });

  it('defaults an unrecognised allergen presence to the more cautious value', async () => {
    // Under-warning about an allergen is the one failure in this payload that can hurt a
    // child. An unknown value must not become "no warning".
    const { transport } = stub({
      data: { categories: [], dishes: [dish({ allergens: [{ allergenId: 'a1', presence: 'wat' }] })] },
      error: null,
    });
    setApiTransport(transport);

    const menu = await fetchMenu('s1');
    expect(menu.dishes[0]?.allergens[0]?.presence).toBe('contains');
  });

  it('treats a missing allergens array as none rather than throwing', async () => {
    const { transport } = stub({
      data: { categories: [], dishes: [dish({ allergens: undefined })] },
      error: null,
    });
    setApiTransport(transport);

    const menu = await fetchMenu('s1');
    expect(menu.dishes[0]?.allergens).toEqual([]);
  });
});

describe('fetchMenuVersion', () => {
  beforeEach(() => setApiTransport(null));

  it('returns the version', async () => {
    const { transport, calls } = stub({ data: 7, error: null });
    setApiTransport(transport);

    await expect(fetchMenuVersion('s1')).resolves.toBe(7);
    expect(calls[0]).toEqual({ fn: 'get_school_menu_version', args: { p_school_id: 's1' } });
  });

  it('parses a bigint delivered as a string', async () => {
    // PostgREST renders bigint as a string rather than a number once it passes 2^53, and
    // a version compared as a string would order "10" before "9". The version will not get
    // that large, but parsing means the day it does is not the day cache invalidation
    // starts silently failing.
    const { transport } = stub({ data: '4294967296', error: null });
    setApiTransport(transport);

    await expect(fetchMenuVersion('s1')).resolves.toBe(4294967296);
  });

  it('returns null for a school that has no menu', async () => {
    const { transport } = stub({ data: null, error: null });
    setApiTransport(transport);

    await expect(fetchMenuVersion('s1')).resolves.toBeNull();
  });

  it('refuses a version that is not a number', async () => {
    const { transport } = stub({ data: 'not-a-version', error: null });
    setApiTransport(transport);

    await expect(fetchMenuVersion('s1')).rejects.toBeInstanceOf(MenuPayloadError);
  });
});
