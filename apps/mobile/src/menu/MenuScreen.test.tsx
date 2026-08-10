import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { menu as menuDomain } from '@graybag/shared';

import { MenuScreen } from './MenuScreen';
import { setMenuCache, type CachedMenuPayload } from './useCachedMenu';
import { formatPaise } from './MenuList';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SCHOOL = 'school-1';

const PAYLOAD: CachedMenuPayload = {
  categories: [
    { id: 'drinks', label: 'Drinks' },
    { id: 'quick_bites', label: 'Quick Bites' },
  ],
  dishes: [
    {
      id: 'd1',
      menuItemId: 'mi-d1',
      name: 'Cold Coffee',
      description: 'Chilled, with milk',
      categoryId: 'drinks',
      ingredientsText: 'milk, coffee',
      pricePaise: 7_550,
      imageUri: null,
      allergens: [{ allergenId: 'milk', presence: 'contains' }],
      allergensDeclaredNone: false,
    },
    {
      id: 'd2',
      menuItemId: 'mi-d2',
      name: 'Veg Sandwich',
      description: null,
      categoryId: 'quick_bites',
      ingredientsText: 'bread, paneer',
      pricePaise: 6_000,
      imageUri: null,
      allergens: [],
      // Nobody has said. NOT "no allergens" — MI1/MI7/0006.
      allergensDeclaredNone: false,
    },
    {
      id: 'd3',
      menuItemId: 'mi-d3',
      name: 'Fruit Bowl',
      description: null,
      categoryId: 'quick_bites',
      ingredientsText: null,
      pricePaise: 5_500,
      imageUri: null,
      allergens: [],
      allergensDeclaredNone: true,
    },
  ],
};

/** A cache stand-in. The real rules are tested in `packages/shared/src/menu/cache.test.ts`. */
function fakeCache(
  result: Partial<{ menu: CachedMenuPayload; stale: boolean; reject: boolean }> = {},
) {
  const get = jest.fn(async () => {
    if (result.reject) throw new Error('nothing cached and offline');
    return {
      menu: result.menu ?? PAYLOAD,
      version: 1,
      stale: result.stale ?? false,
      refetched: false,
    };
  });
  return { get, invalidate: jest.fn(async () => {}) } as never;
}

async function renderMenu(schoolId: string | null = SCHOOL) {
  const onSelect = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MenuScreen schoolId={schoolId} onSelectDish={onSelect} />
    </SafeAreaProvider>,
  );
  return { onSelect };
}

afterEach(() => setMenuCache(null));

describe('MenuScreen', () => {
  it('renders the cached menu with no session anywhere in sight', async () => {
    // AR7. Nothing on this screen asks who you are — there is no session provider in this
    // test at all, and it renders.
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByText('Veg Sandwich')).toBeOnTheScreen();
  });

  it('shows prices in rupees from integer paise', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Rs 75.50')).toBeOnTheScreen());
    expect(formatPaise(7_550)).toBe('Rs 75.50');
  });

  /**
   * The mapping that must not be simplified. `unknown` has to survive from the database
   * column (`0006`) through the cache and into what a parent hears — collapsing it to a
   * boolean anywhere reintroduces the defect `MI7` exists to prevent, two layers up where no
   * migration would catch it.
   */
  it('distinguishes "allergens not stated" from "no allergens"', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Veg Sandwich')).toBeOnTheScreen());

    // d2: no tags, not declared -> unknown -> announced
    expect(screen.getByLabelText(/Veg Sandwich.*allergens not stated/)).toBeOnTheScreen();
    // d3: no tags, declared none -> silent, because there is genuinely nothing to say
    expect(screen.queryByLabelText(/Fruit Bowl.*allergens not stated/)).toBeNull();
    // d1: has tags
    expect(screen.getByLabelText(/Cold Coffee.*contains allergens/)).toBeOnTheScreen();
  });

  it('finds "cold coffee" — the example the task names', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    await userEvent.setup().type(screen.getByLabelText('Search the menu'), 'cold coffee');
    await waitFor(() => expect(screen.queryByText('Veg Sandwich')).toBeNull());
    expect(screen.getByText('Cold Coffee')).toBeOnTheScreen();
  });

  it('filters by category', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    await userEvent.setup().press(screen.getByTestId('screen-menu-tabs-quick_bites'));
    await waitFor(() => expect(screen.queryByText('Cold Coffee')).toBeNull());
    expect(screen.getByText('Veg Sandwich')).toBeOnTheScreen();
  });

  it('offers a way out of an empty search rather than a dead end', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search the menu'), 'zzzz');
    await waitFor(() => expect(screen.getByText(/No dishes match/)).toBeOnTheScreen());

    await user.press(screen.getByLabelText('Clear search'));
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
  });

  /**
   * `P8` / `MC3`. Offline is the ordinary case, and an app that refuses to show a perfectly
   * good menu because it could not *confirm* freshness has turned working into broken.
   */
  it('shows a stale menu with a quiet notice, not an error', async () => {
    setMenuCache(fakeCache({ stale: true }));
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByText(/Offline — showing the menu you last loaded/)).toBeOnTheScreen();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('errors only when there is nothing cached and the fetch failed', async () => {
    setMenuCache(fakeCache({ reject: true }));
    await renderMenu();
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeOnTheScreen());
    expect(screen.getByLabelText('Try again')).toBeOnTheScreen();
  });

  it('treats no school chosen as an empty menu, not an error', async () => {
    // A retry button in front of someone who has nothing to retry is worse than an empty
    // screen that explains itself.
    setMenuCache(fakeCache());
    await renderMenu(null);
    await waitFor(() => expect(screen.getByText(/Nothing on the menu yet/)).toBeOnTheScreen());
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('shows a skeleton, never a spinner, while loading', async () => {
    // S5: on an unreliable connection a skeleton shows the SHAPE of what is coming, which
    // reads as progress; a spinner reads as a stall.
    //
    // The cache here never resolves, which is the only honest way to assert a loading state
    // — a fake that resolves immediately means `await render` has already flushed it, and
    // the test would be asserting a race rather than the state.
    setMenuCache({ get: () => new Promise(() => {}), invalidate: jest.fn() } as never);
    await renderMenu();
    expect(screen.getByTestId('screen-menu-list-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-menu-list')).toBeNull();
  });

  it('opens a dish', async () => {
    setMenuCache(fakeCache());
    const { onSelect } = await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    await userEvent.setup().press(screen.getByTestId('menu-row-d1'));
    expect(onSelect).toHaveBeenCalledWith('d1');
  });
});

describe('the domain rules the screen leans on', () => {
  it('maps the three allergen states the screen renders', () => {
    const d = (tags: string[], none: boolean) => ({
      allergens: tags.map((allergenId) => ({ allergenId, presence: 'contains' as const })),
      allergensDeclaredNone: none,
    });
    expect(menuDomain.allergenDisclosure(d(['milk'], false)).state).toBe('declared');
    expect(menuDomain.allergenDisclosure(d([], true)).state).toBe('declaredNone');
    expect(menuDomain.allergenDisclosure(d([], false)).state).toBe('unknown');
  });
});
