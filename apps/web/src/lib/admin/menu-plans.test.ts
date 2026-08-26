import { describe, expect, it } from 'vitest';

import { assignmentState, buildMenuPlans, unassignedCount } from './menu-plans.js';

const TODAY = '2026-08-27';

const dish = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', name: 'Veg Sandwich', kitchenId: 'k-1', categoryCode: 'snack', categoryName: 'Snack',
  foodType: 'veg', description: null, ingredientsText: null, caloriesKcal: null,
  caloriesText: null, portionText: null, nutrition: null, isActive: true, imageAssetId: 'a-1',
  allergens: [], allergensDeclaredNone: true, ...over,
}) as never;

const item = (over: Record<string, unknown> = {}) => ({
  menuId: 'm-1', dishId: 'd-1', dishName: 'Veg Sandwich',
  pricePaise: 4500, availableDays: [1, 2, 3, 4, 5], isActive: true, ...over,
});

const menu = (over: Record<string, unknown> = {}) =>
  ({ id: 'm-1', name: 'Term 1', kitchenId: 'k-1', status: 'active', items: [item()], ...over }) as never;

const assignment = (over: Record<string, unknown> = {}) => ({
  schoolId: 's-1', schoolName: 'Amity International', schoolCode: 'amity',
  menuId: 'm-1', menuName: 'Term 1',
  validFrom: '2026-01-01', validTo: null, revokedAt: null, ...over,
}) as never;

describe('assignmentState', () => {
  it('is live inside an open-ended window', () => {
    expect(assignmentState(assignment(), TODAY)).toBe('live');
  });

  it('is scheduled before it starts, which is not the same as missing', () => {
    // The distinction the assignment type keeps its dates for: "starts on the 22nd" and "has no
    // menu" look identical once the dates are resolved away, and only one is a problem.
    expect(assignmentState(assignment({ validFrom: '2099-01-01' }), TODAY)).toBe('scheduled');
  });

  /*
   * `validTo` is EXCLUSIVE — the first day the menu is not served. `0001` constrains the column
   * as `[)` and every read in the system tests `valid_to > current_date`. Treating it inclusively
   * serves a menu one day too long, which surfaces as a parent ordering something the kitchen has
   * stopped making.
   */
  it('has ended on the day valid_to names, not the day after', () => {
    expect(assignmentState(assignment({ validTo: TODAY }), TODAY)).toBe('ended');
    expect(assignmentState(assignment({ validTo: '2026-08-28' }), TODAY)).toBe('live');
  });

  it('is revoked whatever the dates say', () => {
    expect(assignmentState(
      assignment({ validTo: null, revokedAt: '2026-08-01T00:00:00Z' }), TODAY,
    )).toBe('revoked');
  });
});

describe('buildMenuPlans', () => {
  it('counts only live assignments as serving somebody', () => {
    const [plan] = buildMenuPlans([menu()], [
      assignment(),
      assignment({ schoolId: 's-2', schoolName: 'Paragon', validFrom: '2099-01-01' }),
      assignment({ schoolId: 's-3', schoolName: 'Gem', revokedAt: '2026-01-01T00:00:00Z' }),
    ], [dish()], TODAY);

    expect(plan!.liveCount).toBe(1);
    expect(plan!.schools).toHaveLength(3);
    // Live first — the only state that means the menu is feeding somebody right now.
    expect(plan!.schools[0]!.state).toBe('live');
  });

  it('puts menus serving nobody first, because that is what the screen is opened for', () => {
    const plans = buildMenuPlans(
      [menu({ id: 'm-1', name: 'Alpha' }), menu({ id: 'm-2', name: 'Beta' })],
      [assignment({ menuId: 'm-1' })],
      [dish()], TODAY,
    );
    expect(plans.map((p) => p.menu.name)).toEqual(['Beta', 'Alpha']);
  });

  it('reports a price range over live items only', () => {
    const [plan] = buildMenuPlans([menu({ items: [
      item({ dishId: 'd-1', pricePaise: 4500 }),
      item({ dishId: 'd-2', pricePaise: 9900, isActive: false }),
      item({ dishId: 'd-3', pricePaise: 6000 }),
    ] })], [], [dish()], TODAY);

    // The parked item is not on sale, so it is not part of what this menu costs.
    expect(plan!.priceRange).toEqual({ lowPaise: 4500, highPaise: 6000 });
    expect(plan!.liveItems).toBe(2);
  });

  it('has no price range rather than a zero one when nothing is on sale', () => {
    const [plan] = buildMenuPlans(
      [menu({ items: [item({ isActive: false })] })], [], [dish()], TODAY,
    );
    // Null, not `{low: 0, high: 0}` — "free" and "nothing on sale" are different facts.
    expect(plan!.priceRange).toBeNull();
  });

  it('names the dishes with no food type, which is the one blocking fault', () => {
    const [plan] = buildMenuPlans([menu({ items: [
      item({ dishId: 'd-1' }), item({ dishId: 'd-2' }),
    ] })], [], [
      dish({ id: 'd-1', name: 'Typed', foodType: 'veg' }),
      dish({ id: 'd-2', name: 'Untyped', foodType: null }),
    ], TODAY);
    expect(plan!.untypedDishes).toEqual(['Untyped']);
  });

  it('does not report a dish it could not read as untyped', () => {
    // A narrower grant returns fewer dishes. Calling that a missing food type would send somebody
    // looking for a problem that does not exist, on a screen whose whole job is naming problems.
    const [plan] = buildMenuPlans(
      [menu({ items: [item({ dishId: 'd-unreadable' })] })], [], [], TODAY,
    );
    expect(plan!.untypedDishes).toEqual([]);
  });

  it('counts a dish once however many times it appears on the menu', () => {
    const [plan] = buildMenuPlans([menu({ items: [
      item({ dishId: 'd-2', availableDays: [1] }), item({ dishId: 'd-2', availableDays: [5] }),
    ] })], [], [dish({ id: 'd-2', name: 'Untyped', foodType: null })], TODAY);
    expect(plan!.untypedDishes).toEqual(['Untyped']);
  });
});

describe('unassignedCount', () => {
  it('counts menus serving no school today, scheduled included', () => {
    // A menu that starts in 2099 is feeding nobody now, and the headline is about now.
    const plans = buildMenuPlans(
      [menu({ id: 'm-1', name: 'Live' }), menu({ id: 'm-2', name: 'Future' }),
       menu({ id: 'm-3', name: 'Orphan' })],
      [assignment({ menuId: 'm-1' }),
       assignment({ menuId: 'm-2', validFrom: '2099-01-01' })],
      [dish()], TODAY,
    );
    expect(unassignedCount(plans)).toBe(2);
  });
});
