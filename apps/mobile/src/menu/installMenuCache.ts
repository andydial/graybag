import { api, menu as menuDomain } from '@graybag/shared';

import { setMenuCache, type CachedMenuPayload } from './useCachedMenu';

/**
 * Build the menu cache and hand it to `useCachedMenu` — `E04-10`, finally connected.
 *
 * ## Why this file did not exist, and what that cost
 *
 * `createMenuCache` was written, tested and exported. `setMenuCache` was written and exported.
 * **Nothing ever called it.** `setMenuCache` appeared only in test files, so in every real build
 * `cache` stayed `null`, `useCachedMenu` returned an empty payload, and the Menu tab rendered
 * "This school's menu has not been published" — on every school, for every user, always.
 *
 * It survived because the unit suite passes a fake cache in, so the screens' tests were green
 * and the cache's tests were green, and the wire between them was the one thing neither could
 * see. It is the `docs/ux-spec.md` §5.21 failure in its purest form: a missing wire rendering as
 * a statement about the data.
 *
 * The Maestro flow (`E14-24`) is what makes that class of defect visible, because it is the only
 * test that runs the app the way a parent does.
 *
 * ## Storage is in memory, deliberately, for now
 *
 * The cache needs a key/value store and the app has none: `expo-secure-store` is for the session
 * (small, secret, and the wrong tool for a 50-dish blob), and `@react-native-async-storage` is
 * not a dependency. Adding it is a **native** module, so it cannot reach an already-installed
 * dev client without a new build — and the menu being broken today should not wait on that.
 *
 * So the cache runs with an in-memory store: correct on every property, and it simply does not
 * survive a restart. The app fetches the menu once per launch instead of once per version
 * change, which on a menu-sized payload is a real but modest cost, and every other property —
 * the in-flight sharing, the stale-serving, the refusal to persist an empty menu — still holds.
 *
 * `E04-15` swaps in AsyncStorage and needs a new dev-client build. Nothing else changes: that is
 * the point of the storage being an injected interface.
 */
function inMemoryStorage(): menuDomain.MenuStorage {
  const store = new Map<string, string>();
  return {
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

/**
 * `api.fetchMenu` returns the menu but not its version — the version is its own tiny endpoint,
 * which is the whole basis of the cache. Reading it a second time here would be a wasted round
 * trip on the connection that is the bottleneck, so the version that came back with the body is
 * the one the caller already resolved, threaded through.
 *
 * `MC2` insists the stored version is the one that arrived *with* the body. Since these are two
 * calls, "with" means "resolved no earlier than the body" — so the version is read **after** the
 * menu, never before. Read first, a menu published in between would be stored under the older
 * number and every later check would call it current.
 */
async function fetchMenuWithVersion(
  schoolId: string,
): Promise<{ menu: CachedMenuPayload; version: number }> {
  const payload = await api.fetchMenu(schoolId);
  const version = await api.fetchMenuVersion(schoolId);

  return {
    version: version ?? 0,
    menu: {
      categories: payload.categories,
      dishes: payload.dishes.map((dish) => ({
        id: dish.id,
        menuItemId: dish.menuItemId,
        name: dish.name,
        description: dish.description,
        categoryId: dish.categoryId,
        foodType: dish.foodType,
        caloriesText: dish.caloriesText,
        ingredientsText: dish.ingredientsText,
        pricePaise: dish.pricePaise,
        imageUri: dish.imageUri,
        allergens: dish.allergens,
        allergensDeclaredNone: dish.allergensDeclaredNone,
      })),
    },
  };
}

/** Called once at app start, before first render. */
export function installMenuCache(): void {
  setMenuCache(
    menuDomain.createMenuCache<CachedMenuPayload>({
      storage: inMemoryStorage(),
      fetchVersion: api.fetchMenuVersion,
      fetchMenu: fetchMenuWithVersion,
      // A menu with no dishes. Categories alone are not a menu — a payload carrying five
      // category labels and nothing to eat is exactly what a refused read produces, because
      // the categories are derived from the dish rows that did not arrive.
      isEmpty: (payload) => payload.dishes.length === 0,
    }),
  );
}
