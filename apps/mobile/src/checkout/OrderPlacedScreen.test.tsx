import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, money } from '@graybag/shared';

import {
  ORDER_PLACED_TEST_ID,
  OrderPlacedScreen,
  placedOrder,
  type ConfirmedSettlement,
  type PlacedOrder,
} from './OrderPlacedScreen';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * `docs/ux-spec.md` §5.13, `docs/order-lifecycle.md` §9.4 and §13, `R8`, `[DM-10]`.
 *
 * Half of this suite is about the type contract rather than about pixels, and that is the
 * point: `R8` — "payment succeeded in the sheet is not a confirmed order" — is a correctness
 * rule, and the tests that prove it are the ones asserting a wrong thing cannot be built.
 */
const SETTLED: ConfirmedSettlement = {
  status: 'paid',
  pickupCode: '4821',
  recipientName: 'Aarav',
  serviceDate: '2026-08-12',
  breakLabel: 'Lunch break',
  itemCount: 3,
  totalPaise: 44_625,
};

describe('placedOrder — the only door onto the screen', () => {
  it('refuses anything that is not paid, at run time as well as at compile time', () => {
    expect(() =>
      // @ts-expect-error — `status` is the literal 'paid'. `payment_pending` is a
      // `PaymentWaitingScreen` state and has no representation here (§13).
      placedOrder({ ...SETTLED, status: 'payment_pending' }),
    ).toThrow(/settled order/i);
  });

  it('refuses a settlement with no four-digit pickup code', () => {
    // §9.4 allocates the code **on capture**, so its absence is a second, independent witness
    // that the money did not move. An order that reached here without one is a bug upstream.
    expect(() => placedOrder({ ...SETTLED, pickupCode: '' })).toThrow(/pickup code/i);
    expect(() => placedOrder({ ...SETTLED, pickupCode: '482' })).toThrow(/pickup code/i);
    expect(() => placedOrder({ ...SETTLED, pickupCode: '48210' })).toThrow(/pickup code/i);
    expect(() => placedOrder({ ...SETTLED, pickupCode: 'ABCD' })).toThrow(/pickup code/i);
  });

  it('refuses money that is not integer paise', () => {
    expect(() => placedOrder({ ...SETTLED, totalPaise: 446.25 })).toThrow(/paise/i);
    expect(() => placedOrder({ ...SETTLED, totalPaise: -1 })).toThrow(/paise/i);
  });

  it('never puts the pickup code or the recipient’s name into an exception', () => {
    // An exception message ends up in a log or in Sentry. A pickup code is quotable at a
    // counter and a child's name is regulated (non-negotiable #4, R6).
    let message = '';
    try {
      placedOrder({ ...SETTLED, pickupCode: '99' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('99');
    expect(message).not.toContain('Aarav');
  });

  it('cannot be forged: a `PlacedOrder` has no hand-writable shape', () => {
    // @ts-expect-error — `PlacedOrder` carries a brand keyed by a module-private symbol, so
    // the only expression of that type in the codebase is `placedOrder()`'s return. This line
    // is the test: if the brand is ever removed, `@ts-expect-error` fails the typecheck.
    const byHand: PlacedOrder = {
      pickupCode: '4821',
      recipientName: 'Aarav',
      serviceDate: '2026-08-12',
      breakLabel: 'Lunch break',
      itemCount: 3,
      totalPaise: 44_625,
    };

    expect(byHand.pickupCode).toBe('4821');
  });
});

describe('OrderPlacedScreen', () => {
  const order = placedOrder(SETTLED);

  it('shows who, when, and what was paid', async () => {
    await render(<OrderPlacedScreen order={order} />);

    expect(screen.getByTestId(ORDER_PLACED_TEST_ID)).toBeTruthy();
    expect(screen.getByText('Order placed')).toBeTruthy();
    // `R7`: the weekday and the month are spelled out so "12/08" cannot be read a day wrong,
    // and it is the order-detail screen's formatter, so the date does not change shape when
    // "View order" is tapped.
    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-who-when`)).toHaveTextContent(
      'Aarav’s lunch is on the kitchen’s list for Wednesday 12 August.',
    );
  });

  it('names the break, the item count and the total, formatted by the one formatter', async () => {
    await render(<OrderPlacedScreen order={order} />);

    // `money.formatPaise` rather than a literal: `design/type.ts` forbids hand-assembling an
    // amount or a currency symbol, and this is the last screen that shows what was paid.
    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-meta`)).toHaveTextContent(
      `Lunch break · 3 items · ${money.formatPaise(44_625)}`,
    );
  });

  it('shows the four-digit pickup code, and spells it out for a screen reader', async () => {
    await render(<OrderPlacedScreen order={order} />);

    const code = screen.getByTestId(`${ORDER_PLACED_TEST_ID}-pickup-code`);
    expect(code).toHaveTextContent('4821');
    // Otherwise it is read as "four thousand eight hundred and twenty-one", which is not a
    // thing anybody can quote at a gate.
    expect(code.props.accessibilityLabel).toBe('Pickup code, 4 8 2 1');
  });

  it('says staff will match the name as well as the code', async () => {
    await render(<OrderPlacedScreen order={order} />);

    // `[DM-10]`: four digits are guessable, so the name is the second factor. This line is the
    // control, not a courtesy.
    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-name-check`)).toHaveTextContent(
      'Staff will match Aarav’s name as well as the code.',
    );
  });

  it('is recipient-neutral — an adult may have ordered their own lunch', async () => {
    const mine = placedOrder({ ...SETTLED, recipientName: null, itemCount: 1 });
    await render(<OrderPlacedScreen order={mine} />);

    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-who-when`)).toHaveTextContent(
      'Your lunch is on the kitchen’s list for Wednesday 12 August.',
    );
    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-name-check`)).toHaveTextContent(
      'Staff will match your name as well as the code.',
    );
    // Nothing here says "your child".
    expect(screen.queryByText(/your child/i)).toBeNull();
    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-meta`)).toHaveTextContent(
      `Lunch break · 1 item · ${money.formatPaise(44_625)}`,
    );
  });

  it('wires both actions', async () => {
    const onViewOrder = jest.fn();
    const onBackToMenu = jest.fn();
    await render(
      <OrderPlacedScreen order={order} onViewOrder={onViewOrder} onBackToMenu={onBackToMenu} />,
    );

    await fireEvent.press(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-view-order`));
    await fireEvent.press(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-back-to-menu`));
    expect(onViewOrder).toHaveBeenCalledTimes(1);
    expect(onBackToMenu).toHaveBeenCalledTimes(1);
  });

  it('renders neither action when there is nowhere to go', async () => {
    // A dead button is worse than a missing one, and the navigator may legitimately have
    // nowhere to send someone — the same rule `CantConnectScreen` follows for its retry.
    await render(<OrderPlacedScreen order={order} />);

    expect(screen.queryByTestId(`${ORDER_PLACED_TEST_ID}-view-order`)).toBeNull();
    expect(screen.queryByTestId(`${ORDER_PLACED_TEST_ID}-back-to-menu`)).toBeNull();
  });

  it('has no waiting variant — `payment_pending` lives on the other screen', async () => {
    await render(
      // @ts-expect-error — there is no `pending` prop, and adding one would be the exact
      // regression `R8` forbids: a confirmation screen that can be shown before settlement.
      <OrderPlacedScreen order={order} pending />,
    );

    expect(screen.getByText('Order placed')).toBeTruthy();
    expect(screen.queryByText(/still confirming/i)).toBeNull();
  });
});

/**
 * The account holder's own name — `P18`, `E05-39`.
 *
 * Asserted **here**, on the screen, and not only in `NameCapture`'s own suite: `P18` settled
 * *where* the question is asked, and "it is on the confirmation screen" is the half of the
 * decision that a unit test of the component cannot hold. The component decides whether to
 * appear; this decides that it is there to.
 */
describe('the name prompt', () => {
  const NO_NAME = { first_name: null, last_name: null, name_prompted_at: null };

  const stubProfile = (rows: unknown[]) => {
    const builder = {
      eq: () => builder,
      order: () => builder,
      then: (onfulfilled: (r: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(onfulfilled),
    };
    api.setApiTransport({
      from: () => ({ select: () => builder }),
      functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: null }) },
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
    } as never);
  };

  afterEach(() => api.setApiTransport(null));

  it('asks for a name after payment, not before it', async () => {
    // Andy overruled both of my proposals — checkout, and the OTP moment. Here the money is
    // taken, the parent is pleased, and they are doing nothing.
    stubProfile([NO_NAME]);
    await render(<OrderPlacedScreen order={placedOrder(SETTLED)} />);

    expect(await screen.findByTestId(`${ORDER_PLACED_TEST_ID}-name`)).toBeOnTheScreen();
    expect(screen.getByText('What should we call you?')).toBeOnTheScreen();
  });

  it('does not ask again on the next order', async () => {
    stubProfile([{ ...NO_NAME, name_prompted_at: '2026-08-11T10:00:00+00:00' }]);
    await render(<OrderPlacedScreen order={placedOrder(SETTLED)} />);

    await waitFor(() =>
      expect(screen.queryByTestId(`${ORDER_PLACED_TEST_ID}-name`)).toBeNull(),
    );
    // The screen itself is unaffected either way — the prompt is an addition to it, never a
    // condition of it.
    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-pickup-code`)).toBeOnTheScreen();
  });

  it('still shows the order when the profile cannot be read', async () => {
    // Fails closed, and the confirmation is what the parent came here for. A prompt that could
    // take the pickup code down with it would be a name field breaking a paid order.
    api.setApiTransport(null);
    await render(<OrderPlacedScreen order={placedOrder(SETTLED)} />);

    expect(screen.getByTestId(`${ORDER_PLACED_TEST_ID}-pickup-code`)).toHaveTextContent('4821');
    await waitFor(() =>
      expect(screen.queryByTestId(`${ORDER_PLACED_TEST_ID}-name`)).toBeNull(),
    );
  });
});
