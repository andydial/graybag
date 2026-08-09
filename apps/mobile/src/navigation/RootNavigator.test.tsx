import { render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PUBLIC_ROUTES, RootNavigator } from './RootNavigator';
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
    expect(screen.queryAllByRole('button')).toHaveLength(4);
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

describe('requiresSignIn', () => {
  it('is true when signed out and false when signed in', () => {
    expect(requiresSignIn({ status: 'signedOut', userId: null })).toBe(true);
    expect(requiresSignIn({ status: 'signedIn', userId: 'u1' })).toBe(false);
  });
});
