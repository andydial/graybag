import { render, screen, userEvent } from '@testing-library/react-native';

import { PackDetailScreen } from './PackDetailScreen';

/**
 * `E21-48`. The screen where a parent decides to hand over money for food not yet made.
 *
 * Two things it owes them **before** they pay rather than after: the expiry, and that packs are
 * not refundable. A term a customer meets first in a policy they did not open is a term they meet
 * after paying.
 */

/** Andy's Pack 1, to the paise: ₹3,000 ex-tax, 20 items, +2 bonus inside 30 days, valid 60. */
const OFFER = {
  id: 'o-1',
  name: 'Pack 1',
  netPricePaise: 300000,
  itemsCount: 20,
  bonusItemsCount: 2,
  bonusWindowDays: 30,
  validityDays: 60,
};

describe('the two terms are stated before the button', () => {
  it('says when the meals expire, and that unused ones are gone', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByTestId('screen-pack-detail-expiry')).toBeTruthy();
    expect(screen.getByText(/Items expire 60 days after purchase/)).toBeTruthy();
    expect(screen.getByText(/Anything unused after that is gone/)).toBeTruthy();
  });

  it('says packs are not refundable, and what IS still cancellable', async () => {
    // The distinction matters: a parent who reads "no refunds" and concludes nothing can ever be
    // cancelled has been told something false about their single orders.
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByTestId('screen-pack-detail-no-refund')).toBeTruthy();
    expect(screen.getByText(/Single orders can still be cancelled/)).toBeTruthy();
  });

  it('repeats the expiry under the button, where the commitment is', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByText(/Expires 60 days after purchase · no refunds/)).toBeTruthy();
  });

  it('reads the validity from the offer rather than assuming 60 days', async () => {
    await render(<PackDetailScreen offer={{ ...OFFER, validityDays: 90 }} />);
    expect(screen.getByText(/Items expire 90 days after purchase/)).toBeTruthy();
  });
});

describe('the price on the button is what will be charged', () => {
  it('shows the PAYABLE amount, GST included', async () => {
    // Menu prices exclude GST (non-negotiable #7). A parent who reads ₹3,000 and is charged
    // ₹3,150 has been surprised at the last step, which is the one place §5.7 says the amount and
    // the commitment must agree.
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByText(/Buy · ₹3,150/)).toBeTruthy();
  });

  it('breaks the tax out, so the headline price is still findable', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    // `formatPaise` always renders two decimals — that is deliberate and documented in
    // `money/index.ts`. My first version of this regex omitted them and failed on the code being
    // right, which is the correct direction for a test to be wrong in.
    expect(screen.getByTestId('screen-pack-detail-gst')).toHaveTextContent(
      /₹3,000\.00 \+ ₹150\.00 GST \(CGST 2\.5% \+ SGST 2\.5%\)/,
    );
  });

  it('makes NO saving claim, because with no price cap there is none to make', async () => {
    // `alacarteReferencePaise` and "save ₹375" are gone. A pack's worth depends entirely on what
    // it is spent on — ₹3,000 buys 20 drinks or 20 mains — so any headline saving would be a
    // claim we cannot stand behind. Asserted as an absence, because that is the decision.
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.queryByText(/save /i)).toBeNull();
  });
});

describe('buying', () => {
  it('says ANY menu item counts as one — no cap, no category', async () => {
    // Andy, 2026-09-16: "Any menu item counts as one item. No price cap, no category exclusions.
    // A ₹40 drink and a ₹250 main each consume exactly one item. This is deliberate."
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByTestId('screen-pack-detail-items')).toHaveTextContent(/20 items/);
    expect(screen.getByTestId('screen-pack-detail-items')).toHaveTextContent(
      /Anything on the menu counts as one item/,
    );
  });

  it('states the bonus rule in plain words, with both numbers from the offer', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    const bonus = screen.getByTestId('screen-pack-detail-bonus');
    expect(bonus).toHaveTextContent(/Use all 20 within 30 days/);
    expect(bonus).toHaveTextContent(/add 2 more, free/);
    // The half of the rule a parent is most likely to assume wrongly.
    expect(bonus).toHaveTextContent(/expire with the pack/);
  });

  it('says nothing about a bonus when the offer has none', async () => {
    // The schema refuses a window with no items, so an offer with bonusItemsCount 0 has no
    // window either — and must say nothing rather than promising zero extra items.
    await render(
      <PackDetailScreen offer={{ ...OFFER, bonusItemsCount: 0, bonusWindowDays: 0 }} />,
    );
    expect(screen.queryByTestId('screen-pack-detail-bonus')).toBeNull();
  });

  it('says the pack is the parent’s, usable for any of their children', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByText(/Use it for any of your children/)).toBeTruthy();
  });

  it('hands the purchase up rather than starting one itself', async () => {
    const onBuy = jest.fn();
    await render(<PackDetailScreen offer={OFFER} onBuy={onBuy} />);
    await userEvent.press(screen.getByTestId('screen-pack-detail-buy'));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed twice while a purchase is starting', async () => {
    // A double tap here is a second pack and a second charge. The server refuses it on the
    // idempotency key; this is what stops the parent seeing a button that looks ignored.
    const onBuy = jest.fn();
    await render(<PackDetailScreen offer={OFFER} buying onBuy={onBuy} />);
    await userEvent.press(screen.getByTestId('screen-pack-detail-buy'));
    expect(onBuy).not.toHaveBeenCalled();
    expect(screen.getByText('Starting…')).toBeTruthy();
  });

  it('renders nothing rather than a broken screen when the offer is gone', async () => {
    await render(<PackDetailScreen offer={null} />);
    expect(screen.getByTestId('screen-pack-detail')).toBeTruthy();
    expect(screen.queryByTestId('screen-pack-detail-buy')).toBeNull();
  });
});

describe('E21-91 — a failure is VISIBLE', () => {
  /**
   * The bug this file exists to prevent a repeat of.
   *
   * `startMealPackPurchase` called the transport wrapper with the wrong argument shape, so the
   * server refused every purchase with a 400 — and the screen's handler had an EMPTY `.catch`.
   * The result was a button that did nothing at all: no sheet, no spinner, no message, several
   * taps, no sign anything had happened. Andy: *"a visible error beats silence."*
   *
   * So the screen now takes an `error` prop and these assert it is actually rendered. A handler
   * that swallows is no longer enough to hide a failure, because the screen has somewhere to put
   * one and a test that notices when it is empty.
   */
  const OFFER_FOR_ERROR = {
    id: 'o-1',
    name: 'Pack 1',
    netPricePaise: 300000,
    itemsCount: 20,
    bonusItemsCount: 2,
    bonusWindowDays: 30,
    validityDays: 60,
  };

  it('shows the server’s own sentence when the purchase is refused', async () => {
    await render(
      <PackDetailScreen
        offer={OFFER_FOR_ERROR}
        error="Meal packs aren’t offered at this school."
      />,
    );
    expect(screen.getByTestId('screen-pack-detail-error')).toBeTruthy();
    expect(screen.getByText('Meal packs aren’t offered at this school.')).toBeTruthy();
  });

  it('announces it, rather than leaving it to be noticed', async () => {
    // `accessibilityRole="alert"` — a parent using VoiceOver got nothing at all before, and a
    // silent failure is worse for them than for anyone else.
    await render(<PackDetailScreen offer={OFFER_FOR_ERROR} error="That payment did not go through." />);
    expect(screen.getByTestId('screen-pack-detail-error').props.accessibilityRole).toBe('alert');
  });

  it('says nothing when there is nothing to say', async () => {
    await render(<PackDetailScreen offer={OFFER_FOR_ERROR} />);
    expect(screen.queryByTestId('screen-pack-detail-error')).toBeNull();
  });

  it('keeps the Buy button usable after a failure, so a retry is possible', async () => {
    // The failure states all end "nothing has been charged", and that promise is only true if
    // the parent can actually try again. A disabled button after an error would strand them.
    const onBuy = jest.fn();
    await render(
      <PackDetailScreen offer={OFFER_FOR_ERROR} error="Payment cancelled." onBuy={onBuy} />,
    );
    await userEvent.press(screen.getByTestId('screen-pack-detail-buy'));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });
});
