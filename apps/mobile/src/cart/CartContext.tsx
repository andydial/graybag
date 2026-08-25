import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { track } from '../analytics/analytics';
import { cart as cartDomain } from '@graybag/shared';

/**
 * The cart, as React state (`E05-04`).
 *
 * **All the rules live in `@graybag/shared`'s `cart` module** — what merges with what, how a
 * comment changes a line's identity, what a quantity of zero means. This provider owns only
 * the React part: holding the current cart and swapping it for the next one. The same split
 * as `useCachedMenu`, for the same reason: the rules are the part with teeth and they are
 * tested without a renderer.
 *
 * **The cart is in memory and does not survive a restart.** That is the scope of `E05-04`,
 * not an oversight — persistence needs the injected storage adapter that arrives with the
 * `api/` module, and a half-persisted cart (lines but not the prices they were added at)
 * would be worse than none, because `L7` compares against those prices at checkout.
 *
 * **It holds no session.** `AR7`: the cart fills signed out, and the only gate is at
 * checkout. Nothing here asks who you are.
 */

type CartLineInput = cartDomain.CartLineInput;

interface CartValue {
  cart: cartDomain.Cart;
  add: (input: CartLineInput) => void;
  setQuantity: (key: string, quantity: number) => void;
  setComment: (key: string, comment: string | null) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** Total items, for `M06`'s badge. */
  itemCount: number;
  /** Integer paise, GST-exclusive (`SC2`). Tax is added at checkout, never here. */
  subtotalPaise: number;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({
  children,
  initial = cartDomain.emptyCart(),
}: {
  children: ReactNode;
  initial?: cartDomain.Cart;
}) {
  const [cart, setCart] = useState<cartDomain.Cart>(initial);

  /**
   * Every mutation is a `setCart` with a pure function of the previous cart, so the update is
   * applied on the tap's own render — that is what makes the UI optimistic without any
   * request being in flight to be optimistic *about*. There is nothing to reconcile until
   * checkout, which is the point of keeping the cart client-side.
   *
   * A rejected quantity is swallowed rather than thrown. The stepper cannot produce one, but
   * losing a part-built order to an exception from a caller's bug is a worse outcome than
   * ignoring the tap, and `CartQuantityError` exists so the domain still refuses to guess.
   */
  const guarded = useCallback((next: (current: cartDomain.Cart) => cartDomain.Cart) => {
    setCart((current) => {
      try {
        return next(current);
      } catch (error) {
        if (error instanceof cartDomain.CartQuantityError) return current;
        throw error;
      }
    });
  }, []);

  const add = useCallback(
    (input: CartLineInput) =>
      guarded((current) => {
        const next = cartDomain.addToCart(current, input);
        /**
         * `E15-20`. **Once per cart, not once per tap.** `cart_started` marks the funnel step
         * "this parent began building an order"; firing it on every add would make the step
         * meaningless and is the one event here that could run away on volume.
         *
         * No dish and no child — `docs/posthog.md` §3. Which dishes a *specific* child eats is
         * exactly the profile s.9(3) forbids building.
         */
        if (current.lines.length === 0 && next.lines.length > 0) {
          track('cart_started', { line_count: next.lines.length });
        }
        return next;
      }),
    [guarded],
  );

  const setQuantity = useCallback(
    (key: string, quantity: number) =>
      guarded((current) => cartDomain.setLineQuantity(current, key, quantity)),
    [guarded],
  );

  const setComment = useCallback(
    (key: string, comment: string | null) =>
      guarded((current) => cartDomain.setLineComment(current, key, comment)),
    [guarded],
  );

  const remove = useCallback(
    (key: string) => guarded((current) => cartDomain.removeLine(current, key)),
    [guarded],
  );

  const clear = useCallback(() => setCart(cartDomain.emptyCart()), []);

  const value = useMemo<CartValue>(
    () => ({
      cart,
      add,
      setQuantity,
      setComment,
      remove,
      clear,
      itemCount: cartDomain.cartItemCount(cart),
      subtotalPaise: cartDomain.cartSubtotalPaise(cart),
    }),
    [cart, add, setQuantity, setComment, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * Throws when there is no provider, rather than returning an empty cart.
 *
 * A default empty cart would let a screen be mounted outside the provider and appear to
 * work — adds would go nowhere and the badge would stay at zero, which reads as "the button
 * is broken" and is found by a person rather than by a test.
 */
export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside a CartProvider');
  return value;
}
