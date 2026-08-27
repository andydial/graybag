import { fireEvent, render, screen } from '@testing-library/react-native';

import { PackRedemptionStrip } from './PackRedemptionStrip';

/**
 * `E21-39`. The cart strip — the only place a meal is actually spent.
 *
 * Two properties dominate: **nothing is spent without an explicit tap**, and **a cart that cannot
 * be redeemed says why and what would fix it**. A greyed-out control with no sentence is the same
 * failure as an empty state with no reason.
 */

let mockSurface = { canBuy: false, hasBalance: false, loading: false };
jest.mock('./MealPackSurfaceContext', () => ({
  useMealPackSurface: () => mockSurface,
}));

beforeEach(() => {
  mockSurface = { canBuy: false, hasBalance: false, loading: false };
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

  it('shows no switch, because there is nothing to spend', async () => {
    await render(<PackRedemptionStrip />);
    expect(screen.queryByTestId('cart-pack-strip-switch')).toBeNull();
  });
});

describe('when the parent holds meals', () => {
  beforeEach(() => {
    // Note `canBuy: false` throughout: a parent whose school stopped selling still spends.
    mockSurface = { canBuy: false, hasBalance: true, loading: false };
  });

  it('offers the switch even where we no longer sell packs', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={7} mealsTotal={10} expiresLabel="11 Oct 2026" />,
    );
    expect(screen.getByTestId('cart-pack-strip-switch')).toBeTruthy();
    expect(screen.getByText(/7 of 10 left/)).toBeTruthy();
  });

  it('is OFF until the parent turns it on', async () => {
    // Nothing is spent without an explicit tap, every time. There is no remembered preference
    // and no default-on, because a meal is money.
    const onToggle = jest.fn();
    await render(<PackRedemptionStrip mealsLeft={7} mealsTotal={10} onToggle={onToggle} />);
    expect(screen.getByTestId('cart-pack-strip-switch').props.value).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('reports the tap rather than deciding for itself', async () => {
    const onToggle = jest.fn();
    await render(<PackRedemptionStrip mealsLeft={7} mealsTotal={10} onToggle={onToggle} />);
    // A Switch reports `valueChange`, not a press — `userEvent.press` on one does nothing at
    // all, silently, which would have made this test pass while asserting the opposite.
    // Awaited: `fireEvent` opens an `act` scope on RNTL v14 (docs/learnings.md, 2026-08-10).
    await fireEvent(screen.getByTestId('cart-pack-strip-switch'), 'valueChange', true);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('says this order uses one, once it is on', async () => {
    await render(<PackRedemptionStrip mealsLeft={7} mealsTotal={10} using />);
    expect(screen.getByText(/this order uses one/)).toBeTruthy();
  });
});

describe('a cart that cannot use a meal says WHY, and what would fix it', () => {
  beforeEach(() => {
    mockSurface = { canBuy: false, hasBalance: true, loading: false };
  });

  it('names the missing drink', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={7} mealsTotal={10} ineligible="missing_required_category" />,
    );
    expect(screen.getByTestId('cart-pack-strip-ineligible')).toBeTruthy();
    expect(screen.getByText(/needs one of the two items to be a drink/)).toBeTruthy();
  });

  it('names the wrong count', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={7} mealsTotal={10} ineligible="wrong_item_count" />,
    );
    expect(screen.getByText(/exactly two items, one of them a drink/)).toBeTruthy();
  });

  it('reassures that the balance is untouched — the parent’s first worry', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={7} mealsTotal={10} ineligible="wrong_item_count" />,
    );
    expect(screen.getByText(/your 7 meals stay where they are/)).toBeTruthy();
  });

  it('says "meal stays" for one, not "1 meals stay"', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={1} mealsTotal={10} ineligible="wrong_item_count" />,
    );
    expect(screen.getByText(/your 1 meal stays where they are/)).toBeTruthy();
  });

  it('offers no switch while ineligible, so it cannot be turned on by mistake', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={7} mealsTotal={10} ineligible="wrong_item_count" />,
    );
    expect(screen.queryByTestId('cart-pack-strip-switch')).toBeNull();
  });
});

describe('expired and empty are different news', () => {
  beforeEach(() => {
    mockSurface = { canBuy: false, hasBalance: true, loading: false };
  });

  it('expired says the meals are gone and cannot be refunded', async () => {
    await render(
      <PackRedemptionStrip mealsLeft={4} mealsTotal={10} expired expiresLabel="11 Oct 2026" />,
    );
    expect(screen.getByText(/expired on 11 Oct 2026/)).toBeTruthy();
    expect(screen.getByText(/can’t be refunded/)).toBeTruthy();
  });

  it('empty says this order will simply be charged', async () => {
    await render(<PackRedemptionStrip mealsLeft={0} mealsTotal={10} />);
    expect(screen.getByText(/No meals left in your pack/)).toBeTruthy();
    expect(screen.getByText(/charged as usual/)).toBeTruthy();
  });

  it('neither offers a switch', async () => {
    await render(<PackRedemptionStrip mealsLeft={0} mealsTotal={10} />);
    expect(screen.queryByTestId('cart-pack-strip-switch')).toBeNull();
  });
});
