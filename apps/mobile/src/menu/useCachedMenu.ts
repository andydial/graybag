import { useCallback, useEffect, useState } from 'react';
import type { menu as menuDomain } from '@graybag/shared';

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
} {
  const [state, setState] = useState<MenuState>('loading');
  const [payload, setPayload] = useState<CachedMenuPayload | null>(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // No school chosen yet is not an error and not a load — it is an empty menu. Treating it
    // as an error would put a retry button in front of someone who has nothing to retry.
    if (schoolId === null || cache === null) {
      setState('ready');
      setPayload(null);
      setStale(false);
      return;
    }

    let live = true;
    setState('loading');

    cache
      .get(schoolId)
      .then((result) => {
        if (!live) return;
        setPayload(result.menu);
        setStale(result.stale);
        setState('ready');
      })
      .catch(() => {
        if (!live) return;
        // The cache only rejects when there is nothing stored AND the fetch failed — every
        // other path serves something (`MC3`). So reaching here genuinely means there is
        // nothing to show.
        setState('error');
        setPayload(null);
      });

    return () => {
      live = false;
    };
  }, [schoolId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, payload, stale, retry };
}
