/**
 * Pack money the a11y audit and a designer can open without a session — `E21`.
 *
 * Shaped so every figure on the pack section has something to say, because a demo where nothing
 * has been redeemed demonstrates none of the arithmetic:
 *
 *   - a pack **part-eaten**, so deferred revenue and recognised revenue are both non-zero
 *   - a pack that **earned its bonus** and is eating into it, so bonus granted and bonus redeemed
 *     are visibly separate from purchased items
 *   - an **expired** pack with breakage, so "forfeited" has a number beside it
 *   - a **second offer** with a different redemption rate, because one row cannot show that the
 *     rate is per offer
 *
 * The numbers are the rebuild design's worked example (₹3,000 / 20 items / 2 bonus), so a reader
 * comparing the two sees the same pack twice rather than two inventions.
 */
import type { api } from '@graybag/shared';

export const PACK_MONEY_FIXTURE: api.PackMoneyRow[] = [
  {
    // Part-eaten: 12 of 20 items gone, so ₹1,800 recognised and ₹1,200 still owed in food.
    mealPackId: 'p-1',
    schoolId: 's-1',
    nameSnapshot: 'Pack 1',
    purchasedAt: '2026-09-02T04:30:00Z',
    expiresAt: '2026-11-01T04:30:00Z',
    status: 'active',
    pricePaidPaise: 300_000,
    taxPaise: 15_000,
    itemsOriginal: 20,
    valuedRemaining: 8,
    deferredPaise: 120_000,
    bonusItemsOffered: 2,
    bonusGranted: false,
    bonusItemsRedeemed: 0,
    bonusItemsOutstanding: 0,
    revenueRecognisedPaise: 180_000,
    valuedItemsRedeemed: 12,
    breakagePaise: 0,
  },
  {
    // Finished all 20 purchased items, so the bonus was granted and one of the two is eaten.
    // Deferred is zero — the giveaway never deferred anything (`M10`).
    mealPackId: 'p-2',
    schoolId: 's-1',
    nameSnapshot: 'Pack 1',
    purchasedAt: '2026-09-04T05:00:00Z',
    expiresAt: '2026-11-03T05:00:00Z',
    status: 'active',
    pricePaidPaise: 300_000,
    taxPaise: 15_000,
    itemsOriginal: 20,
    valuedRemaining: 0,
    deferredPaise: 0,
    bonusItemsOffered: 2,
    bonusGranted: true,
    bonusItemsRedeemed: 1,
    bonusItemsOutstanding: 1,
    revenueRecognisedPaise: 300_000,
    valuedItemsRedeemed: 20,
    breakagePaise: 0,
  },
  {
    // Expired with 6 of 20 unspent: the whole ₹3,000 is revenue, ₹900 of it as breakage.
    mealPackId: 'p-3',
    schoolId: 's-2',
    nameSnapshot: 'Pack 1',
    purchasedAt: '2026-07-10T04:00:00Z',
    expiresAt: '2026-09-08T04:00:00Z',
    status: 'expired',
    pricePaidPaise: 300_000,
    taxPaise: 15_000,
    itemsOriginal: 20,
    valuedRemaining: 0,
    deferredPaise: 0,
    bonusItemsOffered: 2,
    bonusGranted: false,
    bonusItemsRedeemed: 0,
    bonusItemsOutstanding: 0,
    revenueRecognisedPaise: 300_000,
    valuedItemsRedeemed: 14,
    breakagePaise: 90_000,
  },
  {
    // A different offer, barely touched — so the redemption rate column has two distinct values
    // and reads as a per-offer figure rather than a platform average.
    mealPackId: 'p-4',
    schoolId: 's-1',
    nameSnapshot: 'Pack 2',
    purchasedAt: '2026-09-11T04:00:00Z',
    expiresAt: '2026-12-10T04:00:00Z',
    status: 'active',
    pricePaidPaise: 500_000,
    taxPaise: 25_000,
    itemsOriginal: 40,
    valuedRemaining: 36,
    deferredPaise: 450_000,
    bonusItemsOffered: 0,
    bonusGranted: false,
    bonusItemsRedeemed: 0,
    bonusItemsOutstanding: 0,
    revenueRecognisedPaise: 50_000,
    valuedItemsRedeemed: 4,
    breakagePaise: 0,
  },
];
