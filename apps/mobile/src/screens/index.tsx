import { useNavigation } from '@react-navigation/native';

import { PlaceholderScreen } from './PlaceholderScreen';
import { MenuScreen as MenuScreenImpl } from '../menu/MenuScreen';
import { useSelectedSchool } from '../session/SelectedSchoolContext';

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

/**
 * The one placeholder that is now real (`E04-12`).
 *
 * The school comes from `SelectedSchoolContext`, which is `null` until a school is chosen —
 * and `null` is a legitimate state that renders an empty menu, not an error. `AR7`: nothing
 * here asks who you are.
 */
export const MenuScreen = () => {
  const navigation = useNavigation();
  const { schoolId } = useSelectedSchool();
  return (
    <MenuScreenImpl
      schoolId={schoolId}
      onSelectDish={(dishId) => navigation.navigate('DishDetail', { dishId })}
    />
  );
};

/**
 * Real as of `E05-04`. Fillable signed out — the sign-in gate is at checkout, not here
 * (`AR7`), which `CartScreen.test.tsx` asserts rather than leaving to this comment.
 */
export { CartScreen } from '../cart/CartScreen';

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
