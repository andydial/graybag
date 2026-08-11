import { render, screen, userEvent, waitFor, fireEvent } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { menu as menuDomain, money } from '@graybag/shared';

import { CartProvider } from '../cart/CartContext';
import { MenuScreen, type AllergenWatchlist } from './MenuScreen';
import { setMenuCache, type CachedMenuPayload } from './useCachedMenu';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * jest's window is 750pt at `fontScale: 2` — above §3.5's threshold, so an unset suite tests
 * the accessibility layout and never the grid. Pinned to a 390pt phone at default text size;
 * the dynamic-type behaviour is `MenuList.test.tsx`'s subject.
 */
function setWindow({ width = 390, fontScale = 1 }: { width?: number; fontScale?: number } = {}) {
  const scale = 3;
  const physical = { width: width * scale, height: 844 * scale, scale, fontScale, densityDpi: 480 };
  Dimensions.set({ windowPhysicalPixels: physical, screenPhysicalPixels: physical });
}

const SCHOOL = 'school-1';

const PAYLOAD: CachedMenuPayload = {
  categories: [
    { id: 'drinks', label: 'Drinks' },
    { id: 'quick_bites', label: 'Quick Bites' },
    { id: 'salads', label: 'Salads' },
  ],
  dishes: [
    {
      id: 'd1',
      menuItemId: 'mi-d1',
      name: 'Cold Coffee',
      description: 'Chilled, with milk',
      categoryId: 'drinks',
      foodType: 'egg',
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
      foodType: 'non_veg',
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
      foodType: 'veg',
      ingredientsText: null,
      pricePaise: 5_500,
      imageUri: null,
      allergens: [],
      allergensDeclaredNone: true,
    },
  ],
};

const EMPTY_MENU: CachedMenuPayload = { categories: [], dishes: [] };

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

async function renderMenu(
  schoolId: string | null = SCHOOL,
  allergens: AllergenWatchlist = { status: 'none' },
  /** `E14-34`'s two props. Optional so every existing call site is unchanged. */
  extra: { schoolName?: string | null; onChangeSchool?: () => void } = {},
) {
  const onSelect = jest.fn();
  await render(
    // `CartProvider` is here for the brand header's cart badge, and for nothing else. There is
    // still no session provider in this file: `AR7` — nothing on this screen asks who you are.
    <SafeAreaProvider initialMetrics={METRICS}>
      <CartProvider>
        <MenuScreen
          schoolId={schoolId}
          onSelectDish={onSelect}
          allergens={allergens}
          {...extra}
        />
      </CartProvider>
    </SafeAreaProvider>,
  );
  return { onSelect };
}

beforeEach(() => setWindow());
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

  /** Ref `06`: the header, the eyebrow, the green title, the search, the category strip. */
  it('wears the brand — header, eyebrow, title, search, category strip', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    expect(screen.getByTestId('brand-header')).toBeOnTheScreen();
    expect(screen.getByText('Our food')).toBeOnTheScreen();
    expect(screen.getByText('Made specially for your child')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-menu-search')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-menu-tabs')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-menu-tabs-drinks')).toBeOnTheScreen();
  });

  it('shows prices in rupees from integer paise, formatted in one place', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText(money.formatPaise(7_550))).toBeOnTheScreen());
    // Changed from a local `formatPaise` in `MenuList` to the shared formatter: the currency
    // symbol and the grouping are never hand-assembled in a component.
    expect(money.formatPaise(7_550)).toBe('₹75.50');
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

  it('opens a dish', async () => {
    setMenuCache(fakeCache());
    const { onSelect } = await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    await userEvent.setup().press(screen.getByTestId('menu-row-d1'));
    expect(onSelect).toHaveBeenCalledWith('d1');
  });
});

/**
 * `docs/ux-spec.md` §5.21. Four genuinely different situations hide behind one empty list, and
 * this screen is the one the audit names: `ListEmptyComponent` said "not published" for an
 * unpublished menu, a failed fetch and an unconfigured client alike, and that collapsed
 * distinction cost three hours hunting a data problem that did not exist.
 */
describe('the four kinds of nothing', () => {
  it('N1 — the menu really is unpublished', async () => {
    setMenuCache(fakeCache({ menu: EMPTY_MENU }));
    await renderMenu();
    await waitFor(() => expect(screen.getByText(/Nothing on the menu yet/)).toBeOnTheScreen());
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('N1 — the search matched nothing, and offers a way out rather than a dead end', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search the menu'), 'zzzz');
    await waitFor(() => expect(screen.getByText(/No dishes match/)).toBeOnTheScreen());

    await user.press(screen.getByLabelText('Clear search'));
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
  });

  /** A category with nothing in it is not an unpublished menu, and must not say it is. */
  it('N1 — the category is empty, and the way out is another category', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    await userEvent.setup().press(screen.getByTestId('screen-menu-tabs-salads'));
    await waitFor(() => expect(screen.getByText('Nothing in this category')).toBeOnTheScreen());
    expect(screen.queryByText(/Nothing on the menu yet/)).toBeNull();

    await userEvent.setup().press(screen.getByLabelText('Show everything'));
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
  });

  it('N2 — we could not ask, so it retries instead of blaming the school', async () => {
    setMenuCache(fakeCache({ reject: true }));
    await renderMenu();
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeOnTheScreen());
    expect(screen.getByText(/We couldn't load the menu/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Try again')).toBeOnTheScreen();
    expect(screen.queryByText(/Nothing on the menu yet/)).toBeNull();
  });

  /**
   * `P8` / `MC3`. Offline is the ordinary case, and an app that refuses to show a perfectly
   * good menu because it could not *confirm* freshness has turned working into broken.
   */
  it('N4 — a stale menu shows, with a quiet notice, not an error', async () => {
    setMenuCache(fakeCache({ stale: true }));
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByText(/Offline — showing the menu you last loaded/)).toBeOnTheScreen();
    expect(screen.queryByTestId('error-state')).toBeNull();
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
    // The search and the tabs survive the wait. A screen with no controls at the moment
    // someone wants to change what they asked for is a screen that has stalled.
    expect(screen.getByTestId('screen-menu-search')).toBeOnTheScreen();
  });
});

/**
 * The partial state (§5.5), and the one with a safety consequence. `AddChildScreen` swallows a
 * failed allergen read into `[]`; the menu then renders every card with no flag, which is a
 * claim we did not verify (`F5`/`F6`).
 */
describe('when the allergen list is in play', () => {
  const MILK: AllergenWatchlist = {
    status: 'ready',
    avoid: [{ allergenId: 'milk', label: 'Milk' }],
  };

  it('flags a dish that clashes with the selected recipient', async () => {
    setMenuCache(fakeCache());
    await renderMenu(SCHOOL, MILK);
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    expect(screen.getByTestId('menu-row-d1-allergen')).toBeOnTheScreen();
    expect(screen.getByText(/Contains Milk/)).toBeOnTheScreen();
    // Nothing to say about the sandwich: it is undescribed, which the spoken label already
    // carries. Naming an allergen nobody declared would be inventing one.
    expect(screen.queryByTestId('menu-row-d2-allergen')).toBeNull();
  });

  it('suppresses every flag when the list could not be read — and says so', async () => {
    setMenuCache(fakeCache());
    await renderMenu(SCHOOL, { status: 'unavailable' });
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

    expect(screen.getByTestId('screen-menu-allergens-unavailable')).toBeOnTheScreen();
    expect(screen.getByText(/Allergy warnings aren't available right now/)).toBeOnTheScreen();
    expect(screen.queryByTestId('menu-row-d1-allergen')).toBeNull();
  });

  it('says nothing about allergens when nobody is selected — that is not a failure', async () => {
    setMenuCache(fakeCache());
    await renderMenu();
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.queryByTestId('screen-menu-allergens-unavailable')).toBeNull();
    expect(screen.queryByTestId('menu-row-d1-allergen')).toBeNull();
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

/**
 * `E14-34`. Choosing a school was a one-way door: `SchoolPicker` renders only while `schoolId`
 * is null, so once one was set there was no way to see which, and no way to change it. A parent
 * with children at two schools, or anyone who tapped the wrong row, had to reinstall the app.
 */
describe('changing school', () => {
  const withSchool = { schoolName: 'Alpha Public School', onChangeSchool: jest.fn() };

  beforeEach(() => {
    withSchool.onChangeSchool.mockClear();
    setMenuCache(fakeCache());
  });

  it('names the school whose menu this is', async () => {
    await renderMenu(SCHOOL, { status: 'none' }, withSchool);
    expect(await screen.findByText('Alpha Public School')).toBeTruthy();
  });

  it('offers a way back to the picker', async () => {
    await renderMenu(SCHOOL, { status: 'none' }, withSchool);
    fireEvent.press(await screen.findByTestId('screen-menu-change-school'));
    expect(withSchool.onChangeSchool).toHaveBeenCalled();
  });

  it('announces the school and the action together', async () => {
    // A screen-reader user hears the button's label and nothing else, so "Change" alone would
    // never say what is being changed from.
    await renderMenu(SCHOOL, { status: 'none' }, withSchool);
    expect(await screen.findByLabelText('Alpha Public School. Change school')).toBeTruthy();
  });

  it('leaves the row out when there is nowhere to send it', async () => {
    await renderMenu();
    expect(screen.queryByTestId('screen-menu-change-school')).toBeNull();
  });
});
