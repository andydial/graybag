import { render, screen, userEvent } from '@testing-library/react-native';

import { PackDetailScreen } from './PackDetailScreen';

/**
 * `E21-48`. The screen where a parent decides to hand over money for food not yet made.
 *
 * Two things it owes them **before** they pay rather than after: the expiry, and that packs are
 * not refundable. A term a customer meets first in a policy they did not open is a term they meet
 * after paying.
 */

const OFFER = {
  id: 'o-1',
  name: '10 meal pack',
  mealsCount: 10,
  itemsPerMeal: 2,
  requiredCategoryId: 'cat-drinks',
  netPricePaise: 300000,
  alacarteReferencePaise: 337500,
  validityDays: 60,
};

describe('the two terms are stated before the button', () => {
  it('says when the meals expire, and that unused ones are gone', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByTestId('screen-pack-detail-expiry')).toBeTruthy();
    expect(screen.getByText(/Meals expire 60 days after purchase/)).toBeTruthy();
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
    expect(screen.getByText(/Meals expire 90 days after purchase/)).toBeTruthy();
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

  it('shows the saving against buying the meals singly', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByText(/save ₹375/)).toBeTruthy();
  });
});

describe('buying', () => {
  it('says what a meal covers, in the offer’s terms', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByText(/10 meals. One meal covers one child on one day./)).toBeTruthy();
    expect(screen.getByText(/2 items per meal/)).toBeTruthy();
  });

  it('says the pack is the parent’s, usable for anyone they order for', async () => {
    await render(<PackDetailScreen offer={OFFER} />);
    expect(screen.getByText(/Use it for anyone you order for/)).toBeTruthy();
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
