import { describe, expect, it } from 'vitest';

import { EMPTY_QUERY, buildRows, facets, fold, queryDishes, score } from './dish-index.js';

const dish = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', name: 'Veg Sandwich', kitchenId: 'k-1', categoryCode: 'snack', categoryName: 'Snack',
  foodType: 'veg', description: null, ingredientsText: 'Capsicum, corn, cheese',
  caloriesKcal: null, caloriesText: null, portionText: null, nutrition: null,
  isActive: true, imageAssetId: 'a-1', allergens: ['milk'], allergensDeclaredNone: false, ...over,
}) as never;

const item = (over: Record<string, unknown> = {}) => ({
  menuId: 'm-1', dishId: 'd-1', dishName: 'Veg Sandwich',
  pricePaise: 4500, availableDays: [1, 2, 3, 4, 5], isActive: true, ...over,
});

const menu = (over: Record<string, unknown> = {}) =>
  ({ id: 'm-1', name: 'Term 1', kitchenId: 'k-1', status: 'active', items: [item()], ...over }) as never;

const rowsOf = (dishes: unknown[], menus: unknown[] = [menu()]) =>
  buildRows(dishes as never, menus as never);

const namesFor = (q: Partial<typeof EMPTY_QUERY>, dishes: unknown[], menus: unknown[] = [menu()]) =>
  queryDishes(rowsOf(dishes, menus), { ...EMPTY_QUERY, ...q }).map((r) => r.dish.name);

describe('folding', () => {
  it('strips accents, because the catalogue has "Pain Au Chocolat"', () => {
    // Without this, typing the word you can see returns nothing, which reads as a broken search.
    expect(fold('Pâin Au Chocolât')).toBe('pain au chocolat');
  });

  it('collapses whitespace and case', () => {
    expect(fold('  Veg   SANDWICH ')).toBe('veg sandwich');
  });
});

describe('search', () => {
  const dishes = [
    dish({ id: 'a', name: 'Pancakes w Honey', ingredientsText: 'Flour, milk, eggs, honey' }),
    dish({ id: 'b', name: 'Paneer Croissant', ingredientsText: 'Paneer, mayonnaise' }),
    dish({ id: 'c', name: 'Aloo Tikki Burger', ingredientsText: 'Potato, pepper, bread' }),
  ];

  it('ranks a name prefix above a name substring above an ingredient', () => {
    // "pan" must put Pancakes first. Sorting these alphabetically would put Paneer first, which is
    // the behaviour that makes people stop trusting a search box.
    expect(namesFor({ text: 'pan' }, dishes)).toEqual(['Pancakes w Honey', 'Paneer Croissant']);
  });

  it('finds a dish by an ingredient, because that is how people remember some of them', () => {
    expect(namesFor({ text: 'potato' }, dishes)).toEqual(['Aloo Tikki Burger']);
  });

  it('every term must match — a second word narrows', () => {
    expect(namesFor({ text: 'paneer croissant' }, dishes)).toEqual(['Paneer Croissant']);
    expect(namesFor({ text: 'paneer pancakes' }, dishes)).toEqual([]);
  });

  it('an unmatched search returns nothing rather than everything', () => {
    // The failure mode where a filter silently does nothing is worse than an empty result: you act
    // on a list you think is filtered.
    expect(namesFor({ text: 'zzzz' }, dishes)).toEqual([]);
  });

  it('scores zero when a term matches nothing', () => {
    expect(score(rowsOf([dish()])[0]!, 'zzzz')).toBe(0);
  });

  it('an empty search matches everything and keeps the sort', () => {
    expect(namesFor({ text: '  ' }, dishes)).toHaveLength(3);
  });
});

describe('filters', () => {
  const dishes = [
    dish({ id: 'a', name: 'Marked', foodType: 'veg' }),
    dish({ id: 'b', name: 'Unmarked', foodType: null }),
    dish({ id: 'c', name: 'Orphan', imageAssetId: null, allergens: [], allergensDeclaredNone: false }),
  ];
  const menus = [menu({ items: [item({ dishId: 'a' }), item({ dishId: 'b' })] })];

  it('filters to dishes with no food type', () => {
    expect(namesFor({ foodType: 'unset' }, dishes, menus)).toEqual(['Unmarked']);
  });

  it('filters to dishes on no menu', () => {
    expect(namesFor({ menu: 'none' }, dishes, menus)).toEqual(['Orphan']);
  });

  it('filters to one menu', () => {
    expect(namesFor({ menu: 'm-1' }, dishes, menus).sort()).toEqual(['Marked', 'Unmarked']);
  });

  it('separates "allergens not checked" from "declared none"', () => {
    // `MI1`: an empty tag list means one of two opposite things. A filter that lumped them would
    // hide exactly the dishes somebody is looking for.
    const set = [
      dish({ id: 'a', name: 'Tagged', allergens: ['milk'] }),
      dish({ id: 'b', name: 'None', allergens: [], allergensDeclaredNone: true }),
      dish({ id: 'c', name: 'Unchecked', allergens: [], allergensDeclaredNone: false }),
    ];
    expect(namesFor({ allergens: 'unchecked' }, set, [])).toEqual(['Unchecked']);
    expect(namesFor({ allergens: 'declared_none' }, set, [])).toEqual(['None']);
    expect(namesFor({ allergens: 'tagged' }, set, [])).toEqual(['Tagged']);
  });

  it('filters to dishes with no photo', () => {
    expect(namesFor({ photo: 'missing' }, dishes, menus)).toEqual(['Orphan']);
  });

  it('combines a search with a filter', () => {
    expect(namesFor({ text: 'mark', foodType: 'unset' }, dishes, menus)).toEqual(['Unmarked']);
  });
});

describe('sorting', () => {
  const dishes = [
    dish({ id: 'a', name: 'Cheap' }),
    dish({ id: 'b', name: 'Dear' }),
    dish({ id: 'c', name: 'Orphan' }),
  ];
  const menus = [menu({ items: [item({ dishId: 'a', pricePaise: 1000 }), item({ dishId: 'b', pricePaise: 9000 })] })];

  it('sorts by price ascending, with unpriced dishes last', () => {
    // A dish on no menu has no price. Sorting it as 0 would read as free.
    expect(namesFor({ sort: 'price-asc' }, dishes, menus)).toEqual(['Cheap', 'Dear', 'Orphan']);
  });

  it('sorts by price descending, still with unpriced dishes last', () => {
    expect(namesFor({ sort: 'price-desc' }, dishes, menus)).toEqual(['Dear', 'Cheap', 'Orphan']);
  });

  it('"needs attention" sorts the most-broken first', () => {
    expect(namesFor({ sort: 'state' }, dishes, menus)[0]).toBe('Orphan');
  });

  it('a search overrides the sort key, because rank is the point', () => {
    // Ranked results re-sorted alphabetically are just an alphabetical list again.
    const set = [
      dish({ id: 'a', name: 'Zeta Pancakes' }),
      dish({ id: 'b', name: 'Pancake Stack' }),
    ];
    expect(namesFor({ text: 'pancake', sort: 'name' }, set, [])).toEqual(['Pancake Stack', 'Zeta Pancakes']);
  });
});

describe('the row', () => {
  it('carries every menu the dish is on, with its price there', () => {
    const menus = [
      menu({ id: 'm-1', name: 'A', items: [item({ menuId: 'm-1', pricePaise: 4500 })] }),
      menu({ id: 'm-2', name: 'B', items: [item({ menuId: 'm-2', pricePaise: 6900 })] }),
    ];
    const row = rowsOf([dish()], menus)[0]!;
    expect(row.placements.map((p) => `${p.menuName}:${p.pricePaise}`)).toEqual(['A:4500', 'B:6900']);
    expect(row.lowestPaise).toBe(4500);
  });

  it('ignores a parked placement when working out the lowest price', () => {
    // A parked dish cannot be bought at that price, so showing it as the price would be a lie.
    const menus = [menu({ items: [item({ pricePaise: 100, isActive: false }), item({ pricePaise: 4500 })] })];
    expect(rowsOf([dish()], menus)[0]!.lowestPaise).toBe(4500);
  });

  it('lists problems most-important first', () => {
    const row = rowsOf([dish({ foodType: null, imageAssetId: null })], [])[0]!;
    expect(row.problems[0]).toBe('No food type');
  });

  it('a complete dish has no problems', () => {
    expect(rowsOf([dish()], [menu()])[0]!.problems).toEqual([]);
  });
});

describe('facets', () => {
  it('counts what each filter would find, so the numbers show before you click', () => {
    const rows = rowsOf(
      [dish({ id: 'a' }), dish({ id: 'b', foodType: null, imageAssetId: null })],
      [menu({ items: [item({ dishId: 'a' })] })],
    );
    const f = facets(rows);
    expect(f.total).toBe(2);
    expect(f.noFoodType).toBe(1);
    expect(f.noPhoto).toBe(1);
    expect(f.noMenu).toBe(1);
    expect(f.needsAttention).toBe(1);
  });
});
