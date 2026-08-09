import { render, screen, userEvent } from '@testing-library/react-native';
import { cart as cartDomain } from '@graybag/shared';
import type { ReactNode } from 'react';

import { CartProvider } from './CartContext';
import { CartScreen } from './CartScreen';

const IDLI = {
  recipientId: 'r-1',
  serviceDate: '2026-08-10',
  menuItemId: 'mi-1',
  dishId: 'd-1',
  dishName: 'Idli Sambar',
  unitPricePaise: 6000,
  quantity: 2,
  comment: null,
};

const DOSA = {
  ...IDLI,
  menuItemId: 'mi-2',
  dishId: 'd-2',
  dishName: 'Masala Dosa',
  unitPricePaise: 9000,
  quantity: 1,
};

function withCart(lines: (typeof IDLI)[] = []) {
  const initial = lines.reduce((acc, line) => cartDomain.addToCart(acc, line), cartDomain.emptyCart());
  return ({ children }: { children: ReactNode }) => (
    <CartProvider initial={initial}>{children}</CartProvider>
  );
}

/** `render` is async in RNTL 14, so every caller awaits it. */
const renderCart = (lines: (typeof IDLI)[] = []) => {
  const Wrapper = withCart(lines);
  return render(
    <Wrapper>
      <CartScreen />
    </Wrapper>,
  );
};

describe('CartScreen', () => {
  // AR7: the cart fills signed out and the gate is at checkout. An empty cart is an
  // invitation to the menu, never a prompt to sign in.
  it('shows an empty state that points at the menu, not at sign-in', async () => {
    await renderCart();

    expect(screen.getByTestId('cart-empty')).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  it('lists a line with its dish name and quantity', async () => {
    await renderCart([IDLI]);

    expect(screen.getByText('Idli Sambar')).toBeTruthy();
    expect(screen.getByTestId(`cart-line-qty-${cartDomain.lineKey(IDLI)}`)).toHaveTextContent('2');
  });

  // The line total is quantity × unit price, formatted by the shared formatter — never
  // hand-assembled here (design/type.ts). Asserted by testID rather than by text, because
  // with one line in the cart the line total and the subtotal are legitimately the same
  // string and `getByText` cannot tell which one it found.
  it('shows the line total for the quantity, not the unit price', async () => {
    await renderCart([IDLI]);

    expect(screen.getByTestId(`cart-line-total-${cartDomain.lineKey(IDLI)}`)).toHaveTextContent(
      '₹120.00',
    );
    expect(screen.getByText('₹60.00 each')).toBeTruthy();
  });

  it('shows the subtotal across lines', async () => {
    await renderCart([IDLI, DOSA]);
    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('₹210.00');
  });

  // SC2: menu prices are GST-exclusive and 5% is added at checkout. A subtotal presented as
  // if it were the amount payable is a number that changes on the next screen, which is the
  // single most reliable way to lose trust in a payment flow.
  it('says tax is added at checkout rather than presenting the subtotal as payable', async () => {
    await renderCart([IDLI]);
    expect(screen.getByTestId('cart-tax-note')).toBeTruthy();
  });

  it('increments a line', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);

    await user.press(screen.getByTestId(`cart-line-increment-${cartDomain.lineKey(IDLI)}`));

    expect(screen.getByTestId(`cart-line-qty-${cartDomain.lineKey(IDLI)}`)).toHaveTextContent('3');
    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('₹180.00');
  });

  it('decrements a line', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);

    await user.press(screen.getByTestId(`cart-line-decrement-${cartDomain.lineKey(IDLI)}`));

    expect(screen.getByTestId(`cart-line-qty-${cartDomain.lineKey(IDLI)}`)).toHaveTextContent('1');
  });

  // Decrementing off the end removes the line rather than leaving a zero — the domain does
  // this, and the screen must not re-add a guard that disagrees with it.
  it('removes the line when the last one is decremented away', async () => {
    const user = userEvent.setup();
    await renderCart([{ ...IDLI, quantity: 1 }]);

    await user.press(screen.getByTestId(`cart-line-decrement-${cartDomain.lineKey(IDLI)}`));

    expect(screen.queryByText('Idli Sambar')).toBeNull();
    expect(screen.getByTestId('cart-empty')).toBeTruthy();
  });

  it('removes a line outright', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI, DOSA]);

    await user.press(screen.getByTestId(`cart-line-remove-${cartDomain.lineKey(IDLI)}`));

    expect(screen.queryByText('Idli Sambar')).toBeNull();
    expect(screen.getByText('Masala Dosa')).toBeTruthy();
  });

  it('captures a per-line comment', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);

    // By label, not testID: `TextField` puts its testID on the wrapping View, and `type`
    // only accepts a host TextInput.
    await user.type(screen.getByLabelText('Special request'), 'no chutney');

    expect(screen.getByDisplayValue('no chutney')).toBeTruthy();
  });

  // The test above only proves the draft renders. This one proves the draft was committed to
  // the cart: a comment is part of a line's identity, so once it lands the line is keyed by
  // the new comment — and the old key no longer resolves.
  it('commits the comment to the cart when the field loses focus', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);

    await user.type(screen.getByLabelText('Special request'), 'no chutney');

    const committedKey = cartDomain.lineKey({ ...IDLI, comment: 'no chutney' });
    expect(screen.getByTestId(`cart-line-${committedKey}`)).toBeTruthy();
    expect(screen.queryByTestId(`cart-line-${cartDomain.lineKey(IDLI)}`)).toBeNull();
  });

  // Every control is a real touch target with a label — E13-08 runs the a11y audit in CI, and
  // an icon-only stepper with no accessible name is the classic way to fail it.
  it('labels the stepper controls for screen readers', async () => {
    await renderCart([IDLI]);

    expect(
      screen.getByLabelText('Add one Idli Sambar'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Remove one Idli Sambar'),
    ).toBeTruthy();
  });
});
