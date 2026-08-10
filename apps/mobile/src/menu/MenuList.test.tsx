import { render, screen, userEvent } from '@testing-library/react-native';
import { Dimensions, Text } from 'react-native';
import { money } from '@graybag/shared';

import { MenuList, AX_SINGLE_COLUMN_FONT_SCALE, type MenuListItem } from './MenuList';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * jest's window is 750pt wide at `fontScale: 2`, which is above §3.5's threshold — so a suite
 * that never says otherwise silently tests the accessibility layout and never the grid. Every
 * test here states the text size it is about.
 */
function setWindow({ width = 390, fontScale = 1 }: { width?: number; fontScale?: number } = {}) {
  const scale = 3;
  const physical = { width: width * scale, height: 844 * scale, scale, fontScale, densityDpi: 480 };
  // Called before mounting, never during: `Dimensions.set` emits, and a component already on
  // screen would re-measure outside `act`.
  Dimensions.set({ windowPhysicalPixels: physical, screenPhysicalPixels: physical });
}

/** 390pt wide, less the gutters, less the gap between the columns, halved. */
const GRID_CARD_WIDTH = (390 - 16 * 2 - 12) / 2;
const FULL_CARD_WIDTH = 390 - 16 * 2;

const COLD_COFFEE: MenuListItem = {
  id: 'd1',
  name: 'Cold Coffee',
  pricePaise: 7_550,
  imageUri: null,
  foodType: 'veg',
  allergens: 'declared',
  warnAllergens: [],
};

const SANDWICH: MenuListItem = {
  id: 'd2',
  name: 'Tomato, Cucumber Cheese Sandwich In Brown Bread',
  pricePaise: 6_000,
  imageUri: 'https://example.test/sandwich-160.webp',
  foodType: null,
  // Nobody has said. NOT "no allergens" — MI1/MI7/0006.
  allergens: 'unknown',
  warnAllergens: [],
};

async function renderList(items: MenuListItem[] = [COLD_COFFEE, SANDWICH], extra = {}) {
  const onSelect = jest.fn();
  await render(<MenuList items={items} onSelect={onSelect} testID="menu-list" {...extra} />);
  return { onSelect };
}

beforeEach(() => setWindow());

describe('the dish card', () => {
  it('lays out two columns at ordinary text sizes', async () => {
    setWindow();
    await renderList();
    // Two cards side by side across a 390pt screen — the grid of §5.5.
    expect(screen.getByTestId('menu-row-d1')).toHaveStyle({ width: GRID_CARD_WIDTH });
    expect(screen.getByTestId('menu-row-d2')).toHaveStyle({ width: GRID_CARD_WIDTH });
  });

  it('formats the price with money.formatPaise rather than assembling a string', async () => {
    setWindow();
    await renderList();
    expect(screen.getByText(money.formatPaise(7_550))).toBeOnTheScreen();
    expect(money.formatPaise(7_550)).toBe('₹75.50');
  });

  it('caps the name at two lines beside the photo, and never caps the price', async () => {
    setWindow();
    await renderList();
    expect(screen.getByText(SANDWICH.name).props.numberOfLines).toBe(2);
    expect(screen.getByText(money.formatPaise(6_000)).props.numberOfLines).toBeUndefined();
  });

  /**
   * `E21`: a dish with no photograph is a branded tile, never a grey box. Most of the
   * catalogue has no image today, so this is the ordinary case rather than the edge one.
   */
  it('draws the pattern tile when a dish has no photo', async () => {
    setWindow();
    await renderList();
    expect(screen.getByTestId('menu-row-d1-image').props.source.uri).toBeUndefined();
  });

  it('asks for the photo it will draw, and keys it to the dish so a recycled card cannot lie', async () => {
    setWindow();
    await renderList();
    // Hidden from the screen reader — a photo beside the dish's own name adds nothing to say.
    const image = screen.getByTestId('menu-row-d2-image', { includeHiddenElements: true });
    expect(image.props.source).toEqual({ uri: SANDWICH.imageUri });
    expect(image.props.recyclingKey).toBe('d2');
    expect(image.props.cachePolicy).toBe('memory-disk');
  });

  it('marks veg / egg / non-veg on the photo, and marks nothing when nobody has classified it', async () => {
    setWindow();
    await renderList();
    expect(screen.getByTestId('menu-row-d1-foodtype')).toBeOnTheScreen();
    expect(screen.getByLabelText('Pure vegetarian')).toBeOnTheScreen();
    expect(screen.queryByTestId('menu-row-d2-foodtype')).toBeNull();
  });

  it('flags a clash with the selected recipient, in words, on the card', async () => {
    setWindow();
    await renderList([{ ...COLD_COFFEE, warnAllergens: ['Milk'] }]);
    expect(screen.getByTestId('menu-row-d1-allergen')).toBeOnTheScreen();
    expect(screen.getByText(/Contains Milk/)).toBeOnTheScreen();
  });

  it('shows no flag when there is no clash to report', async () => {
    setWindow();
    await renderList();
    expect(screen.queryByTestId('menu-row-d1-allergen')).toBeNull();
  });

  /**
   * `MI1` / `MI7`. The card is mostly pictures, so the spoken label is where the third
   * allergen state has to survive — "nobody has said" and "there are none" are opposite facts
   * wearing the same shape, and a blank card looks identical for both.
   */
  it('speaks the price and the allergen state in one label', async () => {
    setWindow();
    await renderList([{ ...COLD_COFFEE, warnAllergens: ['Milk'] }, SANDWICH]);
    expect(
      screen.getByLabelText(/Cold Coffee, ₹75\.50, warning, contains Milk, contains allergens/),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(/Sandwich.*allergens not stated/)).toBeOnTheScreen();
  });

  it('gives the card a 16:10 photo (§5.5)', async () => {
    setWindow();
    await renderList();
    expect(screen.getByTestId('menu-row-d1-photo')).toHaveStyle({
      width: GRID_CARD_WIDTH,
      height: Math.round(GRID_CARD_WIDTH / (16 / 10)),
    });
  });

  it('opens the dish rather than adding it', async () => {
    setWindow();
    const { onSelect } = await renderList();
    await userEvent.setup().press(screen.getByTestId('menu-row-d1'));
    expect(onSelect).toHaveBeenCalledWith('d1');
  });
});

/** `docs/ux-spec.md` §3.5 — the grid is not a fixed choice. */
describe('at AX1 and above', () => {
  const BIG = { fontScale: AX_SINGLE_COLUMN_FONT_SCALE };

  it('drops to a single column, with the photo as a leading thumbnail', async () => {
    setWindow(BIG);
    await renderList();
    const card = screen.getByTestId('menu-row-d1');
    expect(card).toHaveStyle({ width: FULL_CARD_WIDTH });
    expect(card).toHaveStyle({ flexDirection: 'row' });
    // 96pt square — the thumbnail size the app already renders (`IMAGE_SIZES.thumb`), not a
    // full-width 16:10 photo pushing the price off the screen.
    expect(screen.getByTestId('menu-row-d1-photo')).toHaveStyle({ width: 96, height: 96 });
  });

  it('stops truncating the dish name — removing text is the opposite of what was asked for', async () => {
    setWindow(BIG);
    await renderList();
    expect(screen.getByText(SANDWICH.name).props.numberOfLines).toBeUndefined();
  });

  it('keeps the price and the allergen warning, both untruncated', async () => {
    setWindow(BIG);
    await renderList([{ ...COLD_COFFEE, warnAllergens: ['Milk'] }]);
    expect(screen.getByText(money.formatPaise(7_550)).props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('menu-row-d1-allergen')).toBeOnTheScreen();
  });

  /**
   * `NV6` keeps `getItemLayout` on this list, and `getItemLayout` is only correct while every
   * row really is the height it claims. Here the name is deliberately unbounded, so there is
   * no constant to give — and a `getItemLayout` that lies scrolls to the wrong place.
   */
  it('gives up the fixed row height rather than lying about it', async () => {
    setWindow(BIG);
    await renderList();
    expect(screen.getByTestId('menu-list').props.getItemLayout).toBeUndefined();
  });

  it('keeps it at ordinary text sizes, where the row height is true by construction', async () => {
    setWindow();
    await renderList();
    expect(screen.getByTestId('menu-list').props.getItemLayout).toEqual(expect.any(Function));
  });
});

describe('loading', () => {
  it('is a skeleton of the grid, never a spinner (R9, S5)', async () => {
    setWindow();
    await renderList([], { loading: true });
    expect(screen.getByTestId('menu-list-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('menu-list')).toBeNull();
  });

  /** The search field and the tabs are in the list header. Losing them while loading would
      leave the screen with no controls at exactly the moment someone wants to change what
      they asked for. */
  it('keeps the list header while the skeleton is up', async () => {
    setWindow();
    await renderList([], {
      loading: true,
      ListHeaderComponent: <Text testID="header">Our food</Text>,
    });
    expect(screen.getByTestId('header')).toBeOnTheScreen();
  });
});
