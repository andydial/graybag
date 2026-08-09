import { describe, expect, it } from 'vitest';

import { allergenDisclosure, allergenWarning, mayStateNoAllergens } from './allergens.js';

const PEANUT = 'allergen-peanut';
const MILK = 'allergen-milk';

const dish = (allergenIds: string[], declaredNone = false) => ({
  allergens: allergenIds.map((allergenId) => ({ allergenId, presence: 'contains' as const })),
  allergensDeclaredNone: declaredNone,
});

describe('allergenDisclosure', () => {
  it('reports declared allergens when there are tags', () => {
    expect(allergenDisclosure(dish([PEANUT]))).toEqual({
      state: 'declared',
      allergenIds: [PEANUT],
    });
  });

  it('reports declaredNone only when the source explicitly said so', () => {
    expect(allergenDisclosure(dish([], true))).toEqual({ state: 'declaredNone' });
  });

  /**
   * `MI1`, and the whole reason `0006` exists.
   *
   * An empty tag list and an unanswered question are opposite facts wearing the same shape.
   * Before `0006` the database could not tell them apart, so this state was unreachable and
   * every undescribed dish read as allergen-free.
   */
  it('reports unknown for a dish nobody has described — NOT none', () => {
    expect(allergenDisclosure(dish([]))).toEqual({ state: 'unknown' });
    expect(allergenDisclosure(dish([]))).not.toEqual({ state: 'declaredNone' });
  });

  it('trusts the tags over the flag if both are somehow set', () => {
    // Contradictory input. Tags win: a dish that has been described has been described,
    // and the reassuring reading is the one that must lose a disagreement.
    expect(allergenDisclosure(dish([PEANUT], true)).state).toBe('declared');
  });
});

describe('mayStateNoAllergens', () => {
  it('is true only for an explicit declaration', () => {
    expect(mayStateNoAllergens(dish([], true))).toBe(true);
  });

  it('is false for unknown — the one-liner this function exists to replace', () => {
    // `if (!dish.allergens.length) return 'no allergens'` is the plausible wrong
    // implementation, it is one line, and it is the failure D7 exists to prevent.
    expect(mayStateNoAllergens(dish([]))).toBe(false);
  });

  it('is false when there are allergens', () => {
    expect(mayStateNoAllergens(dish([MILK]))).toBe(false);
  });
});

describe('allergenWarning', () => {
  it('warns on a match', () => {
    expect(allergenWarning(dish([PEANUT, MILK]), [PEANUT])).toEqual({
      warn: true,
      reason: 'match',
      allergenIds: [PEANUT],
    });
  });

  it('does not warn when the declared allergens miss the recipient', () => {
    expect(allergenWarning(dish([MILK]), [PEANUT])).toEqual({ warn: false });
  });

  it('does not warn when the kitchen declared none', () => {
    expect(allergenWarning(dish([], true), [PEANUT])).toEqual({ warn: false });
  });

  /**
   * The case worth getting right: a child with a peanut allergy, and a dish nobody has
   * classified. Saying nothing is the harmful answer, so `unknown` warns even though there
   * is no match to report — there is no match precisely because there is no information.
   */
  it('warns on an undescribed dish even with no match to report', () => {
    expect(allergenWarning(dish([]), [PEANUT])).toEqual({ warn: true, reason: 'unknown' });
  });

  it('warns on an undescribed dish even when the recipient has no recorded allergies', () => {
    expect(allergenWarning(dish([]), [])).toEqual({ warn: true, reason: 'unknown' });
  });

  it('warns on may_contain as well as contains', () => {
    const mayContain = {
      allergens: [{ allergenId: PEANUT, presence: 'may_contain' as const }],
      allergensDeclaredNone: false,
    };
    expect(allergenWarning(mayContain, [PEANUT])).toEqual({
      warn: true,
      reason: 'match',
      allergenIds: [PEANUT],
    });
  });
});
