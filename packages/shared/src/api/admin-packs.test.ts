import { afterEach, describe, expect, it } from 'vitest';

import {
  ADMIN_PACK_OFFER_COLUMNS,
  fetchAdminPackOffers,
  perItemPricePaise,
  validatePackOffer,
} from './admin-packs.js';
import { setApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

/** Pack 1 from the rebuild design: ₹3,000 ex-tax, 20 items, 2 bonus inside 30 days, valid 60. */
const ok = {
  name: 'Pack 1',
  netPricePaise: 300_000,
  itemsCount: 20,
  bonusItemsCount: 2,
  bonusWindowDays: 30,
  validityDays: 60,
  sortOrder: 0,
};

describe('validatePackOffer', () => {
  it('accepts a well-formed offer', () => {
    expect(validatePackOffer(ok)).toBeNull();
  });

  it('accepts a pack with no bonus at all', () => {
    // Zero is legitimate for both, together. An ordinary pack is not a misconfiguration.
    expect(validatePackOffer({ ...ok, bonusItemsCount: 0, bonusWindowDays: 0 })).toBeNull();
  });

  describe('bonus items and a bonus window are one decision, not two', () => {
    /*
     * `(bonus_items_count = 0) = (bonus_window_days = 0)` is a CHECK in the schema. Either half
     * alone reads as a promise to a parent that nothing can keep, and it is the single most likely
     * thing to be typed into this form — so it is caught by name rather than as a 23514.
     */
    it('refuses a window with no items', () => {
      const errors = validatePackOffer({ ...ok, bonusItemsCount: 0, bonusWindowDays: 30 })!;
      expect(errors).toHaveProperty('bonusItemsCount');
      expect(errors.bonusItemsCount).toContain('promises a parent nothing');
    });

    it('refuses items with no window', () => {
      const errors = validatePackOffer({ ...ok, bonusItemsCount: 2, bonusWindowDays: 0 })!;
      expect(errors).toHaveProperty('bonusWindowDays');
      expect(errors.bonusWindowDays).toContain('never be earned');
    });

    it('names the field the person should change, not the other one', () => {
      // Telling someone "bonus items is wrong" when they meant to clear the window sends them to
      // the wrong box. The error lands on whichever half is zero.
      expect(Object.keys(validatePackOffer({ ...ok, bonusItemsCount: 0 })!)).toEqual(['bonusItemsCount']);
      expect(Object.keys(validatePackOffer({ ...ok, bonusWindowDays: 0 })!)).toEqual(['bonusWindowDays']);
    });
  });

  it('refuses a bonus window that outlasts the pack', () => {
    // The pack expires first, so the last days of the window are unreachable.
    // `bonus_window_days <= validity_days` in the schema.
    expect(validatePackOffer({ ...ok, bonusWindowDays: 61, validityDays: 60 }))
      .toHaveProperty('bonusWindowDays');
    // Equal is fine — a window that runs exactly to expiry promises something real on every day.
    expect(validatePackOffer({ ...ok, bonusWindowDays: 60, validityDays: 60 })).toBeNull();
  });

  it('names every problem at once rather than one at a time', () => {
    const errors = validatePackOffer({ name: '', itemsCount: 0 })!;
    expect(Object.keys(errors).sort()).toEqual([
      'bonusItemsCount', 'bonusWindowDays', 'itemsCount', 'name', 'netPricePaise', 'validityDays',
    ]);
  });

  it('refuses fractional and negative counts, which the database also refuses', () => {
    expect(validatePackOffer({ ...ok, itemsCount: 2.5 })).toHaveProperty('itemsCount');
    expect(validatePackOffer({ ...ok, itemsCount: -1 })).toHaveProperty('itemsCount');
    expect(validatePackOffer({ ...ok, validityDays: 0 })).toHaveProperty('validityDays');
    expect(validatePackOffer({ ...ok, bonusItemsCount: -1 })).toHaveProperty('bonusItemsCount');
  });

  it('has no opinion about a required category, because the rebuilt model has none', () => {
    /*
     * The old model sold a *meal* — N items, one from a configured category. One item is now one
     * item. A stray `requiredCategoryId` is simply not a field and must not become an error, or a
     * caller still sending the old shape would be told something false about why it failed.
     */
    expect(validatePackOffer({ ...ok, requiredCategoryId: 'nope' } as never)).toBeNull();
  });
});

describe('perItemPricePaise', () => {
  it('divides by PURCHASED items, never by the bonus-inclusive total', () => {
    /*
     * `M10`: bonus items carry no value. Dividing ₹3,000 by 22 would print a per-item price the
     * books never use and quietly suggest the giveaway was paid for.
     */
    expect(perItemPricePaise({ netPricePaise: 300_000, itemsCount: 20 })).toBe(15_000);
  });

  it('is zero rather than Infinity when an offer has no items', () => {
    // The schema forbids it; a display helper still must not render "₹Infinity".
    expect(perItemPricePaise({ netPricePaise: 300_000, itemsCount: 0 })).toBe(0);
  });
});

describe('fetchAdminPackOffers', () => {
  it('asks for drafts as well as live offers, and for the school switches', async () => {
    const fake = fakeTransport([]);
    setApiTransport(fake.transport);
    await fetchAdminPackOffers();

    const [query] = fake.queries;
    expect(query!.table).toBe('meal_pack_offer');
    // No `is_active` filter: this is the workshop, and a draft is the thing you came to work on.
    expect(query!.filters).toEqual([]);
    expect(query!.columns).toContain('is_active');
    expect(query!.columns).toContain('meal_pack_offer_school');
  });

  it('reads the rebuilt columns and none of the deleted ones', () => {
    for (const column of ['items_count', 'bonus_items_count', 'bonus_window_days']) {
      expect(ADMIN_PACK_OFFER_COLUMNS, column).toContain(column);
    }
    for (const gone of ['meals_count', 'items_per_meal', 'required_category_id', 'alacarte']) {
      expect(ADMIN_PACK_OFFER_COLUMNS, gone).not.toContain(gone);
    }
  });

  it('reads no purchase data — an offer screen has no business with who bought what', () => {
    // `meal_pack` is deliberately absent. The sold *count* comes from the Edge Function, which
    // returns a number per offer and nothing else.
    expect(ADMIN_PACK_OFFER_COLUMNS).not.toContain('meal_pack(');
    expect(ADMIN_PACK_OFFER_COLUMNS).not.toContain('customer_user_id');
    expect(ADMIN_PACK_OFFER_COLUMNS).not.toContain('order_group');
  });

  it('flattens the school switches', async () => {
    setApiTransport(fakeTransport([{
      id: 'o-1', name: 'Pack 1', net_price_paise: 300_000, items_count: 20,
      bonus_items_count: 2, bonus_window_days: 30, validity_days: 60,
      is_active: false, sort_order: 0,
      meal_pack_offer_school: [
        { school_id: 's-1', is_enabled: true, school: { name: 'Amity' } },
        { school_id: 's-2', is_enabled: false, school: { name: 'Gem' } },
      ],
    }]).transport);

    const [offer] = await fetchAdminPackOffers();
    expect(offer!.itemsCount).toBe(20);
    expect(offer!.bonusItemsCount).toBe(2);
    expect(offer!.isActive).toBe(false);
    expect(offer!.schools).toEqual([
      { schoolId: 's-1', schoolName: 'Amity', isEnabled: true },
      { schoolId: 's-2', schoolName: 'Gem', isEnabled: false },
    ]);
  });

  it('reads an offer with no school rows as offered NOWHERE, not as offered everywhere', async () => {
    /*
     * Absence means off. This is the gate Andy keeps — an offer with no `meal_pack_offer_school`
     * row is not sold anywhere, and reading it as "unrestricted" would sell packs at every school
     * the moment one went active.
     */
    setApiTransport(fakeTransport([{
      id: 'o-1', name: 'Orphan', net_price_paise: 100, items_count: 5,
      bonus_items_count: 0, bonus_window_days: 0, validity_days: 30,
      is_active: true, sort_order: 0, meal_pack_offer_school: [],
    }]).transport);

    const [offer] = await fetchAdminPackOffers();
    expect(offer!.schools).toEqual([]);
  });
});
