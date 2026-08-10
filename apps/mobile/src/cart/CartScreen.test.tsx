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
    // The line now states the basis as well as the amount: SC2 prices are GST-exclusive and the
    // split appears below, so "each" alone invited the reader to add it up themselves.
    expect(screen.getByText('₹60.00 each · excl. GST')).toBeTruthy();
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
    await user.type(screen.getByLabelText('Note for the kitchen'), 'no chutney');

    expect(screen.getByDisplayValue('no chutney')).toBeTruthy();
  });

  // The test above only proves the draft renders. This one proves the draft was committed to
  // the cart: a comment is part of a line's identity, so once it lands the line is keyed by
  // the new comment — and the old key no longer resolves.
  it('commits the comment to the cart when the field loses focus', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);

    await user.type(screen.getByLabelText('Note for the kitchen'), 'no chutney');

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

/**
 * `docs/ux-spec.md` §5.7 additions — the "For" block, the GST split, and the note cap.
 *
 * The `api/` module is unconfigured under test, so `fetchRecipients` rejects and the "For" block
 * takes its null branch. That is the case worth pinning hardest: §5.21 forbids an unknown from
 * rendering as a known, and a cart that cannot say who it is for must say exactly that.
 */
describe('CartScreen — who, and how much', () => {
  it('says plainly that no child is chosen rather than naming one it cannot resolve', async () => {
    await renderCart([IDLI]);

    expect(await screen.findByTestId('cart-order-for-unknown')).toBeTruthy();
    expect(screen.getByText('No child chosen yet')).toBeTruthy();
    // The confident-looking version must not exist: a resolved child block would be a claim.
    expect(screen.queryByTestId('cart-order-for-child')).toBeNull();
  });

  // M2 / SC2: 5% shown as CGST 2.5% + SGST 2.5%, computed per line and half-up (§6.2).
  // 2 x ₹60.00 = ₹120.00 -> 300 paise each component. 1 x ₹90.00 = ₹90.00 -> 225 paise each.
  it('shows the tax split, computed per line rather than on the subtotal', async () => {
    await renderCart([IDLI, DOSA]);

    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('₹210.00');
    expect(screen.getByTestId('cart-cgst')).toHaveTextContent('₹5.25');
    expect(screen.getByTestId('cart-sgst')).toHaveTextContent('₹5.25');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('₹220.50');
  });

  // R11: Mohali only, so there is no IGST line and there must not be one until there is a
  // second state to need it.
  it('never shows an IGST line', async () => {
    await renderCart([IDLI]);
    expect(screen.queryByText(/IGST/i)).toBeNull();
  });

  // §5.7: the amount and the commitment are never on separate screens.
  it('puts the payable total on the place-order button itself', async () => {
    await renderCart([IDLI]);
    // 2 x ₹60.00 = ₹120.00 taxable; 300 paise CGST + 300 SGST; ₹126.00 payable.
    expect(screen.getByText('Place order · ₹126.00')).toBeTruthy();
  });

  // AR7 again, now that the screen has a primary action: the gate is at checkout, and the
  // word must still not appear here.
  it('still never says sign in, even with a place-order button', async () => {
    await renderCart([IDLI]);
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  // P12: 140 characters, enforced by the field rather than truncated on save.
  it('caps the kitchen note at 140 characters in the field', async () => {
    await renderCart([IDLI]);

    const note = screen.getByLabelText('Note for the kitchen');
    expect(note.props.maxLength).toBe(140);
  });

  it('describes the note as a request and not as allergy information', async () => {
    await renderCart([IDLI]);
    expect(
      screen.getByText(/request we pass to the kitchen — not a guarantee, and not for allergies/i),
    ).toBeTruthy();
  });

  /**
   * The absences that are deliberate (§5.7's "what this screen does not show yet").
   *
   * These assert that the screen does NOT invent data it cannot resolve. If a future change
   * wires the calendar or the child's allergens in for real, these fail — which is the point:
   * the replacement should be a real value, reviewed, not a quiet appearance.
   */
  it('shows no cutoff time while the client cannot resolve one', async () => {
    await renderCart([IDLI]);
    expect(screen.queryByText(/Ordering closes/i)).toBeNull();
  });

  it('shows no allergen warning while it cannot check against a child', async () => {
    await renderCart([IDLI]);
    expect(screen.queryByText(/allergic/i)).toBeNull();
  });
});
