/**
 * Suggesting allergen tags from a dish's ingredients — `E10-33`.
 *
 * **Every output of this file is a guess, and the screen says so on every row.** Nothing here is
 * ever saved without a person pressing a button, and the suggestion is not pre-applied — it is
 * offered next to the checkboxes as something to accept.
 *
 * ## Why this is the most dangerous code in the repository
 *
 * `dish_allergen` and `recipient_allergen` share one vocabulary, and the match between them **is**
 * the allergy warning a parent sees. A missed tag is a child with a milk allergy handed a dish
 * containing milk, with the app having said nothing. There is no recovery from that and no other
 * control that catches it.
 *
 * So the rules are one-directional: they only ever **add** a suggestion, never remove one, and
 * `MI1`'s distinction is respected absolutely —
 *
 *     no suggestions  ≠  no allergens
 *
 * A dish this file has nothing to say about is `unknown`, which is a warning state, not a clean
 * one. `0006` created `allergens_declared_none` precisely so that "we checked, there are none" can
 * be recorded as a different fact from "nobody has looked", and the screen makes that a separate,
 * explicit action.
 *
 * ## Why keyword matching, and what it cannot do
 *
 * It reads the ingredient text, which is the only structured evidence there is. It cannot know
 * that a kitchen fries in the same oil, that a bread contains milk powder not listed, or that
 * "seasoning mix" hides soy. **It under-reports by construction**, which is why the screen never
 * presents an accepted suggestion as a completed dish.
 */

/**
 * The seven codes in `allergen` (`0063` then `0064`). Suggestions may only ever use these.
 *
 * Ordered as the picker shows them — by how often they matter, not by when the row was created.
 * **`egg` here is not `dish.food_type = 'egg'`**: one is a safety fact about an ingredient that a
 * child's record can be matched against, the other is a dietary classification of the whole dish.
 * A cake made with egg is `food_type: 'veg'` and carries the `egg` allergen, and both are true.
 */
export const ALLERGEN_CODES = ['milk', 'egg', 'gluten', 'tree_nut', 'peanut', 'soy', 'sesame'] as const;
export type AllergenCode = (typeof ALLERGEN_CODES)[number];

interface Matcher {
  word: string;
  /**
   * Match only as a whole word. Required for anything short enough to hide inside an unrelated
   * one — and the reason this option exists at all: **"veggies" contains "egg"**, so the default
   * substring rule tagged every vegetable dish in the catalogue as containing egg. A test caught
   * it; a menu would not have.
   */
  whole?: boolean;
  /** Words that cancel this hit. `nut` must not fire on "groundnut" — a peanut is not a tree nut. */
  unless?: string[];
  note?: string;
}

/**
 * Ingredient words that imply an allergen.
 *
 * Matched as substrings on a lower-cased ingredient list by default, because the source writes
 * "Mozzarella Cheese", "Refined Soybean Oil" and "Maida Base Bread" — the signal sits inside a
 * longer phrase far more often than it stands alone.
 *
 * Short words opt into `whole`, and words that are a substring of a *different* allergen use
 * `unless`. Both exist because of real failures, noted where they apply.
 */
const IMPLIES: Record<AllergenCode, Matcher[]> = {
  milk: [
    { word: 'milk' }, { word: 'cheese' }, { word: 'butter' }, { word: 'cream' },
    { word: 'paneer' }, { word: 'curd' }, { word: 'yoghurt' }, { word: 'yogurt' },
    { word: 'ghee' }, { word: 'khoya' }, { word: 'malai' }, { word: 'mozzarella' },
    { word: 'ice cream' }, { word: 'mayonnaise', note: 'mayonnaise often contains milk solids' },
    { word: 'mayo', whole: true, note: 'mayo often contains milk solids' },
    { word: 'chocolate', note: 'milk chocolate contains milk; dark chocolate usually does not' },
  ],
  gluten: [
    { word: 'wheat' }, { word: 'atta' }, { word: 'maida' }, { word: 'flour' },
    { word: 'bread' }, { word: 'bun' }, { word: 'pasta' }, { word: 'noodle' },
    { word: 'roti' }, { word: 'prantha' }, { word: 'paratha' }, { word: 'parantha' },
    { word: 'kulcha' }, { word: 'naan' }, { word: 'pav' }, { word: 'pao' },
    { word: 'suji' }, { word: 'semolina' }, { word: 'rava' }, { word: 'barley' },
    { word: 'rye' }, { word: 'oats' }, { word: 'croissant' }, { word: 'bagel' },
    { word: 'puff pastry' }, { word: 'pastry' }, { word: 'doughnut' }, { word: 'muffin' },
    { word: 'brownie' }, { word: 'cake' }, { word: 'crumb' }, { word: 'tortilla' },
    { word: 'wrap', note: 'a wheat wrap contains gluten; a rice or corn one does not' },
    { word: 'gluten' }, { word: 'sev', note: 'sev is usually gram flour, but papdi in the same mix is not' },
    { word: 'bhel', note: 'bhel usually includes papdi, which is maida' },
    { word: 'soy sauce', note: 'most soy sauce is brewed with wheat' },
  ],
  tree_nut: [
    { word: 'almond' }, { word: 'cashew' }, { word: 'walnut' }, { word: 'pista' },
    { word: 'pistachio' }, { word: 'hazelnut' }, { word: 'pecan' }, { word: 'badam' },
    { word: 'kaju' },
    // Cancelled on peanut and groundnut — a peanut is a legume, and tagging a peanut dish
    // `tree_nut` tells a peanut-allergic family nothing while alarming one that only avoids
    // cashews (`0064`). Caught by a test using "Groundnut sauce".
    { word: 'nut', whole: true, unless: ['peanut', 'groundnut'], note: 'check whether this is a tree nut or a peanut' },
  ],
  soy: [
    { word: 'soy' }, { word: 'soya' }, { word: 'soybean' }, { word: 'tofu', whole: true },
    { word: 'edamame' },
  ],
  egg: [
    // `whole` on every one of these: "veggies" contains "egg", and "anda" hides inside
    // plenty of words. This is the rule that would have tagged the whole catalogue.
    { word: 'egg', whole: true }, { word: 'eggs', whole: true },
    { word: 'omelette' }, { word: 'omelet' }, { word: 'anda', whole: true },
    { word: 'meringue' }, { word: 'albumen' }, { word: 'custard' },
    // The judgement call in this catalogue, and it points the opposite way from the food-type
    // one: eggless mayo is the Indian default, so `food_type` treats mayonnaise as probably-veg —
    // but an allergen suggestion that stays silent about it is a miss, and a miss here is the
    // failure that matters. Suggested, and caveated.
    { word: 'mayonnaise', note: 'eggless mayo is standard in Indian kitchens, but egg mayo exists — ask' },
    { word: 'mayo', whole: true, note: 'eggless mayo is standard in Indian kitchens, but egg mayo exists — ask' },
  ],
  peanut: [
    // Its own code, never folded into tree_nut: a peanut is a legume, and a great many people are
    // allergic to one and not the other (`0064`).
    { word: 'peanut' }, { word: 'groundnut' }, { word: 'moongphali' },
    { word: 'satay' }, { word: 'arachis' },
  ],
  sesame: [
    { word: 'sesame' }, { word: 'til', whole: true }, { word: 'tahini' }, { word: 'gingelly' },
    // Appears in breads without being named in the title, which is exactly why it is worth a
    // keyword rather than being left to whoever is reading the row.
    { word: 'burger bun', note: 'burger and pav buns are often sesame-topped — check the bread' },
  ],
};

export interface AllergenSuggestion {
  code: AllergenCode;
  /** The ingredient words that triggered it, so a person can disagree with the evidence itself. */
  evidence: string[];
  /** Set when the match is real but the conclusion is not certain. Shown on the row. */
  caveat: string | null;
}

/**
 * @param dish name and ingredient text — description is deliberately ignored, because marketing
 *   copy names things the dish evokes rather than things it contains.
 */
export function suggestAllergens(dish: { name?: string; ingredientsText?: string | null }): AllergenSuggestion[] {
  const text = `${dish.name ?? ''} ${dish.ingredientsText ?? ''}`.toLowerCase();
  const out: AllergenSuggestion[] = [];

  const matches = (m: Matcher) => {
    if (m.unless?.some((u) => text.includes(u))) return false;
    if (!m.whole) return text.includes(m.word);
    return new RegExp(`(^|[^a-z])${m.word}([^a-z]|$)`, 'i').test(text);
  };

  for (const code of ALLERGEN_CODES) {
    const hits = IMPLIES[code].filter(matches);
    if (hits.length === 0) continue;
    const caveats = hits.map((h) => h.note).filter((n): n is string => Boolean(n));
    out.push({
      code,
      evidence: hits.map((h) => h.word),
      // Only when EVERY hit is caveated. One solid match — "paneer" — settles it whatever else
      // matched alongside.
      caveat: caveats.length === hits.length ? caveats[0]! : null,
    });
  }

  return out;
}

/**
 * The three states `MI1` and `0006` insist must never be conflated.
 *
 * `unknown` is not a tidiness problem: it is the state where the app must warn rather than
 * reassure, and every production dish is currently in it.
 */
export type AllergenState = 'tagged' | 'declared_none' | 'unknown';

export function allergenState(dish: { allergens: string[]; allergensDeclaredNone: boolean }): AllergenState {
  if (dish.allergens.length > 0) return 'tagged';
  return dish.allergensDeclaredNone ? 'declared_none' : 'unknown';
}
