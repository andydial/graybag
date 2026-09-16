import { describe, expect, it } from 'vitest';

import {
  type LedgerPackMovements,
  type PackRow,
  deferredOutstandingPaise,
  deferredPaise,
  packPeriodTotals,
  reconcile,
  redemptionRate,
  summarisePackSales,
} from './admin-pack-reports.js';

/**
 * Pinned to `M10`, `M11` and `docs/meal-packs-rebuild.md` §5. If this file and those disagree, they
 * are right and this is the bug — the database posts the ledger movements and this module only
 * reports them.
 */

/** Pack 1 from the design: ₹3,000 ex-tax, 20 items, 2 bonus. */
const pack = (over: Partial<PackRow> = {}): PackRow => ({
  id: 'p1',
  offerId: 'o1',
  offerName: 'Pack 1',
  pricePaidPaise: 300_000,
  cgstPaise: 7_500,
  sgstPaise: 7_500,
  itemsOriginal: 20,
  itemsTotal: 20,
  itemsRemaining: 20,
  valuedRemaining: 20,
  bonusItems: 2,
  bonusGrantedAt: null,
  purchasedAt: '2026-09-01T00:00:00Z',
  expiresAt: '2026-10-31T00:00:00Z',
  status: 'active',
  ...over,
});

/**
 * The one row a single-offer summary must have.
 *
 * A helper rather than `!` so that a summary which unexpectedly returns nothing fails with a
 * sentence, instead of the assertion below it failing on `undefined` and sending the reader to the
 * wrong line.
 */
const only = <T>(rows: readonly T[]): T => {
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
  return rows[0] as T;
};

const ledger = (over: Partial<LedgerPackMovements> = {}): LedgerPackMovements => ({
  deferredBalancePaise: 0,
  recognisedFromRedemptionsPaise: 0,
  recognisedFromBreakagePaise: 0,
  restatedByBonusPaise: 0,
  ...over,
});

describe('deferredPaise', () => {
  it('owes the whole price before anything is eaten, and nothing after everything is', () => {
    expect(deferredPaise(pack())).toBe(300_000);
    expect(deferredPaise(pack({ itemsRemaining: 0, valuedRemaining: 0 }))).toBe(0);
  });

  it('lands the last item on exactly zero, which an accumulated per-item value cannot', () => {
    /*
     * The case the design calls out: ₹3,000 over 22 items is 13,636.36 paise. A stored per-item
     * value leaves the books a few paise off; a function of `items_remaining` cannot.
     */
    const bonus = pack({ itemsTotal: 22, bonusGrantedAt: '2026-09-20T00:00:00Z' });
    let previous = Number.POSITIVE_INFINITY;
    for (let remaining = 20; remaining >= 0; remaining -= 1) {
      const owed = deferredPaise({ ...bonus, valuedRemaining: remaining });
      expect(owed).toBeLessThanOrEqual(previous);
      expect(Number.isInteger(owed)).toBe(true);
      previous = owed;
    }
    expect(deferredPaise({ ...bonus, valuedRemaining: 0 })).toBe(0);
    expect(deferredPaise({ ...bonus, valuedRemaining: 20 })).toBe(300_000);
  });

  it('OWES NOTHING for bonus items — M12, and this test previously said otherwise', () => {
    /**
     * Rewritten by MOBILE on merge, and worth explaining rather than quietly changing.
     *
     * This assertion read `deferredPaise({ itemsTotal: 22, itemsRemaining: 2 }) === 27_273`, from
     * the design document's §5 **as it stood before Andy ruled on it**. That draft re-spread the
     * price over 22 items when the bonus was granted, which meant clawing ₹272.73 back out of
     * revenue already recognised — possibly in a closed month.
     *
     * **Andy rejected it on 2026-09-16**: bonus items carry zero deferred value, no revenue is
     * restated, and `items_original` stays 20 for the life of the pack. So a pack holding only
     * bonus items owes nothing — the giveaway was free in the books as well as to the parent.
     *
     * Keeping the old number would have made `reconcile()` report a divergence against the
     * ledger on every bonus-earning pack, because the server posts `M12`'s arithmetic.
     */
    const granted = pack({
      itemsTotal: 22,
      itemsRemaining: 2,
      valuedRemaining: 0,
      bonusGrantedAt: '2026-09-20T00:00:00Z',
    });
    expect(deferredPaise(granted)).toBe(0);

    // And a cancellation that hands a VALUED item back does owe again — one item of the twenty
    // the money bought, never one of twenty-two.
    expect(deferredPaise({ ...granted, valuedRemaining: 1 })).toBe(15_000);
  });
});

describe('deferredOutstandingPaise', () => {
  it('counts active and exhausted packs, and never a pending one', () => {
    // `pending` was never paid for, so it owes no food. Counting it would inflate the liability.
    const packs = [
      pack({ id: 'a', itemsRemaining: 10, valuedRemaining: 10 }),
      pack({ id: 'b', status: 'exhausted', itemsRemaining: 0, valuedRemaining: 0 }),
      pack({ id: 'c', status: 'pending', itemsRemaining: 20, valuedRemaining: 20 }),
      pack({ id: 'd', status: 'expired', itemsRemaining: 0, valuedRemaining: 0 }),
    ];
    expect(deferredOutstandingPaise(packs)).toBe(150_000);
  });
});

describe('reconcile', () => {
  it('agrees when the packs and the books say the same thing', () => {
    const packs = [pack({ itemsRemaining: 10, valuedRemaining: 10 })];
    const result = reconcile(packs, ledger({ deferredBalancePaise: 150_000 }));
    expect(result.agrees).toBe(true);
    expect(result.differencePaise).toBe(0);
  });

  it('reports a disagreement rather than choosing the prettier number', () => {
    /*
     * The whole point of the second derivation. A missed posting or a double-counted item shows up
     * here as a non-zero difference, and the screen has to say so.
     */
    const packs = [pack({ itemsRemaining: 10, valuedRemaining: 10 })];
    const result = reconcile(packs, ledger({ deferredBalancePaise: 149_000 }));
    expect(result.agrees).toBe(false);
    expect(result.differencePaise).toBe(1_000);
    expect(result.fromPacksPaise).toBe(150_000);
    expect(result.fromLedgerPaise).toBe(149_000);
  });
});

describe('redemptionRate', () => {
  it('is null rather than zero when nothing has been sold', () => {
    // 0/0 is "we do not know yet". Rendering 0% against no sales says something false.
    expect(redemptionRate(0, 0)).toBeNull();
  });

  it('is the fraction of purchased items eaten', () => {
    expect(redemptionRate(20, 15)).toBe(0.75);
  });
});

describe('summarisePackSales', () => {
  it('splits bonus items out of the redemption rate, in both halves', () => {
    /*
     * The pack ate all 20 purchased items and then one of its 2 bonus items. Redemption rate is
     * 20/20 — the parent got everything they paid for. Counting the bonus would read 21/22 = 95%
     * and describe the bonus rather than the price, which is the question Andy is asking.
     */
    const row = only(summarisePackSales(
      [pack({ itemsTotal: 22, itemsRemaining: 1, valuedRemaining: 0, bonusGrantedAt: '2026-09-20T00:00:00Z' })],
      [],
    ));
    expect(row.itemsSold).toBe(20);
    expect(row.itemsRedeemed).toBe(20);
    expect(row.redemptionRate).toBe(1);
    expect(row.bonusItemsGranted).toBe(2);
    expect(row.bonusItemsRedeemed).toBe(1);
  });

  it('counts no bonus as granted until it is earned', () => {
    const row = only(summarisePackSales([pack({ itemsRemaining: 5, valuedRemaining: 5 })], []));
    expect(row.bonusItemsGranted).toBe(0);
    expect(row.bonusItemsRedeemed).toBe(0);
    expect(row.itemsRedeemed).toBe(15);
    expect(row.redemptionRate).toBe(0.75);
  });

  it('never counts a pending pack as sold', () => {
    expect(summarisePackSales([pack({ status: 'pending' })], [])).toEqual([]);
  });

  it('keeps GST out of the ex-tax gross, and sums both per offer', () => {
    const row = only(summarisePackSales([pack({ id: 'a' }), pack({ id: 'b' })], []));
    expect(row.packsSold).toBe(2);
    expect(row.grossExTaxPaise).toBe(600_000);
    expect(row.gstPaise).toBe(30_000);
  });

  it('uses the name the pack was SOLD under, not the offer’s name today', () => {
    // `E21-67`. A renamed offer must not restate a month that already closed.
    const row = only(summarisePackSales([pack({ offerName: 'Pack 1 (Spring)' })], []));
    expect(row.offerName).toBe('Pack 1 (Spring)');
  });

  it('attributes forfeited items to the pack that expired', () => {
    const row = only(summarisePackSales(
      [pack({ id: 'a', status: 'expired', itemsRemaining: 0, valuedRemaining: 0 })],
      [{ packId: 'a', breakagePaise: 45_000, itemsForfeit: 3, expiredAt: '2026-11-01T00:00:00Z' }],
    ));
    expect(row.itemsForfeit).toBe(3);
  });
});

describe('packPeriodTotals', () => {
  it('keeps breakage and redemption revenue on separate lines, and totals them without merging', () => {
    // `M11`. "Ate it" and "forgot about it" must never be one number.
    const totals = packPeriodTotals(
      [pack()],
      [pack({ itemsRemaining: 10, valuedRemaining: 10 })],
      ledger({
        deferredBalancePaise: 150_000,
        recognisedFromRedemptionsPaise: 120_000,
        recognisedFromBreakagePaise: 30_000,
      }),
    );
    expect(totals.recognisedFromRedemptionsPaise).toBe(120_000);
    expect(totals.recognisedFromBreakagePaise).toBe(30_000);
    expect(totals.recognisedTotalPaise).toBe(150_000);
    expect(totals.reconciliation.agrees).toBe(true);
  });

  it('subtracts a bonus restatement, and reports it in its own right', () => {
    /*
     * Policy-neutral by construction (`M10`): under "bonus carries no value" this field is simply
     * zero and nothing else in the module changes.
     */
    const totals = packPeriodTotals(
      [pack()],
      [],
      ledger({ recognisedFromRedemptionsPaise: 300_000, restatedByBonusPaise: 27_273 }),
    );
    expect(totals.restatedByBonusPaise).toBe(27_273);
    expect(totals.recognisedTotalPaise).toBe(272_727);
  });

  it('reports the sale gross and GST for the period, not the lifetime', () => {
    const totals = packPeriodTotals([pack(), pack({ id: 'b' })], [pack()], ledger());
    expect(totals.packsSold).toBe(2);
    expect(totals.grossExTaxPaise).toBe(600_000);
    expect(totals.gstPaise).toBe(30_000);
  });
});

describe('the compliance control', () => {
  it('has no field on any row type that could carry child data', () => {
    /*
     * Non-negotiable #4, asserted by name rather than trusted to the schema. The new
     * `meal_pack_redemption` has no `recipient_id` at all, but "the table happens not to have it"
     * is not a control — this is.
     */
    const row = only(summarisePackSales([pack()], []));
    const banned = ['recipient', 'child', 'name_snapshot', 'class', 'section', 'allergen', 'allergy'];
    for (const key of Object.keys(row)) {
      for (const word of banned) {
        expect(key.toLowerCase()).not.toContain(word);
      }
    }
  });
});
