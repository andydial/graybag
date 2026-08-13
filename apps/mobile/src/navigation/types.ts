import type { NavigatorScreenParams } from '@react-navigation/native';

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
 * fifth is a design change nobody asked for. It is reachable **from Account**.
 *
 * This comment used to say "from Account and from Home", and neither was true — nothing in the
 * app navigated to `Orders` at all. A comment asserting reachability is not reachability;
 * `reachability.test.ts` is, and it found this on its first run.
 */
export type RootStackParamList = {
  /**
   * The tab navigator.
   *
   * `NavigatorScreenParams` rather than `undefined` so a stack screen can say **which tab**
   * to land on. It used to be `undefined`, which made `navigate('Tabs')` the only expressible
   * form — and from a screen already inside the tabs that is a no-op. Home's "Open the Menu",
   * its school picker prompt, its retry, the Orders empty state and Order detail's "back to
   * the menu" were all that call: five buttons that did nothing, and typed as correct.
   */
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  DishDetail: { dishId: string };
  Orders: undefined;
  OrderDetail: { orderGroupId: string };
  /**
   * Adding a child (`E05-01`). A stack screen reached **by intent** from Account, never a
   * step the app pushes you into — `AR7` says in as many words that adding a child must not
   * be a wall in front of browsing the menu.
   *
   * `audience` carries the answer to the screen's own first question when the caller already
   * has it — "Order for myself" on the list arrives with `'self'` (`E05-38`). Optional in both
   * senses: the param may be absent, and the screen asks when it is. It is a shortcut past a
   * question, never a way to decide it on somebody's behalf, and the screen keeps the answer
   * changeable either way.
   */
  AddChild: { audience?: 'child' | 'self' } | undefined;
  /**
   * The children a parent has added (`E05-01`). Reached from Account, like `AddChild` and
   * for the same reason — the mock has four tabs, and this is not one of them.
   *
   * It mounts signed out and shows its empty state, which is `AR7` again: a list that
   * demanded a session before it would tell you it was empty is a wall.
   */
  Children: undefined;
  /**
   * The auth gate. Nothing navigates here on open — only a checkout attempt does
   * (`AR7`). `intent` is what the user was trying to do, so the flow can resume it
   * rather than dumping them on Home having forgotten why they signed in.
   */
  SignIn: { intent?: 'checkout' | 'orders' | 'account' } | undefined;
  /**
   * The policy-version acceptance gate (`E20-36`, `E20-03`, ux-spec §5.19).
   *
   * No params: the version comes from `PolicyGateContext`, so the cart and this screen read
   * one answer rather than two copies that can disagree after an acceptance.
   *
   * Reached only from a **write** attempt — Place order — never on open. It blocks ordering,
   * not browsing (`AR7`), which is why "Not now" simply returns you to the cart.
   */
  PolicyGate: undefined;
  /**
   * Support and the grievance officer (`E20-39`, ux-spec §5.18).
   *
   * DPDP requires a published contact point for questions and complaints about personal data,
   * and both stores expect an in-app route to it. Reached from Account; it mounts with no
   * session, because someone whose complaint *is* that they cannot sign in must still reach us.
   */
  Support: undefined;
  /**
   * Account deletion (`E20-37`). Both stores require an in-app path to it, and it is one of the
   * six v1 compliance controls.
   *
   * Signed-in only — it is reached from a row Account renders only for a signed-in user, since
   * there is no account to delete otherwise.
   */
  DeleteAccount: undefined;
  /**
   * A policy document (`E20-38`). `which` picks one of the three Account lists.
   *
   * Mounts with no session: a visitor deciding whether to sign up is exactly who reads a
   * privacy policy, and putting it behind an account would be both a wall (`AR7`) and a
   * compliance problem — `[AZ-03]` requires the grievance block reachable without one.
   */
  Policy: { which: 'privacy' | 'terms' | 'refund' };
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
