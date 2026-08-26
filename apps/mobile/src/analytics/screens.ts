/**
 * Route name → the analytics vocabulary. `E15-21`.
 *
 * ## Why a map and not the route name
 *
 * Sending `route.name` straight through would be one line and would make the vocabulary in
 * `events.ts` decorative: whatever a navigator happened to be called would become an analytics
 * value, and a route added later would arrive unreviewed. **The map is the review.** A new
 * screen produces `null` here, and `null` sends nothing — silent rather than sending an
 * unvetted name.
 *
 * That is the safe direction. A missing screen costs one row in a path; an unvetted name is how
 * `screen: "Aarav's orders"` would reach a vendor if a route were ever titled from data.
 *
 * ## Deliberately not derived
 *
 * `route.name.toLowerCase()` would produce most of these correctly and is exactly the shortcut
 * that turns a closed vocabulary back into an open one.
 */
const ROUTES: Record<string, string> = {
  Home: 'home',
  Menu: 'menu',
  DishDetail: 'dish_detail',
  Cart: 'cart',
  Orders: 'orders',
  OrderDetail: 'order_detail',
  Account: 'account',
  Children: 'children',
  AddChild: 'add_child',
  SignIn: 'sign_in',
  Support: 'support',
  Policy: 'policy',
  PolicyGate: 'policy_gate',
  DeleteAccount: 'delete_account',
  /**
   * `E21`. Real routes, so the navigator listener emits them — including the **fallback** case,
   * where a parent reaches `Packs` with the gate off and sees the refusal. That is still a screen
   * they viewed, and it is the one worth counting: it means a stale link is in circulation.
   *
   * They were briefly in `NON_ROUTE_SCREENS` with the screens emitting for themselves, which
   * would have double-counted every visit once the routes existed. `screens.test.ts` caught it.
   */
  Packs: 'packs',
  MyPacks: 'my_packs',
  PackPlan: 'pack_plan',
};

/**
 * The screen name for a route, or `null` when it is not one we have vetted.
 *
 * `Tabs` is absent on purpose: it is a container, and the tab *inside* it is the screen a
 * parent is actually on. React Navigation reports both, and counting the container would double
 * every tab view.
 */
export function screenNameFor(routeName: string | undefined): string | null {
  if (routeName === undefined) return null;
  return ROUTES[routeName] ?? null;
}

/**
 * Screens that are not routes.
 *
 * `sign_in_code`, `payment_waiting`, `order_placed`, `update_required` and `cant_connect` are
 * rendered as *states* of a screen rather than as navigation targets, so nothing in the
 * navigator will ever emit them. They are emitted where they render, and named here so both
 * halves of the vocabulary live in one place.
 *
 * ## `cant_connect` will almost never arrive, and that is not a bug
 *
 * `App.tsx` renders it when `configureApiFromEnvironment()` fails — and that is the same
 * condition under which `readExpoClientEnv()` throws, which puts `analytics.ts` on its no-op
 * fallback. So the screen that means "this build is misconfigured" is reported by a client the
 * same misconfiguration switched off.
 *
 * It is emitted anyway: it costs nothing, and it becomes correct the moment the environment
 * check becomes partial rather than all-or-nothing. **The point of writing this down is that
 * zero `cant_connect` rows must not be read as "nobody hit that screen".** An absent event and
 * an impossible event look identical on a dashboard, which is the whole reason this comment
 * exists rather than a silent omission. `docs/posthog.md` §4 says the same thing to whoever is
 * reading the funnel rather than the code.
 */
export const NON_ROUTE_SCREENS = {
  signInCode: 'sign_in_code',
  paymentWaiting: 'payment_waiting',
  orderPlaced: 'order_placed',
  updateRequired: 'update_required',
  cantConnect: 'cant_connect',
  schoolPicker: 'school_picker',
} as const;
