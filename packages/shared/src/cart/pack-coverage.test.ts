/**
 * `pack-coverage.ts` — the cart's display arithmetic. `E21-74`.
 *
 * The worked example throughout is Andy's own: a ₹250 main and a ₹40 drink, a pack with one item
 * left. Under `P23` — cheapest first, his ruling against my recommendation — the pack covers the
 * DRINK and the parent pays ₹262.50. Those numbers appear in the design document and in the
 * migration; this is where they are actually checked.
 */
import { describe, expect, it } from 'vitest';

import { gstBreakdown } from '../money/gst.js';
import { cashBreakdown, coverCart } from './pack-coverage.js';
import type { CartLine } from './types.js';

const line = (over: Partial<CartLine> & { key: string; unitPricePaise: number }): CartLine => ({
  recipientId: null,
  serviceDate: null,
  menuItemId: 'mi-1',
  dishId: 'd-1',
  dishName: 'Dish',
  quantity: 1,
  comment: null,
  ...over,
});

describe('coverCart', () => {
  it('covers nothing when the parent has no spendable items', () => {
    const c = coverCart([line({ key: 'a', unitPricePaise: 25_000 })], 0);
    expect(c.itemsCovered).toBe(0);
    expect(c.covered).toEqual([]);
    expect(c.isPartial).toBe(false);
    // The cash total must still be right — a parent with no pack sees this path on every cart.
    expect(c.cashSubtotalPaise).toBe(25_000);
    expect(c.cashDuePaise).toBe(25_000 + 625 + 625);
  });

  it("covers the CHEAPEST line first — P23, Andy's worked example", () => {
    const c = coverCart(
      [
        line({ key: 'main', unitPricePaise: 25_000, dishName: 'Butter chicken & rice' }),
        line({ key: 'drink', unitPricePaise: 4_000, dishName: 'Fresh lime soda' }),
      ],
      1,
    );

    expect(c.covered).toHaveLength(1);
    expect(c.covered[0]?.dishName).toBe('Fresh lime soda');
    expect(c.coveredSubtotalPaise).toBe(4_000);

    // ₹250 taxable, CGST ₹6.25 + SGST ₹6.25, total ₹262.50 — to the paise.
    expect(c.cashSubtotalPaise).toBe(25_000);
    expect(c.cashCgstPaise).toBe(625);
    expect(c.cashSgstPaise).toBe(625);
    expect(c.cashDuePaise).toBe(26_250);
    expect(c.isPartial).toBe(true);
  });

  it('covers the whole cart when the pack can, and then nothing is due', () => {
    const c = coverCart(
      [line({ key: 'a', unitPricePaise: 4_000 }), line({ key: 'b', unitPricePaise: 25_000 })],
      2,
    );
    expect(c.itemsCovered).toBe(2);
    expect(c.cashDuePaise).toBe(0);
    // Covering everything is NOT "partial" — there is a different, simpler sentence to say, and
    // the checkout takes a different path: no payment, confirmed immediately.
    expect(c.isPartial).toBe(false);
  });

  it('splits exactly one line — the one where the pack runs out', () => {
    // Three drinks on one line, two items left. Two covered, one cash.
    const c = coverCart([line({ key: 'drink', unitPricePaise: 4_000, quantity: 3 })], 2);
    expect(c.covered).toHaveLength(1);
    expect(c.covered[0]?.coveredQuantity).toBe(2);
    expect(c.covered[0]?.cashQuantity).toBe(1);
    expect(c.coveredSubtotalPaise).toBe(8_000);
    expect(c.cashSubtotalPaise).toBe(4_000);
    expect(c.cashDuePaise).toBe(4_000 + 100 + 100);
  });

  it('takes whole lines before splitting one', () => {
    // Cheapest first means the ₹40 line goes entirely before the ₹250 line is touched at all.
    const c = coverCart(
      [
        line({ key: 'main', unitPricePaise: 25_000, quantity: 2 }),
        line({ key: 'drink', unitPricePaise: 4_000, quantity: 2 }),
      ],
      3,
    );
    const drink = c.covered.find((l) => l.key === 'drink');
    const main = c.covered.find((l) => l.key === 'main');
    expect(drink?.coveredQuantity).toBe(2);
    expect(main?.coveredQuantity).toBe(1);
    expect(c.itemsCovered).toBe(3);
  });

  it('is deterministic when two lines cost the same', () => {
    // Ties break on the stable key, so the same cart always produces the same answer — and the
    // server breaks its tie on line_no, assigned in the same order.
    const a = coverCart(
      [line({ key: 'aaa', unitPricePaise: 4_000 }), line({ key: 'bbb', unitPricePaise: 4_000 })],
      1,
    );
    const b = coverCart(
      [line({ key: 'bbb', unitPricePaise: 4_000 }), line({ key: 'aaa', unitPricePaise: 4_000 })],
      1,
    );
    expect(a.covered[0]?.key).toBe('aaa');
    expect(b.covered[0]?.key).toBe('aaa');
  });

  it('never covers more than the cart holds', () => {
    const c = coverCart([line({ key: 'a', unitPricePaise: 4_000, quantity: 1 })], 20);
    expect(c.itemsCovered).toBe(1);
    expect(c.cashDuePaise).toBe(0);
  });

  it('taxes per line, per component — never 5% of a total', () => {
    // The half-paise boundary from docs/gst-invoicing.md §6.2. Two lines of ₹95.00 and ₹75.00 tax
    // one paise higher per line than the subtotal would, and the invoice is the sum of its lines.
    const c = coverCart(
      [line({ key: 'a', unitPricePaise: 9_500 }), line({ key: 'b', unitPricePaise: 7_500 })],
      0,
    );
    // halfUp(9500 * 250, 10000) = 238 (237.5 rounds up); halfUp(7500 * 250, 10000) = 188.
    expect(c.cashCgstPaise).toBe(238 + 188);
    expect(c.cashSgstPaise).toBe(238 + 188);
    // Taxing the ₹170 subtotal instead would give 425, one paise lower. That difference is the
    // whole reason the rule is written down.
    expect(c.cashCgstPaise).not.toBe(425);
  });
});

/**
 * `cashBreakdown` — one expression for the payable. `E21-97`.
 *
 * The cart had two. `coverCart` fed the redemption strip, `gstBreakdown(cart.lines)` fed the
 * summary and the button, and on a fully covered cart they said "Nothing to pay" and "₹260.42" on
 * the same screen. The order could not be placed at all: `L7` compares the displayed figure
 * against the server's and refused — `pack coverage changed: expected 26042, server says 0`.
 *
 * The property below is what makes the substitution safe for the ordering path that is carrying
 * real orders right now, and it is the assertion worth having: **for a parent with no pack, the
 * new expression must equal the old one exactly.** Not to the rupee — to the paise. A single
 * paise of disagreement is not a rounding nicety here, it is every checkout failing with
 * `price_changed`, because `L7` compares integers.
 */
describe('cashBreakdown is the one expression for what the parent pays', () => {
  const CART = [
    line({ key: 'a', unitPricePaise: 6900, quantity: 3 }),
    line({ key: 'b', unitPricePaise: 25_000 }),
    line({ key: 'c', unitPricePaise: 4000, quantity: 2 }),
    // 33 paise is deliberate: ×7 it lands on a half-paise boundary in both components, which is
    // where per-line half-up and any other rounding disagree.
    line({ key: 'd', unitPricePaise: 33, quantity: 7 }),
  ];

  it('EQUALS gstBreakdown to the paise when no pack is involved', () => {
    expect(cashBreakdown(coverCart(CART, 0))).toEqual(gstBreakdown(CART));
  });

  it('equals it for every sub-cart, not just the one that happened to be picked', () => {
    // A single example can agree by luck. Every prefix of the cart exercises a different mix of
    // quantities and rounding boundaries against the same two implementations.
    for (let n = 1; n <= CART.length; n += 1) {
      const some = CART.slice(0, n);
      expect(cashBreakdown(coverCart(some, 0))).toEqual(gstBreakdown(some));
    }
  });

  it('is ZERO in every component when the pack covers the whole cart', () => {
    const items = CART.reduce((t, l) => t + l.quantity, 0);
    expect(cashBreakdown(coverCart(CART, items))).toEqual({
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 0,
    });
  });

  it('taxes only the cash half, never the covered items — Andy’s own worked example', () => {
    // A ₹250 main and a ₹40 drink, one item of pack. `P23`: the pack takes the DRINK, and the
    // parent pays ₹262.50 — ₹250 plus 5%. The covered item is not a taxable supply here at all.
    const andy = [
      line({ key: 'main', unitPricePaise: 25_000 }),
      line({ key: 'drink', unitPricePaise: 4000 }),
    ];
    expect(cashBreakdown(coverCart(andy, 1))).toEqual({
      taxablePaise: 25_000,
      cgstPaise: 625,
      sgstPaise: 625,
      totalPaise: 26_250,
    });
  });

  it('never returns a non-integer — no float reaches a payable (non-negotiable #3)', () => {
    for (let spend = 0; spend <= 8; spend += 1) {
      const b = cashBreakdown(coverCart(CART, spend));
      for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
    }
  });
});
