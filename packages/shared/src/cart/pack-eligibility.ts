/**
 * Does a set of chosen items make a valid pack meal? `E21-40`.
 *
 * ## This is a MIRROR of the server's rule, not the rule
 *
 * `meal_pack_ineligibility_reason` in `0069` decides, from the order lines as persisted, inside
 * the same transaction that decrements the balance. Andy, 2026-08-26: *"A client claiming a cart
 * qualifies proves nothing; the rule — two items, one from the configured category — is enforced
 * where the meal is spent."*
 *
 * So what is this for? Telling a parent **before** they tap, and telling them *why*. A cart that
 * cannot be redeemed should say "one of the two must be a drink" while they can still fix it,
 * rather than failing at confirm time with a server error. The two must agree, and when they
 * disagree the server wins — the app's answer only ever decides what to *say*, never what to
 * spend.
 *
 * ## The app is MORE specific than the server, deliberately
 *
 * The server returns `wrong_item_count`; this returns `too_few` or `too_many` with the gap. That
 * is not drift — the server only has to decide yes or no, while the app has to write a sentence
 * a parent can act on, and "pick one more item" is a different instruction from "remove one".
 * `missing_required_category` is the same string on both sides, because there the two agree
 * exactly and a shared string makes a real mismatch greppable.
 *
 * What must never differ is the **verdict**: any selection this accepts, the server must accept.
 * `pack-eligibility.test.ts` walks the boundaries — count by quantity rather than rows, a
 * zero-quantity line not satisfying the category — because each is a way the two could disagree.
 */

/** Why a set of items is not a pack meal, or `null` when it is one. */
export type PackMealProblem =
  | { reason: 'nothing_chosen' }
  | { reason: 'too_few'; shortBy: number }
  | { reason: 'too_many'; overBy: number }
  | { reason: 'missing_required_category' }
  | null;

export interface PackMealRule {
  /** How many items make one meal. From the offer, never assumed to be two. */
  itemsPerMeal: number;
  /** The category one item must come from. From the offer, never hardcoded to Drinks. */
  requiredCategoryId: string;
}

export interface ChosenItem {
  /** The dish's category. Compared against the rule's `requiredCategoryId`. */
  categoryId: string;
  /** How many of this dish. Two of one dish is two items, exactly as the server counts it. */
  quantity: number;
}

/**
 * Check a selection against a pack's meal rule.
 *
 * Counts **quantity**, not rows, because `meal_pack_ineligibility_reason` sums
 * `order_line.quantity`. Counting rows here would let a cart of one dish times two pass in the app
 * and be refused by the server — the exact disagreement this file exists to prevent.
 */
export function checkPackMeal(items: readonly ChosenItem[], rule: PackMealRule): PackMealProblem {
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  if (count === 0) return { reason: 'nothing_chosen' };
  if (count < rule.itemsPerMeal) return { reason: 'too_few', shortBy: rule.itemsPerMeal - count };
  if (count > rule.itemsPerMeal) return { reason: 'too_many', overBy: count - rule.itemsPerMeal };

  const hasRequired = items.some(
    (item) => item.categoryId === rule.requiredCategoryId && item.quantity > 0,
  );
  if (!hasRequired) return { reason: 'missing_required_category' };

  return null;
}

/**
 * The sentence a parent reads.
 *
 * Kept beside the check so a new problem cannot be added without someone writing its copy — a
 * reason code with no sentence renders as silence, which is how a parent ends up staring at a
 * control that will not turn on.
 *
 * `requiredLabel` is the category's display name ("a drink"), passed in rather than looked up,
 * because this module has no business fetching anything.
 */
export function packMealMessage(problem: PackMealProblem, requiredLabel: string): string | null {
  if (problem === null) return null;
  switch (problem.reason) {
    case 'nothing_chosen':
      return 'Nothing chosen yet';
    case 'too_few':
      return problem.shortBy === 1 ? 'Pick one more item' : `Pick ${problem.shortBy} more items`;
    case 'too_many':
      return problem.overBy === 1
        ? 'A pack meal is two items — remove one'
        : `A pack meal is two items — remove ${problem.overBy}`;
    case 'missing_required_category':
      return `One of the two must be ${requiredLabel}`;
    default: {
      // Exhaustive: adding a reason without copy is a compile error rather than a blank screen.
      const never: never = problem;
      return never;
    }
  }
}
