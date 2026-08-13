import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MENU_CACHE_EPOCH,
  MenuUnavailableError,
  MenuUnreadableError,
  createMenuCache,
  type MenuStorage,
} from './cache.js';

type Menu = { items: string[] };

/**
 * The cache is generic, so it needs telling what "empty" means for this payload. Properties 5
 * and 6 both hang off it, and both exist because a refused read arrives as `200 []`.
 */
const isEmpty = (menu: Menu) => menu.items.length === 0;

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
      isEmpty,
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
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty, fetchVersion, fetchMenu, now: NOW });

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
      isEmpty,
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
      isEmpty,
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
      isEmpty,
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
      isEmpty,
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
      isEmpty,
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
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty, fetchVersion, fetchMenu, now: NOW });

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
      isEmpty,
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
      isEmpty,
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
      isEmpty,
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
      isEmpty,
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
      isEmpty,
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

/**
 * The incident these exist for.
 *
 * `AUTH-01` left `anon` without a grant on `public_menu`. PostgREST answers a read that RLS or
 * a missing grant filtered to nothing with `200 []` — so the app received an empty menu, cached
 * it against a perfectly valid version, and from then on the version matched on every open. The
 * cache short-circuited and served that morning's authorization failure back as data, on every
 * device that had opened the app once, for ever.
 *
 * Three separate defences, because any one of them alone leaves a way back in.
 */
describe('createMenuCache — a refused read is not an empty menu', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('refuses to treat an empty body as a menu when a version says one exists', async () => {
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty,
      // A version row exists, so a menu has been published for this school...
      fetchVersion: async () => 7,
      // ...but the read came back with nothing, which can only mean we were not allowed to see it.
      fetchMenu: async () => ({ menu: { items: [] }, version: 7 }),
      now: NOW,
    });

    await expect(cache.get(SCHOOL)).rejects.toBeInstanceOf(MenuUnreadableError);
  });

  it('never writes an empty menu to disk', async () => {
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty,
      fetchVersion: async () => 7,
      fetchMenu: async () => ({ menu: { items: [] }, version: 7 }),
      now: NOW,
    });

    await cache.get(SCHOOL).catch(() => undefined);

    // Nothing persisted means nothing to be poisoned by on the next open.
    expect(storage.store.size).toBe(0);
  });

  // The other half: a school that genuinely has no published menu has NO version row, and that
  // is the only case allowed to render as "nothing on the menu yet" (ux-spec §5.21, N1 vs N2).
  it('serves a genuinely unpublished menu as empty, without caching it', async () => {
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty,
      fetchVersion: async () => null,
      fetchMenu: async () => ({ menu: { items: [] }, version: 0 }),
      now: NOW,
    });

    const result = await cache.get(SCHOOL);
    expect(result.menu.items).toEqual([]);
    // Not cached: a school publishes its first menu exactly once, and paying one small request
    // per open until it does is the right price for making the poisoned state unreachable.
    expect(storage.store.size).toBe(0);
  });

  it('never trusts a cached empty menu, even when the version matches', async () => {
    // The poison escape. Property 5 should stop one ever being written; this is what stops a
    // device stranded by an older build — or a path nobody has thought of — from staying stuck.
    const key = `graybag.menu.v1.e${MENU_CACHE_EPOCH}.${SCHOOL}`;
    storage.store.set(
      key,
      JSON.stringify({ version: 7, menu: { items: [] }, fetchedAt: '2026-08-09T00:00:00Z' }),
    );

    const fetchMenu = vi.fn(async () => ({ menu: { items: ['recovered'] }, version: 7 }));
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty,
      // Unchanged version — the exact condition that used to short-circuit for ever.
      fetchVersion: async () => 7,
      fetchMenu,
      now: NOW,
    });

    const result = await cache.get(SCHOOL);

    expect(fetchMenu).toHaveBeenCalledTimes(1);
    expect(result.menu.items).toEqual(['recovered']);
  });
});

/**
 * The property that reaches beyond this incident.
 *
 * A GRANT or an RLS change alters what the app may read without moving any menu's version, so
 * a content version cannot express it. Without an epoch in the key, every installed app keeps
 * the pre-change answer for ever — which is exactly what `AUTH-01` did to every device that had
 * opened the app before it landed.
 */
describe('MENU_CACHE_EPOCH', () => {
  it('orphans every entry written under a previous epoch', async () => {
    const storage = memoryStorage();
    const previousEpochKey = `graybag.menu.v1.e${MENU_CACHE_EPOCH - 1}.${SCHOOL}`;
    storage.store.set(
      previousEpochKey,
      JSON.stringify({ version: 7, menu: { items: ['stale'] }, fetchedAt: '2026-08-09T00:00:00Z' }),
    );

    const fetchMenu = vi.fn(async () => ({ menu: { items: ['fresh'] }, version: 7 }));
    const cache = createMenuCache<Menu>({
      storage,
      isEmpty,
      fetchVersion: async () => 7,
      fetchMenu,
      now: NOW,
    });

    const result = await cache.get(SCHOOL);

    // The old entry is unreachable rather than deleted — nothing has to enumerate keys, and a
    // downgrade to a previous build still finds its own cache where it left it.
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    expect(result.menu.items).toEqual(['fresh']);
    expect(storage.store.get(previousEpochKey)).toBeDefined();
  });

  it('is a number that only ever goes up', () => {
    // A downgrade would re-expose exactly the caches a bump was meant to orphan.
    expect(Number.isInteger(MENU_CACHE_EPOCH)).toBe(true);
    expect(MENU_CACHE_EPOCH).toBeGreaterThanOrEqual(2);
  });
});
