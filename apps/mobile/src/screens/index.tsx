import { useNavigation } from '@react-navigation/native';

import { PlaceholderScreen } from './PlaceholderScreen';
import { MenuScreen as MenuScreenImpl } from '../menu/MenuScreen';
import { SchoolPicker } from '../menu/SchoolPicker';
import { SignInScreen as SignInScreenImpl } from '../session/SignInScreen';
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
 * **When no school has been chosen, this shows the picker rather than an empty menu.**
 * `null` used to render an empty state — correct while nothing could supply a school list,
 * and useless now that something can: an empty Menu tab with no way to fill it is a dead
 * end, and the audience arriving in the next few weeks is ~150 parents who have never
 * opened this app before (`SC3`).
 *
 * Choosing a school is one tap and it is not a gate — the tab bar stays live throughout, so
 * anyone who would rather look at their cart or their account first still can. `AR7`:
 * nothing here asks who you are.
 */
export const MenuScreen = () => {
  const navigation = useNavigation();
  const { schoolId, setSchool } = useSelectedSchool();

  if (schoolId === null) {
    return <SchoolPicker onSelect={(next) => setSchool(next)} />;
  }

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

/**
 * Real as of `E03-14`. Email OTP only for now — Google (`E03-12`) and Apple (`E03-13`) need
 * OAuth client ids and an Apple team configuration, both of which are Andy's to create.
 *
 * Dismisses itself on success, because it is presented modally over whatever the user was
 * doing (checkout) and the point of signing in was to carry on with that, not to arrive
 * somewhere new.
 */
export const SignInScreen = () => {
  const navigation = useNavigation();
  return <SignInScreenImpl onSignedIn={() => navigation.goBack()} />;
};
