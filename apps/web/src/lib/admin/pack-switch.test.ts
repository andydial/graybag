import { describe, expect, it } from 'vitest';

import type { api } from '@graybag/shared';

import { canManagePacks, packSummaryLine, packSwitchRows } from './pack-switch.js';

const offer = (o: Partial<api.AdminPackOffer> & { id: string }): api.AdminPackOffer => ({
  name: 'Pack 1',
  netPricePaise: 300_000,
  itemsCount: 20,
  bonusItemsCount: 2,
  bonusWindowDays: 30,
  validityDays: 60,
  isActive: true,
  sortOrder: 0,
  schools: [],
  ...o,
});

const access = (over: Partial<api.MyAccess> = {}): api.MyAccess => ({
  grants: [], isOwner: false, ...over,
});

describe('canManagePacks', () => {
  it('is true for a platform-scoped meal_packs.manage grant', () => {
    expect(canManagePacks(access({
      grants: [{ permissionCode: 'meal_packs.manage', scopeType: 'platform' }],
    }))).toBe(true);
  });

  it('checks the SCOPE, not just the code', () => {
    /*
     * `0070` constrains `valid_scope_types` to `{platform}`, so a school-scoped grant cannot be
     * created today. A constraint on what may be granted is not a check on what was — and if that
     * constraint is ever relaxed, a school-scoped grant must not silently become a platform
     * control over every school's packs.
     */
    expect(canManagePacks(access({
      grants: [{ permissionCode: 'meal_packs.manage', scopeType: 'school' }],
    }))).toBe(false);
  });

  it('is true for the owner, who holds no grant rows at all', () => {
    // `E02-39`. Enumerating grants alone renders an empty back office for the one account that
    // can do everything, which is the whole consequence the owner design has to answer for.
    expect(canManagePacks(access({ isOwner: true }))).toBe(true);
  });

  it('is false for another permission, and for no access at all', () => {
    expect(canManagePacks(access({
      grants: [{ permissionCode: 'schools.manage', scopeType: 'platform' }],
    }))).toBe(false);
    expect(canManagePacks(null)).toBe(false);
  });
});

describe('packSwitchRows', () => {
  it('lists every offer, including ones with no row for this school', () => {
    /*
     * Absence means off. Listing only existing rows would show an empty list for the school
     * nobody has enabled yet — which is exactly the school somebody came here to enable. The
     * Amity case, and the one that has to work on the first try.
     */
    const rows = packSwitchRows([offer({ id: 'a' }), offer({ id: 'b' })], 's-new');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.isEnabled)).toBe(true);
  });

  it('reads a row that exists and is switched off as off', () => {
    const rows = packSwitchRows(
      [offer({ id: 'a', schools: [{ schoolId: 's-1', schoolName: 'Amity', isEnabled: false }] })],
      's-1',
    );
    expect(rows[0]!.isEnabled).toBe(false);
  });

  it('reads a row that exists and is switched on as on', () => {
    const rows = packSwitchRows(
      [offer({ id: 'a', schools: [{ schoolId: 's-1', schoolName: 'Amity', isEnabled: true }] })],
      's-1',
    );
    expect(rows[0]!.isEnabled).toBe(true);
  });

  it('does not leak another school’s switch into this one', () => {
    const rows = packSwitchRows(
      [offer({ id: 'a', schools: [{ schoolId: 's-2', schoolName: 'Gem', isEnabled: true }] })],
      's-1',
    );
    expect(rows[0]!.isEnabled).toBe(false);
  });

  it('includes drafts, and says so', () => {
    // Hiding them means creating an offer, coming here, finding nothing, and having no way to
    // learn that the offer's own switch is the missing half.
    const rows = packSwitchRows([offer({ id: 'a', isActive: false })], 's-1');
    expect(rows[0]!.isOfferActive).toBe(false);
  });
});

describe('packSummaryLine', () => {
  it('names what is actually on sale', () => {
    const rows = packSwitchRows(
      [offer({ id: 'a', schools: [{ schoolId: 's-1', schoolName: 'Amity', isEnabled: true }] })],
      's-1',
    );
    expect(packSummaryLine(rows)).toContain('on sale here');
    expect(packSummaryLine(rows)).toContain('Pack 1');
  });

  it('says NOTHING is purchasable when the only enabled offer is a draft', () => {
    /*
     * The two switches are independent by design, so "on at this school" and "on sale" are
     * different facts. From a parent's side they are the same — they see nothing either way — and
     * this page exists to answer what a parent would see.
     */
    const rows = packSwitchRows(
      [offer({
        id: 'a', isActive: false,
        schools: [{ schoolId: 's-1', schoolName: 'Amity', isEnabled: true }],
      })],
      's-1',
    );
    const line = packSummaryLine(rows);
    expect(line).toContain('still a draft');
    expect(line).toContain('nothing is purchasable');
    expect(line).not.toContain('on sale here');
  });

  it('says packs are not offered when no switch is on', () => {
    expect(packSummaryLine(packSwitchRows([offer({ id: 'a' })], 's-1')))
      .toBe('No meal packs are offered at this school.');
  });

  it('says packs are not offered when there are no offers at all', () => {
    // Production today: zero offers, zero rows. The sentence must still be a sentence.
    expect(packSummaryLine(packSwitchRows([], 's-1')))
      .toBe('No meal packs are offered at this school.');
  });
});
