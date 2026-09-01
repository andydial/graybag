import { describe, expect, it } from 'vitest';

import {
  CartQuantityError,
  addToCart,
  cartItemCount,
  cartServiceDates,
  cartSubtotalPaise,
  emptyCart,
  lineKey,
  moveCartToDate,
  removeLine,
  setLineComment,
  setLineQuantity,
} from './cart.js';
import type { CartLineInput } from './types.js';

const IDLI: CartLineInput = {
  recipientId: 'r-1',
  serviceDate: '2026-08-10',
  menuItemId: 'mi-1',
  dishId: 'd-1',
  dishName: 'Idli Sambar',
  unitPricePaise: 6000,
  quantity: 1,
  comment: null,
};

const DOSA: CartLineInput = {
  ...IDLI,
  menuItemId: 'mi-2',
  dishId: 'd-2',
  dishName: 'Masala Dosa',
  unitPricePaise: 9000,
};

describe('adding', () => {
  it('adds a line to an empty cart', () => {
    const cart = addToCart(emptyCart(), IDLI);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ dishName: 'Idli Sambar', quantity: 1 });
  });

  it('merges an identical line by summing quantity rather than appending', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), { ...IDLI, quantity: 2 });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(3);
  });

  it('keeps two different dishes as two lines', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), DOSA);
    expect(cart.lines).toHaveLength(2);
  });

  // The same dish for two children is two lines, because they are two deliveries.
  it('keeps the same dish for a different recipient as its own line', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), { ...IDLI, recipientId: 'r-2' });
    expect(cart.lines).toHaveLength(2);
  });

  it('keeps the same dish on a different service date as its own line', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), { ...IDLI, serviceDate: '2026-08-11' });
    expect(cart.lines).toHaveLength(2);
  });

  // A comment is per line, so two different comments are two different things to make.
  it('keeps the same dish with a different comment as its own line', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), { ...IDLI, comment: 'no chutney' });
    expect(cart.lines).toHaveLength(2);
  });

  it('treats blank and whitespace-only comments as no comment at all', () => {
    const cart = addToCart(addToCart(emptyCart(), { ...IDLI, comment: '   ' }), {
      ...IDLI,
      comment: '',
    });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.comment).toBeNull();
    expect(cart.lines[0]?.quantity).toBe(2);
  });

  it('trims a comment before storing it, so "  no chutney " and "no chutney" are one line', () => {
    const cart = addToCart(addToCart(emptyCart(), { ...IDLI, comment: '  no chutney ' }), {
      ...IDLI,
      comment: 'no chutney',
    });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.comment).toBe('no chutney');
  });

  // L7: the server never charges an amount the app did not display. The cart carries the
  // price it showed, and when the shown price changes the newest one wins — the cart screen
  // renders one price per line, so holding a stale one would display a number nobody agreed
  // to and hand it to checkout as evidence.
  it('adopts the most recently displayed price when merging', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), { ...IDLI, unitPricePaise: 6500 });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.unitPricePaise).toBe(6500);
  });

  it('does not mutate the cart it was given', () => {
    const before = emptyCart();
    addToCart(before, IDLI);
    expect(before.lines).toHaveLength(0);
  });
});

describe('quantity', () => {
  it('sets a line quantity', () => {
    const cart = setLineQuantity(addToCart(emptyCart(), IDLI), lineKey(IDLI), 4);
    expect(cart.lines[0]?.quantity).toBe(4);
  });

  // Setting zero is how the cart screen's stepper removes a line, so it must not leave a
  // zero-quantity line behind to be sent to checkout.
  it('removes the line when quantity is set to zero', () => {
    const cart = setLineQuantity(addToCart(emptyCart(), IDLI), lineKey(IDLI), 0);
    expect(cart.lines).toHaveLength(0);
  });

  it('refuses a negative quantity', () => {
    const cart = addToCart(emptyCart(), IDLI);
    expect(() => setLineQuantity(cart, lineKey(IDLI), -1)).toThrow(CartQuantityError);
  });

  // Money is integer paise (non-negotiable #3) and a fractional quantity is the fastest way
  // to a fractional total.
  it('refuses a fractional quantity', () => {
    const cart = addToCart(emptyCart(), IDLI);
    expect(() => setLineQuantity(cart, lineKey(IDLI), 1.5)).toThrow(CartQuantityError);
  });

  it('refuses to add a line with a quantity below one', () => {
    expect(() => addToCart(emptyCart(), { ...IDLI, quantity: 0 })).toThrow(CartQuantityError);
  });

  it('ignores a quantity change for a line that is not in the cart', () => {
    const cart = setLineQuantity(addToCart(emptyCart(), IDLI), lineKey(DOSA), 9);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(1);
  });

  it('removes a line by key', () => {
    const cart = removeLine(addToCart(addToCart(emptyCart(), IDLI), DOSA), lineKey(IDLI));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.dishName).toBe('Masala Dosa');
  });
});

describe('comments', () => {
  it('sets a comment on an existing line', () => {
    const cart = setLineComment(addToCart(emptyCart(), IDLI), lineKey(IDLI), 'less spicy');
    expect(cart.lines[0]?.comment).toBe('less spicy');
  });

  // A comment is part of what makes a line distinct, so editing one into an existing line's
  // comment has to merge rather than leave two lines the checkout would treat as duplicates.
  it('merges into the existing line when a comment edit collides with one', () => {
    let cart = addToCart(emptyCart(), IDLI);
    cart = addToCart(cart, { ...IDLI, comment: 'less spicy', quantity: 2 });
    cart = setLineComment(cart, lineKey(IDLI), 'less spicy');

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe(3);
    expect(cart.lines[0]?.comment).toBe('less spicy');
  });
});

describe('totals', () => {
  it('is empty and free to begin with', () => {
    expect(cartSubtotalPaise(emptyCart())).toBe(0);
    expect(cartItemCount(emptyCart())).toBe(0);
  });

  it('sums quantity times unit price across lines, in whole paise', () => {
    const cart = addToCart(addToCart(emptyCart(), { ...IDLI, quantity: 3 }), DOSA);
    expect(cartSubtotalPaise(cart)).toBe(3 * 6000 + 9000);
    expect(Number.isInteger(cartSubtotalPaise(cart))).toBe(true);
  });

  // The badge counts items, not lines (M06 shows "3" for three idlis on one line).
  it('counts total quantity rather than number of lines', () => {
    const cart = addToCart(addToCart(emptyCart(), { ...IDLI, quantity: 3 }), DOSA);
    expect(cartItemCount(cart)).toBe(4);
  });

  // The subtotal is GST-exclusive (SC2). Nothing here computes tax — E07 does, from the
  // order line, and a helpful `cartTotalPaise` that added 5% would be a second implementation
  // of the tax rule living in the client.
  it('does not add tax to the subtotal', () => {
    const cart = addToCart(emptyCart(), IDLI);
    expect(cartSubtotalPaise(cart)).toBe(6000);
  });
});

describe('service dates', () => {
  // C7: a cart spanning several service dates needs every one of them open at checkout, and
  // the binding constraint is the earliest. Checkout asks the cart which dates it covers.
  it('lists the distinct service dates in ascending order', () => {
    let cart = addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-12' });
    cart = addToCart(cart, { ...IDLI, serviceDate: '2026-08-10' });
    cart = addToCart(cart, { ...DOSA, serviceDate: '2026-08-12' });

    expect(cartServiceDates(cart)).toEqual(['2026-08-10', '2026-08-12']);
  });

  it('has no dates when empty', () => {
    expect(cartServiceDates(emptyCart())).toEqual([]);
  });
});

/**
 * `E05-52`. Moving the cart to another delivery day.
 *
 * The merge is the whole risk. `serviceDate` is part of `lineKey`, so re-dating changes a line's
 * identity — and the failure mode is silent: a parent moves everything to Thursday and finds
 * fewer portions than they put in, with nothing on screen to say so. Andy: *"that's the case that
 * silently loses someone's food."*
 */
describe('moveCartToDate', () => {
  it('moves every line to the new day', () => {
    const cart = addToCart(addToCart(emptyCart(), IDLI), DOSA);
    const moved = moveCartToDate(cart, '2026-08-12');
    expect(moved.lines.map((l) => l.serviceDate)).toEqual(['2026-08-12', '2026-08-12']);
  });

  it('re-keys the lines, because the date is part of their identity', () => {
    const cart = addToCart(emptyCart(), IDLI);
    const moved = moveCartToDate(cart, '2026-08-12');
    expect(moved.lines[0]?.key).toBe(lineKey({ ...IDLI, serviceDate: '2026-08-12' }));
    expect(moved.lines[0]?.key).not.toBe(cart.lines[0]?.key);
  });

  it('COLLAPSES two lines that differed only by date into one', () => {
    const cart = addToCart(
      addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10' }),
      { ...IDLI, serviceDate: '2026-08-11' },
    );
    expect(cart.lines).toHaveLength(2);

    const moved = moveCartToDate(cart, '2026-08-11');
    expect(moved.lines).toHaveLength(1);
  });

  it('MOVES QUANTITIES TOGETHER RATHER THAN OVER EACH OTHER', () => {
    // The one that loses food. 2 on Wednesday + 3 on Thursday, all moved to Thursday, is 5 —
    // never 3, and never 2. Overwriting is the silent version of this bug.
    const cart = addToCart(
      addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10', quantity: 2 }),
      { ...IDLI, serviceDate: '2026-08-11', quantity: 3 },
    );
    const moved = moveCartToDate(cart, '2026-08-11');
    expect(moved.lines).toHaveLength(1);
    expect(moved.lines[0]?.quantity).toBe(5);
  });

  it('keeps the total item count whole across a collapsing move', () => {
    // Asserted separately from the quantity above, because a future change could fix one line's
    // quantity and still drop a line — and the count is what a parent actually sees on the badge.
    const cart = addToCart(
      addToCart(
        addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10', quantity: 2 }),
        { ...IDLI, serviceDate: '2026-08-11', quantity: 3 },
      ),
      { ...DOSA, serviceDate: '2026-08-10', quantity: 1 },
    );
    expect(cartItemCount(cart)).toBe(6);
    expect(cartItemCount(moveCartToDate(cart, '2026-08-11'))).toBe(6);
  });

  it('keeps the subtotal whole across a collapsing move', () => {
    const cart = addToCart(
      addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10', quantity: 2 }),
      { ...IDLI, serviceDate: '2026-08-11', quantity: 3 },
    );
    const before = cartSubtotalPaise(cart);
    expect(cartSubtotalPaise(moveCartToDate(cart, '2026-08-11'))).toBe(before);
  });

  it('does not merge lines that differ by more than the date', () => {
    // Two different dishes on two different days are still two lines afterwards. A merge that was
    // too eager would be the same lost-food bug from the other direction.
    const cart = addToCart(
      addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10' }),
      { ...DOSA, serviceDate: '2026-08-11' },
    );
    expect(moveCartToDate(cart, '2026-08-12').lines).toHaveLength(2);
  });

  it('does not merge lines that differ by comment', () => {
    // The comment is part of the key on purpose: "no chilli" is a different thing to hand over.
    const cart = addToCart(
      addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10', comment: 'no chilli' }),
      { ...IDLI, serviceDate: '2026-08-11', comment: null },
    );
    expect(moveCartToDate(cart, '2026-08-11').lines).toHaveLength(2);
  });

  it('takes the LAST line’s price on collapse, as addToCart does', () => {
    // The cart renders one row per key. Keeping the older price would show a number the parent
    // never saw and then hand it to checkout as the L7 comparison value.
    const cart = addToCart(
      addToCart(emptyCart(), { ...IDLI, serviceDate: '2026-08-10', unitPricePaise: 6000 }),
      { ...IDLI, serviceDate: '2026-08-11', unitPricePaise: 6500 },
    );
    expect(moveCartToDate(cart, '2026-08-11').lines[0]?.unitPricePaise).toBe(6500);
  });

  it('returns the SAME cart when every line is already on that day', () => {
    // Identity, not just equality: the connector calls this whenever the calendar resolves, and a
    // fresh object every render is a re-render loop.
    const cart = addToCart(emptyCart(), IDLI);
    // The literal rather than `IDLI.serviceDate`: the input type allows null, and a test that
    // has to widen its own fixture to compile is a test about the fixture.
    expect(moveCartToDate(cart, '2026-08-10')).toBe(cart);
  });

  it('leaves an empty cart alone', () => {
    const cart = emptyCart();
    expect(moveCartToDate(cart, '2026-08-12')).toBe(cart);
  });
});
