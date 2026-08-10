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
 * Six properties, each because getting it wrong is quiet rather than loud. Properties 5 and 6
 * were added after a live incident: the app served an empty menu for a day because a read
 * refused by RLS came back as `200 []`, was cached against a valid version, and then matched on
 * every subsequent open.
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
 * 5. **An empty menu is never persisted, and an empty body against a real version is an
 *    error, not a menu.** `MenuUnreadableError`. A refused read is indistinguishable from an
 *    empty result at the wire — `200 []` either way — so the version is what tells them apart.
 * 6. **A cached empty menu is never trusted.** Even if one is somehow stored, it is treated as
 *    no cache and a live read is attempted. Property 5 should make it impossible; property 6 is
 *    what stops a device being stranded for ever if it turns out not to be.
 *
 * And one thing outside the cache's own logic: **`MENU_CACHE_EPOCH`**, because a change to what
 * the app may *read* does not move any menu's version, and without an epoch every installed app
 * keeps the pre-change answer for ever.
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
  /**
   * `GET /menu/version?school=X` — a few bytes (`E04-09`).
   *
   * **`null` means the school has no published menu at all**, which is a legitimate state and
   * is the ONLY thing that may be rendered as "nothing on the menu yet". A row in
   * `school_menu_version` is created the first time a menu is published, so its presence is
   * the evidence that a menu exists to be read.
   */
  fetchVersion: (schoolId: string) => Promise<number | null>;
  fetchMenu: (schoolId: string) => Promise<{ menu: TMenu; version: number }>;
  /**
   * Is this payload empty of dishes?
   *
   * The cache is generic over `TMenu`, so it cannot look inside one. It has to, because an
   * empty menu is the single most dangerous thing it can persist — see `MenuUnreadableError`.
   */
  isEmpty: (menu: TMenu) => boolean;
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

/**
 * A published menu came back with no dishes in it.
 *
 * **This is an authorization failure wearing an empty list's clothes.** PostgREST answers a
 * read that RLS or a missing grant filtered to nothing with `200 []`, not with an error — so a
 * refused menu read is byte-identical to a menu with no dishes. The only thing that tells them
 * apart is the version: `school_menu_version` gets a row the first time a menu is published, so
 * a version that exists alongside an empty body is a contradiction, and the contradiction means
 * we could not read what is there.
 *
 * It matters because of what happened when `AUTH-01` was outstanding: `anon` had no grant on
 * `public_menu`, every read returned `[]`, and the app cached that empty list against a
 * perfectly valid version. From then on the version matched on every open, the cache
 * short-circuited, and the app served the morning's authorization failure back as though it
 * were data — permanently, on every device that had opened the app once.
 */
export class MenuUnreadableError extends Error {
  constructor(schoolId: string, version: number) {
    super(
      `Menu for school ${schoolId} is published at version ${version} but came back empty. ` +
        `That is a refused read, not an empty menu, and it must never be cached or shown as ` +
        `"nothing on the menu yet".`,
    );
    this.name = 'MenuUnreadableError';
  }
}

export interface MenuCache<TMenu> {
  get: (schoolId: string) => Promise<MenuResult<TMenu>>;
  /** Drop the cached menu for a school. Used on sign-out and school change. */
  invalidate: (schoolId: string) => Promise<void>;
}

/**
 * Bump this whenever a migration changes **what the app is allowed to read**, not just what the
 * data says.
 *
 * The menu version tracks the *content* of a menu. It does not move when a GRANT or an RLS
 * policy changes, so `AUTH-01` altered what `anon` could see while every school's version
 * stayed put — and every device holding a cache from before it was stranded permanently, because
 * the version matched forever. A content version cannot express "the rules changed".
 *
 * The epoch is part of the storage key, so bumping it orphans every existing entry at once. It
 * costs one refetch per school per device and it is the only thing that unsticks a fleet.
 *
 * ## When to bump
 *
 * Any migration that touches a GRANT, an RLS policy, or the columns exposed by `public_menu`.
 * `scripts/check-migrations.mjs` cannot detect intent, so this is a review question on every
 * such migration: *does an installed app holding yesterday's cache still see the right thing?*
 *
 * | Epoch | Bumped by | Why |
 * |---|---|---|
 * | 1 | — | Original. |
 * | 2 | `AUTH-01` / `0012_anon_menu_table_grants.sql` | `anon` gained SELECT on the menu tables. Caches written before it hold an empty menu against a valid version and will never refetch. |
 */
export const MENU_CACHE_EPOCH = 2;

export function createMenuCache<TMenu>(options: MenuCacheOptions<TMenu>): MenuCache<TMenu> {
  const { storage, fetchVersion, fetchMenu, isEmpty } = options;
  const now = options.now ?? (() => new Date());
  const prefix = options.keyPrefix ?? `graybag.menu.v1.e${MENU_CACHE_EPOCH}`;

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
    const stored = await readCache(schoolId);

    /**
     * Property 6 — the poison escape.
     *
     * A cached menu with no dishes in it is never trusted, whatever its version says. Property
     * 5 means one should not exist, but a cache written by an older build, or by a path nobody
     * has thought of yet, must not be able to strand a device for ever. An empty cache entry is
     * treated as no cache entry: we always go and look.
     */
    const cached = stored !== null && !isEmpty(stored.menu) ? stored : null;

    let remoteVersion: number | null;
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

      /**
       * Property 5 — an empty body against a real version is a refused read, not a menu.
       *
       * `remoteVersion === null` means no menu has ever been published for this school, and an
       * empty result there is the truth: it renders as "nothing on the menu yet". A version
       * that exists says a menu does too, so an empty body contradicts it, and the contradiction
       * is an authorization failure PostgREST reported as `200 []`.
       *
       * It is not cached and it is not returned. Doing either is how a morning's grants problem
       * became a permanent one.
       */
      if (remoteVersion !== null && isEmpty(fresh.menu)) {
        throw new MenuUnreadableError(schoolId, remoteVersion);
      }

      // Property 3: the version written is the one that came back WITH the menu, never the
      // one from the version endpoint. They can differ — a menu can change between the two
      // calls — and storing the endpoint's number against this body would mark a stale menu
      // as current, permanently, because the next check compares the stored number.
      //
      // Property 4: an empty menu is never persisted. A school with nothing published costs
      // one small request per open, which is the right price for making the poisoned-cache
      // state unreachable.
      if (!isEmpty(fresh.menu)) {
        await writeCache(schoolId, {
          version: fresh.version,
          menu: fresh.menu,
          fetchedAt: now().toISOString(),
        });
      }
      return { menu: fresh.menu, version: fresh.version, stale: false, refetched: true };
    } catch (error) {
      // Property 2. Stale and real beats empty — including when the fresh read was refused.
      if (cached) {
        return { menu: cached.menu, version: cached.version, stale: true, refetched: false };
      }
      // A refused read is reported as itself so the screen can say "we couldn't load the menu"
      // rather than "this school hasn't published one" (`docs/ux-spec.md` §5.21, N2 vs N1).
      if (error instanceof MenuUnreadableError) throw error;
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
