import { render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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

async function renderDish(dishId: string, schoolId: string | null = SCHOOL) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <DishDetailScreen dishId={dishId} schoolId={schoolId} />
    </SafeAreaProvider>,
  );
}

afterEach(() => setMenuCache(null));

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

  it('shows a skeleton, never a spinner, while loading (S5)', async () => {
    // A cache that never resolves is the only honest way to assert a loading state.
    setMenuCache({ get: () => new Promise(() => {}), invalidate: jest.fn() } as never);
    await renderDish('d1');
    expect(screen.getByTestId('screen-dish-detail-skeleton')).toBeOnTheScreen();
    expect(screen.queryByText('Cold Coffee')).toBeNull();
  });
});
