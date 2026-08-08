/**
 * Route names and their params.
 *
 * Kept in one file so a screen never invents a route name as a string literal — the
 * failure mode of that is a navigate() to a route that does not exist, which is a runtime
 * warning rather than a build error, and it survives review because it reads fine.
 */

/** The four tabs. Matches `06_App UI/05.png`, which shows exactly these four. */
export type TabParamList = {
  Home: undefined;
  Menu: { categoryId?: string } | undefined;
  Cart: undefined;
  Account: undefined;
};

/**
 * Screens that sit above the tabs.
 *
 * `Orders` lives here rather than in the tab bar: the mock has four tabs and adding a
 * fifth is a design change nobody asked for. It is reachable from Account and from Home,
 * so it is one tap from either place a returning parent would look.
 */
export type RootStackParamList = {
  Tabs: undefined;
  DishDetail: { dishId: string };
  Orders: undefined;
  OrderDetail: { orderGroupId: string };
  /**
   * The auth gate. Nothing navigates here on open — only a checkout attempt does
   * (`AR7`). `intent` is what the user was trying to do, so the flow can resume it
   * rather than dumping them on Home having forgotten why they signed in.
   */
  SignIn: { intent?: 'checkout' | 'orders' | 'account' } | undefined;
};

/**
 * Register the param list globally so `navigation.navigate('DishDetail', …)` is typed
 * everywhere without each screen importing and threading the generic.
 *
 * Both disables are load-bearing rather than convenience. React Navigation's registration
 * point *is* a namespace, and an interface is the only construct that can merge into an
 * existing declaration — a type alias cannot, so `no-empty-object-type`'s advice does not
 * apply here. The interface is empty on purpose: extending is the whole mechanism.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
