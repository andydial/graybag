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
  it('is UNREADABLE when the money read failed outright', () => {
    /*
     * Not `hidden`. A failed read tells us nothing, including whether any pack exists — and the
     * screen for `hidden` says "packs have been sold", which would be inventing a fact to explain
     * our own silence. This is what a back office sees where the view has not shipped yet.
     */
    expect(packVisibilityOf(null, { a: 3 })).toBe('unreadable');
    expect(packVisibilityOf(null, null)).toBe('unreadable');
  });

  it('is visible as soon as a single row comes back', () => {
    // One row proves the read is not being filtered to nothing, whatever the count says.
    expect(packVisibilityOf([row()], null)).toBe('visible');
    expect(packVisibilityOf([row()], {})).toBe('visible');
  });

  it('is HIDDEN when packs have been sold and the view returns none', () => {
    /*
     * The case the module exists for. `meal_pack_money` is `security_invoker` over a table whose
     * only read policy is `meal_pack_read_own`, so a back-office account reads nothing while packs
     * exist — and the screen would otherwise print a confident ₹0 still owed in food.
     */
    expect(packVisibilityOf([], { 'offer-a': 17 })).toBe('hidden');
  });

  it('is visible when nothing has been sold and the service role agrees', () => {
    // Production today: zero offers, zero packs. "No packs sold" is the truth, not a blind spot,
    // and a screen that cried "we cannot see" here would be crying wolf from day one.
    expect(packVisibilityOf([], {})).toBe('visible');
    expect(packVisibilityOf([], { 'offer-a': 0 })).toBe('visible');
  });

  it('is unreadable when empty and the count could not be checked', () => {
    // Uncertainty never resolves to a number. And it resolves to `unreadable` rather than
    // `hidden`, because we did not manage to ask whether any pack exists.
    expect(packVisibilityOf([], null)).toBe('unreadable');
  });

  it('sums counts across offers rather than reading only the first', () => {
    // A single offer with 0 sold and another with 5 must still read as blind.
    expect(packVisibilityOf([], { 'offer-a': 0, 'offer-b': 5 })).toBe('hidden');
  });
});
