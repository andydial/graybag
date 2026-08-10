import { useEffect, useState } from 'react';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Constants from 'expo-constants';

import { View } from 'react-native';

import { AccountScreen as AccountScreenImpl } from '../account/AccountScreen';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';
import { requiresSignIn, useSession } from '../session/SessionContext';

const { space } = design;
import { PlaceholderScreen } from './PlaceholderScreen';
import { AddChildScreen as AddChildScreenImpl } from '../recipients/AddChildScreen';
import { DishDetailScreen as DishDetailScreenImpl } from '../menu/DishDetailScreen';
import { ChildrenScreen as ChildrenScreenImpl } from '../recipients/ChildrenScreen';
import { MenuScreen as MenuScreenImpl } from '../menu/MenuScreen';
import type { RootStackParamList } from '../navigation/types';
import { SchoolPicker } from '../menu/SchoolPicker';
import { SignInScreen as SignInScreenImpl } from '../session/SignInScreen';
import { useOrderTarget } from '../session/OrderTargetContext';
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
//
// It goes to the **list** rather than straight to the form. Until there was a list, adding a
// child was a one-way door: the child disappeared on save and there was nothing that could
// show a parent what they had entered or let them correct it. "Add a child" is still one tap
// away — it is what the empty list offers, and the only thing on it when there is nobody yet.
/**
 * Account — the real screen (`E21-13`), wired to the navigator here.
 *
 * The screen itself is presentational and takes handlers: it knows what the rows are, this
 * knows where they go. That split is why it can be tested in every state without a navigator.
 *
 * `exactOptionalPropertyTypes` is on, so an optional handler is spread conditionally rather
 * than passed as possibly-undefined.
 */
export const AccountScreen = () => {
  const navigation = useNavigation();
  const session = useSession();
  const signedOut = requiresSignIn(session);

  return (
    <AccountScreenImpl
      signedOut={signedOut}
      onSignIn={() => navigation.navigate('SignIn')}
      onRecipients={() => navigation.navigate('Children')}
      onOrders={() => navigation.navigate('Orders')}
    />
  );
};

// Reached from Account. `navigation/types.ts` used to say "and from Home" as well; Home has no
// such link, and saying so was how nobody noticed this screen had no door at all.
export const OrdersScreen = () => (
  <PlaceholderScreen
    testID="screen-orders"
    title="Your orders"
    body="Once you have placed an order it will appear here, with what was ordered, for whom, and when it will be delivered."
  />
);

/**
 * Real as of `E04-12` / `E14-14`. `D7`: the allergen warning belongs at add-to-cart, on this
 * screen.
 *
 * The dish comes out of the cached menu by id rather than being fetched — the menu is already
 * held by the time a row can be tapped, and a per-dish round trip on this audience's
 * connection would be the slowest thing on the screen (`E04-10`, `MC3`).
 */
export const DishDetailScreen = () => {
  // No `useNavigation` here any more: this screen never routes anywhere. It used to send
  // people to AddChild before they could add to the cart, which was the wall (`E05-32`).
  const { params } = useRoute<RouteProp<RootStackParamList, 'DishDetail'>>();
  const { schoolId } = useSelectedSchool();
  const { target } = useOrderTarget();

  return (
    <DishDetailScreenImpl
      dishId={params.dishId}
      schoolId={schoolId}
      target={target}
      // `null` is the ordinary state today: nothing can name a child yet (`E05-16`), so the
      // one honest thing to offer is the screen that creates one.
    />
  );
};

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

/**
 * The children a parent has added (`E05-01`), and where a school change starts (`E05-02`).
 *
 * `goBack` is not what "add a child" does from here — it **pushes** the form, so returning
 * from it lands back on this list with the new child on it. That is the loop the flow was
 * missing: before this screen existed, saving a child returned to Account and there was
 * nothing anywhere that showed it had worked.
 *
 * The refetch on focus is what closes that loop. A stack screen stays mounted while the form
 * is pushed over it, so without this the parent comes back to the list they were looking at
 * before they added anyone — which reads exactly like the add having failed.
 */
export const ChildrenScreen = () => {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const [visit, setVisit] = useState(0);

  useEffect(() => {
    if (isFocused) setVisit((n) => n + 1);
  }, [isFocused]);

  return (
    <ChildrenScreenImpl
      reloadToken={visit}
      onAddChild={() => navigation.navigate('AddChild')}
    />
  );
};
