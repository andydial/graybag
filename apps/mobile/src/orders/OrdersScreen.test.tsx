import { type ComponentProps } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { auditA11y, formatViolations } from '../a11y/audit';
import { CartProvider } from '../cart/CartContext';
import {
  OrdersScreen as OrdersScreenImpl,
  formatOrderDate,
  splitOrders,
  todayInIndia,
  type OrderSummary,
} from './OrdersScreen';

/**
 * These are presentation tests, and the ordinary case they describe is a settled, signed-in
 * session. The component's own default is `pending` — it claims nothing until told — so the
 * default is supplied here rather than by the component, and the cases that are *about*
 * `access` still pass it explicitly and override this.
 */
const OrdersScreen = (props: ComponentProps<typeof OrdersScreenImpl>) => (
  <OrdersScreenImpl access="signedIn" {...props} />
);


/**
 * `docs/ux-spec.md` §5.14, against `docs/prototype/graybag-prototype.html#orders,signedin`.
 *
 * Two things this file leans on hard, both of them §5.21: **an empty list, a failed read and a
 * signed-out visitor are three different screens**, and a cached list says so. Each is asserted
 * separately, because the defect this spec exists to prevent is exactly the one where they
 * collapse into each other and the app tells a parent their order history is gone.
 */

const TODAY = '2026-08-10';

const order = (over: Partial<OrderSummary> = {}): OrderSummary => ({
  orderGroupId: 'og-1',
  serviceDate: '2026-08-12',
  recipientName: 'Aarav',
  itemCount: 2,
  totalPaise: 16276,
  status: 'paid',
  ...over,
});

/** `BrandHeader` reads the cart badge, so every render needs the provider. */
const renderScreen = (ui: ReactElement) => render(<CartProvider>{ui}</CartProvider>);

describe('OrdersScreen', () => {
  // The route's identity is the route, not whether it happens to have anything on it. A
  // testID that appears only in the happy state is a navigation test passing for the wrong
  // reason — one render per case, because two renders in one test share a `screen`.
  it.each([
    ['empty', <OrdersScreen key="empty" />],
    ['loading', <OrdersScreen key="loading" state="loading" />],
    ['error', <OrdersScreen key="error" state="error" />],
    ['signed out', <OrdersScreen key="out" access="signedOut" />],
    ['loaded', <OrdersScreen key="loaded" orders={[order()]} today={TODAY} />],
  ])('is the Orders route when it is %s', async (_name, ui) => {
    await renderScreen(ui);
    expect(screen.getByTestId('screen-orders')).toBeTruthy();
  });

  // The whole reason the orders arrive as a prop: with no `api.fetchOrders`, "no orders" is
  // the only thing this build can honestly say.
  it('renders the empty state when it is given nothing, which is the default', async () => {
    await renderScreen(<OrdersScreen />);

    expect(screen.getByTestId('orders-empty')).toBeTruthy();
    expect(screen.getByText('No orders yet')).toBeTruthy();
  });

  it('invites an empty-handed parent to the menu rather than asking them to sign in', async () => {
    const onBrowseMenu = jest.fn();
    await renderScreen(<OrdersScreen onBrowseMenu={onBrowseMenu} />);

    await userEvent.press(screen.getByText('Browse the menu'));
    expect(onBrowseMenu).toHaveBeenCalled();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  // §5.21, Orders: signed out is a prompt. Not an empty history, not an error, and — `AR7` —
  // not a wall: the words explain what signing in gets you.
  it('prompts a signed-out visitor instead of showing an empty history or an error', async () => {
    const onSignIn = jest.fn();
    await renderScreen(<OrdersScreen access="signedOut" onSignIn={onSignIn} />);

    expect(screen.getByTestId('orders-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('orders-empty')).toBeNull();
    expect(screen.queryByTestId('orders-error')).toBeNull();

    await userEvent.press(screen.getByText('Sign in'));
    expect(onSignIn).toHaveBeenCalled();
  });

  // A signed-out read was never attempted, so it cannot have failed.
  it('prefers the sign-in prompt over an error when both are true', async () => {
    await renderScreen(<OrdersScreen access="signedOut" state="error" />);

    expect(screen.getByTestId('orders-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('orders-error')).toBeNull();
  });

  it('offers a retry when the read failed', async () => {
    const onRetry = jest.fn();
    await renderScreen(<OrdersScreen state="error" onRetry={onRetry} />);

    expect(screen.getByTestId('orders-error')).toBeTruthy();
    await userEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows skeleton rows on a first load', async () => {
    await renderScreen(<OrdersScreen state="loading" />);

    expect(screen.getByTestId('orders-loading')).toBeTruthy();
    expect(screen.queryByTestId('orders-empty')).toBeNull();
  });

  // `S5`: a skeleton is for a first load. A background refresh must not blank out history a
  // parent is reading.
  it('keeps the orders it has while refreshing rather than reverting to skeletons', async () => {
    await renderScreen(<OrdersScreen state="loading" orders={[order()]} today={TODAY} />);

    expect(screen.queryByTestId('orders-loading')).toBeNull();
    expect(screen.getByTestId('order-row-og-1')).toBeTruthy();
  });

  it('says when the list came from cache, quietly and without hiding it', async () => {
    await renderScreen(<OrdersScreen stale orders={[order()]} today={TODAY} />);

    expect(screen.getByTestId('orders-stale')).toBeTruthy();
    expect(screen.getByTestId('order-row-og-1')).toBeTruthy();
  });

  it('says nothing about cache when the read was live', async () => {
    await renderScreen(<OrdersScreen orders={[order()]} today={TODAY} />);
    expect(screen.queryByTestId('orders-stale')).toBeNull();
  });

  describe('a row', () => {
    it('reads as the date, the person, the count and the total', async () => {
      await renderScreen(<OrdersScreen orders={[order()]} today={TODAY} />);

      expect(screen.getByText('Wed 12 Aug · Aarav')).toBeTruthy();
      expect(screen.getByText('2 items · ₹162.76')).toBeTruthy();
    });

    it('singularises a one-item order', async () => {
      await renderScreen(
        <OrdersScreen orders={[order({ itemCount: 1, totalPaise: 8925 })]} today={TODAY} />,
      );
      expect(screen.getByText('1 item · ₹89.25')).toBeTruthy();
    });

    // The product is recipient-neutral: an adult may order for themselves, and the row still
    // has to say who it is for.
    it('says "You" when the order is the account holder\'s own', async () => {
      await renderScreen(
        <OrdersScreen orders={[order({ recipientName: null })]} today={TODAY} />,
      );
      expect(screen.getByText('Wed 12 Aug · You')).toBeTruthy();
    });

    it('opens the order it was tapped on', async () => {
      const onSelectOrder = jest.fn();
      await renderScreen(
        <OrdersScreen orders={[order()]} today={TODAY} onSelectOrder={onSelectOrder} />,
      );

      await userEvent.press(screen.getByTestId('order-row-og-1'));
      expect(onSelectOrder).toHaveBeenCalledWith('og-1');
    });

    it('stays readable when nothing is wired to it yet', async () => {
      await renderScreen(<OrdersScreen orders={[order()]} today={TODAY} />);
      await userEvent.press(screen.getByTestId('order-row-og-1'));
      expect(screen.getByTestId('order-row-og-1')).toBeTruthy();
    });
  });

  describe('status', () => {
    // §2.10: colour never carries meaning alone. Green-good / red-bad is the worst pair for
    // deuteranopia, so the word is the carrier and the colour reinforces it.
    it.each([
      ['paid', 'Paid'],
      ['delivered', 'Delivered'],
      ['refunded', 'Refunded'],
      ['cancelled', 'Cancelled'],
      ['preparing', 'With the kitchen'],
      ['pending_payment', 'Payment pending'],
      ['draft', 'Draft'],
    ] as const)('renders %s as the word "%s"', async (status, word) => {
      await renderScreen(<OrdersScreen orders={[order({ status })]} today={TODAY} />);
      expect(screen.getByText(word)).toBeTruthy();
    });

    // The status is the only part of the row carrying colour, so it is the part that must
    // survive into the accessibility label. `ListRow` would have dropped it.
    it('reaches a screen reader as part of the row, not only as a colour', async () => {
      await renderScreen(<OrdersScreen orders={[order({ status: 'refunded' })]} today={TODAY} />);

      expect(screen.getByLabelText('Wed 12 Aug · Aarav, 2 items · ₹162.76, Refunded')).toBeTruthy();
    });
  });

  describe('upcoming and past', () => {
    const UPCOMING = order({ orderGroupId: 'og-up', serviceDate: '2026-08-12', status: 'paid' });
    const PAST = order({
      orderGroupId: 'og-past',
      serviceDate: '2026-08-08',
      status: 'delivered',
    });

    it('draws both headings when both halves have something in them', async () => {
      await renderScreen(<OrdersScreen orders={[PAST, UPCOMING]} today={TODAY} />);

      expect(screen.getByText('Upcoming')).toBeTruthy();
      expect(screen.getByText('Past')).toBeTruthy();
    });

    it('omits a heading with nothing under it', async () => {
      await renderScreen(<OrdersScreen orders={[UPCOMING]} today={TODAY} />);

      expect(screen.getByText('Upcoming')).toBeTruthy();
      expect(screen.queryByText('Past')).toBeNull();
    });
  });

  it('has no unnamed or undersized controls', async () => {
    await renderScreen(
      <OrdersScreen orders={[order(), order({ orderGroupId: 'og-2' })]} today={TODAY} />,
    );

    const violations = auditA11y(screen);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });
});

describe('splitOrders', () => {
  it('puts a future order that is still live under upcoming', () => {
    const { upcoming, past } = splitOrders([order({ serviceDate: '2026-08-12' })], TODAY);
    expect(upcoming).toHaveLength(1);
    expect(past).toHaveLength(0);
  });

  it("counts today's order as upcoming", () => {
    const { upcoming } = splitOrders([order({ serviceDate: TODAY })], TODAY);
    expect(upcoming).toHaveLength(1);
  });

  // A date test alone leaves this morning's delivered lunch sitting under "Upcoming" all
  // afternoon, which is the row telling a parent food is still coming when it has been eaten.
  it('moves a delivered order out of upcoming even when it is for today', () => {
    const { upcoming, past } = splitOrders(
      [order({ serviceDate: TODAY, status: 'delivered' })],
      TODAY,
    );
    expect(upcoming).toHaveLength(0);
    expect(past).toHaveLength(1);
  });

  it.each(['cancelled', 'refunded'] as const)(
    'treats a %s order as history however far ahead its date is',
    (status) => {
      const { upcoming, past } = splitOrders(
        [order({ serviceDate: '2026-12-25', status })],
        TODAY,
      );
      expect(upcoming).toHaveLength(0);
      expect(past).toHaveLength(1);
    },
  );

  it('reads upcoming soonest-first and past most-recent-first', () => {
    const orders = [
      order({ orderGroupId: 'a', serviceDate: '2026-08-14' }),
      order({ orderGroupId: 'b', serviceDate: '2026-08-11' }),
      order({ orderGroupId: 'c', serviceDate: '2026-08-01', status: 'delivered' }),
      order({ orderGroupId: 'd', serviceDate: '2026-08-08', status: 'delivered' }),
    ];

    const { upcoming, past } = splitOrders(orders, TODAY);
    expect(upcoming.map((o) => o.orderGroupId)).toEqual(['b', 'a']);
    expect(past.map((o) => o.orderGroupId)).toEqual(['d', 'c']);
  });

  it('breaks a same-day tie deterministically rather than however the server sorted it', () => {
    const same = (id: string) => order({ orderGroupId: id, serviceDate: '2026-08-12' });
    expect(splitOrders([same('z'), same('a')], TODAY).upcoming.map((o) => o.orderGroupId)).toEqual([
      'a',
      'z',
    ]);
  });
});

describe('formatOrderDate', () => {
  it('renders the weekday, the day and the short month, with no comma', () => {
    expect(formatOrderDate('2026-08-12')).toBe('Wed 12 Aug');
  });

  /**
   * The bug `menu/dates.ts` was written to prevent, checked here rather than assumed: a date
   * formatted through the device's zone renders as the day before for anyone west of UTC, and
   * a parent then reads the wrong lunch day off the list.
   */
  it('is the service date itself whatever zone the device is in', () => {
    const original = process.env.TZ;
    try {
      const answers = new Set<string>();
      for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        answers.add(formatOrderDate('2026-08-12'));
      }
      expect([...answers]).toEqual(['Wed 12 Aug']);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('renders something rather than throwing on a value that is not a service date', () => {
    expect(formatOrderDate('not a date')).toBe('not a date');
  });
});

describe('todayInIndia', () => {
  // 18:45 UTC is already the next day in IST, and an order for "tomorrow" placed at that hour
  // must not fall into Past.
  it('rolls over at 18:30 UTC, because IST is a fixed +05:30', () => {
    expect(todayInIndia(new Date('2026-08-10T18:29:00Z'))).toBe('2026-08-10');
    expect(todayInIndia(new Date('2026-08-10T18:31:00Z'))).toBe('2026-08-11');
  });
});
