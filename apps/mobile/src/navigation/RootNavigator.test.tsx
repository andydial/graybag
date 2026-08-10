import { render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PUBLIC_ROUTES, RootNavigator, TAB_ORDER, cartTabLabel } from './RootNavigator';
import { SCREEN_TEST_ID } from '../components/Screen';
import { CartProvider } from '../cart/CartContext';
import { SessionProvider, requiresSignIn } from '../session/SessionContext';
import { SelectedSchoolProvider } from '../session/SelectedSchoolContext';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * Find a tab by its accessibility label.
 *
 * React Navigation announces a tab as `"Menu, tab, 2 of 4"` — the role and the position are
 * part of the label rather than separate props. Matching the prefix rather than the whole
 * string keeps the test from breaking when a fifth tab renumbers the others, while still
 * asserting the label a screen-reader user actually hears (`E13-08`).
 */
const tab = (name: string) => screen.getByLabelText(new RegExp(`^${name}, tab,`));

/**
 * Mount the app exactly as `App.tsx` does, with **no session**. Every test in this file
 * uses this: the default is signed out, and a test that had to opt into being signed out
 * would let the default drift the other way without failing.
 */
function renderSignedOut() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <SessionProvider>
        {/*
          The cart provider is not optional scaffolding: the Cart tab's badge reads the cart
          during the navigator's own render (`E05-04`), so a navigator without one throws.
          That is deliberate — `useCart` refuses rather than returning an empty cart, because
          a silently-empty cart reads as "the add button is broken".
        */}
        <CartProvider>
          <RootNavigator />
        </CartProvider>
      </SessionProvider>
    </SafeAreaProvider>,
  );
}

/**
 * The tab bar's own buttons, in order.
 *
 * Every tab announces "<Name>, tab, n of m" on iOS, which is what distinguishes them from any
 * other button a screen happens to render. Screens are real now, so "all the buttons" and "the
 * tabs" stopped being the same set.
 */
const tabBarLabels = (): string[] =>
  screen
    .getAllByRole('button')
    .map((node) => String(node.props.accessibilityLabel ?? ''))
    .filter((label) => /,\s*tab,\s*\d+ of \d+/.test(label));

describe('RootNavigator', () => {
  it('opens on Home with no session', async () => {
    await renderSignedOut();
    expect(screen.getByTestId('screen-home')).toBeOnTheScreen();
  });

  it('shows the four tabs from the mock, and no more', async () => {
    await renderSignedOut();
    for (const label of ['Home', 'Menu', 'Cart', 'Account']) {
      expect(tab(label)).toBeOnTheScreen();
    }
    // Orders is deliberately not a tab — the mock has four and a fifth is a design change
    // nobody asked for. It is a stack route reached from Account and Home.
    expect(screen.queryByLabelText(/^Orders, tab,/)).toBeNull();
    // Count the TAB BAR's buttons, not every button on screen. This used to be
    // `queryAllByRole('button')` and passed only because Home was a placeholder with no
    // controls; the moment Home became a real screen (`E21-08`) it counted Home's search
    // field and delivery card too. The assertion is about how many tabs exist.
    expect(tabBarLabels()).toHaveLength(TAB_ORDER.length);
  });

  /**
   * The `AR7` guarantee, and the reason this file exists.
   *
   * Signup-to-first-order conversion is a primary v1 goal, not a quality attribute. The way
   * that goal dies is not a decision — it is one screen at a time, each with a reasonable
   * local justification, until the menu sits behind a sign-in wall exactly as the legacy
   * app's funnel did. Asserting it per route means adding a gate to any of these is a
   * failing test with `AR7` in the message, which is a conversation rather than a merge.
   */
  /**
   * What each public route renders when opened with no session and no state.
   *
   * `Menu` is the only one with an answer other than `screen-<route>`, and it is **not** a
   * weakening of `AR7`. With no school chosen the Menu tab shows the school picker, which is
   * the first step of browsing rather than a gate: the tab bar stays live, every other tab
   * is still one tap away, and nothing asks who you are. A parent who would rather look at
   * their cart first still can. Once a school is chosen the same tab shows the menu, which
   * `renders the menu once a school is chosen` below asserts separately.
   *
   * The pattern rather than an exact id because the picker announces its state — `-loading`,
   * `-error`, `-empty` — and which one it lands on depends on whether a backend is
   * configured, which is not what this file is about. What it is about is the second
   * assertion in each case: the sign-in gate did not fire.
   */
  const OPENS_AS: Record<string, RegExp> = {
    Home: /^screen-home$/,
    Menu: /^school-picker/,
    Cart: /^screen-cart$/,
    Account: /^screen-account$/,
  };

  it.each(PUBLIC_ROUTES.filter((r) => r !== 'DishDetail'))(
    'browsing %s does not require a session',
    async (route) => {
      await renderSignedOut();
      const user = userEvent.setup();
      await user.press(tab(route));

      expect(screen.getByTestId(OPENS_AS[route] ?? new RegExp(`^screen-${route.toLowerCase()}$`)))
        .toBeOnTheScreen();
      // The gate must not have fired as a side effect of navigating.
      expect(screen.queryByTestId('screen-sign-in')).toBeNull();
    },
  );

  it('renders the menu once a school is chosen, still with no session', async () => {
    // The other half of AR7 for this tab: choosing a school is one tap and it leads
    // straight to food, not to a sign-in screen.
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SessionProvider>
          <SelectedSchoolProvider initial={{ schoolId: 'school-1', schoolName: 'Alpha' }}>
            <CartProvider>
              <RootNavigator />
            </CartProvider>
          </SelectedSchoolProvider>
        </SessionProvider>
      </SafeAreaProvider>,
    );

    const user = userEvent.setup();
    await user.press(tab('Menu'));

    expect(screen.getByTestId('screen-menu')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-sign-in')).toBeNull();
  });

  it('never lands on the sign-in screen on open', async () => {
    await renderSignedOut();
    expect(screen.queryByTestId('screen-sign-in')).toBeNull();
  });

  it('puts the cart behind no gate — the gate is at checkout', async () => {
    await renderSignedOut();
    const user = userEvent.setup();
    await user.press(tab('Cart'));
    expect(screen.getByTestId('screen-cart')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-sign-in')).toBeNull();
  });

  it('opens Account signed out rather than redirecting', async () => {
    // The tempting shape is "Account redirects to SignIn when signed out". It is wrong:
    // a tab that cannot be opened is a wall, and AR7 says adding a child must not be one
    // in front of browsing. Account signed out is an invitation, not a redirect.
    await renderSignedOut();
    const user = userEvent.setup();
    await user.press(tab('Account'));
    expect(screen.getByTestId('screen-account')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-sign-in')).toBeNull();
  });
});

/**
 * The tab bar's icons (`E14-16`).
 *
 * On the first iOS build all four tabs drew React Navigation's default placeholder — a filled
 * triangle — because only the Cart tab set `tabBarIcon` and that one returned the badge,
 * which is `null` at zero. Nothing in the project supplied an icon at all.
 *
 * These assert the presence of a real icon per tab rather than what it looks like. What it
 * looks like is `docs/design-tokens.md` §7's business and `TabIcon`'s; what this file is
 * responsible for is that every tab has one, which is the part that was missing.
 */
describe('tab bar icons', () => {
  it.each([
    ['Home', 'tab-icon-home'],
    ['Menu', 'tab-icon-menu'],
    ['Cart', 'tab-icon-cart'],
    ['Account', 'tab-icon-account'],
  ])('%s draws its own icon rather than the default placeholder', async (_name, testID) => {
    await renderSignedOut();
    // `getAllBy`, not `getBy`: React Navigation renders each tab's icon twice in the tree —
    // once visible and once for the large-content viewer it offers on iOS. The old default
    // triangle was rendered by the same path, which is why one tab still showed one glyph.
    expect(screen.getAllByTestId(testID).length).toBeGreaterThan(0);
  });

  it('announces its tabs in the declared order', async () => {
    // `cartTabLabel` reproduces React Navigation's "Cart, tab, 3 of 4" so it can add the
    // count to it, and it takes the position from `TAB_ORDER`. This is what stops that list
    // and the JSX below it from drifting apart — a fifth tab added to one and not the other
    // would make the cart announce the wrong position to a screen-reader user, silently.
    await renderSignedOut();
    const labels = tabBarLabels();

    expect(labels).toHaveLength(TAB_ORDER.length);
    TAB_ORDER.forEach((name, index) => {
      expect(labels[index]).toMatch(new RegExp(`^${name}\\b`));
      expect(labels[index]).toContain(`${index + 1} of ${TAB_ORDER.length}`);
    });
  });
});

describe('cartTabLabel', () => {
  // §7: state lives in the label, not the colour. The badge is the sighted half of the
  // signal; React Navigation's tab button is a single accessible element, so iOS never
  // announces the badge inside it and this is the only route the count has.
  it('says nothing about a count when the cart is empty', () => {
    expect(cartTabLabel(0)).toBe('Cart, tab, 3 of 4');
  });

  it('carries the count, singular and plural', () => {
    expect(cartTabLabel(1)).toBe('Cart, 1 item, tab, 3 of 4');
    expect(cartTabLabel(2)).toBe('Cart, 2 items, tab, 3 of 4');
  });
});

/**
 * The test that would have caught the first iOS build.
 *
 * On a real iPhone every screen drew from y=0: the school picker's first row sat on top of
 * the clock and the cart's empty-state heading ran through the status icons. 865 tests were
 * green, because every one of them rendered a screen **in isolation** — and in isolation
 * nobody is responsible for the status bar, so nobody was failing to be.
 *
 * This asks the question at the level the answer lives at: mount the app the way `App.tsx`
 * does, with the insets of the device it broke on, and require that whatever is on screen is
 * below them. It fails on the pre-fix tree at the first assertion, because there is no frame
 * in the tree at all.
 */
describe('safe area', () => {
  // The insets `renderSignedOut` gives the provider. Both non-zero, so an edge that is
  // supposed to add nothing cannot pass by the device having nothing to add.
  const TOP_INSET = 47;

  it.each(PUBLIC_ROUTES.filter((r) => r !== 'DishDetail'))(
    '%s renders below the status bar, not underneath it',
    async (route) => {
      await renderSignedOut();
      const user = userEvent.setup();
      await user.press(tab(route));

      const frames = screen.getAllByTestId(SCREEN_TEST_ID);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame).toHaveStyle({ paddingTop: TOP_INSET });
      }
    },
  );

  it('does not double the bottom inset the tab bar already pays', async () => {
    // The opposite failure, and the reason `TAB_SCREEN_EDGES` omits `bottom`: React
    // Navigation's tab bar sits above the home indicator by itself. A screen that added the
    // inset too would leave a 34pt band of empty canvas above the tab bar.
    await renderSignedOut();

    const frames = screen.getAllByTestId(SCREEN_TEST_ID);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).toHaveStyle({ paddingBottom: 0 });
    }
  });
});

describe('requiresSignIn', () => {
  it('is true when signed out and false when signed in', () => {
    expect(requiresSignIn({ status: 'signedOut', userId: null })).toBe(true);
    expect(requiresSignIn({ status: 'signedIn', userId: 'u1' })).toBe(false);
  });
});
