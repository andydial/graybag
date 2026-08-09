import { describe, expect, it } from 'vitest';

import { RUPEE, formatPaise } from './format.js';

describe('formatPaise', () => {
  it('renders whole rupees with two decimal places', () => {
    expect(formatPaise(6000)).toBe('₹60.00');
  });

  it('renders paise that are not a whole rupee', () => {
    expect(formatPaise(4995)).toBe('₹49.95');
  });

  it('renders zero', () => {
    expect(formatPaise(0)).toBe('₹0.00');
  });

  it('pads a single paisa to two decimal places', () => {
    expect(formatPaise(1)).toBe('₹0.01');
  });

  // Indian digit grouping: the last three digits, then pairs. 119900 paise is ₹1,199.00 —
  // and a lakh is where a naive thousands-grouping formatter gets it wrong.
  it('groups thousands', () => {
    expect(formatPaise(119900)).toBe('₹1,199.00');
  });

  it('groups a lakh the Indian way, not the western way', () => {
    expect(formatPaise(10000000)).toBe('₹1,00,000.00');
  });

  it('groups a crore the Indian way', () => {
    expect(formatPaise(1000000000)).toBe('₹1,00,00,000.00');
  });

  // A refund line or a ledger entry is legitimately negative; the sign goes before the
  // symbol, because "₹-60.00" reads as a typo.
  it('puts the minus sign before the symbol', () => {
    expect(formatPaise(-6000)).toBe('-₹60.00');
  });

  // Non-negotiable #3. A float that reached here means paise were computed with `/` or `*`
  // somewhere upstream, and rendering it would hide the bug behind a plausible string.
  it('refuses a fractional paise value', () => {
    expect(() => formatPaise(60.5)).toThrow(/integer paise/i);
  });

  it('refuses a value that is not a number', () => {
    expect(() => formatPaise(Number.NaN)).toThrow(/integer paise/i);
  });

  it('exports the symbol so no component hand-assembles one', () => {
    expect(RUPEE).toBe('₹');
  });
});
