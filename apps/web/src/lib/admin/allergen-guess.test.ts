import { describe, expect, it } from 'vitest';

import { allergenState, suggestAllergens } from './allergen-guess.js';

const codes = (name: string, ingredientsText: string | null) =>
  suggestAllergens({ name, ingredientsText }).map((s) => s.code).sort();

describe('what the ingredient list implies', () => {
  it('finds milk behind its many names', () => {
    // The source writes "Mozzarella Cheese", not "milk". A matcher that looked for the allergen's
    // own name would find almost nothing in this catalogue.
    expect(codes('Cheese Garlic Bread', 'Mozzarella Cheese, Garlic, Butter')).toContain('milk');
    expect(codes('Paneer Wrap', 'Tortilla, Paneer, Veggies')).toContain('milk');
    expect(codes('Wheat Jaggery Cake', 'Ashirwad Atta, Jaggery, Curd, Baking Soda')).toContain('milk');
  });

  it('finds gluten in the Indian names for wheat, not just the word wheat', () => {
    expect(codes('Vada Pao', 'Potato, Turmeric')).toContain('gluten');
    expect(codes('Chole Masala With Wheat Atta Kulcha', null)).toContain('gluten');
    expect(codes('French Butter Croissant', 'Maida, Brown Sugar, Gluten')).toContain('gluten');
  });

  it('reads refined soybean oil as soy', () => {
    // Highly refined soybean oil is exempt from allergen labelling in some jurisdictions. On a
    // children's menu it is flagged anyway — the cost of an unnecessary tag is a question, and the
    // cost of a missing one is a reaction.
    expect(codes('Blueberry Muffin', 'Flour, Sugar, Refined Soybean Oil')).toContain('soy');
  });

  it('carries the evidence, so a person can disagree with the reasoning', () => {
    const milk = suggestAllergens({ name: 'X', ingredientsText: 'Butter, Fresh Cream' })
      .find((s) => s.code === 'milk');
    expect(milk?.evidence).toEqual(expect.arrayContaining(['butter', 'cream']));
  });

  it('only ever suggests codes that exist in the allergen table', () => {
    // `dish_allergen` references `allergen`, and an invented code is a tag that silently never
    // matches a child's record.
    const all = suggestAllergens({ name: 'Everything', ingredientsText: 'milk cheese wheat cashew soy' });
    for (const s of all) expect(['milk', 'gluten', 'tree_nut', 'soy']).toContain(s.code);
  });
});

describe('the caveats', () => {
  it('flags chocolate rather than asserting milk', () => {
    // Dark chocolate usually contains no milk; milk chocolate obviously does. A confident tag here
    // would be wrong about half the time in either direction.
    const milk = suggestAllergens({ name: 'Dark Choc Bar', ingredientsText: 'Dark Chocolate, Sugar' })
      .find((s) => s.code === 'milk');
    expect(milk?.caveat).toMatch(/chocolate/i);
  });

  it('a solid match settles it even when a caveated word matched too', () => {
    // "Paneer" is not ambiguous. The presence of chocolate alongside must not downgrade it —
    // otherwise the one certain signal on the row is presented as a maybe.
    const milk = suggestAllergens({ name: 'X', ingredientsText: 'Paneer, Dark Chocolate' })
      .find((s) => s.code === 'milk');
    expect(milk?.caveat).toBeNull();
  });

  it('notes that soy sauce is usually brewed with wheat', () => {
    const gluten = suggestAllergens({ name: 'Fried Rice', ingredientsText: 'Rice, Soy Sauce' })
      .find((s) => s.code === 'gluten');
    expect(gluten?.caveat).toMatch(/wheat/i);
  });
});

describe('silence is not a clean bill of health', () => {
  it('a dish with nothing recognisable yields NO suggestions', () => {
    expect(suggestAllergens({ name: 'Fruit Salad', ingredientsText: 'Seasonal Fruit' })).toEqual([]);
  });

  it('a dish with no ingredient list yields no suggestions either', () => {
    // And that is the point of the state machine below: nothing to say is `unknown`, never `none`.
    expect(suggestAllergens({ name: 'Lemonade', ingredientsText: null })).toEqual([]);
  });
});

describe('the three states MI1 says must never be conflated', () => {
  it('tags present means tagged', () => {
    expect(allergenState({ allergens: ['milk'], allergensDeclaredNone: false })).toBe('tagged');
  });

  it('no tags and nobody has looked is UNKNOWN, not none', () => {
    // Every production dish is in this state. It is the one where the app must warn rather than
    // reassure, and it looks identical to "declared none" on any screen that does not check.
    expect(allergenState({ allergens: [], allergensDeclaredNone: false })).toBe('unknown');
  });

  it('no tags but explicitly declared none is a different fact', () => {
    expect(allergenState({ allergens: [], allergensDeclaredNone: true })).toBe('declared_none');
  });

  it('tags win over a stale declared-none flag', () => {
    // Both set is contradictory data. Reading it as `tagged` warns; reading it as `declared_none`
    // reassures. When the two disagree the safe reading is the one that warns.
    expect(allergenState({ allergens: ['milk'], allergensDeclaredNone: true })).toBe('tagged');
  });
});
