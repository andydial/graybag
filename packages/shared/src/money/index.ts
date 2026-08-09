/**
 * Money rendering. Integer paise in, display string out (non-negotiable #3).
 *
 * Arithmetic does not live here — GST is `E07`'s, computed from the order line, and the cart
 * subtotal is a sum in `cart/`. This module only turns a number into something a person reads.
 */

export { RUPEE, formatPaise } from './format.js';
