import type { Dish } from './types.js';

/**
 * What we are entitled to tell a parent about a dish's allergens (`E04-01`, `D7`, `MI1`).
 *
 * This is one function because the rule has exactly one correct implementation and several
 * plausible wrong ones, all of which are one line. The commonest is
 * `if (!dish.allergens.length) return 'none'` — which is why `MI1` is written the way it is,
 * and why `0006` added the column that makes the third state representable at all.
 */

export type AllergenDisclosure =
  /** The kitchen listed allergens. These are they. */
  | { state: 'declared'; allergenIds: string[] }
  /** The kitchen explicitly said there are none. Safe to say so. */
  | { state: 'declaredNone' }
  /**
   * **Nobody has said.** Not a synonym for `declaredNone` — an empty tag list and an
   * unanswered question are opposite facts wearing the same shape.
   */
  | { state: 'unknown' };

/**
 * Read the two fields together, in the only order that is safe.
 *
 * Rows first: a dish with tags has been described, whatever the flag says. Then the explicit
 * declaration. Only then, unknown — which is the default for every row `0006` backfilled,
 * because nothing already in the database came from a cell that said "none".
 */
export function allergenDisclosure(
  dish: Pick<Dish, 'allergens' | 'allergensDeclaredNone'>,
): AllergenDisclosure {
  if (dish.allergens.length > 0) {
    return { state: 'declared', allergenIds: dish.allergens.map((a) => a.allergenId) };
  }
  if (dish.allergensDeclaredNone) return { state: 'declaredNone' };
  return { state: 'unknown' };
}

/**
 * May the UI reassure the user that this dish is allergen-free?
 *
 * **Only `declaredNone` earns a reassurance.** `unknown` must render as "not stated" or as a
 * prompt to ask the kitchen — never as an absence of warning, and never as blank space,
 * which reads as "nothing to worry about" to every user who has not read this file. `D7`
 * exists so the add-to-cart warning (`E05-05`) is nearly free; it is only worth having if it
 * distinguishes these two.
 */
export function mayStateNoAllergens(
  dish: Pick<Dish, 'allergens' | 'allergensDeclaredNone'>,
): boolean {
  return allergenDisclosure(dish).state === 'declaredNone';
}

/**
 * Does this dish need a warning for a recipient with these allergies?
 *
 * Returns the intersection when there is one — and returns `{ warn: true, reason: 'unknown' }`
 * when the dish has never been described, because a child with a peanut allergy and a dish
 * nobody has classified is exactly the case where saying nothing is the harmful answer.
 *
 * `may_contain` warns as well as `contains`. The schema comment notes the Excel only supports
 * `contains` today, but the presence enum exists because a kitchen will eventually need the
 * distinction — and when it does, "may contain peanuts" must still stop the sale.
 */
export function allergenWarning(
  dish: Pick<Dish, 'allergens' | 'allergensDeclaredNone'>,
  recipientAllergenIds: readonly string[],
): { warn: false } | { warn: true; reason: 'unknown' } | { warn: true; reason: 'match'; allergenIds: string[] } {
  const disclosure = allergenDisclosure(dish);

  if (disclosure.state === 'unknown') return { warn: true, reason: 'unknown' };
  if (disclosure.state === 'declaredNone') return { warn: false };

  const wanted = new Set(recipientAllergenIds);
  const hits = disclosure.allergenIds.filter((id) => wanted.has(id));
  return hits.length > 0 ? { warn: true, reason: 'match', allergenIds: hits } : { warn: false };
}
