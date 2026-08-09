/**
 * Filtering a menu by category and by search text (`E04-12`).
 *
 * Pure, and in `packages/shared` rather than in the screen, because "can a parent find cold
 * coffee" is a rule about the product and not a detail of one component — the web admin will
 * need the same answers, and two implementations of "does this match" diverge in exactly the
 * way that makes a dish findable on one surface and invisible on the other.
 *
 * `E04`'s context note is the sizing constraint: the largest menu is 50 items. That is small
 * enough that a linear scan per keystroke is free, and small enough that a fuzzy matcher
 * would do more harm than good — on 50 items, fuzzy matching mostly returns things you did
 * not ask for.
 */

export interface SearchableDish {
  id: string;
  name: string;
  description: string | null;
  /** The resolved category — a menu item's override, falling back to the dish's own. */
  categoryId: string;
  /** Searchable because a parent looks for "paneer" and it is an ingredient, not a name. */
  ingredientsText?: string | null;
}

/** The sentinel category meaning "no filter". Not a real category id. */
export const ALL_CATEGORIES = '__all__';

/**
 * Normalise for comparison.
 *
 * Lowercase, strip diacritics, collapse whitespace. Diacritics matter here rather than being
 * theoretical: a menu written by a kitchen contains "Jalapeño" and a parent types "jalapeno",
 * and a search that misses that looks broken rather than strict.
 */
export function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does this dish match the query?
 *
 * **Every whitespace-separated term must match somewhere** — an AND across terms, an OR
 * across fields. "cold coffee" finds a dish named "Cold Coffee"; it also finds "Coffee,
 * served cold", which is right. An OR across terms would make every extra word you type
 * *widen* the results, which is the opposite of what typing more means.
 */
export function matchesQuery(dish: SearchableDish, query: string): boolean {
  const terms = normalise(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalise(
    [dish.name, dish.description ?? '', dish.ingredientsText ?? ''].join(' '),
  );

  return terms.every((term) => haystack.includes(term));
}

/**
 * Filter by category and query together.
 *
 * Category first because it is the cheaper test, and because the two compose as AND: a search
 * inside a category searches *that* category. The alternative — search ignores the category —
 * is defensible but surprising, since the tab stays visibly selected while results appear
 * from elsewhere.
 */
export function filterMenu<T extends SearchableDish>(
  dishes: readonly T[],
  { categoryId = ALL_CATEGORIES, query = '' }: { categoryId?: string; query?: string } = {},
): T[] {
  return dishes.filter(
    (dish) =>
      (categoryId === ALL_CATEGORIES || dish.categoryId === categoryId) &&
      matchesQuery(dish, query),
  );
}
