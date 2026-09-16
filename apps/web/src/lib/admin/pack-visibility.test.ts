import { describe, expect, it } from 'vitest';

import type { api } from '@graybag/shared';

import { packVisibilityOf } from './pack-visibility.js';

const row = (): api.PackMoneyRow => ({
  mealPackId: 'p1', schoolId: 's1', nameSnapshot: 'Pack 1',
  purchasedAt: '2026-09-01T04:00:00Z', expiresAt: '2026-11-01T04:00:00Z', status: 'active',
  pricePaidPaise: 300_000, taxPaise: 15_000, itemsOriginal: 20, valuedRemaining: 20,
  deferredPaise: 300_000, bonusItemsOffered: 2, bonusGranted: false,
  bonusItemsRedeemed: 0, bonusItemsOutstanding: 0,
  revenueRecognisedPaise: 0, valuedItemsRedeemed: 0, breakagePaise: 0,
});

describe('packVisibilityOf', () => {
  it('is blind when the money read failed outright', () => {
    expect(packVisibilityOf(null, { a: 3 })).toBe('blind');
    expect(packVisibilityOf(null, null)).toBe('blind');
  });

  it('is visible as soon as a single row comes back', () => {
    // One row proves the read is not being filtered to nothing, whatever the count says.
    expect(packVisibilityOf([row()], null)).toBe('visible');
    expect(packVisibilityOf([row()], {})).toBe('visible');
  });

  it('is BLIND when packs have been sold and the view returns none', () => {
    /*
     * The case the module exists for. `meal_pack_money` is `security_invoker` over a table whose
     * only read policy is `meal_pack_read_own`, so a back-office account reads nothing while packs
     * exist — and the screen would otherwise print a confident ₹0 still owed in food.
     */
    expect(packVisibilityOf([], { 'offer-a': 17 })).toBe('blind');
  });

  it('is visible when nothing has been sold and the service role agrees', () => {
    // Production today: zero offers, zero packs. "No packs sold" is the truth, not a blind spot,
    // and a screen that cried "we cannot see" here would be crying wolf from day one.
    expect(packVisibilityOf([], {})).toBe('visible');
    expect(packVisibilityOf([], { 'offer-a': 0 })).toBe('visible');
  });

  it('is blind when empty and the count could not be checked', () => {
    // Uncertainty resolves to blind. Saying "we cannot see this" when a number was available is
    // a small annoyance; saying ₹0 when the truth is ₹40,000 is a false statement about money.
    expect(packVisibilityOf([], null)).toBe('blind');
  });

  it('sums counts across offers rather than reading only the first', () => {
    // A single offer with 0 sold and another with 5 must still read as blind.
    expect(packVisibilityOf([], { 'offer-a': 0, 'offer-b': 5 })).toBe('blind');
  });
});
