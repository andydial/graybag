import { useMemo, type ComponentType } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { design } from '@graybag/shared';

import {
  AccountScreen,
  AddChildScreen,
  CartScreen,
  ChildrenScreen,
  DishDetailScreen,
  HomeScreen,
  MenuScreen,
  OrderDetailScreen,
  OrdersScreen,
  SignInScreen,
} from '../screens';
import { House, ShoppingCart, User, UtensilsCrossed } from 'lucide-react-native';

import { CartBadge } from '../components';
import {
  Screen,
  STACK_SCREEN_EDGES,
  TAB_SCREEN_EDGES,
  type ScreenEdge,
} from '../components/Screen';
import { BackBar } from '../components/BackBar';
import { TabIcon } from '../components/TabIcon';
import { useCart } from '../cart/CartContext';
import { PolicyGateContainer } from '../policy/PolicyGateContainer';
import { usePolicyGate, useNextPendingPolicy } from '../policy/PolicyGateContext';
import { useAudience } from '../session/audience';
import { useSelectedSchool } from '../session/SelectedSchoolContext';
import { useCachedMenu } from '../menu/useCachedMenu';

import type { RootStackParamList, TabParamList } from './types';

const { bg, border, nav, scale, borderWidth } = design;

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The four tabs, in the order `06_App UI/05.png` shows them.
 *
 * **Every one of them opens with no session.** That is not an oversight to be tightened
 * later — it is `AR7`, which makes signup-to-first-order conversion a primary v1 goal and
 * says in as many words that adding a child must not be a wall in front of browsing the
 * menu. The only gate in the app is at checkout, and it is a *stack* screen reached by
 * intent (`SignIn`), never a redirect that fires on open.
 *
 * The tab bar is deliberately static — `S9` keeps the product's chrome near-motionless
 * where motion would be a tax rather than a cue, and a tab bar is chrome.
 */
/**
 * Reads the cart so the tab bar does not have to. Separated because a `tabBarIcon` is called
 * during the navigator's render, and a hook cannot be called there directly.
 *
 * `CartBadge` returns `null` at zero, so an empty cart shows no badge at all rather than a
 * "0" nobody needs to read.
 */
function CartTabBadge() {
  const { itemCount } = useCart();
  return <CartBadge count={itemCount} />;
}

/**
 * The tab order, as one list.
 *
 * It exists because `cartTabLabel` has to reproduce React Navigation's own announcement —
 * "Cart, tab, 3 of 4" — in order to add the cart count to it, and the position in that
 * sentence has to come from somewhere that cannot drift. Hard-coding "3 of 4" would be a
 * silent lie the first time a fifth tab is added. `announces its tabs in the declared order`
 * in the test file holds this list and the JSX below to each other.
 */
export const TAB_ORDER = ['Home', 'Menu', 'Cart', 'Account'] as const;

/**
 * What a screen-reader user hears on the Cart tab.
 *
 * §7: an icon that conveys state carries the state in its **label**, never in its colour —
 * "Cart, 2 items". The badge is the sighted half of that signal and cannot be the only half,
 * because React Navigation's tab button is a single accessible element and iOS does not
 * announce an accessible element's children.
 *
 * The `, tab, n of m` suffix is iOS-only because React Navigation composes it only on iOS,
 * where `role: 'tab'` does not work (its own comment says so) — adding it on Android, where
 * the role is real, would announce the word "tab" twice.
 */
export function cartTabLabel(itemCount: number): string {
  const base =
    itemCount > 0 ? `Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : 'Cart';
  if (Platform.OS !== 'ios') return base;
  const index = TAB_ORDER.indexOf('Cart');
  return `${base}, tab, ${index + 1} of ${TAB_ORDER.length}`;
}

/**
 * Put a screen inside its safe-area frame.
 *
 * **This is the one place the inset is applied, and that is the point.** The first iOS build
 * rendered every screen underneath the status bar because each screen is a bare `View` and
 * every route runs `headerShown: false` — nothing in the tree paid for the notch. Fixing that
 * screen by screen would have fixed the four screens that exist and left the defect waiting
 * for the fifth, which is how it happened in the first place. Applying it at registration
 * means a route cannot be added without a frame: there is nowhere else to add one.
 *
 * The wrapper is built **once per screen at module scope**, never inline in the JSX. A
 * `component={() => <Screen>…</Screen>}` prop is a new component type on every render, so
 * React Navigation would unmount and remount the screen — losing its state — each time this
 * navigator re-rendered, which it does on every cart change.
 */
function withScreenFrame<P extends object>(
  Component: ComponentType<P>,
  edges: readonly ScreenEdge[],
  /**
   * Draw a back chevron above the screen. **True for every stack route**, false for tabs — a
   * tab is not somewhere you came from.
   *
   * It is applied here, at registration, for exactly the reason the safe-area inset is: a
   * route cannot then be added without a way back. Dish detail and Add someone both shipped
   * with no visible exit because `headerShown: false` removed the only one and nothing put it
   * back, and fixing those two screens would have left the next one waiting.
   */
  { back = false }: { back?: boolean } = {},
): ComponentType<P> {
  function Framed(props: P) {
    return (
      <Screen edges={edges}>
        {back ? <BackBar /> : null}
        <Component {...props} />
      </Screen>
    );
  }
  Framed.displayName = `Screen(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return Framed;
}

const HomeTab = withScreenFrame(HomeScreen, TAB_SCREEN_EDGES);
const MenuTab = withScreenFrame(MenuScreen, TAB_SCREEN_EDGES);
/**
 * "Place order" is the one gate (`AR7`, ux-spec F1).
 *
 * Signed out it opens Sign in, and **the cart is kept** — F1 calls losing it here the single
 * most likely place to lose a first order. Signed in there is nowhere to go yet: checkout is
 * `E06`, so the button is inert rather than routing somewhere that would look finished.
 */
function CartTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const audience = useAudience();

  /**
   * The photo and the veg mark for each line — `E05-42`.
   *
   * **A cart line cannot carry them.** `cart/line.ts` stores what identifies and prices a line
   * (dish id, who, when, note); a photo is presentation and would go stale the moment the menu
   * changed. So the cart looks them up from the menu it already has cached, which costs no
   * request — `useCachedMenu` is the same read the Menu tab just did.
   *
   * The prop existed and nothing ever passed it, so every line rendered the placeholder and the
   * cart read as a different app from the grid. Same shape as the four other "both sides
   * written, wire missing" defects: `orphans.test.ts` covers contexts, not optional props.
   *
   * A dish that is no longer on the current school's menu simply has no entry and falls back to
   * the food-type placeholder, which is correct — we do not have a picture for it any more.
   */
  const { schoolId } = useSelectedSchool();
  const { payload } = useCachedMenu(schoolId);
  const dishInfo = useMemo(() => {
    const info: Record<string, { imageUri: string | null; foodType: 'veg' | 'non_veg' | 'egg' | null }> = {};
    for (const dish of payload?.dishes ?? []) {
      info[dish.id] = { imageUri: dish.imageUri, foodType: dish.foodType };
    }
    return info;
  }, [payload]);

  /**
   * The gate, in the order `docs/ux-spec.md` §6.1 puts it.
   *
   * This used to be `navigate('SignIn')` unconditionally, which meant a parent who had
   * *already* signed in was sent back to sign in again every time they tapped Place order —
   * the gate firing on someone who had passed it.
   *
   * Signed in with nobody to order for goes to Add someone (`R2`), because the next thing
   * needed is a recipient, not a payment. Signed in with a recipient has nowhere to go yet:
   * checkout is `E06`, so the button stays inert rather than routing somewhere that would
   * look finished.
   */
  /**
   * The policy gate, read here rather than inside the handler — `E20-36`.
   *
   * It is checked **after** sign-in and recipient, because those two are prerequisites for
   * having an acceptance at all: a visitor has no user id, so there is nothing to be pending.
   * And it is checked **before** checkout, because that is the write it exists to block.
   */
  const nextPolicy = useNextPendingPolicy();

  const placeOrder = () => {
    switch (audience.kind) {
      case 'unknown':
        // One keychain read away from knowing. Routing now would guess, and guessing wrong
        // sends a signed-in parent back through sign-in.
        return;
      case 'visitor':
        navigation.navigate('SignIn');
        return;
      case 'needsRecipient':
        navigation.navigate('AddChild');
        return;
      case 'ordering':
        // The gate: one of the six compliance controls, and until `E20-36` it had no caller
        // anywhere in the app. It sits here — on the write, not on open — because `AR7`
        // forbids a wall in front of browsing, and because this is the point the acceptance
        // requirement actually attaches to (`user_policy_acceptance`, `E20-03`).
        if (nextPolicy !== null) {
          navigation.navigate('PolicyGate');
          return;
        }
        // Nowhere to go yet: checkout is `E06`. Inert beats routing somewhere that would look
        // finished.
        return;
    }
  };

  return <CartScreen onPlaceOrder={placeOrder} dishInfo={dishInfo} />;
}

const CartTab = withScreenFrame(CartTabScreen, TAB_SCREEN_EDGES);
const AccountTab = withScreenFrame(AccountScreen, TAB_SCREEN_EDGES);

const DishDetailStackScreen = withScreenFrame(DishDetailScreen, STACK_SCREEN_EDGES, { back: true });
const OrdersStackScreen = withScreenFrame(OrdersScreen, STACK_SCREEN_EDGES, { back: true });
const OrderDetailStackScreen = withScreenFrame(OrderDetailScreen, STACK_SCREEN_EDGES, { back: true });
const AddChildStackScreen = withScreenFrame(AddChildScreen, STACK_SCREEN_EDGES, { back: true });
const ChildrenStackScreen = withScreenFrame(ChildrenScreen, STACK_SCREEN_EDGES, { back: true });
// The modal takes the full set too. On iOS it is presented as a page sheet whose top already
// clears the status bar, so the top inset buys a little unnecessary whitespace there; on
// Android `presentation: 'modal'` is a full-screen route where the same inset is the
// difference between a heading and a heading under the clock. Erring toward the whitespace
// is the cheap mistake — this is the screen a parent reaches mid-checkout.
const SignInStackScreen = withScreenFrame(SignInScreen, STACK_SCREEN_EDGES, { back: true });

/**
 * The policy gate (`E20-36`). Reads the version from the context the cart read it from, so
 * accepting it removes it from both at once.
 *
 * **`back: true` even though the screen draws its own "Not now — keep browsing".** The two do
 * the same thing, and the redundancy is the cheaper mistake: `reachability.test.ts` cannot see
 * a button inside a screen, and teaching it to would open the exemption every future
 * unreachable screen needs — "there is a button in there somewhere" is exactly the reasoning
 * that let sign-in ship behind a wall. A duplicated exit costs a chevron.
 */
function PolicyGateRoute() {
  const version = useNextPendingPolicy();
  const { clear } = usePolicyGate();
  return <PolicyGateContainer version={version} onAccepted={clear} />;
}
const PolicyGateStackScreen = withScreenFrame(PolicyGateRoute, STACK_SCREEN_EDGES, {
  back: true,
});

function Tabs() {
  // The navigator itself reads the cart, which it did not before. The badge alone cannot
  // carry the count to a screen reader (see `cartTabLabel`), and `options` is evaluated
  // during this component's render — so this is the only place the count can reach it.
  const { itemCount } = useCart();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: nav.itemActive,
        tabBarInactiveTintColor: nav.itemInactive,
        tabBarStyle: {
          backgroundColor: bg.surface,
          borderTopColor: border.subtle,
          borderTopWidth: borderWidth.hairline,
        },
        tabBarLabelStyle: {
          fontSize: scale.label.size,
          fontWeight: scale.label.weight,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeTab}
        options={{
          // A stable handle for the Maestro flow (`E14-24`). Without one, the suite that
          // drives a real build has to tap by visible label — which breaks the first time
          // a label is shortened or translated, and a flaky e2e suite gets disabled.
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon glyph={House} focused={focused} color={color} testID="tab-icon-home" />
          ),
        }}
      />
      <Tab.Screen
        name="Menu"
        component={MenuTab}
        options={{
          // A stable handle for the Maestro flow (`E14-24`). Without one, the suite that
          // drives a real build has to tap by visible label — which breaks the first time
          // a label is shortened or translated, and a flaky e2e suite gets disabled.
          tabBarButtonTestID: 'tab-menu',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              glyph={UtensilsCrossed}
              focused={focused}
              color={color}
              testID="tab-icon-menu"
            />
          ),
        }}
      />
      <Tab.Screen
        name="Cart"
        component={CartTab}
        options={{
          // A stable handle for the Maestro flow (`E14-24`). Without one, the suite that
          // drives a real build has to tap by visible label — which breaks the first time
          // a label is shortened or translated, and a flaky e2e suite gets disabled.
          tabBarButtonTestID: 'tab-cart',
          // `M06`'s badge, on the tab bar rather than in the cart screen — the whole reason
          // it is the one spring in the product (`S4`) is that adding to cart confirms itself
          // somewhere other than where the user is looking. `animate` stays false here: this
          // renders on every cart change including hydration, and a badge that pops when a
          // screen re-renders is the failure mode `CartBadge` documents.
          //
          // Until `E14-16` the badge *was* the icon, which is why an empty cart drew React
          // Navigation's default triangle: `CartBadge` returns `null` at zero.
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              glyph={ShoppingCart}
              focused={focused}
              color={color}
              trailing={<CartTabBadge />}
              testID="tab-icon-cart"
            />
          ),
          // §7: an icon that conveys state carries the state in its label, not its colour.
          // React Navigation's tab button is one accessible element, so the badge's own label
          // is not announced separately on iOS — the count has to be here.
          tabBarAccessibilityLabel: cartTabLabel(itemCount),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountTab}
        options={{
          // A stable handle for the Maestro flow (`E14-24`). Without one, the suite that
          // drives a real build has to tap by visible label — which breaks the first time
          // a label is shortened or translated, and a flaky e2e suite gets disabled.
          tabBarButtonTestID: 'tab-account',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon glyph={User} focused={focused} color={color} testID="tab-icon-account" />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

/**
 * The stack above the tabs.
 *
 * `SignIn` is `presentation: 'modal'` because signing in is an interruption of something
 * else — the user was checking out. A push would put it in the back stack as though it
 * were a destination, and returning from it would read as going "back" rather than
 * resuming. The `intent` param is what lets the flow resume.
 */
export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* `Tabs` is deliberately not framed: the frame belongs to each tab's screen, below
            the tab bar's own inset handling. Framing here would put the status-bar padding
            above the tab navigator and so above the tab bar as well. */}
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="DishDetail" component={DishDetailStackScreen} />
        <Stack.Screen name="Orders" component={OrdersStackScreen} />
        <Stack.Screen name="OrderDetail" component={OrderDetailStackScreen} />
        {/* Reached by intent from Account, never pushed (`AR7`). A stack screen rather than
            a tab for the same reason `Orders` is one: the mock has four tabs. */}
        <Stack.Screen name="AddChild" component={AddChildStackScreen} />
        {/* The list those children land on. Reached from Account for the same reason
            `AddChild` is: the mock has four tabs and this is not one of them. It mounts
            with no session and shows its empty state rather than a gate (`AR7`). */}
        <Stack.Screen name="Children" component={ChildrenStackScreen} />
        <Stack.Screen
          name="SignIn"
          component={SignInStackScreen}
          options={{ presentation: 'modal' }}
        />
        {/* Modal for the same reason `SignIn` is: it interrupts placing an order and then
            returns you to it. A push would put it in the back stack as a destination, and
            "Not now" would read as going back rather than resuming. */}
        <Stack.Screen
          name="PolicyGate"
          component={PolicyGateStackScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** The routes that must mount with no session. Exported so the test cannot drift from the rule. */
export const PUBLIC_ROUTES = ['Home', 'Menu', 'Cart', 'Account', 'DishDetail'] as const;
