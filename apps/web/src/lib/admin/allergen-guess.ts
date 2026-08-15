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

/** The four codes seeded in `allergen` (`0063`). Suggestions may only ever use these. */
export const ALLERGEN_CODES = ['milk', 'gluten', 'tree_nut', 'soy'] as const;
export type AllergenCode = (typeof ALLERGEN_CODES)[number];

/**
 * Ingredient words that imply an allergen.
 *
 * Matched as substrings on a lower-cased ingredient list, not word-boundaried, because the source
 * writes "Mozzarella Cheese", "Refined Soybean Oil" and "Maida Base Bread" — the signal is inside
 * longer phrases far more often than it is a standalone word.
 */
const IMPLIES: Record<AllergenCode, { word: string; note?: string }[]> = {
  milk: [
    { word: 'milk' }, { word: 'cheese' }, { word: 'butter' }, { word: 'cream' },
    { word: 'paneer' }, { word: 'curd' }, { word: 'yoghurt' }, { word: 'yogurt' },
    { word: 'ghee' }, { word: 'khoya' }, { word: 'malai' }, { word: 'mozzarella' },
    { word: 'ice cream' }, { word: 'mayonnaise', note: 'mayonnaise often contains milk solids' },
    { word: 'mayo', note: 'mayo often contains milk solids' },
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
    { word: 'kaju' }, { word: 'nut', note: 'check whether this is a tree nut or a peanut' },
  ],
  soy: [
    { word: 'soy' }, { word: 'soya' }, { word: 'soybean' }, { word: 'tofu' },
    { word: 'edamame' },
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

  for (const code of ALLERGEN_CODES) {
    const hits = IMPLIES[code].filter((m) => text.includes(m.word));
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
