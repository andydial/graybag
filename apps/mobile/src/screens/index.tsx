import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';

import { PlaceholderScreen } from './PlaceholderScreen';
import { AddChildScreen as AddChildScreenImpl } from '../recipients/AddChildScreen';
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

/**
 * Every `body` below is written for a parent holding the phone, not for us (`E14-17`).
 *
 * What was here before were build notes — "Browsable signed out", "Never a wall — the tab
 * still opens" — and they shipped to a real device. They record real constraints (`AR7`,
 * `D7`) and those constraints now live in these comments, which is where they were always
 * meant to be. The screen says what will be on it, in the second person, as a future,
 * because it genuinely is not built yet.
 */

// `AR7`: Home opens with no session and always will. Today's specials are the hook, and a
// hook behind a sign-in wall is not a hook.
export const HomeScreen = () => (
  <PlaceholderScreen
    testID="screen-home"
    title="Welcome to GrayBag"
    body="Today's specials and the week ahead will show up here. For now, tap Menu to see the food and start an order."
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

// `AR7`, and the reason the old note said "never a wall": this tab **opens** signed out
// rather than redirecting to sign-in. The invitation is the content, not a gate — which is
// why the copy leads with what signing in gets you and then says what works without it.
//
// The one action is real (`E05-01`). It is reached **by intent** from here and is never
// pushed at anybody: `AR7` says adding a child must not be a wall in front of browsing.
export const AccountScreen = () => {
  const navigation = useNavigation();
  return (
    <PlaceholderScreen
      testID="screen-account"
      title="Your account"
      body="Sign in to add your children, see your orders and manage payment. You can browse the menu and fill your cart without signing in."
      actionLabel="Add a child"
      onAction={() => navigation.navigate('AddChild')}
    />
  );
};

// Reached from Account and Home rather than being a fifth tab — the mock has four.
export const OrdersScreen = () => (
  <PlaceholderScreen
    testID="screen-orders"
    title="Your orders"
    body="Once you have placed an order it will appear here, with what was ordered, for whom, and when it will be delivered."
  />
);

// `D7`: the allergen warning belongs at add-to-cart, on this screen. That is a constraint on
// what gets built here, not something to say to a parent in advance of it existing.
export const DishDetailScreen = () => (
  <PlaceholderScreen
    testID="screen-dish-detail"
    title="Dish details"
    body="The full description, what is in it and any allergen information will appear here."
  />
);

export const OrderDetailScreen = () => (
  <PlaceholderScreen
    testID="screen-order-detail"
    title="Order details"
    body="This is where you will find what was ordered, its delivery status and your invoice."
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

/**
 * Adding a child (`E05-01`, `E20-02`).
 *
 * The school defaults to the one already being browsed. A parent arriving here has almost
 * always answered "which school" once already, and `AR7` makes every avoidable step a cost
 * we can measure in registrations.
 *
 * `app_version` goes onto the consent record as evidence of *which build* showed the wording.
 * It comes from `expo-constants` rather than a literal, so it cannot drift from the binary.
 */
export const AddChildScreen = () => {
  const navigation = useNavigation();
  const { schoolId, schoolName } = useSelectedSchool();

  return (
    <AddChildScreenImpl
      initialSchool={{ schoolId, schoolName }}
      appVersion={Constants.expoConfig?.version ?? 'unknown'}
      onAdded={() => navigation.goBack()}
      onCancel={() => navigation.goBack()}
    />
  );
};
