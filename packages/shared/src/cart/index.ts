/**
 * The cart domain (`E05-04`).
 *
 * Pure, immutable operations over a cart the caller holds. No fetching, no storage, no
 * Supabase — the same reason `menu/` has none: the app, the preflight endpoint and the
 * checkout transaction must agree about what a cart *is*, and a module that fetched would be
 * usable in only one of them.
 */

export {
  CartQuantityError,
  addToCart,
  cartItemCount,
  cartServiceDates,
  cartSubtotalPaise,
  emptyCart,
  lineKey,
  removeLine,
  setLineComment,
  setLineQuantity,
} from './cart.js';

export type { Cart, CartLine, CartLineInput } from './types.js';
