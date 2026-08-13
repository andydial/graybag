import { describe, expect, it } from 'vitest';

import {
  ALLOWED_NOTE_KEYS,
  buildOrderRequest,
  disallowedNoteKeys,
} from '../../../../supabase/functions/_shared/razorpay-payload.js';

/**
 * `E06-25`. Non-negotiable #4 — a child's name, class, section or allergen must never reach a
 * payment processor.
 *
 * **The sentinel test is the one that matters.** A redaction guard that has never been shown to
 * catch the thing it exists for is a guard nobody should trust, so the central test here takes
 * the realistic bad payload — the one a tutorial would write, with the child's name in `notes`
 * because it is genuinely useful for support — and proves it is refused.
 *
 * Razorpay is not a sub-processor we can instruct to forget. Anything that reaches their
 * dashboard is beyond the reach of any erasure request we ever honour, which is why this is
 * checked at the send and not only reviewed.
 */
const REAL_ORDER = {
  amountPaise: 21_000,
  currency: 'INR',
  orderGroupId: '11111111-2222-3333-4444-555555555555',
  correlationId: '99999999-8888-7777-6666-555555555555',
  attemptNo: 1,
  appEnv: 'staging',
};

describe('buildOrderRequest', () => {
  it('carries only the four allowed note keys', () => {
    const request = buildOrderRequest(REAL_ORDER);
    expect(Object.keys(request.notes).sort()).toEqual([...ALLOWED_NOTE_KEYS].sort());
    expect(disallowedNoteKeys(request.notes)).toEqual([]);
  });

  it('sends paise as the integer we already hold, with no conversion', () => {
    // Razorpay takes the smallest currency unit, which for INR is paise. A `* 100` anywhere in
    // this path charges a hundred times the price, and the shape of that bug is a number that
    // looks plausible in a dashboard.
    expect(buildOrderRequest(REAL_ORDER).amount).toBe(21_000);
    expect(Number.isInteger(buildOrderRequest(REAL_ORDER).amount)).toBe(true);
  });

  it('uses the correlation id as the receipt, not the customer-facing order ref', () => {
    // Razorpay caps `receipt` at 40 characters and a uuid is 36. The order ref is printed on an
    // invoice and shown to a parent; the correlation id is the internal thread (§13.6).
    const request = buildOrderRequest(REAL_ORDER);
    expect(request.receipt).toBe(REAL_ORDER.correlationId);
    expect(request.receipt.length).toBeLessThanOrEqual(40);
  });

  it('stringifies every note value, because Razorpay returns them as strings', () => {
    // A number sent as a number comes back as a string, which makes a reconciliation comparison
    // silently type-dependent.
    for (const value of Object.values(buildOrderRequest(REAL_ORDER).notes)) {
      expect(typeof value).toBe('string');
    }
  });

  it('says which environment produced the payment', () => {
    // A test payment in a live dashboard, or the reverse, should be visible at a glance rather
    // than reconstructed from timestamps.
    expect(buildOrderRequest({ ...REAL_ORDER, appEnv: 'production' }).notes.app_env).toBe('production');
  });
});

describe('disallowedNoteKeys — the sentinel', () => {
  /**
   * The payload a reasonable person writes. Every field here is *useful*: a support agent would
   * genuinely rather see "Aarav Sharma, class 5-B, no peanuts" than a uuid. That is precisely
   * why the rule has to be mechanical — the tempting version and the illegal version are the
   * same object.
   */
  const THE_PAYLOAD_THAT_MUST_NEVER_SEND = {
    order_group_id: REAL_ORDER.orderGroupId,
    correlation_id: REAL_ORDER.correlationId,
    child_name: 'Aarav Sharma',
    class: '5',
    section: 'B',
    allergens: 'peanuts, dairy',
    dish: 'Paneer wrap',
    school: 'Alpha Public School',
    service_date: '2026-08-13',
    customer_vpa: 'aarav@okhdfcbank',
  };

  it('refuses the exact payload this guard exists to catch', () => {
    const offenders = disallowedNoteKeys(THE_PAYLOAD_THAT_MUST_NEVER_SEND);
    expect(offenders.length).toBeGreaterThan(0);
    // Named individually, so a partial fix cannot pass by removing only the obvious one.
    for (const key of ['child_name', 'class', 'section', 'allergens', 'dish', 'school', 'customer_vpa']) {
      expect(offenders).toContain(key);
    }
  });

  it('catches service_date and school, which are not names and are still identifying', () => {
    // The rule is not "no names". A school plus a service date plus a class narrows a purchase
    // to a handful of children, and to exactly one if any of them is the only one with an order.
    expect(disallowedNoteKeys({ school: 'Alpha', service_date: '2026-08-13' })).toEqual([
      'school',
      'service_date',
    ]);
  });

  it('catches a VPA or a card PAN, which are the customer’s and not ours to echo', () => {
    expect(disallowedNoteKeys({ vpa: 'a@okaxis', card_pan: '4111111111111111' })).toEqual([
      'vpa',
      'card_pan',
    ]);
  });

  it('passes a payload that carries only ids', () => {
    // The guard has to be usable, or it gets bypassed. This is the honest positive case.
    expect(disallowedNoteKeys(buildOrderRequest(REAL_ORDER).notes)).toEqual([]);
  });

  it('is an allow-list, so a field invented tomorrow is refused by default', () => {
    // The property that makes this survive the product growing: not "these are forbidden", but
    // "only these are permitted". A deny-list is a list of the mistakes already thought of.
    expect(disallowedNoteKeys({ some_field_nobody_has_written_yet: 'x' })).toEqual([
      'some_field_nobody_has_written_yet',
    ]);
  });
});
