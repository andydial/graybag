import { PlaceholderScreen } from './PlaceholderScreen';

/**
 * The screens, as placeholders. Content lands in `E14-14` and `E04-12`; what is fixed here
 * is which routes exist and what each is for.
 *
 * Every one of these mounts with no session. That is asserted in
 * `navigation/RootNavigator.test.tsx` rather than left to a comment, because `AR7` is a
 * standing constraint and the way it gets broken is one screen at a time.
 */

export const HomeScreen = () => (
  <PlaceholderScreen
    testID="screen-home"
    title="Home"
    note="Delivery school, today's specials, top of week. Browsable signed out."
  />
);

export const MenuScreen = () => (
  <PlaceholderScreen
    testID="screen-menu"
    title="Menu"
    note="Category tabs and search (E04-12). Browsable signed out — this is the screen AR7 is about."
  />
);

export const CartScreen = () => (
  <PlaceholderScreen
    testID="screen-cart"
    title="Cart"
    note="Fillable signed out. The sign-in gate is at checkout, not here."
  />
);

export const AccountScreen = () => (
  <PlaceholderScreen
    testID="screen-account"
    title="Account"
    note="Signed out: an invitation to sign in. Never a wall — the tab still opens."
  />
);

export const OrdersScreen = () => (
  <PlaceholderScreen
    testID="screen-orders"
    title="Orders"
    note="Order history. Reachable from Account and Home rather than a fifth tab."
  />
);

export const DishDetailScreen = () => (
  <PlaceholderScreen
    testID="screen-dish-detail"
    title="Dish"
    note="Dish detail sheet, allergen warnings at add-to-cart (D7). Browsable signed out."
  />
);

export const OrderDetailScreen = () => (
  <PlaceholderScreen
    testID="screen-order-detail"
    title="Order"
    note="One order group: status, pickup code, invoice."
  />
);

export const SignInScreen = () => (
  <PlaceholderScreen
    testID="screen-sign-in"
    title="Sign in"
    note="Google, Apple, email OTP. No passwords (U1). Reached by intent, never on open."
  />
);
