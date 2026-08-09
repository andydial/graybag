/**
 * The version-checked menu cache (`E04-10`).
 *
 * The shape of the problem, from CLAUDE.md's performance priorities: **the constraint is
 * network, not CPU.** Private schools in tier-1 Indian cities, mid-range Androids, unreliable
 * connections. A menu is ~50 items with images; fetching it on every app open is what makes
 * an app feel broken on a bad line. Menu changes are rare — 1 kitchen, 3 menus, 3 schools —
 * which is exactly the condition that makes version-based caching pay.
 *
 * So: on open, ask for a number. `GET /menu/version?school=X` returns a few bytes
 * (`E04-09`). If it matches what we hold, serve from disk and make no further request.
 *
 * Four properties, each because getting it wrong is quiet rather than loud:
 *
 * 1. **A failed version check serves the cache, it does not fail.** Offline is the ordinary
 *    case here, not the exception (`P8`: read-only offline in v1). An app that shows an error
 *    because it could not confirm freshness, while holding a perfectly good menu, has turned
 *    a working state into a broken one.
 * 2. **A failed *menu* fetch also serves the cache.** The version moved and we could not get
 *    the new menu — the old one is stale but real, and stale-and-labelled beats empty.
 * 3. **Nothing partial is ever written.** A menu is written with its version in one
 *    operation, because a cache holding version N's number against version N−1's dishes is
 *    worse than no cache: it is confidently wrong and it never self-corrects, since the next
 *    check compares the *stored* version and finds it current.
 * 4. **Concurrent callers share one in-flight load.** Six components mounting at once must
 *    not issue six round trips on the connection that is the bottleneck. Same reasoning as
 *    `createConfigCache`.
 */

/** What the cache needs from a key/value store. Matches AsyncStorage's shape. */
export interface MenuStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface CachedMenu<TMenu> {
  version: number;
  menu: TMenu;
  /** When this was fetched, ISO. Diagnostics only — freshness is decided by version. */
  fetchedAt: string;
}

export interface MenuResult<TMenu> {
  menu: TMenu;
  version: number;
  /**
   * `true` when we could not confirm this is current — the version check or the menu fetch
   * failed and we are serving what we had. The UI is expected to say so quietly (an offline
   * chip), never to block on it.
   */
  stale: boolean;
  /** `true` when this call went to the network for the menu body. */
  refetched: boolean;
}

export interface MenuCacheOptions<TMenu> {
  storage: MenuStorage;
  /** `GET /menu/version?school=X` — a few bytes (`E04-09`). */
  fetchVersion: (schoolId: string) => Promise<number>;
  fetchMenu: (schoolId: string) => Promise<{ menu: TMenu; version: number }>;
  /** Injected so tests are not clock-dependent. */
  now?: () => Date;
  keyPrefix?: string;
}

export class MenuUnavailableError extends Error {
  constructor(schoolId: string, cause: unknown) {
    super(
      `No menu for school ${schoolId}: nothing cached and the fetch failed. ` +
        `This is the only case the cache cannot paper over — there is genuinely nothing to show.`,
    );
    this.name = 'MenuUnavailableError';
    this.cause = cause;
  }
}

export interface MenuCache<TMenu> {
  get: (schoolId: string) => Promise<MenuResult<TMenu>>;
  /** Drop the cached menu for a school. Used on sign-out and school change. */
  invalidate: (schoolId: string) => Promise<void>;
}

export function createMenuCache<TMenu>(options: MenuCacheOptions<TMenu>): MenuCache<TMenu> {
  const { storage, fetchVersion, fetchMenu } = options;
  const now = options.now ?? (() => new Date());
  const prefix = options.keyPrefix ?? 'graybag.menu.v1';

  const keyFor = (schoolId: string) => `${prefix}.${schoolId}`;
  const inFlight = new Map<string, Promise<MenuResult<TMenu>>>();

  async function readCache(schoolId: string): Promise<CachedMenu<TMenu> | null> {
    let raw: string | null;
    try {
      raw = await storage.getItem(keyFor(schoolId));
    } catch {
      // A storage read failing is not a reason to fail the screen — it is a reason to
      // behave as though nothing was cached and go to the network.
      return null;
    }
    if (raw === null) return null;

    try {
      const parsed = JSON.parse(raw) as CachedMenu<TMenu>;
      // A stored blob missing its version is unusable: we cannot tell whether it is
      // current, and treating it as current is the confidently-wrong state property 3
      // exists to prevent.
      if (typeof parsed?.version !== 'number' || parsed.menu === undefined) return null;
      return parsed;
    } catch {
      // Corrupt JSON. Not recoverable and not worth reporting — the next write fixes it.
      return null;
    }
  }

  async function writeCache(schoolId: string, entry: CachedMenu<TMenu>): Promise<void> {
    try {
      await storage.setItem(keyFor(schoolId), JSON.stringify(entry));
    } catch {
      // Disk full, quota exceeded. The menu we hold in memory is still good, so the call
      // succeeds and the next open pays for a refetch. Failing the screen here would turn
      // a full disk into "the app does not work".
    }
  }

  async function load(schoolId: string): Promise<MenuResult<TMenu>> {
    const cached = await readCache(schoolId);

    let remoteVersion: number | null = null;
    try {
      remoteVersion = await fetchVersion(schoolId);
    } catch (error) {
      // Property 1. We hold a menu and could not confirm it — serve it.
      if (cached) {
        return { menu: cached.menu, version: cached.version, stale: true, refetched: false };
      }
      throw new MenuUnavailableError(schoolId, error);
    }

    if (cached && cached.version === remoteVersion) {
      return { menu: cached.menu, version: cached.version, stale: false, refetched: false };
    }

    try {
      const fresh = await fetchMenu(schoolId);
      // Property 3: the version written is the one that came back WITH the menu, never the
      // one from the version endpoint. They can differ — a menu can change between the two
      // calls — and storing the endpoint's number against this body would mark a stale menu
      // as current, permanently, because the next check compares the stored number.
      await writeCache(schoolId, {
        version: fresh.version,
        menu: fresh.menu,
        fetchedAt: now().toISOString(),
      });
      return { menu: fresh.menu, version: fresh.version, stale: false, refetched: true };
    } catch (error) {
      // Property 2. Stale and real beats empty.
      if (cached) {
        return { menu: cached.menu, version: cached.version, stale: true, refetched: false };
      }
      throw new MenuUnavailableError(schoolId, error);
    }
  }

  return {
    async get(schoolId: string): Promise<MenuResult<TMenu>> {
      const existing = inFlight.get(schoolId);
      if (existing) return existing;

      const promise = load(schoolId).finally(() => inFlight.delete(schoolId));
      inFlight.set(schoolId, promise);
      return promise;
    },

    async invalidate(schoolId: string): Promise<void> {
      inFlight.delete(schoolId);
      try {
        await storage.removeItem(keyFor(schoolId));
      } catch {
        // Nothing useful to do. The version check corrects it on the next open.
      }
    },
  };
}
