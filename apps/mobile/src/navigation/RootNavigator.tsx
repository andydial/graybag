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
      <Tab.Screen name="Cart" component={CartScreen} />
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
