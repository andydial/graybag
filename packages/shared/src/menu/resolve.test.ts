import { describe, expect, it } from 'vitest';

import {
  AmbiguousAssignmentError,
  isAvailableOn,
  resolveMenuIdForSchool,
  resolvePricePaise,
} from './resolve.js';
import type { MenuAssignment, MenuItem, MenuItemPriceOverride } from './types.js';

const SCHOOL = 'school-1';
const OTHER_SCHOOL = 'school-2';

const assignment = (over: Partial<MenuAssignment> = {}): MenuAssignment => ({
  id: 'a1',
  schoolId: SCHOOL,
  menuId: 'menu-1',
  validFrom: '2026-08-01',
  validTo: null,
  revokedAt: null,
  ...over,
});

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: 'mi-1',
  menuId: 'menu-1',
  dishId: 'dish-1',
  pricePaise: 12_500,
  categoryId: null,
  availableDays: [1, 2, 3, 4, 5, 6],
  isActive: true,
  sortOrder: 0,
  ...over,
});

describe('resolveMenuIdForSchool', () => {
  it('finds the assignment covering the date', () => {
    expect(resolveMenuIdForSchool([assignment()], SCHOOL, '2026-08-09')).toBe('menu-1');
  });

  it('returns null when nothing covers the date', () => {
    expect(resolveMenuIdForSchool([assignment()], SCHOOL, '2026-07-31')).toBeNull();
  });

  it('ignores other schools', () => {
    expect(resolveMenuIdForSchool([assignment()], OTHER_SCHOOL, '2026-08-09')).toBeNull();
  });

  it('ignores revoked assignments', () => {
    const revoked = assignment({ revokedAt: '2026-08-05T00:00:00Z' });
    expect(resolveMenuIdForSchool([revoked], SCHOOL, '2026-08-09')).toBeNull();
  });

  it('lets a revoked assignment and a live one coexist without ambiguity', () => {
    // The exclusion constraint is `where (revoked_at is null)`, so this is a legal pair of
    // rows — a menu was swapped mid-term. Filtering revoked rows before counting is what
    // makes that legal here too.
    const rows = [
      assignment({ id: 'a1', revokedAt: '2026-08-05T00:00:00Z' }),
      assignment({ id: 'a2', menuId: 'menu-2' }),
    ];
    expect(resolveMenuIdForSchool(rows, SCHOOL, '2026-08-09')).toBe('menu-2');
  });

  it('handles a closed range with an exclusive end', () => {
    const rows = [
      assignment({ id: 'a1', menuId: 'menu-1', validFrom: '2026-08-01', validTo: '2026-09-01' }),
      assignment({ id: 'a2', menuId: 'menu-2', validFrom: '2026-09-01', validTo: null }),
    ];
    // 31 Aug belongs to the first, 1 Sept to the second. If validTo were inclusive both
    // would match on 1 Sept, which is the overlap the schema forbids.
    expect(resolveMenuIdForSchool(rows, SCHOOL, '2026-08-31')).toBe('menu-1');
    expect(resolveMenuIdForSchool(rows, SCHOOL, '2026-09-01')).toBe('menu-2');
  });

  /**
   * The database cannot produce two live assignments for one school on one day — that is
   * `menu_assignment_no_overlap`, an exclusion constraint, and `D4`'s whole point. So
   * reaching this state means the rows did not come from that table. Picking the first would
   * hide a broken invariant behind a plausible menu, and the symptom would surface as a
   * parent seeing the wrong prices, traceable to nothing.
   */
  it('throws rather than picking when two live assignments overlap', () => {
    const rows = [assignment({ id: 'a1' }), assignment({ id: 'a2', menuId: 'menu-2' })];
    expect(() => resolveMenuIdForSchool(rows, SCHOOL, '2026-08-09')).toThrow(
      AmbiguousAssignmentError,
    );
  });
});

describe('isAvailableOn', () => {
  it('honours the ISO weekday list', () => {
    const weekdaysOnly = item({ availableDays: [1, 2, 3, 4, 5] });
    expect(isAvailableOn(weekdaysOnly, '2026-08-07')).toBe(true); // Friday
    expect(isAvailableOn(weekdaysOnly, '2026-08-08')).toBe(false); // Saturday
    expect(isAvailableOn(weekdaysOnly, '2026-08-09')).toBe(false); // Sunday
  });

  it('treats Sunday as 7, not 0', () => {
    // The off-by-one that JS invites: Date#getDay() is 0-based from Sunday, ISO is 1-based
    // from Monday. A `[0]` in available_days would also violate the schema's CHECK.
    const sundayOnly = item({ availableDays: [7] });
    expect(isAvailableOn(sundayOnly, '2026-08-09')).toBe(true);
    expect(isAvailableOn(sundayOnly, '2026-08-03')).toBe(false);
  });

  it('is false for an inactive item on an available day', () => {
    expect(isAvailableOn(item({ isActive: false }), '2026-08-03')).toBe(false);
  });
});

describe('resolvePricePaise', () => {
  const override = (over: Partial<MenuItemPriceOverride> = {}): MenuItemPriceOverride => ({
    id: 'o1',
    schoolId: SCHOOL,
    menuItemId: 'mi-1',
    pricePaise: 9_900,
    validFrom: '2026-08-01',
    validTo: null,
    ...over,
  });

  it('falls back to the menu item price when nothing overrides', () => {
    expect(resolvePricePaise(item(), [], SCHOOL, '2026-08-09')).toBe(12_500);
  });

  it('prefers a live override for this school', () => {
    expect(resolvePricePaise(item(), [override()], SCHOOL, '2026-08-09')).toBe(9_900);
  });

  it('ignores an override for another school', () => {
    const other = override({ schoolId: OTHER_SCHOOL });
    expect(resolvePricePaise(item(), [other], SCHOOL, '2026-08-09')).toBe(12_500);
  });

  it('ignores an override for another item', () => {
    const other = override({ menuItemId: 'mi-2' });
    expect(resolvePricePaise(item(), [other], SCHOOL, '2026-08-09')).toBe(12_500);
  });

  it('ignores an override whose window has closed', () => {
    const expired = override({ validFrom: '2026-07-01', validTo: '2026-08-01' });
    expect(resolvePricePaise(item(), [expired], SCHOOL, '2026-08-09')).toBe(12_500);
  });

  it('throws rather than picking when two overrides overlap', () => {
    const rows = [override({ id: 'o1' }), override({ id: 'o2', pricePaise: 8_800 })];
    expect(() => resolvePricePaise(item(), rows, SCHOOL, '2026-08-09')).toThrow(
      AmbiguousAssignmentError,
    );
  });

  it('returns integer paise and never a float', () => {
    // Non-negotiable #3. The resolver only ever passes a stored value through, so the only
    // way a float appears is if someone adds arithmetic here — which is what this catches.
    const price = resolvePricePaise(item({ pricePaise: 33_333 }), [], SCHOOL, '2026-08-09');
    expect(Number.isInteger(price)).toBe(true);
  });
});
