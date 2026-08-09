import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenuUnavailableError, createMenuCache, type MenuStorage } from './cache.js';

type Menu = { items: string[] };

function memoryStorage(): MenuStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async getItem(key) {
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
  };
}

const SCHOOL = 'school-1';
const NOW = () => new Date('2026-08-09T00:00:00Z');

describe('createMenuCache', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('fetches and stores on a cold start', async () => {
    const fetchMenu = vi.fn(async () => ({ menu: { items: ['a'] }, version: 5 }));
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => 5,
      fetchMenu,
      now: NOW,
    });

    const result = await cache.get(SCHOOL);
    expect(result).toMatchObject({ version: 5, stale: false, refetched: true });
    expect(result.menu.items).toEqual(['a']);
    expect(storage.store.size).toBe(1);
  });

  it('serves from disk without fetching the menu when the version matches', async () => {
    // The entire point. One tiny request on open, and no menu body over the wire.
    const fetchMenu = vi.fn(async () => ({ menu: { items: ['a'] }, version: 5 }));
    const fetchVersion = vi.fn(async () => 5);
    const cache = createMenuCache<Menu>({ storage, fetchVersion, fetchMenu, now: NOW });

    await cache.get(SCHOOL);
    expect(fetchMenu).toHaveBeenCalledTimes(1);

    const second = await cache.get(SCHOOL);
    expect(second).toMatchObject({ version: 5, stale: false, refetched: false });
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    expect(fetchVersion).toHaveBeenCalledTimes(2);
  });

  it('refetches when the version moves', async () => {
    let version = 5;
    const fetchMenu = vi.fn(async () => ({ menu: { items: [`v${version}`] }, version }));
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => version,
      fetchMenu,
      now: NOW,
    });

    await cache.get(SCHOOL);
    version = 6;
    const result = await cache.get(SCHOOL);

    expect(result).toMatchObject({ version: 6, refetched: true, stale: false });
    expect(result.menu.items).toEqual(['v6']);
  });

  /**
   * Offline is the ordinary case, not the exception (`P8`). An app that shows an error
   * because it could not *confirm* freshness, while holding a perfectly good menu, has
   * turned a working state into a broken one.
   */
  it('serves the cache when the version check fails, marked stale', async () => {
    let online = true;
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => {
        if (!online) throw new Error('offline');
        return 5;
      },
      fetchMenu: async () => ({ menu: { items: ['a'] }, version: 5 }),
      now: NOW,
    });

    await cache.get(SCHOOL);
    online = false;

    const result = await cache.get(SCHOOL);
    expect(result).toMatchObject({ version: 5, stale: true, refetched: false });
    expect(result.menu.items).toEqual(['a']);
  });

  it('serves the cache when the version moved but the menu fetch fails', async () => {
    // Stale and real beats empty. We know it is out of date and we say so.
    let version = 5;
    let menuWorks = true;
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => version,
      fetchMenu: async () => {
        if (!menuWorks) throw new Error('connection reset');
        return { menu: { items: ['a'] }, version };
      },
      now: NOW,
    });

    await cache.get(SCHOOL);
    version = 6;
    menuWorks = false;

    const result = await cache.get(SCHOOL);
    expect(result).toMatchObject({ version: 5, stale: true });
  });

  it('throws only when there is nothing cached and the fetch fails', async () => {
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => {
        throw new Error('offline');
      },
      fetchMenu: async () => ({ menu: { items: [] }, version: 1 }),
      now: NOW,
    });

    await expect(cache.get(SCHOOL)).rejects.toThrow(MenuUnavailableError);
  });

  /**
   * The version stored is the one that arrived WITH the menu body, never the one the
   * version endpoint returned. They can differ — the menu can change between the two calls
   * — and storing the endpoint's number against this body marks a stale menu as current
   * *permanently*, because every later check compares the stored number and finds it equal.
   */
  it('stores the version that came with the menu, not the one from the version endpoint', async () => {
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => 9,
      fetchMenu: async () => ({ menu: { items: ['a'] }, version: 10 }),
      now: NOW,
    });

    const result = await cache.get(SCHOOL);
    expect(result.version).toBe(10);

    const stored = JSON.parse([...storage.store.values()][0] ?? '{}');
    expect(stored.version).toBe(10);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    // Six components mounting at once must not issue six round trips on the connection
    // that is the bottleneck.
    const fetchMenu = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { menu: { items: ['a'] }, version: 1 };
    });
    const fetchVersion = vi.fn(async () => 1);
    const cache = createMenuCache<Menu>({ storage, fetchVersion, fetchMenu, now: NOW });

    const results = await Promise.all([
      cache.get(SCHOOL),
      cache.get(SCHOOL),
      cache.get(SCHOOL),
      cache.get(SCHOOL),
      cache.get(SCHOOL),
      cache.get(SCHOOL),
    ]);

    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.version === 1)).toBe(true);
  });

  it('does not share an in-flight load between different schools', async () => {
    const fetchMenu = vi.fn(async (schoolId: string) => ({
      menu: { items: [schoolId] },
      version: 1,
    }));
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => 1,
      fetchMenu,
      now: NOW,
    });

    const [a, b] = await Promise.all([cache.get('school-a'), cache.get('school-b')]);
    expect(a.menu.items).toEqual(['school-a']);
    expect(b.menu.items).toEqual(['school-b']);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
  });

  it('treats corrupt stored JSON as a cold start rather than crashing', async () => {
    await storage.setItem('graybag.menu.v1.school-1', '{not json');
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => 1,
      fetchMenu: async () => ({ menu: { items: ['a'] }, version: 1 }),
      now: NOW,
    });

    const result = await cache.get(SCHOOL);
    expect(result.refetched).toBe(true);
  });

  it('treats a stored blob with no version as unusable', async () => {
    // We could not tell whether it is current, and assuming it is current is the
    // confidently-wrong state the cache exists to avoid.
    await storage.setItem('graybag.menu.v1.school-1', JSON.stringify({ menu: { items: ['old'] } }));
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => 1,
      fetchMenu: async () => ({ menu: { items: ['new'] }, version: 1 }),
      now: NOW,
    });

    const result = await cache.get(SCHOOL);
    expect(result.menu.items).toEqual(['new']);
  });

  it('survives a storage that cannot write', async () => {
    // Disk full is not "the app does not work".
    const failing: MenuStorage = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('quota exceeded');
      },
      removeItem: async () => {},
    };
    const cache = createMenuCache<Menu>({
      storage: failing,
      fetchVersion: async () => 1,
      fetchMenu: async () => ({ menu: { items: ['a'] }, version: 1 }),
      now: NOW,
    });

    const result = await cache.get(SCHOOL);
    expect(result.menu.items).toEqual(['a']);
  });

  it('invalidate forces a refetch', async () => {
    const fetchMenu = vi.fn(async () => ({ menu: { items: ['a'] }, version: 1 }));
    const cache = createMenuCache<Menu>({
      storage,
      fetchVersion: async () => 1,
      fetchMenu,
      now: NOW,
    });

    await cache.get(SCHOOL);
    await cache.invalidate(SCHOOL);
    await cache.get(SCHOOL);

    expect(fetchMenu).toHaveBeenCalledTimes(2);
  });
});
