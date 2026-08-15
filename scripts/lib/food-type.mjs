// Proposing a `food_type` from a dish's name, ingredients and description — `E10-32`.
//
// **This module proposes. It never decides.** Nothing here writes to the database, and every
// output carries a confidence and the exact words it was derived from, because the person
// applying it has to be able to disagree with any single row in under a second.
//
// ## Why a wrong answer here is the worst thing this product can output
//
// A dish marked `veg` that contains egg is served to a child whose family does not eat egg, on
// the strength of a label we wrote. That is not a data-quality problem, it is a broken promise to
// a parent — and in this market vegetarian status is the first thing many families check. So the
// rules below are deliberately **asymmetric**:
//
//   * evidence of egg or meat is taken at face value and marked high confidence;
//   * absence of evidence is NOT evidence of absence — a dish with no ingredient list cannot be
//     called veg with confidence, however obviously vegetarian its name reads;
//   * anything containing an ingredient that is *usually* but not *always* vegetarian —
//     mayonnaise above all — is proposed as veg and flagged **low**, with the reason stated.
//
// The output is therefore three piles: ones worth trusting, ones worth a glance, and ones a human
// has to answer. That shape is the point. A single confident-looking column over 79 dishes would
// get applied wholesale, which is exactly the failure this exists to prevent.

/** Word-boundary match, so "eggless" never matches "egg". */
const has = (text, word) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(text);
const hasAny = (text, words) => words.filter((w) => has(text, w));

/**
 * Unambiguous animal flesh. None of these appear in the current catalogue, which is itself worth
 * knowing — but a list that only handled what today's data contains would be silently wrong the
 * first time a chicken roll is added.
 */
const MEAT = [
  'chicken', 'mutton', 'lamb', 'beef', 'pork', 'bacon', 'ham', 'salami', 'pepperoni',
  'fish', 'tuna', 'prawn', 'prawns', 'shrimp', 'crab', 'meat', 'keema', 'seekh',
  'gelatin', 'gelatine', 'lard', 'anchovy', 'anchovies',
];

/** Egg, in the forms it actually appears in as a name or an ingredient. */
const EGG = ['egg', 'eggs', 'omelette', 'omelet', 'anda', 'meringue', 'albumen'];

/**
 * Vegetarian in India in almost every case, and not guaranteed by the ingredient name alone.
 *
 * `mayonnaise` is the one that matters: eggless mayo is the default in Indian quick-service
 * kitchens, and egg mayo is nevertheless a real product. The dish is proposed `veg` because that
 * is the likelier truth, and marked **low** because the likelier truth is not good enough here.
 */
const NEEDS_A_HUMAN = {
  mayonnaise: 'contains mayonnaise — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen.',
  mayo: 'contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen.',
  cheese: 'contains cheese — vegetarian rennet is usual here but is not guaranteed by the name.',
  'ice cream': 'contains ice cream — some contain egg.',
  improver: 'contains a bread improver — these occasionally carry enzymes of animal origin.',
  marshmallow: 'contains marshmallow — usually gelatine, which is not vegetarian.',
};

export const HIGH = 'high';
export const LOW = 'low';
export const UNKNOWN = 'unknown';

/**
 * @param {{name: string, ingredientsText?: string|null, description?: string|null}} dish
 * @returns {{foodType: 'veg'|'non_veg'|'egg'|null, confidence: 'high'|'low'|'unknown', why: string}}
 *
 * `foodType: null` with `confidence: 'unknown'` means **this module refuses to guess**. That is a
 * real answer and the CSV carries it as a blank cell, so applying the file leaves the dish exactly
 * as it was rather than writing a guess.
 */
export function proposeFoodType(dish) {
  const name = dish.name ?? '';
  const ingredients = dish.ingredientsText ?? '';
  const description = dish.description ?? '';
  // Name and ingredients are evidence. The description is marketing copy and is used **only** to
  // find egg or meat words — never to justify a confident `veg`, because "wholesome" and
  // "guilt-free" are not facts about what is in the bowl.
  const evidence = `${name} ${ingredients}`;
  const everything = `${name} ${ingredients} ${description}`;

  // 1. Explicitly disclaimed. "Eggless Brownie" is the kitchen telling us directly, and it beats
  //    every inference below.
  if (/eggless|no egg|egg[- ]free/i.test(everything)) {
    return { foodType: 'veg', confidence: HIGH, why: 'the dish states it is eggless' };
  }

  // 2. Meat, anywhere. Taken at face value.
  const meat = hasAny(everything, MEAT);
  if (meat.length > 0) {
    return { foodType: 'non_veg', confidence: HIGH, why: `names ${meat.join(', ')}` };
  }

  // 3. Egg, anywhere — including in the description, because a dish whose copy mentions egg and
  //    whose ingredient list does not is far more likely to contain egg than to be a typo.
  const egg = hasAny(everything, EGG);
  if (egg.length > 0) {
    const inList = hasAny(`${name} ${ingredients}`, EGG).length > 0;
    return {
      foodType: 'egg',
      confidence: inList ? HIGH : LOW,
      why: inList ? `names ${egg.join(', ')}` : `only the description mentions ${egg.join(', ')} — confirm`,
    };
  }

  // 4. No ingredient list at all. **Refuses to answer.** The name may read as obviously
  //    vegetarian, but "obviously" is doing all the work, and this is the one column where that is
  //    not allowed. Nine of the 79 production dishes are in this state.
  if (ingredients.trim() === '') {
    return {
      foodType: null,
      confidence: UNKNOWN,
      why: 'no ingredient list — not guessed from the name alone',
    };
  }

  // 5. Vegetarian, with a caveat where one is honest.
  const caveats = Object.entries(NEEDS_A_HUMAN)
    .filter(([word]) => new RegExp(word.replace(' ', '\\s+'), 'i').test(evidence))
    .map(([, why]) => why);

  if (caveats.length > 0) {
    return { foodType: 'veg', confidence: LOW, why: caveats.join(' ') };
  }

  return {
    foodType: 'veg',
    confidence: HIGH,
    why: 'no egg or meat in the name or the ingredient list',
  };
}

/** Group a set of proposals the way somebody reviewing them will work through them. */
export function summarise(proposals) {
  const by = (type, confidence) =>
    proposals.filter((p) => p.foodType === type && p.confidence === confidence).length;
  return {
    total: proposals.length,
    vegHigh: by('veg', HIGH),
    vegLow: by('veg', LOW),
    egg: proposals.filter((p) => p.foodType === 'egg').length,
    nonVeg: proposals.filter((p) => p.foodType === 'non_veg').length,
    unknown: proposals.filter((p) => p.foodType === null).length,
    needsYou: proposals.filter((p) => p.confidence !== HIGH).length,
  };
}
