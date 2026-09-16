/**
 * A meal pack screen the a11y audit and a designer can open without a session — `E21`, rebuilt.
 *
 * Shaped so the states that matter are all on screen at once, because a demo where everything is
 * healthy demonstrates none of the arithmetic the screen exists for:
 *
 *   - a **live** offer that has **sold**, so "editing does not change packs already bought" is
 *     reachable
 *   - a live offer with **no bonus at all**, which is a legitimate pack and not a misconfiguration
 *   - a **draft** offered nowhere, which is what a new offer looks like
 *   - an offer switched **on at one school and off at another**, which is the two-switch rule the
 *     whole design turns on — and note both rows *exist*. "No row" and "row switched off" are
 *     different states and the screen must not collapse them.
 *
 * The numbers are the rebuild design's own worked example (`docs/meal-packs-rebuild.md` §2), so a
 * reader comparing the two sees the same pack twice rather than two inventions.
 */
import type { api } from '@graybag/shared';

export const PACKS_FIXTURE: {
  offers: api.AdminPackOffer[];
  sold: Record<string, number>;
  schools: { id: string; name: string }[];
} = {
  offers: [
    {
      id: 'o0000000-0000-4000-8000-000000000001',
      name: 'Pack 1',
      netPricePaise: 300_000,
      itemsCount: 20,
      bonusItemsCount: 2,
      bonusWindowDays: 30,
      validityDays: 60,
      isActive: true,
      sortOrder: 0,
      schools: [
        { schoolId: 's-1', schoolName: 'Amity International, Mohali', isEnabled: true },
        { schoolId: 's-2', schoolName: 'Gem Public School', isEnabled: false },
      ],
    },
    {
      id: 'o0000000-0000-4000-8000-000000000002',
      name: 'Pack 2',
      netPricePaise: 500_000,
      itemsCount: 40,
      // No bonus. Zero for both, which is the only other combination the schema allows.
      bonusItemsCount: 0,
      bonusWindowDays: 0,
      validityDays: 90,
      isActive: true,
      sortOrder: 1,
      schools: [{ schoolId: 's-1', schoolName: 'Amity International, Mohali', isEnabled: true }],
    },
    {
      id: 'o0000000-0000-4000-8000-000000000003',
      name: 'Breakfast five (draft)',
      netPricePaise: 90_000,
      itemsCount: 5,
      bonusItemsCount: 0,
      bonusWindowDays: 0,
      validityDays: 45,
      isActive: false,
      sortOrder: 2,
      schools: [],
    },
  ],

  /* Only the first has sold, so exactly one offer shows the already-sold explanation. */
  sold: {
    'o0000000-0000-4000-8000-000000000001': 17,
  },

  schools: [
    { id: 's-1', name: 'Amity International, Mohali' },
    { id: 's-2', name: 'Gem Public School' },
    { id: 's-3', name: 'Paragon Senior Secondary' },
  ],
};
