import { describe, expect, it } from 'vitest';

import {
  ALL_DISHES,
  NO_MENU,
  filterDishes,
  menuFilterOptions,
  placementsFor,
  schoolMenuRows,
} from './catalogue-view.js';

const TODAY = '2026-08-15';

const school = (over = {}) => ({
  id: 's-1', code: 'amity', name: 'Amity', cityName: 'Mohali',
  kitchenId: 'k-1', kitchenName: 'Mohali Kitchen', institutionType: 'school',
  addressLine1: null, addressLine2: null, postcode: null,
  contactName: null, contactEmail: null, contactPhone: null,
  isActive: true, onboardedAt: '2026-08-01', ...over,
}) as never;

const dish = (over = {}) => ({
  id: 'd-1', name: 'Veg Sandwich', kitchenId: 'k-1', categoryCode: 'snack', categoryName: 'Snack',
  foodType: 'veg', description: null, ingredientsText: null, caloriesKcal: null,
  portionText: null, isActive: true, allergens: [], ...over,
}) as never;

const item = (over = {}) => ({
  menuId: 'm-1', dishId: 'd-1', dishName: 'Veg Sandwich',
  pricePaise: 4500, availableDays: [1, 2, 3, 4, 5], isActive: true, ...over,
});

const menu = (over = {}) => ({
  id: 'm-1', name: 'Term 1', kitchenId: 'k-1', status: 'active', items: [item()], ...over,
}) as never;

const assign = (over = {}) => ({
  schoolId: 's-1', schoolName: 'Amity', schoolCode: 'amity',
  menuId: 'm-1', menuName: 'Term 1',
  validFrom: '2026-08-01', validTo: null, revokedAt: null, ...over,
}) as never;

const rowFor = (over: { schools?: unknown[]; assignments?: unknown[]; menus?: unknown[]; dishes?: unknown[] } = {}) =>
  schoolMenuRows(
    (over.schools ?? [school()]) as never,
    (over.assignments ?? [assign()]) as never,
    (over.menus ?? [menu()]) as never,
    (over.dishes ?? [dish()]) as never,
    TODAY,
  )[0]!;

describe('which menu a school is actually serving', () => {
  it('resolves the live assignment and counts what can be ordered', () => {
    const row = rowFor();
    expect(row.live?.menu?.name).toBe('Term 1');
    expect(row.orderable).toBe(1);
    expect(row.problems).toEqual([]);
  });

  it('a school with no assignment says parents see an empty menu', () => {
    // The state Gem and Paragon would have been in. Silence here reads as "fine".
    expect(rowFor({ assignments: [] }).problems).toEqual([
      'No menu assigned — parents at this school see an empty menu',
    ]);
  });

  it('distinguishes "starts later" from "has none"', () => {
    // The distinction the whole `upcoming` field exists for. Resolving the dates away makes a
    // school that is correctly configured for next term look identical to one nobody set up.
    const row = rowFor({ assignments: [assign({ validFrom: '2026-09-01' })] });
    expect(row.live).toBeNull();
    expect(row.upcoming).toHaveLength(1);
    expect(row.problems[0]).toBe('No menu today — the next one starts 2026-09-01');
  });

  it('a revoked assignment is not live even inside its date window', () => {
    const row = rowFor({ assignments: [assign({ revokedAt: '2026-08-10T00:00:00Z' })] });
    expect(row.live).toBeNull();
  });

  it('an expired assignment is not live', () => {
    expect(rowFor({ assignments: [assign({ validTo: '2026-08-14' })] }).live).toBeNull();
  });

  it('an assignment whose valid_to is today is ALREADY over — the bound is exclusive', () => {
    // `0001` constrains the column as `daterange(valid_from, valid_to, '[)')`, and every read in
    // the system — RLS, the public menu view, `create_checkout` — tests `valid_to > current_date`.
    //
    // I first wrote this the other way, and the test passed because it asserted my mistake. An
    // inclusive bound here would show an admin a school still serving a menu on the day the
    // parent-facing app had already stopped serving it: the back office quietly disagreeing with
    // the app about what is on sale, with no error anywhere.
    expect(rowFor({ assignments: [assign({ validTo: TODAY })] }).live).toBeNull();
  });

  it('an assignment ending tomorrow is still live today', () => {
    expect(rowFor({ assignments: [assign({ validTo: '2026-08-16' })] }).live).not.toBeNull();
  });

  it('an assignment starting today is live — valid_from is inclusive too', () => {
    expect(rowFor({ assignments: [assign({ validFrom: TODAY })] }).live).not.toBeNull();
  });

  it('an unmarked dish is on the menu but not orderable', () => {
    // `0059` refuses to publish one, but the 79 that predate the guard are still there.
    const row = rowFor({ dishes: [dish({ foodType: null })] });
    expect(row.orderable).toBe(0);
    expect(row.problems[0]).toBe('No dish on the menu can be ordered — every one is inactive or unmarked');
  });

  it('a retired dish is not orderable even while its menu row is active', () => {
    // `dish.is_active` is catalogue-wide and beats the per-menu switch. A screen that trusted
    // only `menu_item.is_active` would count a withdrawn dish as sellable.
    expect(rowFor({ dishes: [dish({ isActive: false })] }).orderable).toBe(0);
  });

  it('an inactive menu row is not orderable even when the dish is fine', () => {
    expect(rowFor({ menus: [menu({ items: [item({ isActive: false })] })] }).orderable).toBe(0);
  });

  it('an assignment pointing at a missing menu says so', () => {
    // Otherwise indistinguishable from correctly assigned on any screen that does not join.
    expect(rowFor({ menus: [] }).problems).toEqual(['Assigned to a menu that no longer exists']);
  });

  it('an empty menu is reported as empty, not as no menu', () => {
    expect(rowFor({ menus: [menu({ items: [] })] }).problems).toEqual([
      'The assigned menu has no dishes on it',
    ]);
  });

  it('a school that was never onboarded is flagged first', () => {
    // It is invisible in the picker (`P1`), so nothing below it can matter yet.
    const row = rowFor({ schools: [school({ onboardedAt: null })] });
    expect(row.problems[0]).toContain('Not onboarded');
  });

  it('sorts by school name so the list is stable between reloads', () => {
    const rows = schoolMenuRows(
      [school({ id: 's-2', name: 'Zephyr' }), school({ id: 's-1', name: 'Amity' })] as never,
      [] as never, [] as never, [] as never, TODAY,
    );
    expect(rows.map((r) => r.school.name)).toEqual(['Amity', 'Zephyr']);
  });
});

describe('the dish-list filter', () => {
  const dishes = [dish(), dish({ id: 'd-2', name: 'Orphan' })] as never[];
  const menus = [menu()] as never[];

  it('counts every option, including the orphans', () => {
    // The count is the point: "Not on any menu (1)" is the finding, and a filter that made you
    // select it to discover the number would bury it.
    expect(menuFilterOptions(dishes, menus)).toEqual([
      { value: ALL_DISHES, label: 'All dishes', count: 2 },
      { value: 'm-1', label: 'Term 1', count: 1 },
      { value: NO_MENU, label: 'Not on any menu', count: 1 },
    ]);
  });

  it('filters to one menu', () => {
    expect(filterDishes(dishes, menus, 'm-1').map((d) => d.name)).toEqual(['Veg Sandwich']);
  });

  it('finds dishes on no menu at all', () => {
    expect(filterDishes(dishes, menus, NO_MENU).map((d) => d.name)).toEqual(['Orphan']);
  });

  it('an unknown filter shows everything rather than nothing', () => {
    // A stale menu id in the URL must not render an empty catalogue that reads as data loss.
    expect(filterDishes(dishes, menus, 'deleted-menu')).toHaveLength(2);
  });

  it('counts a dish once when it appears on a menu twice', () => {
    const twice = [menu({ items: [item(), item({ isActive: false })] })] as never[];
    expect(menuFilterOptions(dishes, twice)[1]!.count).toBe(1);
  });
});

describe('where a dish appears', () => {
  it('lists every menu a dish is on, with its price there', () => {
    const menus = [menu(), menu({ id: 'm-2', name: 'Term 2', items: [item({ menuId: 'm-2', pricePaise: 5000 })] })] as never[];
    expect(placementsFor('d-1', menus)).toEqual([
      { menuId: 'm-1', menuName: 'Term 1', pricePaise: 4500, availableDays: [1, 2, 3, 4, 5], isActive: true },
      { menuId: 'm-2', menuName: 'Term 2', pricePaise: 5000, availableDays: [1, 2, 3, 4, 5], isActive: true },
    ]);
  });

  it('a dish on nothing returns an empty list, not a throw', () => {
    expect(placementsFor('nobody', [menu()] as never)).toEqual([]);
  });
});
