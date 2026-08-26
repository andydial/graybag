/**
 * Finding a dish — `E10-40`.
 *
 * Pure functions over the shapes the catalogue reads return, so the behaviour that decides what
 * Andy sees is testable without a browser.
 *
 * ## What this screen is for
 *
 * Not browsing. Nobody opens the dish list to see what dishes there are — they open it because
 * **one** dish is wrong. They know its name. The job is: reach it, change one field, confirm it
 * took. Everything here serves that and nothing else.
 *
 * That is why search matches ingredients as well as names (you remember "the one with paneer"),
 * why ranking puts a name match above an ingredient match (you usually remember the name), and
 * why the filters are states rather than categories — "no photo", "not on a menu", "allergens not
 * checked" are the reasons a person is looking, and "Bakery" almost never is.
 */
import { api } from '@graybag/shared';

type AdminDish = api.AdminDish;
type AdminMenu = api.AdminMenu;

/**
 * Lower-case, strip accents, collapse whitespace.
 *
 * Diacritics matter here: the catalogue contains "Pain Au Chocolat" and a person types "chocolat".
 * Without the fold, a search that looks obviously right returns nothing.
 */
export const fold = (s: string): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export type FoodTypeFilter = 'any' | 'veg' | 'non_veg' | 'egg' | 'unset';
export type AllergenFilter = 'any' | 'tagged' | 'declared_none' | 'unchecked';
export type PhotoFilter = 'any' | 'has' | 'missing';
export type MenuFilter = string; // 'any' | 'none' | a menu id
export type SortKey = 'name' | 'category' | 'price-asc' | 'price-desc' | 'state';

export interface DishQuery {
  text: string;
  menu: MenuFilter;
  foodType: FoodTypeFilter;
  allergens: AllergenFilter;
  photo: PhotoFilter;
  sort: SortKey;
  /**
   * "Show me only the dishes with something wrong" — `E10-48`.
   *
   * Not expressible as any of the filters above, because it is a **disjunction**: no food type
   * *or* unchecked allergens *or* on no menu *or* no photo. Setting three dropdowns gives the
   * intersection, which is nearly always empty and reads as "nothing is wrong".
   *
   * It is the question the prototype's workbench is built around — the screen exists to get a
   * catalogue into a publishable state — so it gets to be one click.
   */
  attention: boolean;
}

export const EMPTY_QUERY: DishQuery = {
  text: '',
  menu: 'any',
  foodType: 'any',
  allergens: 'any',
  photo: 'any',
  sort: 'name',
  attention: false,
};

/** Everything the row needs, resolved once, so rendering does no lookups. */
export interface DishRow {
  dish: AdminDish;
  placements: { menuId: string; menuName: string; pricePaise: number; isActive: boolean; availableDays: number[] }[];
  /** Cheapest live price, for sorting. Null when the dish is on no menu. */
  lowestPaise: number | null;
  /** How much is wrong with it, so "needs attention" can sort to the top. */
  problems: string[];
}

export function buildRows(dishes: AdminDish[], menus: AdminMenu[]): DishRow[] {
  const placementsByDish = new Map<string, DishRow['placements']>();
  for (const menu of menus) {
    for (const item of menu.items) {
      if (!placementsByDish.has(item.dishId)) placementsByDish.set(item.dishId, []);
      placementsByDish.get(item.dishId)!.push({
        menuId: menu.id,
        menuName: menu.name,
        pricePaise: item.pricePaise,
        isActive: item.isActive,
        availableDays: item.availableDays,
      });
    }
  }

  return dishes.map((dish) => {
    const placements = placementsByDish.get(dish.id) ?? [];
    const live = placements.filter((p) => p.isActive);
    const problems: string[] = [];

    // Ordered by how much they matter, because the row shows the first one.
    if (dish.foodType === null) problems.push('No food type');
    if (dish.allergens.length === 0 && !dish.allergensDeclaredNone) problems.push('Allergens not checked');
    if (placements.length === 0) problems.push('On no menu');
    if (!dish.imageAssetId) problems.push('No photo');
    if (!dish.isActive) problems.push('Retired');

    return {
      dish,
      placements,
      lowestPaise: live.length > 0 ? Math.min(...live.map((p) => p.pricePaise)) : null,
      problems,
    };
  });
}

/**
 * Score a row against the search text. `0` means no match.
 *
 * Every term must hit something — typing more words narrows, which is what a person expects and
 * what makes a second word worth typing. Within that, a name match outranks an ingredient match,
 * and a name that *starts* with the term outranks one that merely contains it, so "pan" puts
 * "Pancakes" above "Aloo & Pea Tikki" (whose ingredients mention pepper).
 */
export function score(row: DishRow, text: string): number {
  const terms = fold(text).split(' ').filter(Boolean);
  if (terms.length === 0) return 1;

  const name = fold(row.dish.name);
  const category = fold(row.dish.categoryName);
  const ingredients = fold(row.dish.ingredientsText ?? '');
  const menus = fold(row.placements.map((p) => p.menuName).join(' '));

  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (name.startsWith(term)) best = 100;
    else if (name.includes(` ${term}`)) best = 80;
    else if (name.includes(term)) best = 60;
    else if (category.includes(term)) best = 30;
    else if (menus.includes(term)) best = 20;
    else if (ingredients.includes(term)) best = 10;
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

const matchesFilters = (row: DishRow, q: DishQuery): boolean => {
  const { dish } = row;

  if (q.menu === 'none') {
    if (row.placements.length > 0) return false;
  } else if (q.menu !== 'any') {
    if (!row.placements.some((p) => p.menuId === q.menu)) return false;
  }

  if (q.foodType !== 'any') {
    if (q.foodType === 'unset' ? dish.foodType !== null : dish.foodType !== q.foodType) return false;
  }

  if (q.allergens !== 'any') {
    const tagged = dish.allergens.length > 0;
    const state = tagged ? 'tagged' : dish.allergensDeclaredNone ? 'declared_none' : 'unchecked';
    if (state !== q.allergens) return false;
  }

  if (q.photo !== 'any') {
    const has = Boolean(dish.imageAssetId);
    if (q.photo === 'has' ? !has : has) return false;
  }

  // A disjunction, deliberately — see `DishQuery.attention`. `problems` is already ordered by
  // how much each one matters, so "has any" is the whole test.
  if (q.attention && row.problems.length === 0) return false;

  return true;
};

const compare: Record<SortKey, (a: DishRow, b: DishRow) => number> = {
  name: (a, b) => a.dish.name.localeCompare(b.dish.name),
  category: (a, b) =>
    a.dish.categoryName.localeCompare(b.dish.categoryName) || a.dish.name.localeCompare(b.dish.name),
  // A dish on no menu has no price. It sorts last either way rather than reading as free (ascending)
  // or as the most expensive thing on the menu (descending).
  'price-asc': (a, b) =>
    (a.lowestPaise ?? Infinity) - (b.lowestPaise ?? Infinity) || a.dish.name.localeCompare(b.dish.name),
  'price-desc': (a, b) =>
    (b.lowestPaise ?? -Infinity) - (a.lowestPaise ?? -Infinity) || a.dish.name.localeCompare(b.dish.name),
  state: (a, b) => b.problems.length - a.problems.length || a.dish.name.localeCompare(b.dish.name),
};

/**
 * Filter, rank and sort — in that order.
 *
 * **Search rank beats the sort key when there is a search.** Sorting relevance results by name
 * alphabetically throws away the ranking that made them useful; a person who typed "pan" wants
 * "Pancakes" first, not "Paneer Croissant" because P-a-n-e sorts earlier.
 */
export function queryDishes(rows: DishRow[], q: DishQuery): DishRow[] {
  const filtered = rows.filter((r) => matchesFilters(r, q));
  const searching = fold(q.text).length > 0;

  if (!searching) return [...filtered].sort(compare[q.sort] ?? compare.name);

  return filtered
    .map((row) => ({ row, s: score(row, q.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.row.dish.name.localeCompare(b.row.dish.name))
    .map((x) => x.row);
}

/** Counts for the filter controls, so each option can say how many it would leave. */
export function facets(rows: DishRow[]) {
  const count = (p: (r: DishRow) => boolean) => rows.filter(p).length;
  return {
    total: rows.length,
    noFoodType: count((r) => r.dish.foodType === null),
    unchecked: count((r) => r.dish.allergens.length === 0 && !r.dish.allergensDeclaredNone),
    noPhoto: count((r) => !r.dish.imageAssetId),
    noMenu: count((r) => r.placements.length === 0),
    needsAttention: count((r) => r.problems.length > 0),
  };
}
