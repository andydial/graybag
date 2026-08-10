import type { ComponentType } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { design } from '@graybag/shared';

import {
  AccountScreen,
  CartScreen,
  DishDetailScreen,
  HomeScreen,
  MenuScreen,
  OrderDetailScreen,
  OrdersScreen,
  SignInScreen,
} from '../screens';
import { CartBadge } from '../components';
import {
  Screen,
  STACK_SCREEN_EDGES,
  TAB_SCREEN_EDGES,
  type ScreenEdge,
} from '../components/Screen';
import { useCart } from '../cart/CartContext';
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
): ComponentType<P> {
  function Framed(props: P) {
    return (
      <Screen edges={edges}>
        <Component {...props} />
      </Screen>
    );
  }
  Framed.displayName = `Screen(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return Framed;
}

const HomeTab = withScreenFrame(HomeScreen, TAB_SCREEN_EDGES);
const MenuTab = withScreenFrame(MenuScreen, TAB_SCREEN_EDGES);
const CartTab = withScreenFrame(CartScreen, TAB_SCREEN_EDGES);
const AccountTab = withScreenFrame(AccountScreen, TAB_SCREEN_EDGES);

const DishDetailStackScreen = withScreenFrame(DishDetailScreen, STACK_SCREEN_EDGES);
const OrdersStackScreen = withScreenFrame(OrdersScreen, STACK_SCREEN_EDGES);
const OrderDetailStackScreen = withScreenFrame(OrderDetailScreen, STACK_SCREEN_EDGES);
// The modal takes the full set too. On iOS it is presented as a page sheet whose top already
// clears the status bar, so the top inset buys a little unnecessary whitespace there; on
// Android `presentation: 'modal'` is a full-screen route where the same inset is the
// difference between a heading and a heading under the clock. Erring toward the whitespace
// is the cheap mistake — this is the screen a parent reaches mid-checkout.
const SignInStackScreen = withScreenFrame(SignInScreen, STACK_SCREEN_EDGES);

function Tabs() {
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
      <Tab.Screen name="Home" component={HomeTab} />
      <Tab.Screen name="Menu" component={MenuTab} />
      <Tab.Screen
        name="Cart"
        component={CartTab}
        // `M06`'s badge, on the tab bar rather than in the cart screen — the whole reason it
        // is the one spring in the product (`S4`) is that adding to cart confirms itself
        // somewhere other than where the user is looking. `animate` stays false here: this
        // renders on every cart change including hydration, and a badge that pops when a
        // screen re-renders is the failure mode `CartBadge` documents.
        options={{ tabBarIcon: () => <CartTabBadge /> }}
      />
      <Tab.Screen name="Account" component={AccountTab} />
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
        <Stack.Screen
          name="SignIn"
          component={SignInStackScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** The routes that must mount with no session. Exported so the test cannot drift from the rule. */
export const PUBLIC_ROUTES = ['Home', 'Menu', 'Cart', 'Account', 'DishDetail'] as const;
