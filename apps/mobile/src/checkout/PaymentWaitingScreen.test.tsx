import { fireEvent, render, screen } from '@testing-library/react-native';
import { design } from '@graybag/shared';

import {
  PAYMENT_WAITING_TEST_ID,
  PENDING_AFTER_MS,
  PaymentWaitingScreen,
  paymentWaitingState,
} from './PaymentWaitingScreen';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * `docs/ux-spec.md` §5.12, `docs/order-lifecycle.md` §13, `R8`, `S5`.
 *
 * The tests that matter here are about two things the screen must *never* do: claim an order
 * is placed, and spin. Everything else is copy.
 */
describe('paymentWaitingState', () => {
  it('is confirming until the threshold, and pending at it', () => {
    expect(paymentWaitingState({ elapsedMs: 0 })).toBe('confirming');
    expect(paymentWaitingState({ elapsedMs: PENDING_AFTER_MS - 1 })).toBe('confirming');
    expect(paymentWaitingState({ elapsedMs: PENDING_AFTER_MS })).toBe('pending');
  });

  it('takes the server’s `payment_pending` (202) regardless of the clock', () => {
    // §13: the server said capture is not confirmed. How long we have been on screen is
    // irrelevant next to that.
    expect(paymentWaitingState({ pending: true, elapsedMs: 0 })).toBe('pending');
  });

  it('puts a dismissal above a failure, and both above waiting', () => {
    // §10.2 — the two are indistinguishable from the outside, and "you cancelled" is the one
    // that is never wrong in a way that matters.
    expect(paymentWaitingState({ dismissed: true, failed: true, pending: true })).toBe('dismissed');
    expect(paymentWaitingState({ failed: true, pending: true })).toBe('failed');
  });
});

describe('PaymentWaitingScreen', () => {
  it('holds the user honestly while the sheet is open', async () => {
    await render(<PaymentWaitingScreen />);

    expect(screen.getByTestId(PAYMENT_WAITING_TEST_ID)).toBeTruthy();
    expect(screen.getByText('Confirming your payment')).toBeTruthy();
    expect(screen.getByText(/please don’t close the app/)).toBeTruthy();
  });

  it('skeletons the confirmation rather than spinning (S5)', async () => {
    await render(<PaymentWaitingScreen />);

    expect(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-skeleton`)).toBeTruthy();
    // Two bars, which is the shape of the confirmation's own two lines. `Skeleton` labels
    // itself "Loading" and announces `progressbar`; an `ActivityIndicator` — the banned thing
    // — renders nothing queryable at all, so the assertion is that the shape we *do* want is
    // the one present, twice.
    expect(screen.getAllByLabelText('Loading').length).toBe(2);
  });

  it('offers nothing to tap while it is asking the user not to close the app', async () => {
    await render(<PaymentWaitingScreen onSeeOrders={() => {}} onRetry={() => {}} />);

    // A button that leaves, one line under "please don't close the app", is the opposite
    // instruction.
    expect(screen.queryByTestId(`${PAYMENT_WAITING_TEST_ID}-see-orders`)).toBeNull();
    expect(screen.queryByTestId(`${PAYMENT_WAITING_TEST_ID}-retry`)).toBeNull();
  });

  it('becomes `payment_pending` on its own once the wait is long enough', async () => {
    await render(<PaymentWaitingScreen elapsedMs={PENDING_AFTER_MS} onSeeOrders={() => {}} />);

    expect(screen.getByText('Still confirming')).toBeTruthy();
    expect(screen.getByText(/Your money is safe and your order is not lost/)).toBeTruthy();
    expect(screen.getByText(/we’ll email you the moment it’s confirmed/)).toBeTruthy();
    expect(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-see-orders`)).toBeTruthy();
  });

  it('keeps skeletoning in `payment_pending` — never a tick (§13)', async () => {
    await render(<PaymentWaitingScreen pending />);

    expect(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-skeleton`)).toBeTruthy();
  });

  it('offers no retry while a capture may still be settling', async () => {
    // §13 means the capture may be landing right now, and §10.6 — duplicate payment — is what
    // a "try again" button here invites. Retry belongs to `failed` and `dismissed` only.
    await render(<PaymentWaitingScreen pending onRetry={() => {}} onSeeOrders={() => {}} />);

    expect(screen.queryByTestId(`${PAYMENT_WAITING_TEST_ID}-retry`)).toBeNull();
    expect(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-see-orders`)).toBeTruthy();
  });

  it('never says an order was placed, in any state', async () => {
    // `R8`. This is the whole reason the screen exists, so it is asserted across every state
    // rather than in the one that seems most likely to slip. A pickup code is the tell that
    // matters most: §9.4 allocates it on capture, so a waiting screen showing one would mean
    // the app had decided settlement happened.
    const { rerender } = await render(<PaymentWaitingScreen />);

    for (const state of [
      <PaymentWaitingScreen key="b" pending />,
      <PaymentWaitingScreen key="c" failed onRetry={() => {}} />,
      <PaymentWaitingScreen key="d" dismissed onRetry={() => {}} />,
    ]) {
      expect(screen.queryByText(/order placed/i)).toBeNull();
      expect(screen.queryByText(/pickup code/i)).toBeNull();
      await rerender(state);
    }

    expect(screen.queryByText(/order placed/i)).toBeNull();
    expect(screen.queryByText(/pickup code/i)).toBeNull();
  });

  /**
   * The title used to end *"and keeps the cart"*, which this test does not check and cannot: it
   * renders one screen with no cart in the tree. It asserted the **sentence** about the cart and
   * was named after the **behaviour**, which is the shape Andy called *"worse than none, because
   * it buys false confidence"* — a green test while the parent's cart is gone.
   *
   * The promise itself is now tested where the decision lives: `shouldClearCart` in
   * `RootNavigator.test.tsx`. This test asserts what a screen test honestly can — that the words
   * are on screen and the retry control works.
   */
  it('says the order is not placed when the user closes the sheet, and offers a retry', async () => {
    const onRetry = jest.fn();
    await render(<PaymentWaitingScreen dismissed onRetry={onRetry} onSeeOrders={() => {}} />);

    expect(screen.getByText('Payment cancelled')).toBeTruthy();
    expect(screen.getByText(/Your order isn’t placed/)).toBeTruthy();
    expect(screen.getByText(/cart is still here/)).toBeTruthy();

    // Awaited: `fireEvent` opens an `act` scope on RNTL v14, and an unawaited one renders the
    // *next* test's tree as nothing — docs/learnings.md, 2026-08-10.
    await fireEvent.press(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-retry`));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the payment failed, and stops skeletoning', async () => {
    await render(<PaymentWaitingScreen failed onRetry={() => {}} />);

    expect(screen.getByText(/didn’t go through/)).toBeTruthy();
    expect(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-retry`)).toBeTruthy();
    // Nothing is on its way any more; a skeleton under an answer implies something still is.
    expect(screen.queryByTestId(`${PAYMENT_WAITING_TEST_ID}-skeleton`)).toBeNull();
  });

  it('claims nothing about money it has not confirmed', async () => {
    // §10.3 and §10.6 are both live at this moment — a webhook may be arriving right now, and
    // a duplicate capture is a documented case. "Nothing has been charged" is a sentence we
    // are not entitled to.
    const { rerender } = await render(<PaymentWaitingScreen failed onRetry={() => {}} />);
    expect(screen.queryByText(/nothing (has been|was) charged/i)).toBeNull();
    expect(screen.queryByText(/refund/i)).toBeNull();

    await rerender(<PaymentWaitingScreen dismissed onRetry={() => {}} />);
    expect(screen.queryByText(/nothing (has been|was) charged/i)).toBeNull();
    expect(screen.queryByText(/refund/i)).toBeNull();
  });

  it('sets white on the green that white is legal on', async () => {
    await render(<PaymentWaitingScreen />);

    // `text.onBrand` on `bg.surfaceBrand` is 3.85 and illegal for the body copy this screen
    // carries; on `surfaceBrandStrong` it is 5.19. This is a contrast rule, so it is asserted
    // rather than left to the eye.
    //
    // `.parent` because `ImageBackground` puts the `testID` on the inner `Image` and the
    // `style` on the `View` wrapping it — the fill lives one level up from the handle.
    expect(screen.getByTestId(PAYMENT_WAITING_TEST_ID).parent).toHaveStyle({
      backgroundColor: design.bg.surfaceBrandStrong,
    });
    expect(screen.getByTestId(`${PAYMENT_WAITING_TEST_ID}-lead`)).toHaveStyle({
      color: design.text.onBrand,
      fontSize: design.scale.body.size,
    });
  });
});
