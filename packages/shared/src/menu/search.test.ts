import { describe, expect, it } from 'vitest';

import { ALL_CATEGORIES, filterMenu, matchesQuery, normalise } from './search.js';

const dish = (over: Partial<Parameters<typeof matchesQuery>[0]> = {}) => ({
  id: 'd1',
  name: 'Cold Coffee',
  description: 'Chilled, with milk',
  categoryId: 'drinks',
  ingredientsText: 'milk, coffee, sugar',
  ...over,
});

describe('normalise', () => {
  it('strips diacritics so a parent typing plain ASCII still finds the dish', () => {
    // A kitchen writes "Jalapeño"; a parent types "jalapeno". A search that misses that
    // looks broken rather than strict.
    expect(normalise('Jalapeño')).toBe('jalapeno');
    expect(normalise('  Cold   Coffee ')).toBe('cold coffee');
  });
});

describe('matchesQuery', () => {
  it('matches the name', () => {
    expect(matchesQuery(dish(), 'cold')).toBe(true);
  });

  it('is the example the task names — "cold coffee" must be findable', () => {
    expect(matchesQuery(dish(), 'cold coffee')).toBe(true);
  });

  it('matches an ingredient, because that is what people search for', () => {
    expect(matchesQuery(dish({ name: 'Butter Masala', description: null }), 'paneer')).toBe(false);
    expect(
      matchesQuery(
        dish({ name: 'Butter Masala', description: null, ingredientsText: 'paneer, cream' }),
        'paneer',
      ),
    ).toBe(true);
  });

  /**
   * AND across terms, OR across fields. An OR across terms would make every extra word you
   * type *widen* the results, which is the opposite of what typing more means.
   */
  it('requires every term to match somewhere', () => {
    expect(matchesQuery(dish(), 'cold sandwich')).toBe(false);
    expect(matchesQuery(dish(), 'coffee milk')).toBe(true); // name + description
  });

  it('matches across fields, so word order and field do not matter', () => {
    expect(matchesQuery(dish(), 'chilled coffee')).toBe(true);
  });

  it('treats an empty or whitespace query as no filter', () => {
    expect(matchesQuery(dish(), '')).toBe(true);
    expect(matchesQuery(dish(), '   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesQuery(dish(), 'COLD COFFEE')).toBe(true);
  });

  it('survives a null description and missing ingredients', () => {
    const bare = { id: 'd', name: 'Toast', description: null, categoryId: 'c' };
    expect(matchesQuery(bare, 'toast')).toBe(true);
    expect(matchesQuery(bare, 'butter')).toBe(false);
  });
});

describe('filterMenu', () => {
  const menu = [
    dish({ id: 'a', name: 'Cold Coffee', categoryId: 'drinks' }),
    dish({ id: 'b', name: 'Hot Chocolate', categoryId: 'drinks', description: null, ingredientsText: null }),
    dish({ id: 'c', name: 'Veg Sandwich', categoryId: 'quick_bites', description: null, ingredientsText: 'bread' }),
  ];

  it('returns everything with no filters', () => {
    expect(filterMenu(menu)).toHaveLength(3);
    expect(filterMenu(menu, { categoryId: ALL_CATEGORIES })).toHaveLength(3);
  });

  it('filters by category', () => {
    expect(filterMenu(menu, { categoryId: 'drinks' }).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('composes category and query as AND', () => {
    // Searching inside a category searches THAT category. The alternative — search ignores
    // the category — is surprising, because the tab stays visibly selected while results
    // appear from elsewhere.
    expect(filterMenu(menu, { categoryId: 'drinks', query: 'sandwich' })).toEqual([]);
    expect(filterMenu(menu, { categoryId: 'drinks', query: 'cold' }).map((d) => d.id)).toEqual(['a']);
  });

  it('returns an empty array rather than everything when nothing matches', () => {
    // The failure that would matter: a filter that falls back to "show all" on no matches
    // reads as "search is broken" rather than "nothing found".
    expect(filterMenu(menu, { query: 'zzzz' })).toEqual([]);
  });

  it('does not mutate the input', () => {
    const copy = [...menu];
    filterMenu(menu, { query: 'cold' });
    expect(menu).toEqual(copy);
  });
});
