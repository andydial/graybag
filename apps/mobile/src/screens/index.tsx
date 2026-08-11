import { useEffect, useState } from 'react';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Linking } from 'react-native';

import { schoolRequestMailto } from '../support/contact';


import { AccountScreen as AccountScreenImpl } from '../account/AccountScreen';
import { OrderDetailScreen as OrderDetailScreenImpl } from '../orders/OrderDetailScreen';
import { OrdersScreen as OrdersScreenImpl } from '../orders/OrdersScreen';
import { HomeScreen as HomeScreenImpl, type HomeDish } from '../home/HomeScreen';
import { useAllergenWatchlist } from '../menu/useAllergenWatchlist';
import { useCachedMenu } from '../menu/useCachedMenu';


import { AddChildScreen as AddChildScreenImpl } from '../recipients/AddChildScreen';
import { DishDetailScreen as DishDetailScreenImpl } from '../menu/DishDetailScreen';
import { ChildrenScreen as ChildrenScreenImpl } from '../recipients/ChildrenScreen';
import { MenuScreen as MenuScreenImpl } from '../menu/MenuScreen';
import type { RootStackParamList } from '../navigation/types';
import { SchoolPicker } from '../menu/SchoolPicker';
import { SignInScreen as SignInScreenImpl } from '../session/SignInScreen';
import { SupportScreen as SupportScreenImpl } from '../status/SupportScreen';
import { DeleteAccountScreen as DeleteAccountScreenImpl } from '../account/DeleteAccountScreen';
import { PolicyDocumentScreen as PolicyDocumentScreenImpl } from '../account/PolicyDocumentScreen';
import { useConnectivity } from '../net/ConnectivityContext';
import { useAccess, useOrderingTarget, useRefreshRecipients } from '../session/audience';
import { useSignOut } from '../session/useRecipients';
import { useSession } from '../session/SessionContext';
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
/**
 * Home (`E21-08`), wired.
 *
 * The promoted dish and the rail come from the **cached menu** rather than a new request: the
 * menu is already held by the time this renders, and a second round trip on this audience's
 * connection would be the slowest thing on the screen (`E04-10`).
 *
 * The recipient's name, class, school and break time are **not wired yet** — `OrderTarget`
 * carries only an id, an allergen list and a date. The card degrades honestly rather than
 * inventing them, and `E05-29`/`E05-35` fill them in.
 */
export const HomeScreen = () => {
  const navigation = useNavigation();
  const access = useAccess();
  const { schoolId } = useSelectedSchool();
  const { state, payload, stale } = useCachedMenu(schoolId);
  const { offline } = useConnectivity();
  // Real now: `OrderTargetProvider` reads the account's recipients and picks one. Before
  // today nothing wrote the target, so this card could never say who it was ordering for.
  const target = useOrderingTarget();

  const dishes = payload?.dishes ?? [];
  const toHomeDish = (dish: (typeof dishes)[number]): HomeDish => ({
    id: dish.id,
    name: dish.name,
    pricePaise: dish.pricePaise,
    imageUri: dish.imageUri,
    foodType: dish.foodType,
  });

  return (
    <HomeScreenImpl
      state={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'}
      access={access}
      stale={stale || offline}
      // A school with a published menu and nothing in it is `menuUnpublished`; no school
      // chosen is not, because the card's job in that case is to offer the picker.
      menuUnpublished={schoolId !== null && state === 'ready' && dishes.length === 0}
      recipientName={target?.displayName ?? null}
      recipientClass={target?.classLabel ?? null}
      schoolName={target?.schoolName ?? null}
      // Still absent, and still said rather than invented: the break is not on the recipient
      // and not in `fetchRecipients` (`E05-29`).
      breakLabel={target?.breakLabel ?? null}
      serviceDate={target?.serviceDate ?? null}
      featured={dishes[0] ? toHomeDish(dishes[0]) : null}
      popular={dishes.slice(1, 6).map(toHomeDish)}
      onBrowseMenu={() => navigation.navigate('Tabs')}
      onChooseSchool={() => navigation.navigate('Tabs')}
      onAddRecipient={() => navigation.navigate('AddChild')}
      onSelectDish={(dishId) => navigation.navigate('DishDetail', { dishId })}
      onSwitchRecipient={() => navigation.navigate('Children')}
      onRetry={() => navigation.navigate('Tabs')}
    />
  );
};

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
  // `E05-31`. Before this the menu drew no allergen flags at all, because nothing could tell it
  // what to warn about — F5 was the only §6 divergence with a safety consequence.
  const watchlist = useAllergenWatchlist();

  if (schoolId === null) {
    // The picker carries the welcome now (§6.1.1 cut 1), so this is the first screen a cold
    // visitor sees — and the "Sign in" link on it is the door for a returning parent on a new
    // device, who has no cart to place and would otherwise have to build one to reach the gate.
    return (
      <SchoolPicker
        onSelect={(next) => setSchool(next)}
        onSignIn={() => navigation.navigate('SignIn')}
        /*
         * `E04-20`. The prop was accepted and never passed, so a parent whose school is not on
         * the list had nothing to do — and with three schools live that is most people opening
         * the app. There is no backend for a school request (`E04-21`), so it composes a
         * message carrying whatever they typed.
         */
        onRequestSchool={(query) => void Linking.openURL(schoolRequestMailto(query))}
      />
    );
  }

  return (
    <MenuScreenImpl
      allergens={watchlist}
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
  const access = useAccess();
  const { email } = useSession();
  const signOut = useSignOut();

  return (
    <AccountScreenImpl
      access={access}
      email={email}
      onSignIn={() => navigation.navigate('SignIn')}
      onRecipients={() => navigation.navigate('Children')}
      onSignOut={() => {
        // Both sessions, Supabase first — see `session/useRecipients.ts`. This prop was never
        // passed before, so the Sign out row did nothing at all while looking like it worked.
        void signOut();
      }}
      onOrders={() => navigation.navigate('Orders')}
      // `E20-39`. This had no caller, so the Grievance officer row rendered and did nothing —
      // one of the six compliance controls, unreachable, on a screen that looked complete.
      onSupport={() => navigation.navigate('Support')}
      // `E20-37`. The danger row rendered in red and did nothing — a store reviewer taps this
      // during submission, and one of the six compliance controls was inert behind it.
      onDeleteAccount={() => navigation.navigate('DeleteAccount')}
      // `E20-38`. Three rows rendered and did nothing; nothing in the app opened the policies.
      onPolicy={(which) => navigation.navigate('Policy', { which })}
    />
  );
};

/** A policy document (`E20-38`). The text is generated from `docs/`, never a second copy. */
export const PolicyScreen = () => {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Policy'>>();
  return <PolicyDocumentScreenImpl which={params.which} />;
};

/**
 * Account deletion (`E20-37`), wired.
 *
 * Takes no props: the screen composes a request to `SUPPORT_EMAIL` itself. There is no erasure
 * pipeline to call yet (`E20-18`, `E20-30`), and a "Delete my account" button that quietly does
 * nothing is worse than one that says plainly it is handled by a person.
 */
export const DeleteAccountScreen = () => <DeleteAccountScreenImpl />;

/**
 * Support and the grievance officer (`E20-39`), wired.
 *
 * Takes no props. `grievance` stays `null` until `E20-21` supplies the name, designation and
 * published address — the screen already says so plainly rather than inventing a contact, and
 * a published contact that goes nowhere is a commitment on record that we are failing.
 *
 * There is no `supportEmail` to pass any more: the address lives in `support/contact.ts` and
 * reaches the screen only as the target of a `mailto:`, never as text (Andy, 2026-08-11).
 */
export const SupportScreen = () => <SupportScreenImpl />;

// Reached from Account. `navigation/types.ts` used to say "and from Home" as well; Home has no
// such link, and saying so was how nobody noticed this screen had no door at all.
/**
 * Orders (`E21-10`), wired.
 *
 * **It is passed no orders, and that is honest rather than lazy.** There is no `fetchOrders` in
 * the `api/` module — `E06` brings it — so the screen renders its empty state, which is the true
 * answer for a build that cannot ask. Inventing a fetch, or worse a fixture, would make an
 * unbuilt feature look finished.
 *
 * Signed out it prompts rather than walls (`AR7`).
 */
export const OrdersScreen = () => {
  const navigation = useNavigation();
  const access = useAccess();

  return (
    <OrdersScreenImpl
      access={access}
      onSignIn={() => navigation.navigate('SignIn')}
      // `Tabs` takes no params in RootStackParamList, so the nested-navigate form is not
      // typed here. Going back to the tabs lands on the last tab, which for anyone who
      // reached Orders from Account is Account — good enough until the param list grows.
      onBrowseMenu={() => navigation.navigate('Tabs')}
      onSelectOrder={(orderGroupId) => navigation.navigate('OrderDetail', { orderGroupId })}
    />
  );
};

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
  // Through the audience, so the target is `null` for anyone without a session — a dish sheet
  // must not name a child on an unauthenticated phone any more than the cart may.
  const target = useOrderingTarget();

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

/**
 * Order detail (`E21-11`), wired.
 *
 * Passed no order, for the same reason Orders is passed none: there is no `fetchOrder` until
 * `E06`, so it renders its "nothing to show" state — the true answer for a build that cannot
 * ask. It is the only route still in `KNOWN_DOORLESS`, because the list it would be tapped
 * from is itself empty.
 */
export const OrderDetailScreen = () => {
  const navigation = useNavigation();
  return <OrderDetailScreenImpl onBackToMenu={() => navigation.navigate('Tabs')} />;
};

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
  const refresh = useRefreshRecipients();

  return (
    <SignInScreenImpl
      onSignedIn={() => {
        // A signed-out visitor could not read their recipients, so the provider's first pass
        // found none. Without this the app knows who you are and still cannot say who you
        // order for, which reads as the sign-in not having worked.
        void refresh();
        // F1: back to whatever sent us here — the cart, keeping its contents. Never to Home.
        navigation.goBack();
      }}
    />
  );
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
/**
 * Add someone (`E21-04`), wired.
 *
 * ## The flow defect this closes
 *
 * Choose a school → add a child → save → back on Home with **no school selected** and nobody
 * to order for. Three separate causes, all of them "the same fact is held in two places":
 *
 * 1. `OrderTargetProvider` read the recipients **once, at mount**. Someone added at 9am was
 *    invisible until the app restarted.
 * 2. Nothing selected the person who had just been added — the whole point of adding them.
 * 3. `SelectedSchoolContext` and the order target were independent answers to "which school",
 *    so picking one and then adding a child at it left the two disagreeing.
 *
 * So on save: re-read, select the new recipient, and let the school follow from them
 * (`useSchoolFollowsRecipient` below). The school is now **derived**, which is why it cannot
 * drift again.
 */
export const AddChildScreen = () => {
  const navigation = useNavigation();
  const { schoolId, schoolName } = useSelectedSchool();
  const refresh = useRefreshRecipients();
  const { offline } = useConnectivity();

  return (
    <AddChildScreenImpl
      offline={offline}
      initialSchool={{ schoolId, schoolName }}
      appVersion={Constants.expoConfig?.version ?? 'unknown'}
      onAdded={(recipient) => {
        // Await nothing: the screen returns immediately and the list catches up. Blocking the
        // back navigation on a network read would make a successful save feel like a hang.
        void refresh(recipient.recipientId);
        navigation.goBack();
      }}
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

  const refresh = useRefreshRecipients();

  useEffect(() => {
    if (isFocused) setVisit((n) => n + 1);
  }, [isFocused]);

  return (
    <ChildrenScreenImpl
      onSignIn={() => navigation.navigate('SignIn')}
      reloadToken={visit}
      onAddChild={() => navigation.navigate('AddChild')}
      /*
       * Selecting a row now actually switches who the order is for. The screen deliberately
       * refused to write the target itself: `OrderTarget` needs the allergen list, and passing
       * `[]` would silently claim "no allergies" for that person — which F5/F6 forbid. The
       * provider owns that decision and sets `allergenIds: null`, meaning "not read".
       */
      /*
       * `refresh(id)` rather than `setTarget(next)`: the choices list carries
       * `allergenIds: null`, and selecting from it directly would leave the app unable to warn
       * about the person just chosen. `refresh` re-reads and resolves their allergens
       * (`E05-31`). One round trip per switch, which is the right price for a warning that
       * works.
       */
      onSelectRecipient={(recipientId) => void refresh(recipientId)}
    />
  );
};
