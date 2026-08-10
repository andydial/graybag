/**
 * The menu domain (`E04-01`, `E04-02`, `E04-03`).
 *
 * Pure rules over rows the caller already holds — no fetching, no Supabase, no `Date`. The
 * app, the Excel importer and a future Edge Function all read the same implementation of
 * rules that must not diverge between them.
 */

export type {
  Allergen,
  AllergenPresence,
  Dish,
  DishAllergen,
  DishCategory,
  FoodType,
  IsoWeekday,
  Menu,
  MenuAssignment,
  MenuItem,
  MenuItemPriceOverride,
  MenuStatus,
  ServiceDate,
} from './types.js';

export {
  InvalidServiceDateError,
  isServiceDate,
  isWithin,
  isoWeekday,
  parseServiceDate,
} from './dates.js';

export {
  AmbiguousAssignmentError,
  isAvailableOn,
  resolveMenuIdForSchool,
  resolvePricePaise,
} from './resolve.js';

export {
  MenuUnavailableError,
  MenuUnreadableError,
  MENU_CACHE_EPOCH,
  createMenuCache,
  type CachedMenu,
  type MenuCache,
  type MenuCacheOptions,
  type MenuResult,
  type MenuStorage,
} from './cache.js';

export {
  VERSION_MAX_AGE_SECONDS,
  menuVersionResponse,
  parseSchoolId,
  type VersionResponse,
} from './version-endpoint.js';

export {
  ALL_CATEGORIES,
  filterMenu,
  matchesQuery,
  normalise,
  type SearchableDish,
} from './search.js';

export {
  allergenDisclosure,
  allergenWarning,
  mayStateNoAllergens,
  type AllergenDisclosure,
} from './allergens.js';
