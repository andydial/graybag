/**
 * A meal pack screen the a11y audit and a designer can open without a session — `E21-60`.
 *
 * Shaped so the states that matter are all on screen at once, because a demo where everything is
 * healthy demonstrates none of the arithmetic the screen exists for:
 *
 *   - a **live** offer that has **sold**, so the locked-fields explanation is reachable
 *   - a **draft** offered nowhere, which is what a new offer looks like
 *   - a live offer switched **on at one school and off at another**, which is the two-switch rule
 *     the whole design turns on
 */
import type { api } from '@graybag/shared';

const CATEGORY_DRINKS = 'c0000000-0000-4000-8000-000000000001';
const CATEGORY_MAINS = 'c0000000-0000-4000-8000-000000000002';

export const PACKS_FIXTURE: {
  offers: api.AdminPackOffer[];
  sold: Record<string, number>;
  schools: { id: string; name: string }[];
  categories: { id: string; name: string }[];
} = {
  offers: [
    {
      id: 'o0000000-0000-4000-8000-000000000001',
      name: 'Ten lunches',
      mealsCount: 10,
      itemsPerMeal: 2,
      requiredCategoryId: CATEGORY_DRINKS,
      requiredCategoryName: 'Drinks',
      netPricePaise: 450_000,
      alacarteReferencePaise: 500_000,
      validityDays: 90,
      isActive: true,
      // On at one school, off at another. Both rows exist — "no row" and "row switched off" are
      // different states and the screen must not collapse them.
      schools: [
        { schoolId: 's-1', schoolName: 'Amity International, Mohali', isEnabled: true },
        { schoolId: 's-2', schoolName: 'Gem Public School', isEnabled: false },
      ],
    },
    {
      id: 'o0000000-0000-4000-8000-000000000002',
      name: 'Twenty lunches',
      mealsCount: 20,
      itemsPerMeal: 2,
      requiredCategoryId: CATEGORY_DRINKS,
      requiredCategoryName: 'Drinks',
      netPricePaise: 860_000,
      alacarteReferencePaise: 1_000_000,
      validityDays: 120,
      isActive: true,
      schools: [{ schoolId: 's-1', schoolName: 'Amity International, Mohali', isEnabled: true }],
    },
    {
      id: 'o0000000-0000-4000-8000-000000000003',
      name: 'Five breakfasts (draft)',
      mealsCount: 5,
      itemsPerMeal: 1,
      requiredCategoryId: CATEGORY_MAINS,
      requiredCategoryName: 'Meals',
      netPricePaise: 200_000,
      alacarteReferencePaise: 225_000,
      validityDays: 45,
      isActive: false,
      schools: [],
    },
  ],

  /* Only the first has sold, so exactly one offer shows the locked-fields state. */
  sold: {
    'o0000000-0000-4000-8000-000000000001': 17,
  },

  schools: [
    { id: 's-1', name: 'Amity International, Mohali' },
    { id: 's-2', name: 'Gem Public School' },
    { id: 's-3', name: 'Paragon Senior Secondary' },
  ],

  categories: [
    { id: CATEGORY_DRINKS, name: 'Drinks' },
    { id: CATEGORY_MAINS, name: 'Meals' },
  ],
};
