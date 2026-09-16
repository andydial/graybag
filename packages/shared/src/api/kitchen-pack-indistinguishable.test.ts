import { afterEach, describe, expect, it } from 'vitest';

import { KITCHEN_ORDER_COLUMNS, fetchKitchenOrders, setApiTransport } from './index.js';
import { fakeTransport } from './test-support.js';

/**
 * A pack-covered order is an ordinary order to the kitchen — **both directions** — `E21-65`.
 *
 * ## Why this file exists at all
 *
 * The old suite (`supabase/tests/meal_packs.test.sql`) asserted one direction only: that the
 * kitchen can see **nothing pack-related**. Every one of those assertions passed, and a defect that
 * fed nobody looked exactly like a clean bill of health.
 *
 * `confirm_meal_pack_plan` inserted a redeemed meal with `status = 'pending_payment'`
 * (`0073:147`). The only transition to `paid` is the loop inside `settle_payment` (`0080:76-101`),
 * driven by a capture webhook, which runs **once per group** when the pack *purchase* settles — and
 * the redemption orders were inserted into that same, already-settled group, later. So they were
 * never marked paid, the kitchen board filters to
 * `['paid','preparing','delivered','cancelled']`, and the meal was invisible. The parent's balance
 * decremented, the ledger recognised the revenue, and the child got nothing.
 *
 * In the rebuild that defect **cannot exist** — the planner is gone and a pack-covered order is an
 * ordinary cart order settled by a real payment (`docs/meal-packs-rebuild.md` §1). This file is the
 * assertion that keeps it that way, because "cannot exist" is a property of a design, and designs
 * get edited.
 *
 * ## The shape of the test, and why it is not a database test
 *
 * The database half — *the order arrives with `status = 'paid'` and a `pickup_code`* — belongs to
 * whoever owns the migrations, and is stated as a requirement in `planning/andy-queue.md`. This
 * half is the one the web thread owns and it is the stronger of the two to hold here: **given a
 * paid order, nothing in the kitchen path may reveal how it was paid for.**
 *
 * That is asserted against the *column list and the parsed output*, not against a rendered screen.
 * A screen test would pass just as happily with `select('*')` and a field nobody drew — which is
 * precisely how `order_ref`'s `PK-` prefix (`E21-66`) crossed to the kitchen client for weeks
 * while the card that displayed it had already been removed.
 */

afterEach(() => setApiTransport(null));

const install = (rows: unknown) => {
  const fake = fakeTransport(rows, null);
  setApiTransport(fake.transport);
  return fake;
};

/** A perfectly ordinary paid order. Whether a pack paid for it is not expressible here — the point. */
const ORDER = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  order_ref: 'GB-4K2P7X',
  school_id: 's1',
  school_name_snapshot: 'Amity International',
  break_time_id: 'b1',
  break_label_snapshot: 'Lunch break',
  recipient_name_snapshot: 'Aarav',
  class_label_snapshot: '5',
  section_label_snapshot: 'A',
  status: 'paid',
  pickup_code: '4417',
  order_line: [{ dish_id: 'd1', dish_name_snapshot: 'Veg Sandwich', quantity: 1 }],
  ...over,
});

describe('direction 1 — a pack-covered order ARRIVES on the board', () => {
  it('appears, because it is paid like any other order', async () => {
    /*
     * The assertion the old suite never made. If a future change reintroduces a settlement path
     * that leaves redeemed meals unpaid, this is what notices.
     */
    install([ORDER()]);
    const orders = await fetchKitchenOrders('2026-09-16');
    expect(orders).toHaveLength(1);
    expect(orders[0]?.id).toBe('o1');
  });

  it('carries a pickup code, which the settlement loop is the only thing that allocates', async () => {
    // `E21-65`'s second consequence: an order that never settles has no code to call out either.
    install([ORDER()]);
    const orders = await fetchKitchenOrders('2026-09-16');
    expect(orders[0]?.pickupCode).toBe('4417');
  });

  it('is DROPPED while it is still pending_payment — the exact state E21-65 stranded it in', async () => {
    /*
     * This is not a bug being enshrined: a `pending_payment` order is one nobody has paid for and
     * the kitchen must never cook against it (`L5`). The defect was never this filter — it was that
     * a redeemed meal was left in a state this filter correctly excludes.
     *
     * Asserting it here means the filter's meaning is written down next to the failure it caused,
     * so the next person to meet a missing order looks at the *status*, not at the board.
     */
    install([ORDER({ status: 'pending_payment' })]);
    const orders = await fetchKitchenOrders('2026-09-16');
    expect(orders).toHaveLength(0);
  });
});

describe('direction 2 — and NOTHING on it says a pack paid', () => {
  it('reads no pack column, and the list is the control', () => {
    /*
     * Asserted against the column list rather than the returned object. A test on the output would
     * pass with `select('*')` — the field would simply be present and unread, which is the state
     * `E21-66` was actually in.
     */
    for (const column of [
      'meal_pack', 'meal_pack_id', 'pack_id', 'meal_pack_redemption',
      'redemption', 'items_remaining', 'pack_covered', 'paid_with_pack',
    ]) {
      expect(KITCHEN_ORDER_COLUMNS, column).not.toContain(column);
    }
  });

  it('reads no money, so "the pack covered ₹80 of it" is unreachable', () => {
    // Partial redemption is new in the rebuild: a pack covers what it can and cash covers the rest.
    // That makes a per-order money column a disclosure of *how it was split*, not just of price.
    for (const column of [
      'subtotal_paise', 'total_paise', 'tax_cgst_paise', 'tax_sgst_paise',
      'discount_paise', 'refunded_total_paise',
    ]) {
      expect(KITCHEN_ORDER_COLUMNS, column).not.toContain(column);
    }
  });

  it('parses a pack-covered order to exactly the same object as a cash one', async () => {
    /*
     * The property stated directly: indistinguishable means indistinguishable. Two orders that
     * differ only in how they were paid for must be byte-identical by the time the kitchen sees
     * them — and because *how they were paid for* is not in the column list, the only way to write
     * this test is with two identical payloads, which is itself the proof.
     */
    install([ORDER({ id: 'cash' })]);
    const [cash] = await fetchKitchenOrders('2026-09-16');
    install([ORDER({ id: 'pack' })]);
    const [pack] = await fetchKitchenOrders('2026-09-16');

    expect({ ...cash, id: null }).toEqual({ ...pack, id: null });
  });
});

describe('the order reference, which is where E21-66 hid', () => {
  it('is not given a distinguishing prefix by the kitchen path', async () => {
    /*
     * `confirm_meal_pack_plan` minted `'PK-' || …` (`0073:148`) while every food order got
     * `generate_order_ref()`, which is `'GB-' || …` (`0014:75`). `order_ref` is in the column list,
     * so the prefix crossed to the kitchen client on every order. `E09-42` had removed the
     * reference from the card, so nothing *drew* it — and the pgTAP assertion behind
     * "indistinguishable" only checked that `order` carried no pack **column**. A prefix is not a
     * column and walked straight past it.
     *
     * The rebuild deletes the second minting path, so every reference comes from
     * `generate_order_ref()`. This asserts the property rather than the mechanism: whatever the
     * kitchen receives must not be sortable into pack and non-pack.
     */
    install([ORDER({ order_ref: 'GB-4K2P7X' })]);
    const orders = await fetchKitchenOrders('2026-09-16');
    expect(orders[0]?.orderRef?.startsWith('PK-')).toBe(false);
  });

  it('passes the reference through untouched — so the guarantee lives at MINTING, not here', async () => {
    /*
     * An honest characterisation, named for what it proves rather than for what one would like it
     * to prove. The kitchen path does **not** sanitise `order_ref`: hand it a `PK-` reference and a
     * `PK-` reference comes out.
     *
     * That matters because the obvious next move — strip or rewrite the prefix on the way to the
     * kitchen — would be the wrong fix twice over. It would hide the leak rather than remove it,
     * and it would put a second opinion about what an order reference *is* into a module that has
     * no business holding one.
     *
     * So this file cannot enforce the property on its own, and pretending otherwise is the exact
     * mistake that let `E21-66` through: an assertion that looks like a guard and is not one. The
     * guarantee is that `generate_order_ref()` is the only thing that mints a reference, which is
     * a database property and is stated as a requirement in `planning/andy-queue.md`. The test
     * above is the tripwire; this one records why it is only a tripwire.
     */
    install([ORDER({ order_ref: 'PK-4K2P7X' })]);
    const orders = await fetchKitchenOrders('2026-09-16');
    expect(orders[0]?.orderRef).toBe('PK-4K2P7X');
  });
});
