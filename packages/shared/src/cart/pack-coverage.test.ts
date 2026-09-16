/**
 * `pack-coverage.ts` — the cart's display arithmetic. `E21-74`.
 *
 * The worked example throughout is Andy's own: a ₹250 main and a ₹40 drink, a pack with one item
 * left. Under `P23` — cheapest first, his ruling against my recommendation — the pack covers the
 * DRINK and the parent pays ₹262.50. Those numbers appear in the design document and in the
 * migration; this is where they are actually checked.
 */
import { describe, expect, it } from 'vitest';

import { coverCart } from './pack-coverage.js';
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
