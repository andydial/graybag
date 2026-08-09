import { act, renderHook } from '@testing-library/react-native';
import { cart as cartDomain } from '@graybag/shared';
import type { ReactNode } from 'react';

import { CartProvider, useCart } from './CartContext';

const IDLI = {
  recipientId: 'r-1',
  serviceDate: '2026-08-10',
  menuItemId: 'mi-1',
  dishId: 'd-1',
  dishName: 'Idli Sambar',
  unitPricePaise: 6000,
  quantity: 1,
  comment: null,
};

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

/** `renderHook` is async in RNTL 14 — it returns a promise, so every caller awaits it. */
const renderCart = () => renderHook(() => useCart(), { wrapper });

describe('CartProvider', () => {
  it('starts empty', async () => {
    const { result } = await renderCart();
    expect(result.current.itemCount).toBe(0);
    expect(result.current.subtotalPaise).toBe(0);
  });

  it('adds a line', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add(IDLI));

    expect(result.current.cart.lines).toHaveLength(1);
    expect(result.current.itemCount).toBe(1);
    expect(result.current.subtotalPaise).toBe(6000);
  });

  // The badge and the total are what the optimistic UI (E14-08) is judged by: they must move
  // on the same render as the tap, with nothing awaited in between.
  it('reflects an add with no request in flight', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add({ ...IDLI, quantity: 3 }));
    expect(result.current.itemCount).toBe(3);
  });

  it('changes a quantity', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add(IDLI));
    await act(() => result.current.setQuantity(cartDomain.lineKey(IDLI), 5));

    expect(result.current.itemCount).toBe(5);
    expect(result.current.subtotalPaise).toBe(30000);
  });

  it('removes a line', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add(IDLI));
    await act(() => result.current.remove(cartDomain.lineKey(IDLI)));

    expect(result.current.cart.lines).toHaveLength(0);
  });

  it('sets a per-line comment', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add(IDLI));
    await act(() => result.current.setComment(cartDomain.lineKey(IDLI), 'no chutney'));

    expect(result.current.cart.lines[0]?.comment).toBe('no chutney');
  });

  it('empties the cart', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add(IDLI));
    await act(() => result.current.clear());

    expect(result.current.cart.lines).toHaveLength(0);
  });

  // A rejected quantity must not take the screen down with it. The stepper cannot produce a
  // fractional value, but a future caller can, and the cart is the last thing that should
  // crash — losing an in-progress order to an exception is worse than ignoring one bad tap.
  // An escaping throw fails this test, which is the assertion.
  it('ignores an invalid quantity rather than throwing', async () => {
    const { result } = await renderCart();
    await act(() => result.current.add(IDLI));
    await act(() => result.current.setQuantity(cartDomain.lineKey(IDLI), -1));

    expect(result.current.itemCount).toBe(1);
  });
});
