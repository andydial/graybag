/**
 * The cart domain (`E05-04`).
 *
 * **The cart is client-side and has no table.** `0001_initial_schema.sql` has no `cart`, and
 * that is deliberate: a cart is a draft of an intention, it is worthless once the order is
 * written, and a server-side cart would need its own RLS policy, its own sweeper and its own
 * answer to "what happens when the price changes underneath it". The order is the record;
 * the cart is a screen's state that happens to be persisted locally.
 *
 * **Money is integer paise** (non-negotiable #3) and **the subtotal is GST-exclusive** (`SC2`).
 * Nothing in this module computes tax.
 */

import type { ServiceDate } from '../menu/types.js';

/** What a caller supplies to put something in the cart. */
export interface CartLineInput {
  /**
   * **Null until checkout.** `R1`/`AR7`: the cart fills signed out, and the recipient is chosen
   * at the gate — so a line added by someone with no children yet genuinely has no recipient,
   * and saying so is more honest than inventing one.
   *
   * Requiring it here is what put a wall in front of the cart: `DishDetailScreen` could not
   * build a `CartLineInput` without a recipient, so it offered "Add a child" instead of "Add to
   * cart", and a signed-out visitor could not fill a cart at all — which made the one sign-in
   * route in the app unreachable, because that route is the cart's own Place order button.
   */
  recipientId: string | null;
  /** Null until checkout, for the same reason. */
  serviceDate: ServiceDate | null;
  menuItemId: string;
  dishId: string;
  /**
   * Snapshotted for display only. The authoritative name goes onto the order line at
   * checkout (`E05-09`) — this copy exists so the cart screen can render without refetching
   * the menu, and it is not evidence of anything.
   */
  dishName: string;
  /**
   * **The price the app displayed when this was added**, integer paise, GST-exclusive.
   *
   * `L7`: the server never charges an amount the app did not display. Checkout compares this
   * against the price it resolves and aborts on a mismatch rather than silently charging the
   * newer number. So this field is not a convenience — it is the evidence that comparison
   * needs, and the reason the cart carries a price at all rather than just an id.
   */
  unitPricePaise: number;
  /** Must be a whole number of one or more. */
  quantity: number;
  /** Free text from the customer. Trimmed; blank becomes `null`. */
  comment: string | null;
}

export interface CartLine extends CartLineInput {
  /**
   * Derived from the fields that make a line distinct, not random.
   *
   * A stable key means the cart survives being written to storage and read back, and it means
   * "is this already in the cart?" is a lookup rather than a scan with a four-field
   * comparison that some future caller will get one field wrong.
   */
  key: string;
  comment: string | null;
}

export interface Cart {
  lines: CartLine[];
}
