import { render, screen, userEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { auditA11y, formatViolations } from '../a11y/audit';
import {
  OrderDetailScreen,
  buildTimeline,
  cancelAvailability,
  formatDeadline,
  formatMoment,
  formatServiceDateLong,
  invoiceFootnote,
  type OrderDetail,
} from './OrderDetailScreen';

/**
 * `docs/ux-spec.md` §5.15, against `docs/prototype/graybag-prototype.html#orderdetail,signedin`.
 *
 * Three things this file leans on hard, because each is a rule that a well-meaning change
 * quietly breaks:
 *
 * **A closed cancellation window is a sentence, not a missing button** (§5.15, §9.2 E5). The
 * absence of a control and the absence of a feature look identical, so the reason is asserted
 * as text on the screen rather than as the button's absence.
 *
 * **A pickup code that does not exist renders as nothing** (§9.4) — not a dash, not four
 * zeroes, not "pending". A code is something a parent quotes at a counter.
 *
 * **Every timeline step says its state in words**, because a filled dot, a ring and a grey
 * circle are three shades of one shape and, to a screen reader, are nothing at all.
 */

/** 2026-08-12 is a Wednesday. The cutoff for it is midnight IST at the start of that day. */
const SERVICE_DATE = '2026-08-12';
const CLOSES_AT = '2026-08-11T18:30:00.000Z'; // 12:00 AM IST on Wed 12 August
const BEFORE = new Date('2026-08-11T10:00:00.000Z');
const AFTER = new Date('2026-08-11T19:00:00.000Z');

const detail = (over: Partial<OrderDetail> = {}): OrderDetail => ({
  orderGroupId: 'og-1',
  status: 'paid',
  checkoutResumable: false,
  serviceDate: SERVICE_DATE,
  recipientName: 'Aarav',
  classLabel: '5',
  sectionLabel: 'A',
  schoolName: 'Alpha Public School',
  breakLabel: 'Morning break',
  lines: [{ key: 'ol-1', name: 'Paneer Wrap', quantity: 1, unitPricePaise: 9500 }],
  totals: { taxablePaise: 15500, cgstPaise: 388, sgstPaise: 388, totalPaise: 16276 },
  pickupCode: '4821',
  placedAt: '2026-08-10T15:44:00.000Z',
  paidAt: '2026-08-10T15:44:00.000Z',
  preparingAt: null,
  deliveredAt: null,
  cancellationClosesAt: CLOSES_AT,
  cancellationAllowed: true,
  refund: 'none',
  invoiceNumber: 'GB-2026-00417',
  ...over,
});

/** No provider needed: this screen reads no context — everything it shows is a prop. */
const renderScreen = (ui: ReactElement) => render(ui);

describe('OrderDetailScreen', () => {
  // The route's identity is the route, not whether the read happened to succeed. A testID
  // that appears only in the happy state is a navigation test passing for the wrong reason.
  it.each([
    ['loading', <OrderDetailScreen key="l" state="loading" />],
    ['empty', <OrderDetailScreen key="e" />],
    ['error', <OrderDetailScreen key="x" state="error" />],
    ['loaded', <OrderDetailScreen key="d" order={detail()} now={BEFORE} />],
  ])('is the Order detail route when it is %s', async (_name, ui) => {
    await renderScreen(ui);
    expect(screen.getByTestId('screen-order-detail')).toBeTruthy();
  });

  // The whole reason the order arrives as a prop: with no `api.fetchOrder`, "we don't have
  // it" is the only thing this build can honestly say.
  it('says it has nothing rather than inventing an order, which is the default', async () => {
    await renderScreen(<OrderDetailScreen />);

    expect(screen.getByTestId('screen-order-detail-empty')).toBeTruthy();
    expect(screen.queryByTestId('screen-order-detail-timeline')).toBeNull();
    expect(screen.queryByTestId('screen-order-detail-pickup-code')).toBeNull();
  });

  it('offers the menu when there is nothing to show and something is wired to it', async () => {
    const onBackToMenu = jest.fn();
    await renderScreen(<OrderDetailScreen onBackToMenu={onBackToMenu} />);

    await userEvent.press(screen.getByText('Back to menu'));
    expect(onBackToMenu).toHaveBeenCalled();
  });

  it('offers a retry when the read failed', async () => {
    const onRetry = jest.fn();
    await renderScreen(<OrderDetailScreen state="error" onRetry={onRetry} />);

    expect(screen.getByTestId('screen-order-detail-error')).toBeTruthy();
    await userEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows a skeleton on a first load', async () => {
    await renderScreen(<OrderDetailScreen state="loading" />);

    expect(screen.getByTestId('screen-order-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('screen-order-detail-empty')).toBeNull();
  });

  // `S5`: a skeleton is for a first load. A background refresh must not blank out an order a
  // parent is reading — least of all its pickup code, ten feet from the counter.
  it('keeps the order it has while refreshing rather than reverting to a skeleton', async () => {
    await renderScreen(<OrderDetailScreen state="loading" order={detail()} now={BEFORE} />);

    expect(screen.queryByTestId('screen-order-detail-loading')).toBeNull();
    expect(screen.getByTestId('screen-order-detail-pickup-code')).toBeTruthy();
  });

  it('says when the order came from cache, quietly and without hiding it', async () => {
    await renderScreen(<OrderDetailScreen stale order={detail()} now={BEFORE} />);

    expect(screen.getByTestId('screen-order-detail-stale')).toBeTruthy();
    expect(screen.getByTestId('screen-order-detail-timeline')).toBeTruthy();
  });

  it('says nothing about cache when the read was live', async () => {
    await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);
    expect(screen.queryByTestId('screen-order-detail-stale')).toBeNull();
  });

  describe('who it is for', () => {
    it('names the child, the class, the school, the break and the day', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);

      expect(screen.getByText('Aarav · Class 5-A')).toBeTruthy();
      expect(screen.getByText('Alpha Public School')).toBeTruthy();
      expect(screen.getByText('Morning break · Wednesday 12 August')).toBeTruthy();
    });

    // Recipient-neutral: an adult may order for themselves, and the screen still has to say
    // whose lunch it is.
    it('reads "You" when the order is the account holder\'s own', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ recipientName: null, classLabel: null, sectionLabel: null })}
          now={BEFORE}
        />,
      );
      expect(screen.getByText('You')).toBeTruthy();
    });

    // §5.21: an unresolved break is omitted and said to be unresolved, never guessed.
    it('does not invent a break time it has not been given', async () => {
      // The "confirmed with the kitchen" line this used to assert is gone (`P19`). Every order
      // placed from now on carries a break the parent chose; one without a label is a legacy
      // row, and the honest rendering of an unknown is to omit it rather than to explain it
      // away with a promise nobody can keep.
      await renderScreen(<OrderDetailScreen order={detail({ breakLabel: null })} now={BEFORE} />);

      expect(screen.getByText('Wednesday 12 August')).toBeTruthy();
      expect(screen.queryByTestId('screen-order-detail-for-break-unknown')).toBeNull();
      expect(screen.queryByText(/confirm(ed)? with the kitchen/i)).toBeNull();
    });
  });

  describe('the pickup code', () => {
    it('shows the code once money has been captured', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);

      expect(screen.getByTestId('screen-order-detail-pickup-code')).toBeTruthy();
      expect(screen.getByText('Pickup code 4821')).toBeTruthy();
    });

    // §9.4: the code is allocated on capture. Before that there is none, and a placeholder is
    // a number a parent could try to quote at a counter for an order nobody has paid for.
    it('shows nothing at all before capture, not a placeholder', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'pending_payment', pickupCode: null, paidAt: null })}
          now={BEFORE}
        />,
      );

      expect(screen.queryByTestId('screen-order-detail-pickup-code')).toBeNull();
      expect(screen.queryByText(/pickup code/i)).toBeNull();
    });

    // "Four thousand eight hundred and twenty-one" is not a code you can repeat at a counter.
    it('reads out digit by digit', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);
      expect(screen.getByLabelText('Pickup code 4 8 2 1')).toBeTruthy();
    });
  });

  describe('the timeline', () => {
    it('draws the four steps of the progression', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);

      expect(screen.getByTestId('screen-order-detail-timeline')).toBeTruthy();
      expect(screen.getByText('Order placed')).toBeTruthy();
      expect(screen.getByText('Payment confirmed')).toBeTruthy();
      expect(screen.getByText('With the kitchen')).toBeTruthy();
      expect(screen.getByText('Delivered to Aarav')).toBeTruthy();
    });

    // §2.10: a filled dot, a ring and a grey circle carry the whole meaning visually, and
    // none of it to a screen reader. The word is the carrier.
    it('says each step\'s state in words, not only as a dot', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);

      expect(screen.getByLabelText(/^Order placed,.*, done$/)).toBeTruthy();
      expect(screen.getByLabelText(/^With the kitchen,.*, happening now$/)).toBeTruthy();
      expect(screen.getByLabelText(/^Delivered to Aarav, still to come$/)).toBeTruthy();
    });

    it('timestamps the steps that have happened', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);
      expect(screen.getAllByText('10 Aug, 9:14 PM')).toHaveLength(2);
    });
  });

  describe('the items and the totals', () => {
    it('renders each line as its quantity, its unit price and its line total', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);

      expect(screen.getByText('Paneer Wrap')).toBeTruthy();
      expect(screen.getByText('1 × ₹95.00')).toBeTruthy();
    });

    // `M2`, `SC2`: one state, so the split is always CGST 2.5% + SGST 2.5% and there is no
    // IGST row to write.
    it('shows the GST split the invoice will show', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);

      expect(screen.getByTestId('screen-order-detail-totals')).toBeTruthy();
      expect(screen.getByTestId('screen-order-detail-totals-subtotal')).toHaveTextContent('₹155.00');
      expect(screen.getByTestId('screen-order-detail-totals-cgst')).toHaveTextContent('₹3.88');
      expect(screen.getByTestId('screen-order-detail-totals-sgst')).toHaveTextContent('₹3.88');
      expect(screen.getByTestId('screen-order-detail-totals-total')).toHaveTextContent('₹162.76');
      expect(screen.queryByText(/IGST/)).toBeNull();
    });

    it('calls the last row "Total paid" once money has actually moved', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);
      expect(screen.getByText('Total paid')).toBeTruthy();
    });

    // A receipt that says "paid" over an unpaid order is the §5.21 mistake with a currency
    // symbol on it.
    it('calls it "Total" while the payment is still pending', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'pending_payment', pickupCode: null, paidAt: null })}
          now={BEFORE}
        />,
      );
      expect(screen.getByText('Total')).toBeTruthy();
      expect(screen.queryByText('Total paid')).toBeNull();
    });
  });

  describe('cancelling', () => {
    it('offers the button while the window is open, and says when it shuts', async () => {
      const onCancel = jest.fn();
      await renderScreen(
        <OrderDetailScreen order={detail()} now={BEFORE} onCancel={onCancel} />,
      );

      await userEvent.press(screen.getByTestId('screen-order-detail-cancel'));
      expect(onCancel).toHaveBeenCalled();
      expect(screen.getByTestId('screen-order-detail-cancel-closes')).toHaveTextContent(
        /Cancelling closes at 12:00 AM.*on Wednesday 12 August\./,
      );
    });

    /**
     * The rule this whole screen exists to get right. §5.15: "not cancellable (with the
     * reason, not a hidden button)". A control that vanishes and a control that was never
     * built look identical, and the parent's next move is a support ticket asking where it
     * went — which is the outcome the reason is there to prevent.
     */
    it('replaces the button with the reason once the window has closed, and offers a human', async () => {
      const onContactSupport = jest.fn();
      await renderScreen(
        <OrderDetailScreen
          order={detail()}
          now={AFTER}
          onCancel={jest.fn()}
          onContactSupport={onContactSupport}
        />,
      );

      expect(screen.getByText('This order can no longer be cancelled')).toBeTruthy();
      expect(screen.getByTestId('screen-order-detail-cancel-reason')).toHaveTextContent(
        /Cancelling closed at 12:00 AM/,
      );
      expect(screen.queryByTestId('screen-order-detail-cancel-closes')).toBeNull();

      await userEvent.press(screen.getByTestId('screen-order-detail-cancel-support'));
      expect(onContactSupport).toHaveBeenCalled();
    });

    // `C1`: the guard is `now() < closes_at`, strict. Exactly at the boundary it is closed.
    it('is closed exactly at the boundary, not one second after it', async () => {
      await renderScreen(
        <OrderDetailScreen order={detail()} now={new Date(CLOSES_AT)} onCancel={jest.fn()} />,
      );
      expect(screen.getByTestId('screen-order-detail-cancel-reason')).toBeTruthy();
    });

    it('keeps the label and adds an indicator while the cancellation is in flight', async () => {
      await renderScreen(
        <OrderDetailScreen order={detail()} now={BEFORE} cancelling onCancel={jest.fn()} />,
      );

      expect(screen.getByText('Cancel this order')).toBeTruthy();
      expect(screen.getByTestId('screen-order-detail-cancelling')).toBeTruthy();
    });

    // T11/T12: past `paid` only a kitchen or an admin may cancel, and they are not
    // cutoff-bound — so "too late" would be the wrong reason as well as the wrong word.
    it('says the kitchen has it, rather than that time ran out', async () => {
      await renderScreen(
        <OrderDetailScreen order={detail({ status: 'preparing' })} now={BEFORE} />,
      );
      expect(screen.getByTestId('screen-order-detail-cancel-reason')).toHaveTextContent(
        /kitchen has already started/,
      );
    });

    it('says nothing about cancelling an order that is already cancelled', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'cancelled', refund: 'pending' })}
          now={BEFORE}
        />,
      );
      expect(screen.queryByTestId('screen-order-detail-cancel')).toBeNull();
      expect(screen.queryByTestId('screen-order-detail-cancel-reason')).toBeNull();
    });
  });

  describe('refunds', () => {
    it('names the amount and says the refund is approved, without promising a date', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'cancelled', refund: 'pending' })}
          now={BEFORE}
        />,
      );

      // The notice by id, not by a word the screen now says twice — the timeline step and the
      // notice share the title, exactly as they already do for "Refunded" below.
      const notice = screen.getByTestId('screen-order-detail-refund');
      expect(notice).toHaveTextContent(/₹162\.76/);
      expect(notice).toHaveTextContent(/Refund approved/);
    });

    // Twice over: the timeline step and the notice. Both are "Refunded", which is why this
    // asserts the notice by id rather than by a word the screen says in two places.
    it('says when the money is back', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'refunded', refund: 'completed' })}
          now={BEFORE}
        />,
      );
      expect(screen.getByTestId('screen-order-detail-refund')).toHaveTextContent(
        /Refunded.*₹162\.76 has gone back/,
      );
    });

    /**
     * §10.12. The refund row is terminal at `failed`, an admin raises a new one, and the order
     * stays `cancelled` — so the true sentence is "we are on it", and the parent must not be
     * left to discover a missing credit on a statement in a fortnight.
     */
    it('owns a failed refund and routes to a human', async () => {
      const onContactSupport = jest.fn();
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'cancelled', refund: 'failed' })}
          now={BEFORE}
          onContactSupport={onContactSupport}
        />,
      );

      expect(screen.getByText("Your refund hasn't reached you yet")).toBeTruthy();
      expect(screen.getByTestId('screen-order-detail-refund')).toHaveTextContent(/we are on it/i);

      await userEvent.press(screen.getByTestId('screen-order-detail-refund-support'));
      expect(onContactSupport).toHaveBeenCalled();
    });

    it('never claims a failed refund has been paid back', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'cancelled', refund: 'failed' })}
          now={BEFORE}
        />,
      );
      expect(screen.queryByText('Refunded')).toBeNull();
    });
  });

  describe('the invoice footnote', () => {
    it('names the invoice and the tax when one exists', async () => {
      await renderScreen(<OrderDetailScreen order={detail()} now={BEFORE} />);
      expect(screen.getByTestId('screen-order-detail-invoice')).toHaveTextContent(
        'Invoice GB-2026-00417 · GST 5% (CGST 2.5% + SGST 2.5%) · Mohali, Punjab',
      );
    });

    // `I6`/`M3`: no capture, no invoice. An empty "Invoice ·" reads as a missing field.
    it('says where the invoice will be when there is not one yet', async () => {
      await renderScreen(
        <OrderDetailScreen
          order={detail({ status: 'pending_payment', invoiceNumber: null, pickupCode: null })}
          now={BEFORE}
        />,
      );
      expect(screen.getByTestId('screen-order-detail-invoice')).toHaveTextContent(
        /invoice appears here once the payment is confirmed/,
      );
    });
  });

  it('has no unnamed or undersized controls', async () => {
    await renderScreen(
      <OrderDetailScreen
        order={detail()}
        now={BEFORE}
        onCancel={jest.fn()}
        onContactSupport={jest.fn()}
      />,
    );

    const violations = auditA11y(screen);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });

  it('has no unnamed or undersized controls in its refused-cancellation state either', async () => {
    await renderScreen(
      <OrderDetailScreen
        order={detail({ status: 'cancelled', refund: 'failed' })}
        now={AFTER}
        onContactSupport={jest.fn()}
      />,
    );

    const violations = auditA11y(screen);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });
});

describe('cancelAvailability', () => {
  it('is available inside the window on a paid order', () => {
    expect(cancelAvailability(detail(), BEFORE).kind).toBe('available');
  });

  it.each([
    ['delivered', detail({ status: 'delivered' }), /already been delivered/],
    ['preparing', detail({ status: 'preparing' }), /kitchen has already started/],
  ] as const)('refuses a %s order with a reason', (_name, order, reason) => {
    const result = cancelAvailability(order, BEFORE);
    expect(result.kind).toBe('closed');
    if (result.kind === 'closed') expect(result.reason).toMatch(reason);
  });

  /**
   * **`E05-54`. This assertion used to pin a sentence that was not true.**
   *
   * It required `pending_payment` to be `closed` with the reason *"it will close by itself if
   * the payment does not come through"*. Nothing closed it: there was no expiry, no job and no
   * cron, and two parents on production sat behind that sentence for six days with an order
   * they could neither pay nor cancel — which also blocked deleting the child it named.
   *
   * The test was green throughout, because it asserted the copy rather than the mechanism. It is
   * changed rather than deleted: an unpaid order is now its own `kind`, with both actions real.
   */
  it('offers an unpaid order both ways out, rather than a false promise', () => {
    const resumable = cancelAvailability(
      detail({ status: 'pending_payment', checkoutResumable: true }), BEFORE);
    expect(resumable.kind).toBe('unpaid');
    if (resumable.kind === 'unpaid') expect(resumable.resumable).toBe(true);
  });

  it('stops offering to finish a checkout that has expired', () => {
    // `checkout_expires_at` never runs past the cutoff, so this is also the case where the
    // kitchen can no longer make the food. Offering to pay for it would be a worse lie than
    // the one this replaces.
    const expired = cancelAvailability(
      detail({ status: 'pending_payment', checkoutResumable: false }), AFTER);
    expect(expired.kind).toBe('unpaid');
    if (expired.kind === 'unpaid') expect(expired.resumable).toBe(false);
  });

  // The other half of T10's guard, and a config flag rather than a clock — so "too late"
  // would be a lie as well as unhelpful.
  it('refuses when the kitchen does not take app cancellations at all', () => {
    const result = cancelAvailability(detail({ cancellationAllowed: false }), BEFORE);
    expect(result.kind).toBe('closed');
    if (result.kind === 'closed') expect(result.reason).toMatch(/doesn't take cancellations/);
  });

  /**
   * §5.21 applied to a control: an unknown is not a yes. Offering a cancel we cannot evaluate
   * is a promise the server would refuse anyway, since E5 is re-checked in the transaction.
   */
  it.each([null, 'not-a-timestamp'])('refuses rather than guessing when the deadline is %s', (closesAt) => {
    const result = cancelAvailability(detail({ cancellationClosesAt: closesAt }), BEFORE);
    expect(result.kind).toBe('closed');
    if (result.kind === 'closed') expect(result.reason).toMatch(/can't tell when cancelling closes/);
  });

  it('has nothing to say about an order that is already cancelled or refunded', () => {
    expect(cancelAvailability(detail({ status: 'cancelled' }), BEFORE).kind).toBe('none');
    expect(cancelAvailability(detail({ status: 'refunded' }), BEFORE).kind).toBe('none');
  });
});

describe('buildTimeline', () => {
  const states = (order: OrderDetail) =>
    buildTimeline(order).map((step) => `${step.key}:${step.state}`);

  it('puts the ring on the first step that has not happened', () => {
    expect(states(detail({ status: 'pending_payment', paidAt: null }))).toEqual([
      'placed:done',
      'payment:current',
      'kitchen:todo',
      'delivered:todo',
    ]);
  });

  // The prototype draws this exactly so: a paid order's ring sits on "With the kitchen",
  // because that is what happens next. On the last *completed* step it would look finished.
  it('looks forward on a paid order rather than looking finished', () => {
    expect(states(detail())).toEqual([
      'placed:done',
      'payment:done',
      'kitchen:current',
      'delivered:todo',
    ]);
  });

  it('completes every step once the food has been handed over', () => {
    expect(
      states(detail({ status: 'delivered', preparingAt: CLOSES_AT, deliveredAt: CLOSES_AT })),
    ).toEqual(['placed:done', 'payment:done', 'kitchen:done', 'delivered:done']);
  });

  /**
   * A cancelled order gets a different tail, not a greyed-out one. Drawing "With the kitchen"
   * and "Delivered" as pending under a cancelled order tells a parent food is still coming.
   */
  it('ends a cancelled order at cancelled rather than leaving food in transit', () => {
    expect(states(detail({ status: 'cancelled' }))).toEqual([
      'placed:done',
      'payment:done',
      'cancelled:done',
    ]);
  });

  it('adds the refund as its own step, and never marks a failed one done', () => {
    expect(states(detail({ status: 'cancelled', refund: 'pending' }))).toContain('refund:current');
    expect(states(detail({ status: 'refunded', refund: 'completed' }))).toContain('refund:done');
    expect(states(detail({ status: 'cancelled', refund: 'failed' }))).toContain('refund:current');
  });

  // T6: an unpaid order can be cancelled too. Marking its payment step done would be a claim
  // that money moved.
  it('does not claim a payment happened on an order cancelled before it was paid', () => {
    expect(states(detail({ status: 'cancelled', paidAt: null }))).toContain('payment:todo');
  });

  it('names the recipient on the delivery step, and does not when there is none', () => {
    expect(buildTimeline(detail())[3]?.title).toBe('Delivered to Aarav');
    expect(buildTimeline(detail({ recipientName: null }))[3]?.title).toBe('Delivered');
  });
});

describe('date and time copy', () => {
  it('spells the service date out in full', () => {
    expect(formatServiceDateLong('2026-08-12')).toBe('Wednesday 12 August');
  });

  /**
   * The bug `menu/dates.ts` exists to prevent, checked rather than assumed: a service date
   * formatted through the device's zone renders as the day before for anyone west of UTC.
   */
  it('is the service date itself whatever zone the device is in', () => {
    const original = process.env.TZ;
    try {
      const answers = new Set<string>();
      for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        answers.add(formatServiceDateLong('2026-08-12'));
      }
      expect([...answers]).toEqual(['Wednesday 12 August']);
    } finally {
      process.env.TZ = original;
    }
  });

  it('renders an instant in India time, in 12 hours', () => {
    expect(formatMoment('2026-08-10T15:44:00.000Z')).toBe('10 Aug, 9:14 PM');
  });

  it('renders nothing for a step that has not happened', () => {
    expect(formatMoment(null)).toBeNull();
  });

  /**
   * `R7`: a cutoff is written in full — weekday, date and time — never a bare "00:00", which
   * is ambiguous about which midnight and reads a whole day wrong (`C5`). The prototype's own
   * copy makes exactly that mistake; this is the corrected version.
   */
  it('writes a deadline out in full, with no bare midnight', () => {
    expect(formatDeadline(CLOSES_AT, 'Asia/Kolkata')).toBe('12:00 AM on Wednesday 12 August');
  });

  // `C4`: a parent in London must not read the school's midnight as their own.
  it('names the zone only when the device is not on India time', () => {
    expect(formatDeadline(CLOSES_AT, 'Europe/London')).toBe(
      '12:00 AM IST on Wednesday 12 August',
    );
    expect(formatDeadline(CLOSES_AT, null)).toContain('IST');
  });
});

describe('invoiceFootnote', () => {
  it('is one state, one rate, and no IGST line', () => {
    expect(invoiceFootnote('GB-2026-00417')).toBe(
      'Invoice GB-2026-00417 · GST 5% (CGST 2.5% + SGST 2.5%) · Mohali, Punjab',
    );
  });

  it('says where the number will be rather than leaving a gap', () => {
    expect(invoiceFootnote(null)).toMatch(/appears here once the payment is confirmed/);
  });
});

/**
 * `E05-54`. **The screen has to offer a way out of an unpaid order, in both directions.**
 *
 * Before this, `pending_payment` rendered a notice saying the order would "close by itself if
 * the payment does not come through". Nothing closed it, there was no button, and two parents on
 * production sat there for six days with an order they could neither pay nor cancel — which also
 * blocked deleting the child it named.
 *
 * `orphans.test.ts` covers whether the handlers are wired by the navigator. These assert what a
 * parent can actually see and press.
 */
describe('OrderDetailScreen — an unpaid checkout', () => {
  const unpaid = (over = {}) =>
    detail({ status: 'pending_payment', pickupCode: null, paidAt: null, invoiceNumber: null, ...over });

  it('offers to finish paying while the checkout is still resumable', async () => {
    await renderScreen(
      <OrderDetailScreen
        order={unpaid({ checkoutResumable: true })}
        now={BEFORE}
        onResumePayment={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId('screen-order-detail-resume')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-order-detail-abandon')).toBeOnTheScreen();
  });

  it('promises no double charge, because that is the parent’s actual fear', async () => {
    await renderScreen(
      <OrderDetailScreen
        order={unpaid({ checkoutResumable: true })}
        now={BEFORE}
        onResumePayment={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId('screen-order-detail-resume-note')).toHaveTextContent(
      /not be charged twice/,
    );
  });

  it('stops offering to pay once the checkout has expired, but still lets them clear it', async () => {
    // `checkout_expires_at` never runs past the cutoff, so this is also the moment the kitchen
    // can no longer make the food. Still offering to take money would be the worse lie.
    await renderScreen(
      <OrderDetailScreen
        order={unpaid({ checkoutResumable: false })}
        now={AFTER}
        onResumePayment={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId('screen-order-detail-resume')).toBeNull();
    expect(screen.getByTestId('screen-order-detail-resume-expired')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-order-detail-abandon')).toBeOnTheScreen();
  });

  it('never repeats the sentence that was not true', async () => {
    await renderScreen(
      <OrderDetailScreen
        order={unpaid({ checkoutResumable: true })}
        now={BEFORE}
        onResumePayment={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/close by itself/)).toBeNull();
  });
});

/**
 * `E05-56`. **The sweep Andy asked for after `E05-54`: tests that assert copy rather than
 * behaviour, and would stay green while the screen tells a lie.**
 *
 * The pattern to look for is a sentence describing a *mechanism* — "it will close by itself",
 * "we have sent your money" — where the assertion checks the words and nothing checks that the
 * mechanism exists. Two were found in the money screens. This is the second.
 *
 * `cancel_order` records a refund at `pending` and disbursement is **manual** (`E06-46`); no
 * code calls Razorpay's refund API. So a `pending` refund must never claim money has moved, and
 * must not start a clock that has not started.
 */
describe('a pending refund never claims the money has moved', () => {
  const refunded = (state: 'pending' | 'completed') =>
    detail({ status: 'cancelled', refund: state, pickupCode: null });

  it('does not say the money was sent while it is only approved', async () => {
    await renderScreen(<OrderDetailScreen order={refunded('pending')} now={BEFORE} />);
    expect(screen.queryByText(/we have sent/i)).toBeNull();
    expect(screen.queryByText(/has gone back/i)).toBeNull();
  });

  it('quotes no day count from a clock that has not started', async () => {
    // Disbursement is manual, so "5–7 working days" measured from cancellation is a deadline we
    // invented. The number returns when something actually disburses on a schedule.
    await renderScreen(<OrderDetailScreen order={refunded('pending')} now={BEFORE} />);
    expect(screen.queryByText(/working days|business days/i)).toBeNull();
  });

  it('still distinguishes approved from actually refunded', async () => {
    // The fix must not flatten the two states into one vague message — `completed` is the one
    // where the parent really does have their money.
    await renderScreen(<OrderDetailScreen order={refunded('completed')} now={BEFORE} />);
    expect(screen.getByText(/has gone back to the way you paid/i)).toBeOnTheScreen();
  });
});
