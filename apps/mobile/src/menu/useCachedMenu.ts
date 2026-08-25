import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../analytics/analytics';
import type { menu as menuDomain } from '@graybag/shared';

import { useConnectivity } from '../net/ConnectivityContext';

/**
 * The screen's view of the menu cache (`E04-10`).
 *
 * `createMenuCache` in `packages/shared` owns the rules — what counts as fresh, when a stale
 * cache is served, what is written and when. This hook owns only the React part: mount,
 * unmount, retry, and not setting state on a component that has gone away.
 *
 * The split matters because the cache's rules are the ones with teeth (`MC2`: store the
 * version that arrived *with* the body) and they are tested in `cache.test.ts` without a
 * renderer. A hook that reimplemented any of them would be a second, untested copy.
 */

/** Facts about the last menu read. Ids and counts only — never a dish, never a person (R6). */
export interface MenuDiagnostic {
  schoolId: string | null;
  version: number | null;
  /** Where this render's data came from, or how it failed. */
  source: 'cache' | 'network' | 'failed' | 'no-cache' | null;
  rows: number | null;
}

export interface CachedDish {
  id: string;
  /**
   * The `menu_item` row, which is what a checkout line is identified by — never the dish id.
   * Cached with the dish because the cart is built from the cache, and a cached menu that
   * could be browsed but not ordered from is the shape of `E05-16`.
   */
  menuItemId: string;
  name: string;
  description: string | null;
  categoryId: string;
  /**
   * Vegetarian / contains egg / non-vegetarian — `0023`, `E21-02`.
   *
   * Cached with the dish because the mark is drawn on every card in the grid, and a menu that
   * could be browsed but not judged is no use to the large share of this audience for whom
   * this is the first and sometimes only question.
   */
  foodType: 'veg' | 'non_veg' | 'egg' | null;
  /**
   * The calorie figure as written — "310-340" — or `null` for most dishes (`0028`).
   *
   * Cached with the dish rather than fetched per sheet: it comes from the same projection, and
   * a second round trip on this audience's connection to render one line would be the slowest
   * thing on the screen.
   */
  caloriesText: string | null;
  ingredientsText: string | null;
  pricePaise: number;
  imageUri: string | null;
  allergens: { allergenId: string; presence: 'contains' | 'may_contain' }[];
  allergensDeclaredNone: boolean;
}

export interface CachedMenuPayload {
  categories: { id: string; label: string }[];
  dishes: CachedDish[];
}

type MenuCache = ReturnType<typeof menuDomain.createMenuCache<CachedMenuPayload>>;

export type MenuState = 'loading' | 'ready' | 'error';

/**
 * The cache instance, injected rather than constructed here.
 *
 * It needs a storage adapter and two fetchers, all of which live behind the `api/` module
 * (`A4`) — and a hook that built its own would make this screen untestable without a
 * network. `setMenuCache` is called once at app start; tests call it with a fake.
 */
let cache: MenuCache | null = null;

export function setMenuCache(next: MenuCache | null): void {
  cache = next;
}

export function useCachedMenu(schoolId: string | null): {
  state: MenuState;
  payload: CachedMenuPayload | null;
  stale: boolean;
  retry: () => void;
  /** Why this render looks the way it does. Non-production display only. */
  diagnostic: MenuDiagnostic;
} {
  const [state, setState] = useState<MenuState>('loading');
  const [payload, setPayload] = useState<CachedMenuPayload | null>(null);
  const [stale, setStale] = useState(false);
  /**
   * The four facts that settle "why is this screen empty" without another round trip to Andy.
   * Rendered only in non-production builds — see `components/EmptyStateDiagnostic.tsx`.
   */
  const [diagnostic, setDiagnostic] = useState<MenuDiagnostic>({
    schoolId: null,
    version: null,
    source: null,
    rows: null,
  });
  const [attempt, setAttempt] = useState(0);
  const { report } = useConnectivity();

  useEffect(() => {
    // No school chosen yet is not an error and not a load — it is an empty menu. Treating it
    // as an error would put a retry button in front of someone who has nothing to retry.
    if (schoolId === null) {
      setState('ready');
      setPayload(null);
      setStale(false);
      return;
    }

    /**
     * No cache installed is a **bug**, and it must not look like an empty menu.
     *
     * It used to share the branch above, and that is precisely how the Menu tab came to say
     * "this school's menu has not been published" in every build ever shipped: nothing called
     * `setMenuCache`, so `cache` was always `null`, and a missing wire rendered as a statement
     * about the school's data (`docs/ux-spec.md` §5.21 — N2 must never render as N1).
     *
     * `installMenuCache()` runs before first render, so reaching this in the app is impossible.
     * Reporting it as an error means that if it ever becomes possible again, it says so.
     */
    if (cache === null) {
      setState('error');
      setPayload(null);
      setStale(false);
      // The one failure with no school in it: the cache itself was never installed.
      setDiagnostic({ schoolId, version: null, source: 'no-cache', rows: null });
      return;
    }

    let live = true;
    setState('loading');
    setDiagnostic((d) => ({ ...d, schoolId, version: null, source: null, rows: null }));

    cache
      .get(schoolId)
      .then((result) => {
        if (!live) return;
        // The menu read is the app's most frequent request, so it is the cheapest place to
        // learn whether the backend is reachable — no extra round trip, and it answers on
        // exactly the path a parent is waiting on. `result.stale` means the cache served an
        // unconfirmed copy, which is itself evidence the network did not answer.
        report(!result.stale);
        setPayload(result.menu);
        setStale(result.stale);
        setState('ready');
        // What was asked for and what came back — see `components/EmptyStateDiagnostic.tsx`.
        // A count, never the contents.
        setDiagnostic({
          schoolId,
          version: result.version,
          source: result.refetched ? 'network' : 'cache',
          rows: result.menu.dishes.length,
        });
      })
      .catch(() => {
        if (!live) return;
        report(false);
        // The cache only rejects when there is nothing stored AND the fetch failed — every
        // other path serves something (`MC3`). So reaching here genuinely means there is
        // nothing to show.
        setState('error');
        setPayload(null);
        setDiagnostic({ schoolId, version: null, source: 'failed', rows: null });
      });

    return () => {
      live = false;
    };
  }, [schoolId, attempt, report]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * `E15-20`. **Once per menu that actually rendered with items**, which is what
   * `docs/posthog.md` §3 specifies — and the one event flagged there as able to run away on
   * volume if it fired per scroll or per school switch.
   *
   * Keyed on the school so switching schools counts once each, and guarded by a ref so a
   * re-render does not re-emit. No dish list, no counts per dish: `item_count` only.
   */
  const browsed = useRef<string | null>(null);
  useEffect(() => {
    if (state !== 'ready' || payload === null) return;
    const dishes = payload.dishes?.length ?? 0;
    if (dishes === 0) return;
    const key = `${schoolId}`;
    if (browsed.current === key) return;
    browsed.current = key;
    track('menu_browsed', { item_count: dishes });
  }, [state, payload, schoolId]);

  return { state, payload, stale, retry, diagnostic };
}
