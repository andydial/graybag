import { describe, expect, it } from 'vitest';

import { CGST_RATE_BPS, GstInputError, gstBreakdown, halfUp } from './gst.js';

/**
 * Pinned to `docs/gst-invoicing.md` §6.2. If this file and that document disagree, the document
 * is right and this is the bug — the server computes the amount actually charged, and `L7`
 * aborts a checkout whose total does not match what the app displayed.
 */
describe('halfUp', () => {
  it('is the §6.2 identity, in integers only', () => {
    expect(halfUp(0, 10_000)).toBe(0);
    expect(halfUp(10_000, 10_000)).toBe(1);
  });

  it('rounds a half UP, which is the entire reason the rule is written down', () => {
    // 0.5 -> 1, not 0. Banker's rounding here would under-collect on half the lines.
    expect(halfUp(1, 2)).toBe(1);
    expect(halfUp(3, 2)).toBe(2);
    // ₹95.00 at 2.5% is exactly 237.5 paise.
    expect(halfUp(9500 * CGST_RATE_BPS, 10_000)).toBe(238);
  });

  it('rounds below a half down', () => {
    expect(halfUp(4, 10)).toBe(0);
    expect(halfUp(49, 100)).toBe(0);
  });

  it('refuses non-integers rather than quietly using floats', () => {
    expect(() => halfUp(1.5, 2)).toThrow(GstInputError);
    expect(() => halfUp(1, 0)).toThrow(GstInputError);
    expect(() => halfUp(-1, 2)).toThrow(GstInputError);
  });
});

describe('gstBreakdown', () => {
  it('taxes each line independently and sums — NOT the subtotal', () => {
    // The case that makes the rule matter. ₹95.00 and ₹75.00 each carry an exact half-paise
    // of CGST: 237.5 and 187.5. Rounded per line they become 238 + 188 = 426.
    // Taxing the ₹170.00 subtotal instead gives 425 — one paise adrift from the invoice.
    const lines = [
      { unitPricePaise: 9500, quantity: 1 },
      { unitPricePaise: 7500, quantity: 1 },
    ];

    const result = gstBreakdown(lines);

    expect(result.taxablePaise).toBe(17_000);
    expect(result.cgstPaise).toBe(426);
    expect(result.sgstPaise).toBe(426);
    expect(result.totalPaise).toBe(17_852);

    // Spelled out, so a future "simplification" to subtotal-based tax fails here loudly.
    const subtotalBased = halfUp(17_000 * CGST_RATE_BPS, 10_000);
    expect(subtotalBased).toBe(425);
    expect(result.cgstPaise).not.toBe(subtotalBased);
  });

  it('multiplies before taxing, so quantity does not change the rounding per unit', () => {
    // 2 × ₹95.00 is one line of ₹190.00: 475 paise exactly, no rounding at all.
    const result = gstBreakdown([{ unitPricePaise: 9500, quantity: 2 }]);
    expect(result.taxablePaise).toBe(19_000);
    expect(result.cgstPaise).toBe(475);
    expect(result.totalPaise).toBe(19_950);
  });

  it('splits evenly: CGST always equals SGST at 2.5% + 2.5%', () => {
    const result = gstBreakdown([
      { unitPricePaise: 8500, quantity: 3 },
      { unitPricePaise: 6500, quantity: 1 },
      { unitPricePaise: 12_345, quantity: 2 },
    ]);
    expect(result.cgstPaise).toBe(result.sgstPaise);
    expect(result.totalPaise).toBe(result.taxablePaise + result.cgstPaise + result.sgstPaise);
  });

  it('treats an empty cart as zero, not as an error', () => {
    expect(gstBreakdown([])).toEqual({
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: 0,
    });
  });

  it('never produces a fractional paise', () => {
    for (let price = 1; price <= 500; price += 7) {
      const { cgstPaise, sgstPaise, totalPaise } = gstBreakdown([
        { unitPricePaise: price, quantity: 3 },
      ]);
      expect(Number.isInteger(cgstPaise)).toBe(true);
      expect(Number.isInteger(sgstPaise)).toBe(true);
      expect(Number.isInteger(totalPaise)).toBe(true);
    }
  });

  it('refuses a float price rather than rendering a total nobody can reconcile', () => {
    expect(() => gstBreakdown([{ unitPricePaise: 95.5, quantity: 1 }])).toThrow(GstInputError);
    expect(() => gstBreakdown([{ unitPricePaise: 9500, quantity: 1.5 }])).toThrow(GstInputError);
    expect(() => gstBreakdown([{ unitPricePaise: -1, quantity: 1 }])).toThrow(GstInputError);
  });

  it('names the line by index and never by dish', () => {
    expect(() => gstBreakdown([{ unitPricePaise: 100, quantity: 1 }, { unitPricePaise: -5, quantity: 1 }]))
      .toThrow(/line 1/);
  });
});
