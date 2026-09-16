import { afterEach, describe, expect, it } from 'vitest';

import {
  PACK_MONEY_COLUMNS,
  type PackMoneyRow,
  fetchPackMoney,
  packPeriodTotals,
  redemptionRate,
  soldBetween,
  summarisePackSales,
  toPackMoneyRow,
} from './admin-pack-reports.js';
import { setApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

/**
 * Pinned to `M10`, `M11`, `M12` and the `meal_pack_money` view. If this file and the view
 * disagree, the view is right and this is the bug — the database computes the money and this
 * module only aggregates it.
 *
 * Pack 1 from the design: ₹3,000 ex-tax, 20 items, 2 bonus.
 */
const pack = (over: Partial<PackMoneyRow> = {}): PackMoneyRow => ({
  mealPackId: 'p1',
  schoolId: 's-1',
  nameSnapshot: 'Pack 1',
  purchasedAt: '2026-09-01T04:00:00Z',
  expiresAt: '2026-10-31T04:00:00Z',
  status: 'active',
  pricePaidPaise: 300_000,
  taxPaise: 15_000,
  itemsOriginal: 20,
  valuedRemaining: 20,
  deferredPaise: 300_000,
  bonusItemsOffered: 2,
  bonusGranted: false,
  bonusItemsRedeemed: 0,
  bonusItemsOutstanding: 0,
  revenueRecognisedPaise: 0,
  valuedItemsRedeemed: 0,
  breakagePaise: 0,
  ...over,
});

const only = <T>(rows: readonly T[]): T => {
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
  return rows[0] as T;
};

describe('the compliance control', () => {
  it('reads no identity of any kind', () => {
    /*
     * Non-negotiable #4, asserted against the column list rather than the output. A test on the
     * returned objects would pass just as happily with `select('*')` and a field nobody read.
     */
    for (const column of [
      'customer_user_id', 'recipient', 'child', 'class', 'section', 'allerg', 'order_ref',
    ]) {
      expect(PACK_MONEY_COLUMNS, column).not.toContain(column);
    }
  });

  it('is the list actually sent', async () => {
    const fake = fakeTransport([]);
    setApiTransport(fake.transport);
    await fetchPackMoney();
    expect(fake.queries[0]?.table).toBe('meal_pack_money');
    expect(fake.queries[0]?.columns).toBe(PACK_MONEY_COLUMNS);
  });
});

describe('toPackMoneyRow', () => {
  it('maps the view’s snake_case, including numerics arriving as strings', () => {
    // PostgREST returns `bigint` as a string. Coercing that to 0 would understate money silently.
    const row = toPackMoneyRow({
      meal_pack_id: 'p1', school_id: 's1', name_snapshot: 'Pack 1',
      purchased_at: '2026-09-01T04:00:00Z', expires_at: '2026-10-31T04:00:00Z', status: 'active',
      price_paid_paise: '300000', tax_paise: '15000', items_original: 20, valued_remaining: 8,
      deferred_paise: '120000', bonus_items_offered: 2, bonus_granted: true,
      bonus_items_redeemed: 1, bonus_items_outstanding: 1,
      revenue_recognised_paise: '180000', valued_items_redeemed: 12, breakage_paise: '0',
    })!;
    expect(row.pricePaidPaise).toBe(300_000);
    expect(row.deferredPaise).toBe(120_000);
    expect(row.revenueRecognisedPaise).toBe(180_000);
    expect(row.bonusGranted).toBe(true);
  });

  it('refuses a non-object rather than inventing a pack', () => {
    expect(toPackMoneyRow(null)).toBeNull();
    expect(toPackMoneyRow('nope')).toBeNull();
  });
});

describe('redemptionRate', () => {
  it('is null rather than zero when nothing has been sold', () => {
    // 0/0 is "we do not know yet". Rendering 0% against no sales says something false.
    expect(redemptionRate(0, 0)).toBeNull();
  });

  it('is the fraction of PURCHASED items eaten', () => {
    expect(redemptionRate(20, 15)).toBe(0.75);
  });
});

describe('summarisePackSales', () => {
  it('excludes bonus items from both halves of the redemption rate', () => {
    /*
     * The pack ate all 20 purchased items and one of its 2 bonus. The rate is 20/20 — the parent
     * got everything they paid for. Counting the bonus would read 21/22 and describe the bonus
     * rather than the price, which is the question Andy is asking.
     */
    const row = only(summarisePackSales([pack({
      valuedRemaining: 0, valuedItemsRedeemed: 20, deferredPaise: 0,
      revenueRecognisedPaise: 300_000,
      bonusGranted: true, bonusItemsRedeemed: 1, bonusItemsOutstanding: 1,
    })]));
    expect(row.itemsSold).toBe(20);
    expect(row.itemsRedeemed).toBe(20);
    expect(row.redemptionRate).toBe(1);
    expect(row.bonusItemsGranted).toBe(2);
    expect(row.bonusItemsRedeemed).toBe(1);
  });

  it('counts a bonus as OFFERED but not granted until it is earned', () => {
    // A pack that never finishes its purchased items offered 2 and granted 0. Reporting 2 granted
    // would overstate what we have actually given away.
    const row = only(summarisePackSales([pack({ valuedRemaining: 5, valuedItemsRedeemed: 15 })]));
    expect(row.bonusItemsGranted).toBe(0);
    expect(row.redemptionRate).toBe(0.75);
  });

  it('keeps GST out of the ex-tax gross', () => {
    const row = only(summarisePackSales([pack({ mealPackId: 'a' }), pack({ mealPackId: 'b' })]));
    expect(row.packsSold).toBe(2);
    expect(row.grossExTaxPaise).toBe(600_000);
    expect(row.gstPaise).toBe(30_000);
  });

  it('groups by the name the pack was SOLD under', () => {
    // `E21-67`. A renamed offer must not restate a month that already closed.
    const rows = summarisePackSales([
      pack({ mealPackId: 'a', nameSnapshot: 'Pack 1' }),
      pack({ mealPackId: 'b', nameSnapshot: 'Pack 1 (Spring)' }),
    ]);
    expect(rows.map((r) => r.offerName).sort()).toEqual(['Pack 1', 'Pack 1 (Spring)']);
  });

  it('keeps breakage on its own line and never inside recognised revenue', () => {
    /*
     * `M11`. Revenue because a parent ate and revenue because a parent forgot are the same number
     * otherwise — and that is exactly the question "is this pack priced right" is asking.
     */
    const row = only(summarisePackSales([pack({
      status: 'expired', valuedRemaining: 0, valuedItemsRedeemed: 12,
      deferredPaise: 0, revenueRecognisedPaise: 300_000, breakagePaise: 120_000,
    })]));
    expect(row.breakagePaise).toBe(120_000);
    expect(row.revenueRecognisedPaise).toBe(300_000);
  });
});

describe('packPeriodTotals', () => {
  it('counts the liability across every live pack, not only those sold in the period', () => {
    // A liability is a running balance and belongs to no period. Filtering it by sale date would
    // report what we owe as if it expired with the month.
    const sold = [pack({ mealPackId: 'new' })];
    const live = [pack({ mealPackId: 'old', deferredPaise: 45_000, valuedRemaining: 3 }), ...sold];
    const totals = packPeriodTotals(sold, live, 'visible');
    expect(totals.packsSold).toBe(1);
    expect(totals.deferredOutstandingPaise).toBe(345_000);
    expect(totals.itemsOutstanding).toBe(23);
  });

  it('excludes an expired pack from what we still owe', () => {
    // Its balance was recognised as breakage. Counting it would owe the food twice.
    const expired = pack({ status: 'expired', valuedRemaining: 0, deferredPaise: 0 });
    const totals = packPeriodTotals([], [expired], 'visible');
    expect(totals.deferredOutstandingPaise).toBe(0);
  });

  it('carries visibility through, so the screen can tell zero from blind', () => {
    /*
     * `meal_pack_money` is `security_invoker` and `meal_pack` has only `meal_pack_read_own`, so a
     * back-office account reads NOTHING and naive aggregation renders a confident ₹0 deferred.
     * `E21-63` is the same finding: refuse to say "0" when the truth is "we can't see".
     */
    const blind = packPeriodTotals([], [], 'blind');
    expect(blind.visibility).toBe('blind');
    expect(blind.deferredOutstandingPaise).toBe(0);

    const empty = packPeriodTotals([], [], 'visible');
    expect(empty.visibility).toBe('visible');
  });
});

describe('soldBetween', () => {
  it('includes both ends of the range', () => {
    const packs = [
      pack({ mealPackId: 'a', purchasedAt: '2026-09-01T00:00:00Z' }),
      pack({ mealPackId: 'b', purchasedAt: '2026-09-30T23:59:00Z' }),
      pack({ mealPackId: 'c', purchasedAt: '2026-10-01T00:00:00Z' }),
    ];
    expect(soldBetween(packs, '2026-09-01', '2026-09-30').map((p) => p.mealPackId))
      .toEqual(['a', 'b']);
  });
});
