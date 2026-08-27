import { afterEach, describe, expect, it } from 'vitest';

import {
  ADMIN_PACK_OFFER_COLUMNS,
  fetchAdminPackOffers,
  packSavingPaise,
  validatePackOffer,
} from './admin-packs.js';
import { setApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

const ok = {
  name: 'Ten lunches',
  mealsCount: 10,
  itemsPerMeal: 2,
  requiredCategoryId: '11111111-2222-4333-8444-555555555555',
  netPricePaise: 450_000,
  alacarteReferencePaise: 500_000,
  validityDays: 90,
};

describe('validatePackOffer', () => {
  it('accepts a well-formed offer', () => {
    expect(validatePackOffer(ok)).toBeNull();
  });

  /*
   * The rule that makes an offer an offer, and the one that is stated three times: here, in the
   * Edge Function, and as `meal_pack_offer_is_a_discount` in `0068`. The database is the copy that
   * cannot be bypassed; this one exists so the form says so before it is submitted.
   */
  it('refuses a pack that costs the same as or more than buying singly', () => {
    expect(validatePackOffer({ ...ok, netPricePaise: 500_000 })).toHaveProperty('netPricePaise');
    expect(validatePackOffer({ ...ok, netPricePaise: 500_001 })).toHaveProperty('netPricePaise');
    // One paise of saving is still a saving, and the constraint is `<`, not "meaningfully less".
    expect(validatePackOffer({ ...ok, netPricePaise: 499_999 })).toBeNull();
  });

  it('names every problem at once rather than one at a time', () => {
    const errors = validatePackOffer({ name: '', mealsCount: 0, requiredCategoryId: 'nope' })!;
    expect(Object.keys(errors).sort()).toEqual([
      'alacarteReferencePaise', 'itemsPerMeal', 'mealsCount', 'name',
      'netPricePaise', 'requiredCategoryId', 'validityDays',
    ]);
  });

  it('refuses fractional and negative counts, which the database also refuses', () => {
    expect(validatePackOffer({ ...ok, mealsCount: 2.5 })).toHaveProperty('mealsCount');
    expect(validatePackOffer({ ...ok, mealsCount: -1 })).toHaveProperty('mealsCount');
    expect(validatePackOffer({ ...ok, validityDays: 0 })).toHaveProperty('validityDays');
  });

  it('requires a category, because "one of them a drink" is configured and never hardcoded', () => {
    expect(validatePackOffer({ ...ok, requiredCategoryId: '' })).toHaveProperty('requiredCategoryId');
  });
});

describe('packSavingPaise', () => {
  it('is the difference, in paise', () => {
    expect(packSavingPaise({ netPricePaise: 450_000, alacarteReferencePaise: 500_000 })).toBe(50_000);
  });

  it('never goes negative, so a bad row cannot render as a negative saving', () => {
    // The constraint should prevent this reaching us; a display helper still should not produce
    // "save -₹120" if it ever does.
    expect(packSavingPaise({ netPricePaise: 600_000, alacarteReferencePaise: 500_000 })).toBe(0);
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

  it('reads no purchase data — an offer screen has no business with who bought what', async () => {
    // `meal_pack` is deliberately absent. The sold *count* comes from the Edge Function, which
    // returns a number per offer and nothing else.
    expect(ADMIN_PACK_OFFER_COLUMNS).not.toContain('meal_pack(');
    expect(ADMIN_PACK_OFFER_COLUMNS).not.toContain('customer_user_id');
    expect(ADMIN_PACK_OFFER_COLUMNS).not.toContain('order_group');
  });

  it('flattens the category name and the school switches', async () => {
    setApiTransport(fakeTransport([{
      id: 'o-1', name: 'Ten lunches', meals_count: 10, items_per_meal: 2,
      required_category_id: 'c-1', net_price_paise: 450_000,
      alacarte_reference_paise: 500_000, validity_days: 90, is_active: false,
      category: { display_name: 'Drinks' },
      meal_pack_offer_school: [
        { school_id: 's-1', is_enabled: true, school: { name: 'Amity' } },
        { school_id: 's-2', is_enabled: false, school: { name: 'Gem' } },
      ],
    }]).transport);

    const [offer] = await fetchAdminPackOffers();
    expect(offer!.requiredCategoryName).toBe('Drinks');
    expect(offer!.isActive).toBe(false);
    expect(offer!.schools).toEqual([
      { schoolId: 's-1', schoolName: 'Amity', isEnabled: true },
      { schoolId: 's-2', schoolName: 'Gem', isEnabled: false },
    ]);
  });

  it('reads an offer with no school rows as offered nowhere, not as offered everywhere', async () => {
    setApiTransport(fakeTransport([{
      id: 'o-1', name: 'Orphan', meals_count: 5, items_per_meal: 1,
      required_category_id: 'c-1', net_price_paise: 100, alacarte_reference_paise: 200,
      validity_days: 30, is_active: true, category: { display_name: 'Drinks' },
      meal_pack_offer_school: [],
    }]).transport);

    const [offer] = await fetchAdminPackOffers();
    expect(offer!.schools).toEqual([]);
  });
});
