/**
 * Cart operations (`E05-04`).
 *
 * Every function here is pure and returns a new cart. That is what makes the optimistic UI
 * (`E14-08`) honest: the screen applies the change locally and immediately, and if anything
 * later rejects it the previous cart is still sitting there to put back. A mutating reducer
 * would leave nothing to roll back to.
 */

import type { ServiceDate } from '../menu/types.js';
import type { Cart, CartLine, CartLineInput } from './types.js';

/**
 * Raised rather than clamped.
 *
 * Clamping a negative quantity to zero silently deletes a line the customer did not ask to
 * delete; clamping a fractional one silently changes what they are buying. Both are the kind
 * of "helpful" recovery that turns a caller's bug into a customer's surprise.
 */
export class CartQuantityError extends Error {
  constructor(quantity: number) {
    super(`Cart quantity must be a whole number of 1 or more, got ${quantity}`);
    this.name = 'CartQuantityError';
  }
}

export function emptyCart(): Cart {
  return { lines: [] };
}

/** Blank, whitespace-only and absent comments are all the same fact: nothing was said. */
function normaliseComment(comment: string | null | undefined): string | null {
  const trimmed = comment?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The identity of a line: who it is for, when it is for, what it is, and what was asked for.
 *
 * **Price is deliberately not part of the key.** A price change must not split one line into
 * two — the customer sees one row for "3 × Idli Sambar" and a price that changed underneath
 * them does not make it two different things to eat.
 */
export function lineKey(input: Pick<CartLineInput, 'recipientId' | 'serviceDate' | 'menuItemId' | 'comment'>): string {
  return JSON.stringify([
    input.recipientId,
    input.serviceDate,
    input.menuItemId,
    normaliseComment(input.comment),
  ]);
}

function assertQuantity(quantity: number, { allowZero }: { allowZero: boolean }): void {
  const floor = allowZero ? 0 : 1;
  if (!Number.isInteger(quantity) || quantity < floor) throw new CartQuantityError(quantity);
}

/**
 * Add a line, merging into an identical one if the cart already has it.
 *
 * On merge the **most recently displayed price wins**. The cart screen renders one price per
 * line, so keeping the older one would show a number the customer never saw and then hand it
 * to checkout as the `L7` comparison value.
 */
export function addToCart(cart: Cart, input: CartLineInput): Cart {
  assertQuantity(input.quantity, { allowZero: false });

  const comment = normaliseComment(input.comment);
  const key = lineKey({ ...input, comment });
  const existing = cart.lines.find((line) => line.key === key);

  if (!existing) {
    return { lines: [...cart.lines, { ...input, comment, key }] };
  }

  return {
    lines: cart.lines.map((line) =>
      line.key === key
        ? {
            ...line,
            quantity: line.quantity + input.quantity,
            unitPricePaise: input.unitPricePaise,
            dishName: input.dishName,
          }
        : line,
    ),
  };
}

/** Setting zero removes the line — that is how the stepper's last decrement is meant to read. */
export function setLineQuantity(cart: Cart, key: string, quantity: number): Cart {
  assertQuantity(quantity, { allowZero: true });
  if (quantity === 0) return removeLine(cart, key);

  return {
    lines: cart.lines.map((line) => (line.key === key ? { ...line, quantity } : line)),
  };
}

export function removeLine(cart: Cart, key: string): Cart {
  return { lines: cart.lines.filter((line) => line.key !== key) };
}

/**
 * Editing a comment changes the line's identity, so it can collide with a line already in the
 * cart. Merge, rather than leaving two lines that checkout would receive as duplicates for
 * the same child, date and dish.
 */
export function setLineComment(cart: Cart, key: string, comment: string | null): Cart {
  const target = cart.lines.find((line) => line.key === key);
  if (!target) return cart;

  const rest: Cart = { lines: cart.lines.filter((line) => line.key !== key) };
  return addToCart(rest, { ...target, comment });
}

/** Integer paise, GST-exclusive (`SC2`). Tax is `E07`'s, computed from the order line. */
export function cartSubtotalPaise(cart: Cart): number {
  return cart.lines.reduce((total, line) => total + line.unitPricePaise * line.quantity, 0);
}

/** Total items, not lines — `M06`'s badge shows 3 for three idlis on one line. */
export function cartItemCount(cart: Cart): number {
  return cart.lines.reduce((count, line) => count + line.quantity, 0);
}

/**
 * The distinct service dates the cart covers, ascending.
 *
 * `C7`: checkout requires **every** member date to be open and the binding constraint is the
 * earliest, so this is what the cutoff check iterates. Sorted because "the earliest" should
 * be `[0]` rather than another `Math.min` at each call site.
 */
export function cartServiceDates(cart: Cart): ServiceDate[] {
  // A line with no date yet contributes nothing to the cutoff check — there is no date to
  // check. Checkout is where every line acquires one, and where `C7` starts applying.
  const dates = cart.lines
    .map((line) => line.serviceDate)
    .filter((date): date is ServiceDate => date !== null);
  return [...new Set(dates)].sort();
}

export type { Cart, CartLine, CartLineInput };
