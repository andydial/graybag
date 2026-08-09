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
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Menu" component={MenuScreen} />
      <Tab.Screen
        name="Cart"
        component={CartScreen}
        // `M06`'s badge, on the tab bar rather than in the cart screen — the whole reason it
        // is the one spring in the product (`S4`) is that adding to cart confirms itself
        // somewhere other than where the user is looking. `animate` stays false here: this
        // renders on every cart change including hydration, and a badge that pops when a
        // screen re-renders is the failure mode `CartBadge` documents.
        options={{ tabBarIcon: () => <CartTabBadge /> }}
      />
      <Tab.Screen name="Account" component={AccountScreen} />
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
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="DishDetail" component={DishDetailScreen} />
        <Stack.Screen name="Orders" component={OrdersScreen} />
        <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** The routes that must mount with no session. Exported so the test cannot drift from the rule. */
export const PUBLIC_ROUTES = ['Home', 'Menu', 'Cart', 'Account', 'DishDetail'] as const;
