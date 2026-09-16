import { render, screen } from '@testing-library/react-native';
import { packCoverage } from '@graybag/shared';

import { PackRedemptionStrip } from './PackRedemptionStrip';

/**
 * `E21-76`. The cart strip, rebuilt.
 *
 * The old file's dominant property was *"nothing is spent without an explicit tap"*. That toggle
 * is gone (`P25`) because coverage is now per item and partial — a cart of three items against a
 * balance of two is not a yes/no question — and what replaces the tap is this strip **naming every
 * covered line before Place order**.
 *
 * So the properties this file is about are:
 *
 *   1. a parent with no pack concept sees nothing at all;
 *   2. every covered line is NAMED, never summarised as a count;
 *   3. the cash due is stated, and stated as zero when the pack covers everything;
 *   4. partial coverage says so **in words**, because that is the surprise to prevent.
 */

let mockSurface = { canBuy: false, hasBalance: false, loading: false };
jest.mock('./MealPackSurfaceContext', () => ({
  useMealPackSurface: () => mockSurface,
}));

beforeEach(() => {
  mockSurface = { canBuy: false, hasBalance: false, loading: false };
});

const line = (key: string, unitPricePaise: number, dishName: string, quantity = 1) => ({
  recipientId: null,
  serviceDate: null,
  menuItemId: `mi-${key}`,
  dishId: `d-${key}`,
  dishName,
  quantity,
  comment: null,
  key,
  unitPricePaise,
});

describe('when the parent has no pack concept at all', () => {
  it('renders nothing — not a prompt, not a placeholder', async () => {
    await render(<PackRedemptionStrip />);
    expect(screen.queryByTestId('cart-pack-strip')).toBeNull();
    expect(screen.queryByTestId('cart-pack-strip-promo')).toBeNull();
  });
});

describe('when packs are sold here but the parent has none', () => {
  beforeEach(() => {
    mockSurface = { canBuy: true, hasBalance: false, loading: false };
  });

  it('advertises, and only then', async () => {
    await render(<PackRedemptionStrip />);
    expect(screen.getByTestId('cart-pack-strip-promo')).toBeTruthy();
  });
});

describe('when the parent holds a balance', () => {
  beforeEach(() => {
    mockSurface = { canBuy: true, hasBalance: true, loading: false };
  });

  it('renders even when packs are no longer SOLD here', async () => {
    // `E21-31`: withdrawing an offer stops selling and must never strand items already paid for.
    mockSurface = { canBuy: false, hasBalance: true, loading: false };
    const coverage = packCoverage.coverCart([line('a', 4_000, 'Lime soda')], 3);
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={3} itemsTotal={20} />);
    expect(screen.getByTestId('cart-pack-strip')).toBeTruthy();
  });

  it('NAMES every covered line rather than counting them', async () => {
    // The assertion the whole screen exists for. Under cheapest-first the covered line is
    // routinely the one the parent cares least about, so "1 item covered" beside a total they
    // have not reconciled is exactly the surprise to prevent.
    const coverage = packCoverage.coverCart(
      [line('main', 25_000, 'Butter chicken & rice'), line('drink', 4_000, 'Fresh lime soda')],
      1,
    );
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={1} itemsTotal={20} />);
    expect(screen.getByText('Fresh lime soda')).toBeTruthy();
    expect(screen.getByTestId('cart-pack-strip-line-drink')).toBeTruthy();
    // And does NOT claim the main is covered.
    expect(screen.queryByTestId('cart-pack-strip-line-main')).toBeNull();
  });

  it('says partial coverage IN WORDS, and states the cash due', async () => {
    const coverage = packCoverage.coverCart(
      [line('main', 25_000, 'Butter chicken & rice'), line('drink', 4_000, 'Fresh lime soda')],
      1,
    );
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={1} itemsTotal={20} />);
    expect(screen.getByText(/covers part of this order/)).toBeTruthy();
    // ₹250 + 5% = ₹262.50, the worked example from the brief.
    expect(screen.getByTestId('cart-pack-strip-cash')).toHaveTextContent(/₹262\.50/);
  });

  it('states nothing to pay when the pack covers everything, and says why no GST', async () => {
    const coverage = packCoverage.coverCart([line('drink', 4_000, 'Fresh lime soda')], 5);
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={5} itemsTotal={20} />);
    expect(screen.getByText(/covers this order/)).toBeTruthy();
    expect(screen.getByTestId('cart-pack-strip-cash')).toHaveTextContent(/Nothing to pay/);
    // The tax point is the sale, so a redemption carries none — and says so, because a parent
    // who has seen GST on every other order will otherwise wonder where it went.
    expect(screen.getByTestId('cart-pack-strip-cash')).toHaveTextContent(/bought the pack/);
  });

  it('shows the quantity when only part of a line is covered', async () => {
    const coverage = packCoverage.coverCart([line('drink', 4_000, 'Lime soda', 3)], 2);
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={2} itemsTotal={20} />);
    expect(screen.getByText(/Lime soda × 2/)).toBeTruthy();
  });

  it('reports what is left AFTER this order, not before', async () => {
    // A parent reading "3 left" while spending 1 of 3 has been told a number that is already
    // wrong by the time they tap.
    const coverage = packCoverage.coverCart([line('drink', 4_000, 'Lime soda')], 3);
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={3} itemsTotal={20} />);
    expect(screen.getByTestId('cart-pack-strip-summary')).toHaveTextContent(/2 left after this/);
  });

  it('says the pack is empty rather than showing a coverage of nothing', async () => {
    await render(<PackRedemptionStrip itemsLeft={0} itemsTotal={20} />);
    expect(screen.getByTestId('cart-pack-strip-empty')).toBeTruthy();
    expect(screen.getByText(/charged as usual/)).toBeTruthy();
  });

  it('says an expired pack is expired, and that nothing is refunded', async () => {
    await render(
      <PackRedemptionStrip itemsLeft={4} itemsTotal={20} expired expiresLabel="1 August" />,
    );
    expect(screen.getByTestId('cart-pack-strip-expired')).toBeTruthy();
    expect(screen.getByText(/can’t be refunded/)).toBeTruthy();
  });

  it('has NO switch anywhere — coverage is automatic (P25)', async () => {
    const coverage = packCoverage.coverCart([line('drink', 4_000, 'Lime soda')], 3);
    await render(<PackRedemptionStrip coverage={coverage} itemsLeft={3} itemsTotal={20} />);
    // Asserted as an absence because the removal is the decision. If a toggle comes back, the
    // parent's money moves on a different rule and this test is where that gets noticed.
    expect(screen.queryByTestId('cart-pack-strip-switch')).toBeNull();
  });
});
