import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cart as cartDomain, menu as menuDomain } from '@graybag/shared';

import { CartProvider, useCart } from '../cart/CartContext';
import type { OrderTarget } from '../session/OrderTargetContext';
import { DishDetailScreen, allergenLabel } from './DishDetailScreen';
import { setMenuCache, type CachedMenuPayload } from './useCachedMenu';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SCHOOL = 'school-1';

const PAYLOAD: CachedMenuPayload = {
  categories: [{ id: 'drinks', label: 'Drinks' }],
  dishes: [
    {
      id: 'd1',
      menuItemId: 'mi-d1',
      name: 'Cold Coffee',
      description: 'Chilled, with milk',
      categoryId: 'drinks',
      ingredientsText: 'milk, coffee, sugar',
      pricePaise: 7_550,
      imageUri: 'https://example.test/cold-coffee.jpg',
      allergens: [{ allergenId: 'milk', presence: 'contains' }],
      allergensDeclaredNone: false,
    },
    {
      // Nobody has said. NOT "no allergens" — MI1/MI7/0006.
      id: 'd2',
      menuItemId: 'mi-d2',
      name: 'Veg Sandwich',
      description: null,
      categoryId: 'drinks',
      ingredientsText: null,
      pricePaise: 6_000,
      imageUri: null,
      allergens: [],
      allergensDeclaredNone: false,
    },
    {
      id: 'd3',
      menuItemId: 'mi-d3',
      name: 'Fruit Bowl',
      description: null,
      categoryId: 'drinks',
      ingredientsText: 'seasonal fruit',
      pricePaise: 5_500,
      imageUri: null,
      allergens: [],
      allergensDeclaredNone: true,
    },
  ],
};

function fakeCache(result: Partial<{ stale: boolean; reject: boolean }> = {}) {
  const get = jest.fn(async () => {
    if (result.reject) throw new Error('nothing cached and offline');
    return { menu: PAYLOAD, version: 1, stale: result.stale ?? false, refetched: false };
  });
  return { get, invalidate: jest.fn(async () => {}) } as never;
}

/**
 * A child with a milk allergy.
 *
 * The allergen ids are regulated health data (DPDP, non-negotiable #4). They are asserted on
 * only through what the screen *does* with them — nothing in this file expects them to be
 * rendered, and nothing may log them.
 */
/** Asserted to be a real service date rather than trusted as a literal. */
const SERVICE_DATE = '2026-09-01';
if (!menuDomain.isServiceDate(SERVICE_DATE)) throw new Error('fixture is not a service date');

const TARGET: OrderTarget = {
  recipientId: 'r1',
  allergenIds: ['milk'],
  serviceDate: SERVICE_DATE,
};

const NO_ALLERGIES: OrderTarget = { ...TARGET, recipientId: 'r2', allergenIds: [] };

/** Reads the live cart out of the provider, so adds are asserted against the domain object. */
let seenCart: cartDomain.Cart = cartDomain.emptyCart();
function CartProbe() {
  seenCart = useCart().cart;
  return null;
}

async function renderDish(
  dishId: string,
  {
    schoolId = SCHOOL,
    target = null,
  }: { schoolId?: string | null; target?: OrderTarget | null } = {},
) {
  const onNeedsTarget = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CartProvider>
        <CartProbe />
        <DishDetailScreen
          dishId={dishId}
          schoolId={schoolId}
          target={target}
          onNeedsTarget={onNeedsTarget}
        />
      </CartProvider>
    </SafeAreaProvider>,
  );
  return { onNeedsTarget };
}

afterEach(() => {
  setMenuCache(null);
  seenCart = cartDomain.emptyCart();
});

describe('DishDetailScreen', () => {
  it('shows the dish from the cached menu with no session anywhere in sight', async () => {
    // AR7: there is no session provider in this test at all, and it renders.
    setMenuCache(fakeCache());
    await renderDish('d1');

    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByText('Chilled, with milk')).toBeOnTheScreen();
    expect(screen.getByText('milk, coffee, sugar')).toBeOnTheScreen();
    // `includeHiddenElements` because the hero is decorative and hidden from accessibility —
    // a dish image next to the dish's own name adds nothing to announce.
    expect(
      screen.getByTestId('screen-dish-detail-image', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('names the dish as a heading, so a screen reader lands on it', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getAllByRole('header')[0]).toHaveTextContent('Cold Coffee');
  });

  it('formats the price from integer paise, dividing only to display it', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    // 7550 paise. The number that travels is paise; this is the only place it is divided.
    await waitFor(() => expect(screen.getByTestId('screen-dish-detail-price')).toHaveTextContent(
      '₹75.50',
    ));
  });

  it('omits the description and ingredients rather than printing empty headings', async () => {
    setMenuCache(fakeCache());
    await renderDish('d2');
    await waitFor(() => expect(screen.getByText('Veg Sandwich')).toBeOnTheScreen());
    expect(screen.queryByTestId('screen-dish-detail-description')).toBeNull();
    expect(screen.queryByTestId('screen-dish-detail-ingredients')).toBeNull();
  });

  describe('the allergen disclosure (D7, MI1, MI7)', () => {
    it('lists the declared allergens', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1');
      await waitFor(() => expect(screen.getByText('Contains allergens')).toBeOnTheScreen());
      expect(screen.getByTestId('screen-dish-detail-allergens-milk')).toHaveTextContent('Milk');
    });

    /**
     * The state the whole file exists for. An empty tag list and an unanswered question are
     * opposite facts wearing the same shape, and the wrong version of this screen is one
     * line long: rendering nothing.
     */
    it('says "not stated" for a dish nobody has described, and never calls it safe', async () => {
      setMenuCache(fakeCache());
      await renderDish('d2');

      await waitFor(() => expect(screen.getByText('Allergens not stated')).toBeOnTheScreen());
      expect(screen.getByTestId('screen-dish-detail-allergens-unknown')).toBeOnTheScreen();
      // No reassurance is available for this dish, and there must be none on screen.
      expect(screen.queryByTestId('screen-dish-detail-allergens-none')).toBeNull();
      expect(screen.queryByText(/contains none/)).toBeNull();
    });

    it('reassures only when the kitchen explicitly declared none', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3');
      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-allergens-none')).toBeOnTheScreen(),
      );
      expect(screen.queryByText('Allergens not stated')).toBeNull();
    });

    it('spells out "may contain" rather than folding it into "contains"', () => {
      expect(allergenLabel({ allergenId: 'tree_nuts', presence: 'contains' })).toBe('Tree nuts');
      expect(allergenLabel({ allergenId: 'peanut', presence: 'may_contain' })).toBe(
        'Peanut — may contain',
      );
    });
  });

  it('says the dish has gone rather than showing an error', async () => {
    setMenuCache(fakeCache());
    await renderDish('does-not-exist');
    await waitFor(() =>
      expect(screen.getByText('This dish is not on the menu')).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('shows a stale menu with a quiet notice, not an error (P8, MC3)', async () => {
    setMenuCache(fakeCache({ stale: true }));
    await renderDish('d1');
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByText(/Offline — showing the menu you last loaded/)).toBeOnTheScreen();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('errors only when there is nothing cached and the fetch failed', async () => {
    setMenuCache(fakeCache({ reject: true }));
    await renderDish('d1');
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeOnTheScreen());
    expect(screen.getByLabelText('Try again')).toBeOnTheScreen();
  });

  describe('adding to the cart', () => {
    /**
     * The identity rule. A cart line is the **menu item** — what is being offered, on which
     * menu, at what price — and not the dish, because two menus can offer the same food for
     * different money. Getting these the wrong way round produces a cart that looks right and
     * a checkout that cannot resolve a line.
     */
    it('adds a line identified by menuItemId, not dishId', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(seenCart.lines[0]).toMatchObject({
        menuItemId: 'mi-d3',
        dishId: 'd3',
        key: cartDomain.lineKey({
          recipientId: 'r2',
          serviceDate: TARGET.serviceDate,
          menuItemId: 'mi-d3',
          comment: null,
        }),
      });
    });

    it('snapshots the price the parent was looking at, in paise (L7)', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      // Integer paise, exactly as it came off the menu. Checkout compares against this.
      expect(seenCart.lines[0]).toMatchObject({
        unitPricePaise: 5_500,
        quantity: 1,
        recipientId: 'r2',
        serviceDate: TARGET.serviceDate,
      });
    });

    it('confirms the add without navigating away from the dish', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-add-added')).toBeOnTheScreen(),
      );
      expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen();
    });

    /**
     * `AR7`: the dish is fully readable with nobody to order for. The screen offers the way
     * forward instead of a disabled button with no explanation — and it is the last thing on
     * the screen, not a wall in front of it.
     */
    it('offers to add a child when there is nobody to order for, and adds nothing', async () => {
      setMenuCache(fakeCache());
      const { onNeedsTarget } = await renderDish('d3');
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      expect(screen.queryByTestId('screen-dish-detail-add-button')).toBeNull();
      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-needs-target'));

      expect(onNeedsTarget).toHaveBeenCalled();
      expect(seenCart.lines).toHaveLength(0);
    });
  });

  /**
   * `D7` / `E05-05`. The warning is at add-to-cart because that is where the decision is
   * made — at checkout it would arrive after it.
   */
  describe('the allergen warning at add-to-cart', () => {
    it('blocks the add when the dish declares an allergen the child has', async () => {
      setMenuCache(fakeCache());
      // d1 contains milk; TARGET's child has a milk allergy.
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-add-warning-body')).toBeOnTheScreen(),
      );
      // Nothing was added. The add happens on the second, deliberate press or not at all.
      expect(seenCart.lines).toHaveLength(0);
    });

    it('names the dish and the allergen, and never the child', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      const body = await screen.findByTestId('screen-dish-detail-add-warning-body');
      expect(body).toHaveTextContent(/Cold Coffee/);
      expect(body).toHaveTextContent(/milk/);
      // The recipient id is regulated data and has no business on the screen or in the tree.
      expect(screen.queryByText(/r1/)).toBeNull();
    });

    it('adds only after the warning is acknowledged', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      const user = userEvent.setup();
      await user.press(screen.getByTestId('screen-dish-detail-add-button'));
      await screen.findByTestId('screen-dish-detail-add-warning-confirm');
      expect(seenCart.lines).toHaveLength(0);

      await user.press(screen.getByTestId('screen-dish-detail-add-warning-confirm'));
      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(seenCart.lines[0]).toMatchObject({ menuItemId: 'mi-d1', unitPricePaise: 7_550 });
    });

    it('backing out of the warning adds nothing', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      const user = userEvent.setup();
      await user.press(screen.getByTestId('screen-dish-detail-add-button'));
      await user.press(await screen.findByTestId('screen-dish-detail-add-warning-cancel'));

      await waitFor(() =>
        expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull(),
      );
      expect(seenCart.lines).toHaveLength(0);
    });

    it('does not warn about an allergen the child does not have', async () => {
      setMenuCache(fakeCache());
      // d1 declares milk; this child has no declared allergies.
      await renderDish('d1', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull();
    });

    /**
     * `MI7`: an undescribed dish warns for every child, allergies or not. It stays **inline**
     * rather than becoming a sheet, because a sheet on every undescribed dish trains parents
     * to dismiss it unread — and the one that mattered would be dismissed with it.
     */
    it('does not block an undescribed dish, and says so on the screen instead', async () => {
      setMenuCache(fakeCache());
      await renderDish('d2', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Allergens not stated')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull();
      // Still on screen after the add — the notice is a property of the dish, not a step.
      expect(screen.getByTestId('screen-dish-detail-allergens-unknown')).toBeOnTheScreen();
    });

    it('is the domain rule, not this screen re-deciding it', () => {
      // The same function the checkout preflight uses. A second copy of this rule in a
      // component is how the sale gets stopped in one place and allowed in the other.
      const milk = { allergens: [{ allergenId: 'milk', presence: 'contains' as const }], allergensDeclaredNone: false };
      expect(menuDomain.allergenWarning(milk, ['milk'])).toEqual({
        warn: true,
        reason: 'match',
        allergenIds: ['milk'],
      });
      expect(menuDomain.allergenWarning(milk, ['peanut'])).toEqual({ warn: false });
      expect(menuDomain.allergenWarning({ allergens: [], allergensDeclaredNone: false }, [])).toEqual(
        { warn: true, reason: 'unknown' },
      );
    });
  });

  it('shows a skeleton, never a spinner, while loading (S5)', async () => {
    // A cache that never resolves is the only honest way to assert a loading state.
    setMenuCache({ get: () => new Promise(() => {}), invalidate: jest.fn() } as never);
    await renderDish('d1');
    expect(screen.getByTestId('screen-dish-detail-skeleton')).toBeOnTheScreen();
    expect(screen.queryByText('Cold Coffee')).toBeNull();
  });
});
