import { render, screen, userEvent } from '@testing-library/react-native';
import { api, cart as cartDomain } from '@graybag/shared';
import type { ReactNode } from 'react';

import { CartProvider } from './CartContext';
import { CartScreen, cutoffCopy, formatCutoffAt, type CartScreenProps } from './CartScreen';

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
const renderCart = (lines: (typeof IDLI)[] = [], props: CartScreenProps = {}) => {
  const Wrapper = withCart(lines);
  return render(
    <Wrapper>
      <CartScreen {...props} />
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

    // The cart's note is a compact line now (Andy, 2026-08-11) — one tap opens the same field
    // the dish sheet uses. The extra press is the behaviour change; everything asserted after
    // it is unchanged.
    await user.press(screen.getByTestId(`cart-line-note-${cartDomain.lineKey(IDLI)}`));
    // By label, not testID: `TextField` puts its testID on the wrapping View, and `type`
    // only accepts a host TextInput.
    await user.type(screen.getByLabelText('Note for the kitchen'), 'no chutney');

    // `type` blurs at the end, which commits — and a comment is part of a line's key, so the
    // row re-keys and the editor collapses back to the compact line showing what was written.
    // Asserting the collapsed line rather than the field's display value is asserting what a
    // parent actually ends up looking at.
    expect(screen.getByText('no chutney')).toBeTruthy();
  });

  // The test above only proves the draft renders. This one proves the draft was committed to
  // the cart: a comment is part of a line's identity, so once it lands the line is keyed by
  // the new comment — and the old key no longer resolves.
  it('commits the comment to the cart when the field loses focus', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);

    // The cart's note is a compact line now (Andy, 2026-08-11) — one tap opens the same field
    // the dish sheet uses. The extra press is the behaviour change; everything asserted after
    // it is unchanged.
    await user.press(screen.getByTestId(`cart-line-note-${cartDomain.lineKey(IDLI)}`));
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
    const user = userEvent.setup();
    await renderCart([IDLI]);
    // The cart's note is a compact line now (Andy, 2026-08-11) — one tap opens the same field
    // the dish sheet uses. The extra press is the behaviour change; everything asserted after
    // it is unchanged.
    await user.press(screen.getByTestId(`cart-line-note-${cartDomain.lineKey(IDLI)}`));

    const note = screen.getByLabelText('Note for the kitchen');
    expect(note.props.maxLength).toBe(140);
  });

  it('describes the note as a request and not as allergy information', async () => {
    const user = userEvent.setup();
    await renderCart([IDLI]);
    // The cart's note is a compact line now (Andy, 2026-08-11) — one tap opens the same field
    // the dish sheet uses. The extra press is the behaviour change; everything asserted after
    // it is unchanged.
    await user.press(screen.getByTestId(`cart-line-note-${cartDomain.lineKey(IDLI)}`));
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

/**
 * The cutoff copy (`C4`, `C5`, §5.7 element 5).
 *
 * `2025-08-11` is the prototype's own fixture date, and it is used here because it is a
 * **Monday** — which lets these tests pin the specified sentence character for character
 * rather than asserting a shape that a wrong-but-plausible string would also satisfy.
 */
describe('formatCutoffAt', () => {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  /** 23:59 local on Monday 11 August. Built in local time so the weekday is the same
   *  everywhere the suite runs, rather than sliding by a day across the date line. */
  const CLOSES_AT = new Date(2025, 7, 11, 23, 59, 0, 0).toISOString();

  it('renders a full weekday, date and 12-hour time', () => {
    expect(formatCutoffAt(CLOSES_AT)).toBe('Monday 11 Aug, 11:59 PM');
  });

  // C5: "00:00" is ambiguous about which midnight it means and reads as a whole day wrong.
  it('never renders midnight as a bare 00:00', () => {
    const midnight = new Date(2025, 7, 11, 0, 0, 0, 0).toISOString();
    expect(formatCutoffAt(midnight)).toBe('Monday 11 Aug, 12:00 AM');
    expect(formatCutoffAt(midnight)).not.toMatch(/00:00/);
  });

  // C4: the common case stays short. Naming the zone a parent is already standing in is
  // noise, and noise in a deadline is what gets skimmed.
  it('does not name the timezone when it is the phone’s own', () => {
    expect(formatCutoffAt(CLOSES_AT, deviceZone)).toBe(formatCutoffAt(CLOSES_AT));
  });

  // ...and the parent abroad still gets it right.
  it('names the timezone when it differs from the phone’s', () => {
    const elsewhere = deviceZone === 'Asia/Kolkata' ? 'America/New_York' : 'Asia/Kolkata';
    const named = formatCutoffAt(CLOSES_AT, elsewhere);

    expect(named).not.toBe(formatCutoffAt(CLOSES_AT));
    // Ends with a zone token — "GMT+5:30", "IST", "EDT" — rather than with the meridiem.
    expect(named).toMatch(/(AM|PM) \S+$/);
  });

  // An unresolvable zone must not produce a confident wrong time. Ugly and honest beats
  // plausible and wrong (§5.21).
  it('does not guess when the instant or the zone cannot be read', () => {
    expect(formatCutoffAt('not-a-date')).toBe('not-a-date');
    expect(formatCutoffAt(CLOSES_AT, 'Mars/Olympus_Mons')).toBe(CLOSES_AT);
  });

  // §2.10: no state in this product is carried by colour alone, so the amber band must not
  // be the only thing distinguishing "closing soon" from "open".
  it('says in words which state it is in, not only in the tint', () => {
    expect(cutoffCopy({ state: 'open', closesAt: CLOSES_AT })).toBe(
      'Ordering closes on Monday 11 Aug, 11:59 PM.',
    );
    expect(cutoffCopy({ state: 'closed', closesAt: CLOSES_AT })).toBe(
      'Ordering closed on Monday 11 Aug, 11:59 PM.',
    );
    expect(cutoffCopy({ state: 'soon', closesAt: CLOSES_AT, minutesLeft: 42 })).toBe(
      'Ordering closes in 42 minutes — on Monday 11 Aug, 11:59 PM.',
    );
    // Still distinguishable from `open` with no countdown to show.
    expect(cutoffCopy({ state: 'soon', closesAt: CLOSES_AT })).toBe(
      'Ordering closes soon, on Monday 11 Aug, 11:59 PM.',
    );
  });
});

/**
 * The states the cart cannot know about itself (§5.7).
 *
 * Offline, repricing, a price change, the cutoff, a withdrawn item and a failed reprice are
 * facts about the server and the network. They arrive as props, and **each one defaults to
 * absent** — which is what makes `R12`/§5.7.1 hold: a cart restored from disk after the OS
 * killed the app renders as an ordinary cart, never as a stale cache.
 */
describe('CartScreen — the states it is told about', () => {
  const CLOSES_AT = new Date(2025, 7, 11, 23, 59, 0, 0).toISOString();

  // §5.7.1's hardest rule, asserted on the default render because that is exactly what a
  // restored cart is: the same screen, with nothing extra said about it.
  it('says nothing about the network unless it is told to', async () => {
    await renderCart([IDLI]);

    expect(screen.queryByTestId('cart-offline')).toBeNull();
    expect(screen.queryByTestId('cart-price-changed')).toBeNull();
    expect(screen.queryByTestId('cart-error')).toBeNull();
    expect(screen.queryByTestId('cart-unavailable')).toBeNull();
    expect(screen.queryByText(/showing the .*you last loaded/i)).toBeNull();
  });

  it('is fully readable offline, and says the last step is what needs a connection', async () => {
    await renderCart([IDLI], { offline: true, onPlaceOrder: jest.fn() });

    expect(screen.getByTestId('cart-offline')).toBeTruthy();
    // The cart itself is untouched — the lines, the quantities and the total all still show.
    expect(screen.getByText('Idli Sambar')).toBeTruthy();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('₹126.00');
    // The button says which of its several reasons it is inert for.
    expect(screen.getByLabelText("You're offline")).toBeTruthy();
    expect(screen.getByTestId('cart-place-order')).toBeDisabled();
  });

  // §7 `price_changed`: both amounts, formatted by the shared formatter, so the parent can see
  // what moved rather than only that something did.
  it('names the dish and both prices when one changed underneath the cart', async () => {
    await renderCart([IDLI], {
      priceChanged: { dishName: 'Idli Sambar', fromPaise: 6000, toPaise: 6500 },
    });

    expect(screen.getByTestId('cart-price-changed')).toBeTruthy();
    expect(screen.getByText(/Idli Sambar went from ₹60\.00 to ₹65\.00/)).toBeTruthy();
  });

  it('renders the cutoff as a band with the full date and time', async () => {
    await renderCart([IDLI], { cutoff: { state: 'open', closesAt: CLOSES_AT } });

    expect(screen.getByTestId('cart-cutoff-open')).toBeTruthy();
    expect(screen.getByText('Ordering closes on Monday 11 Aug, 11:59 PM.')).toBeTruthy();
  });

  it('warns without blocking when the cutoff is close', async () => {
    await renderCart([IDLI], {
      cutoff: { state: 'soon', closesAt: CLOSES_AT, minutesLeft: 42 },
      onPlaceOrder: jest.fn(),
    });

    expect(screen.getByTestId('cart-cutoff-soon')).toBeTruthy();
    // Closing soon is still open. Disabling here would lose an order we can still take.
    expect(screen.getByTestId('cart-place-order')).not.toBeDisabled();
  });

  // §7 `cutoff_passed`: never a dead end — the notice carries the way forward, and the cart
  // is explicitly kept.
  it('offers another day rather than a dead end when ordering has closed', async () => {
    const user = userEvent.setup();
    const chooseAnotherDay = jest.fn();
    await renderCart([IDLI], {
      cutoff: { state: 'closed', closesAt: CLOSES_AT },
      onChooseAnotherDay: chooseAnotherDay,
      onPlaceOrder: jest.fn(),
    });

    expect(screen.getByTestId('cart-cutoff-passed')).toBeTruthy();
    expect(screen.getByText('Ordering closed on Monday 11 Aug, 11:59 PM.')).toBeTruthy();
    expect(screen.getByText(/we'll keep everything in your order/i)).toBeTruthy();
    expect(screen.getByLabelText('Ordering has closed')).toBeTruthy();
    expect(screen.getByTestId('cart-place-order')).toBeDisabled();

    await user.press(screen.getByLabelText('Choose another day'));
    expect(chooseAnotherDay).toHaveBeenCalled();
  });

  // §5.7: the skeleton is on the totals block only. Blanking the whole screen would say we
  // had lost the cart, which is the one thing repricing must never imply.
  it('skeletons only the totals while repricing, and drops the amount from the button', async () => {
    await renderCart([IDLI], { repricing: true, onPlaceOrder: jest.fn() });

    expect(screen.getByTestId('cart-totals-skeleton')).toBeTruthy();
    // The amounts are gone rather than dimmed: a stale total shown faintly is still a total.
    expect(screen.queryByTestId('cart-total')).toBeNull();
    expect(screen.getByText('Idli Sambar')).toBeTruthy();
    expect(screen.queryByText(/Place order · /)).toBeNull();
  });

  // A total we could not confirm must not travel to the payment sheet on a button.
  it('refuses to put an unconfirmed total on the button when repricing failed', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    await renderCart([IDLI], {
      error: 'We couldn’t reach the kitchen just now.',
      onRetry,
      onPlaceOrder: jest.fn(),
    });

    expect(screen.getByTestId('cart-error')).toBeTruthy();
    expect(screen.queryByText(/Place order · /)).toBeNull();
    expect(screen.getByTestId('cart-place-order')).toBeDisabled();

    await user.press(screen.getByLabelText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  // §7 `item_unavailable`, and §5.7.1's restored-cart rule: say which item, on the line and
  // above it, rather than failing later at checkout.
  it('marks a withdrawn item on its own line and names it at the top', async () => {
    await renderCart([IDLI, DOSA], {
      unavailableDishIds: ['d-1'],
      onPlaceOrder: jest.fn(),
    });

    expect(screen.getByTestId('cart-unavailable')).toBeTruthy();
    expect(screen.getByText(/Idli Sambar came off the menu/)).toBeTruthy();
    expect(
      screen.getByTestId(`cart-line-unavailable-${cartDomain.lineKey(IDLI)}`),
    ).toBeTruthy();
    // The other line is untouched.
    expect(screen.queryByTestId(`cart-line-unavailable-${cartDomain.lineKey(DOSA)}`)).toBeNull();
    expect(screen.getByTestId('cart-place-order')).toBeDisabled();
  });
});

/**
 * Allergen warnings (§5.7 element 4).
 *
 * The rule these pin is one-directional: a warning is **only** ever shown against a named
 * child. "No warning shown" and "we could not check" look identical on screen and mean
 * opposite things, so the type makes a recipient a precondition of passing allergens at all
 * and these assert the screen honours it.
 */
describe('CartScreen — allergen warnings', () => {
  it('warns on the line, naming the child it checked against', async () => {
    await renderCart([IDLI], {
      allergens: { recipientName: 'Aarav', byDishId: { 'd-1': ['Peanuts'] } },
    });

    expect(screen.getByTestId(`cart-line-allergen-${cartDomain.lineKey(IDLI)}`)).toBeTruthy();
    expect(screen.getByText('Contains Peanuts')).toBeTruthy();
    expect(screen.getByText('Aarav is allergic')).toBeTruthy();
  });

  it('warns on the flagged line only, never on the whole cart', async () => {
    await renderCart([IDLI, DOSA], {
      allergens: { recipientName: 'Aarav', byDishId: { 'd-1': ['Peanuts'] } },
    });

    expect(screen.getByTestId(`cart-line-allergen-${cartDomain.lineKey(IDLI)}`)).toBeTruthy();
    expect(screen.queryByTestId(`cart-line-allergen-${cartDomain.lineKey(DOSA)}`)).toBeNull();
  });

  it('shows nothing when the check ran and found nothing', async () => {
    await renderCart([IDLI], { allergens: { recipientName: 'Aarav', byDishId: {} } });
    expect(screen.queryByText(/allergic/i)).toBeNull();
  });
});

/**
 * The presentation a cart line still cannot carry.
 *
 * `CartLineInput` has no `foodType` and no image, so both arrive as `dishInfo`. These tests
 * exist to make the gap visible: when the shared type grows those fields, they should fail and
 * be replaced by assertions against the line itself.
 */
describe('CartScreen — the photo and the veg mark', () => {
  it('draws the branded tile rather than a grey box when a line has no photo', async () => {
    await renderCart([IDLI]);
    expect(screen.getByTestId(`cart-line-image-${cartDomain.lineKey(IDLI)}`)).toBeTruthy();
  });

  it('draws the photo and the veg mark when the caller can supply them', async () => {
    await renderCart([IDLI], {
      dishInfo: { 'd-1': { imageUri: 'https://example.test/idli.jpg', foodType: 'veg' } },
    });

    // The photo is decorative — hidden from assistive tech — so the query has to say so.
    const photo = screen.getByTestId(`cart-line-image-${cartDomain.lineKey(IDLI)}`, {
      includeHiddenElements: true,
    });
    expect(photo.props.source).toEqual({ uri: 'https://example.test/idli.jpg' });
    expect(photo.props.recyclingKey).toBe('d-1');
    expect(screen.getByTestId(`cart-line-foodtype-${cartDomain.lineKey(IDLI)}`)).toBeTruthy();
    // The mark is pure colour, so it carries its meaning in its label too.
    expect(screen.getByLabelText('Pure vegetarian')).toBeTruthy();
  });

  it('draws no mark at all rather than guessing one', async () => {
    await renderCart([IDLI]);
    expect(screen.queryByTestId(`cart-line-foodtype-${cartDomain.lineKey(IDLI)}`)).toBeNull();
  });
});

/**
 * The "For" block's Change affordance, with a recipient the screen can actually resolve.
 *
 * Stubbed at the transport rather than by mocking `api`: `api` is a namespace of ESM
 * re-exports, so `jest.spyOn` fails with "Cannot redefine property", and going through
 * `setApiTransport` means the real `guardian_link` read and its payload validation still run.
 */
describe('CartScreen — changing who it is for', () => {
  beforeEach(() => {
    const builder = {
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      then: (resolve: (r: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({
          data: [
            {
              can_order: true,
              can_manage: true,
              recipient: {
                id: 'r-1',
                first_name: 'Aarav',
                last_name: 'Sharma',
                class_label: '5',
                section_label: 'A',
                is_active: true,
                school: { id: 's1', name: 'Alpha Public School' },
              },
            },
          ],
          error: null,
        }).then(resolve),
    };

    api.setApiTransport({
      from: () => ({ select: () => builder }),
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
    } as never);
  });

  afterEach(() => api.setApiTransport(null));

  it('states the child, the school and the service date once, for the whole cart', async () => {
    await renderCart([IDLI]);

    expect(await screen.findByTestId('cart-order-for-child')).toHaveTextContent('Aarav · Class 5-A');
    expect(screen.getByTestId('cart-order-for-where')).toHaveTextContent('Alpha Public School');
    // R7: a full weekday and month, never "10/08".
    expect(screen.getByTestId('cart-order-for-when')).toHaveTextContent('Monday 10 August');
  });

  it('offers Change once there is something to change', async () => {
    const user = userEvent.setup();
    const onChangeRecipient = jest.fn();
    await renderCart([IDLI], { onChangeRecipient });

    await user.press(await screen.findByTestId('cart-order-for-change'));
    expect(onChangeRecipient).toHaveBeenCalled();
  });

  // A button offering to change a child we could not name is a dead end.
  it('offers no Change affordance while no child is resolved', async () => {
    api.setApiTransport(null);
    await renderCart([IDLI], { onChangeRecipient: jest.fn() });

    expect(await screen.findByTestId('cart-order-for-unknown')).toBeTruthy();
    expect(screen.queryByTestId('cart-order-for-change')).toBeNull();
  });
});

/** The footer, and the one sentence on this screen that names the gate. */
describe('CartScreen — the sticky footer', () => {
  it('sends an empty cart at the menu, and never at the gate', async () => {
    const user = userEvent.setup();
    const onBrowseMenu = jest.fn();
    await renderCart([], { onBrowseMenu });

    expect(screen.getByTestId('cart-empty')).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();

    await user.press(screen.getByLabelText('Browse the menu'));
    expect(onBrowseMenu).toHaveBeenCalled();
  });

  /**
   * `AR7` says nothing on the cart *asks* for sign-in, and the default render still contains
   * the phrase nowhere — the test above and the two earlier ones assert exactly that.
   *
   * A signed-out parent one tap from the gate is the single exception, and it is reassurance
   * rather than a wall: `F1` — the fear of losing a full cart at a sign-in step is what causes
   * abandonment, so the sentence exists to say the cart survives. The prototype carries it at
   * `#cart,cart,signedout`.
   */
  it('promises the order survives the gate — but only to someone facing it', async () => {
    await renderCart([IDLI], { signedOut: true, onPlaceOrder: jest.fn() });
    expect(screen.getByTestId('cart-signed-out-note')).toHaveTextContent(
      'We’ll ask you to sign in — your order is kept.',
    );
  });

  it('says nothing about the gate to someone already through it', async () => {
    await renderCart([IDLI], { onPlaceOrder: jest.fn() });
    expect(screen.queryByTestId('cart-signed-out-note')).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });
});

/**
 * `E05-30` / `P19` — the break window, and the school that cannot take orders.
 *
 * Andy, 2026-08-11: "break time is confirmed with the kitchen" described a manual step nobody
 * can perform at volume, because orders arrive until midnight for the next day. The parent
 * picks. And where there are no windows to pick from, the school is **closed for ordering** and
 * says so — which is two of the three live schools today.
 */
describe('choosing a break time', () => {
  const WINDOWS: api.BreakTime[] = [
    { id: 'b1', label: 'Morning break', startsAt: '10:40:00', endsAt: '11:15:00' },
    { id: 'b2', label: 'Second break', startsAt: '11:15:00', endsAt: '11:40:00' },
  ];

  it('offers the school’s windows by name, with the time underneath', async () => {
    await renderCart([IDLI], { breakWindows: WINDOWS, onPlaceOrder: () => {} });

    expect(screen.getByText('Morning break')).toBeOnTheScreen();
    expect(screen.getByText('10:40 – 11:15')).toBeOnTheScreen();
    // The name, not the raw range. Amity's labels currently hold the range itself, which is the
    // thing `P19` is fixing — a parent should not have to read data to pick.
    expect(screen.getByText('Second break')).toBeOnTheScreen();
  });

  it('preselects nothing, and blocks Place order until one is chosen', async () => {
    // A default that happens to be first in `sort_order` is a choice about a child's day made
    // for the parent by a database column.
    await renderCart([IDLI], { breakWindows: WINDOWS, onPlaceOrder: () => {} });

    const button = screen.getByTestId('cart-place-order');
    expect(button).toHaveTextContent('Choose a delivery time');
    expect(button).toBeDisabled();
  });

  it('enables Place order once a window is chosen', async () => {
    const user = userEvent.setup();
    const onSelectBreakTime = jest.fn();
    await renderCart([IDLI], {
      breakWindows: WINDOWS,
      onPlaceOrder: () => {},
      onSelectBreakTime,
    });

    // The screen reports the choice; the caller owns the state (`RootNavigator`), which is why
    // this asserts the callback rather than a local toggle.
    await user.press(screen.getByTestId('cart-break-picker-b1'));
    expect(onSelectBreakTime).toHaveBeenCalledWith('b1');
  });

  it('enables Place order when a window is already chosen', async () => {
    await renderCart([IDLI], {
      breakWindows: WINDOWS,
      breakTimeId: 'b1',
      onPlaceOrder: () => {},
    });
    expect(screen.getByTestId('cart-place-order')).not.toBeDisabled();
  });

  it('announces the window in the label, not only as visible text', async () => {
    // §7: a control conveying state carries it in the label. A screen-reader user choosing
    // between two breaks needs the time as much as the name.
    await renderCart([IDLI], { breakWindows: WINDOWS, onPlaceOrder: () => {} });
    expect(screen.getByLabelText('Morning break, 10:40 – 11:15')).toBeOnTheScreen();
  });

  describe('a school with no windows', () => {
    it('says we are still setting it up, and never "confirmed with the kitchen"', async () => {
      await renderCart([IDLI], { breakWindows: [], onPlaceOrder: () => {} });

      expect(screen.getByTestId('cart-school-closed')).toBeOnTheScreen();
      expect(screen.getByText(/still setting up ordering for this school/i)).toBeOnTheScreen();
      // The sentence Andy asked to have removed everywhere. It described a manual step nobody
      // can perform at volume, and it must not survive as a fallback.
      expect(screen.queryByText(/confirm(ed)? with the kitchen/i)).toBeNull();
    });

    it('blocks Place order with a reason that is not "come back tomorrow"', async () => {
      await renderCart([IDLI], { breakWindows: [], onPlaceOrder: () => {} });

      const button = screen.getByTestId('cart-place-order');
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Not available at this school yet');
      // "Ordering has closed" is the cutoff's sentence and it would be wrong here: it tells a
      // parent to come back tomorrow, and tomorrow is not the problem.
      expect(button).not.toHaveTextContent(/closed/i);
    });

    it('keeps the cart rather than emptying it', async () => {
      // The school opens later. Throwing away what they chose would punish them for our gap.
      await renderCart([IDLI], { breakWindows: [], onPlaceOrder: () => {} });
      expect(screen.getByText('Idli Sambar')).toBeOnTheScreen();
    });
  });

  it('shows neither picker nor notice before the windows are known', async () => {
    // `undefined` is "not read yet". Rendering it as `[]` would tell every parent their school
    // was closed for the first few hundred milliseconds.
    await renderCart([IDLI], { onPlaceOrder: () => {} });

    expect(screen.queryByTestId('cart-break-picker')).toBeNull();
    expect(screen.queryByTestId('cart-school-closed')).toBeNull();
  });
});
