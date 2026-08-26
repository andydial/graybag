import { useEffect, useMemo, useState, type ComponentType, useRef } from 'react';
import { Platform } from 'react-native';
import {
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { api, design, packEligibility, money } from '@graybag/shared';

import {
  AccountScreen,
  AddChildScreen,
  CartScreen,
  ChildrenScreen,
  DishDetailScreen,
  HomeScreen,
  MenuScreen,
  DeleteAccountScreen,
  PolicyScreen,
  SignInScreen,
  SupportScreen,
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
import { OrderDetailTabScreen } from '../orders/OrderDetailTabScreen';
import { OrdersTabScreen } from '../orders/OrdersTabScreen';
import { useCart } from '../cart/CartContext';
import { OrderPlacedScreen, placedOrder } from '../checkout/OrderPlacedScreen';
import { PENDING_AFTER_MS, PaymentWaitingScreen } from '../checkout/PaymentWaitingScreen';
import { useCheckout } from '../checkout/useCheckout';
import { track } from '../analytics/analytics';
import { screenNameFor } from '../analytics/screens';
import { useBreakTimes } from '../cart/useBreakTimes';
import { clashingAllergens, useAllergenWatchlist } from '../menu/useAllergenWatchlist';
import { formatServiceDateLong } from '../orders/OrderDetailScreen';
import { useMealPackSurface } from '../packs/MealPackSurfaceContext';
import { MyPacksScreen } from '../packs/MyPacksScreen';
import type { PackIneligibility } from '../packs/PackRedemptionStrip';
import { PacksScreen } from '../packs/PacksScreen';
import { PolicyGateContainer } from '../policy/PolicyGateContainer';
import { usePolicyGate, useNextPendingPolicy } from '../policy/PolicyGateContext';
import { useAudience, useOrderingTarget } from '../session/audience';
import { useSelectedSchool } from '../session/SelectedSchoolContext';
import { useCachedMenu } from '../menu/useCachedMenu';
import { useConnectivity } from '../net/ConnectivityContext';

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
 * May the cart be emptied, given how checkout settled?
 *
 * ## Why this is a named rule rather than `status === 'paid'` inline
 *
 * `PaymentWaitingScreen` promises a parent, in as many words, *"Your cart is still here, so you
 * can pick up where you left off."* Until now the only test of that promise asserted **the
 * sentence** — `getByText(/cart is still here/)` — which is a test that passes perfectly while
 * the parent's cart is gone. Andy, 2026-08-26: *"tests that would pass while a parent is stuck.
 * That class of test is worse than none, because it buys false confidence."*
 *
 * ## The default is the safety property
 *
 * It answers `true` for exactly one status and `false` for everything else, **including a status
 * that does not exist yet**. A settlement state added later — `refunded`, `disputed`, `partial` —
 * gets the safe answer without anyone remembering this line, and losing a cart on a decline is
 * unrecoverable from the parent's side: the dishes, the child, the days, all chosen again.
 *
 * The opposite default is what an inline `!== 'failed'` would have given, and the cost of the two
 * mistakes is not symmetric. Keeping a cart that should have been emptied shows a parent a stale
 * cart they can clear in one tap; emptying one that should have been kept ends the order.
 */
export function shouldClearCart(status: string): boolean {
  return status === 'paid';
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
  const { cart, clear: clearCart } = useCart();
  const checkout = useCheckout();
  // Destructured so the effect depends on a stable `useCallback`, never on the object.
  const { reset: resetCheckout } = checkout;
  /**
   * `E06-16`'s clock, owned here because `PaymentWaitingScreen` deliberately starts no timer of
   * its own — it takes `elapsedMs` and renders, so a test never has to advance a fake clock.
   */
  /**
   * The group being polled. A **string**, deliberately — the effect below used to depend on
   * `checkout.phase` and on `checkout` itself, and `useCheckout` returns a fresh object every
   * render, so the effect re-subscribed on every render.
   */
  const [pollGroupId, setPollGroupId] = useState<string | null>(null);
  /**
   * **One state change, not one per tick** — `E14-37`.
   *
   * This was `elapsedMs`, updated every two seconds, and it caused `Maximum update depth
   * exceeded` on the first real payment: the tick set state, the state re-rendered, the render
   * made a new `checkout` object, the new object re-ran the effect, and the effect ticked again.
   *
   * The screen only needs to know one thing — whether ten seconds have passed (`PENDING_AFTER_MS`,
   * §5.12) — so that is a single boolean set by a single timeout. **An elapsed-time counter that
   * drives a render on every tick is a loop waiting for an unstable dependency**, and the fix is
   * not a better dependency array; it is not putting the clock in render state.
   */
  const [stillConfirming, setStillConfirming] = useState(false);


  const [settled, setSettled] = useState<api.CheckoutStatus | null>(null);
  const [placed, setPlaced] = useState<api.SettledOrderSummary | null>(null);
  /** The last refusal, in the parent's words. Rendered on the cart, not swallowed. */
  const [failure, setFailure] = useState<string | null>(null);

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

  /**
   * `P19`. The windows decide whether this school can be ordered from at all, so they are read
   * here rather than at the moment Place order is tapped — a parent should see "we're still
   * setting up ordering for this school" while looking at their cart, not after committing.
   */
  const breakWindows = useBreakTimes(schoolId);
  const [breakTimeId, setBreakTimeId] = useState<string | null>(null);
  // A window belongs to a school. Switching school must drop the choice, or a parent could
  // carry Amity's "Morning break" onto an order for somewhere else entirely.
  useEffect(() => setBreakTimeId(null), [schoolId]);
  const dishInfo = useMemo(() => {
    const info: Record<
      string,
      // `categoryId` added for `E21`: the pack meal rule is "N items, one from a configured
      // category", and the cart needs it to say WHY a cart cannot use a meal before the parent
      // taps. The payload has always carried it; only this map dropped it.
      { imageUri: string | null; foodType: 'veg' | 'non_veg' | 'egg' | null; categoryId: string }
    > = {};
    for (const dish of payload?.dishes ?? []) {
      info[dish.id] = {
        imageUri: dish.imageUri,
        foodType: dish.foodType,
        categoryId: dish.categoryId,
      };
    }
    return info;
  }, [payload]);

  /**
   * `E21`. Whether THIS order is being paid with a meal.
   *
   * Component state, never persisted and never defaulted on. The switch is off every time the
   * cart is opened, because a meal is money and the prototype is explicit: *"nothing is spent
   * without you tapping it."* A remembered preference would spend a meal on an order the parent
   * never thought about.
   */
  const [usingPackMeal, setUsingPackMeal] = useState(false);
  const packSurface = useMealPackSurface();

  /**
   * Does this cart qualify? The app's copy of the rule (`E21-40`) — the SERVER decides when the
   * meal is actually spent, and this only picks which sentence the strip shows.
   *
   * `null` when there is no pack rule to check against, which is also what the strip reads as
   * "eligible": with no balance it renders the advertisement or nothing at all, and neither
   * branch consults this.
   */
  const packIneligibility = useMemo<PackIneligibility>(() => {
    const balance = packSurface.balance;
    if (balance === null || dishInfo === undefined) return null;
    const problem = packEligibility.checkPackMeal(
      cart.lines.map((line) => ({
        categoryId: dishInfo[line.dishId]?.categoryId ?? '',
        quantity: line.quantity,
      })),
      // From the OFFER the pack was bought under, never assumed — `E21-40` tests a three-item
      // pack and a fruit-category pack for exactly this reason.
      { itemsPerMeal: balance.itemsPerMeal, requiredCategoryId: balance.requiredCategoryId },
    );
    if (problem === null) return null;
    return problem.reason === 'missing_required_category'
      ? 'missing_required_category'
      : 'wrong_item_count';
  }, [packSurface.balance, cart.lines, dishInfo]);

  /** The balance in the shape the strip wants — dates already formatted, no date logic below. */
  const packBalanceForCart = useMemo(() => {
    const balance = packSurface.balance;
    if (balance === null) return null;
    return {
      packName: balance.packName,
      mealsTotal: balance.mealsTotal,
      mealsRemaining: balance.mealsRemaining,
      purchasedLabel: formatServiceDateLong(balance.purchasedAt.slice(0, 10)),
      expiresLabel: formatServiceDateLong(balance.expiresAt.slice(0, 10)),
      expired: balance.expired,
    };
  }, [packSurface.balance]);

  const { offline } = useConnectivity();

  /**
   * The allergen warnings on the cart lines — `E05-45`, `F5`/`F6`.
   *
   * The prop existed with a test and nothing passed it, so **no cart line has ever warned about
   * anything** while the menu grid two taps away was flagging the same dish. That is the worst
   * version of this bug class: the last screen before payment was the silent one.
   *
   * `clashingAllergens` is the menu's own function, moved somewhere both can reach it rather
   * than reimplemented — two allergen matchers eventually disagree, and they would disagree
   * about the same dish on two screens a parent sees in the same minute.
   *
   * **`undefined` when the answer is not `ready`, and that is the safety-critical part.** The
   * prop's absence is what makes `CartLineRow` say nothing at all; passing `byDishId: {}`
   * instead would render "no warnings" — a claim we did not check — for a recipient whose
   * allergens we could not read. `[]` means we asked and there are none; `undefined` means we
   * could not ask (§5.21, and `AddChildScreen`'s old `catch { return [] }`).
   */
  const watchlist = useAllergenWatchlist();
  /**
   * **`useOrderingTarget`, never `useOrderTarget`.** The first consults the app's session
   * before it answers; the second is the raw context, and reading it from a screen is the
   * disclosure `E03-26`/`E03-27` closed — a minor's name rendered for somebody with no
   * session. `no-recipient-without-session.test.tsx` refuses the raw one here, and it refused
   * this exact line when it was first written.
   */
  const target = useOrderingTarget();
  const cartAllergens = useMemo(() => {
    if (watchlist.status !== 'ready') return undefined;
    const name = target?.displayName ?? null;
    // The warning names the person — "Aarav is allergic". Without a name there is no honest
    // sentence to write, so no warning is claimed either.
    if (name === null) return undefined;

    const byDishId: Record<string, string[]> = {};
    for (const dish of payload?.dishes ?? []) {
      const clashes = clashingAllergens(dish, watchlist);
      if (clashes.length > 0) byDishId[dish.id] = clashes;
    }
    return { recipientName: name, byDishId };
  }, [watchlist, target, payload]);

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
        void beginCheckout();
        return;
    }
  };

  /**
   * `E06-02`. The lines the server prices, built from the cart at the moment Pay is tapped.
   *
   * `recipientId` and `serviceDate` come off each line — they are set when the line is added,
   * and a line missing either cannot be ordered, so those are filtered rather than defaulted.
   * Defaulting would silently order somebody else's lunch on a day nobody chose.
   */
  const beginCheckout = async () => {
    const lines = cart.lines
      .filter((line) => line.recipientId !== null && line.serviceDate !== null)
      .map((line) => ({
        recipientId: line.recipientId as string,
        serviceDate: line.serviceDate as string,
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        breakTimeId,
      }));

    if (lines.length === 0) return;

    setSettled(null);
    setFailure(null);

    /**
     * **What the parent was actually shown — GST-INCLUSIVE, and rounded per line.**
     *
     * This was `subtotalPaise`, and it made every single checkout fail with `price_changed`
     * before anything reached Razorpay. `cart.subtotalPaise` is documented GST-**exclusive**
     * (`SC2`); the server prices the payable including tax, so the two could never agree.
     *
     * Nor is it subtotal × 1.05. `money.gstBreakdown` computes each component from **each
     * line's** taxable value and rounds half-up (§6.2), which on one ₹69 line gives 7246 where
     * a naive 5% gives 7245 — a one-paise disagreement that reads as a price change and stops
     * the order. It is the same function the totals block renders from, so the number sent is
     * by construction the number on screen.
     */
    const expected = money.gstBreakdown(
      cart.lines.map((line) => ({ unitPricePaise: line.unitPricePaise, quantity: line.quantity })),
    ).totalPaise;

    const outcome = await checkout.start({
      lines,
      // Sent so the server CAN refuse (`L7`), never so it can be believed.
      expectedTotalPaise: expected,
    });

    /**
     * **Only a sheet that reported success starts the waiting screen.**
     *
     * It used to be set before `start()` was even called, so "Still confirming" appeared the
     * instant Pay was tapped — including when the order was refused and no sheet ever opened.
     * That is the worst sentence in the product shown at the worst moment: a screen implying
     * money is in flight when none moved. Same class as treating `reported_success` as paid,
     * one screen further on.
     *
     * A failure now surfaces as a failure, with the server's own reason.
     */
    if (outcome.kind === 'sheet_reported_success') {
      setStillConfirming(false);
      setPollGroupId(outcome.orderGroupId);
      return;
    }
    setPollGroupId(null);
    if (outcome.kind === 'failed') setFailure(outcome.message);
  };

  /**
   * `E06-16`. Poll until the server says something terminal.
   *
   * **Every two seconds, and it keeps going.** There is no give-up timeout, deliberately: a
   * `pending` answer means money may have moved, and a screen that gave up would leave a parent
   * who has paid looking at a cart. `§10.3` — the app being killed mid-payment is the ordinary
   * path here, which is why the endpoint reconciles against Razorpay rather than reading our own
   * row.
   *
   * The tick also drives `elapsedMs`, which is how the copy changes to "still confirming" at ten
   * seconds without the screen owning a clock.
   */
  useEffect(() => {
    if (pollGroupId === null) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const result = await api.fetchCheckoutStatus(pollGroupId);
        if (cancelled) return;
        if (result.status === 'paid' || result.status === 'failed' || result.status === 'cancelled') {
          setSettled(result.status);
          setPollGroupId(null);
          // The cart has become an order. Emptying it any earlier would lose it on a decline.
          if (shouldClearCart(result.status)) {
            /**
             * `E15-20`. **Here, not when the Razorpay sheet said yes.** `R8`: a sheet's success
             * is a handset's word. This is `checkout-status` confirming settlement against the
             * provider, which is the only place the funnel's bottom is real — emitting on the sheet
             * would overstate completions by every payment that later failed to settle.
             *
             * No properties at all: no amount, no order id — revenue lives in the ledger, which
             * does not leave the country — and no attempt number, because this response does not
             * carry one and a hardcoded 1 would be a lie for a resumed payment.
             */
            track('payment_completed');
            setPlaced(result.order ?? null);
            clearCart();
            resetCheckout();
          }
        }
      } catch {
        // A failed poll is not a failed payment. Keep asking — the next tick may reach the server,
        // and treating a dropped request as a verdict is how a paid parent is told otherwise.
      }
    };

    void tick();
    const poll = setInterval(() => void tick(), 2_000);
    // Fires once. See `stillConfirming`.
    const copyChange = setTimeout(() => setStillConfirming(true), PENDING_AFTER_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(copyChange);
    };
    // Every dependency is a primitive or a stable callback. `checkout` itself must NEVER appear
    // here: it is a new object each render, and that is what produced the infinite loop.
  }, [pollGroupId, clearCart, resetCheckout]);

  /**
   * While a payment is in flight the cart is replaced rather than navigated away from, so the
   * cart's own state survives a dismissal untouched and "try again" is genuinely the same cart.
   */
  // `placing` and `opening` are NOT here: during those the sheet has not opened and there is
  // nothing to confirm, so the cart stays on screen with its button in a loading state.
  const paying = pollGroupId !== null || settled === 'failed';

  if (settled === 'paid' && placed !== null) {
    return (
      <OrderPlacedScreen
        order={placedOrder({
          status: 'paid',
          pickupCode: placed.pickupCode,
          recipientName: placed.recipientFirstName,
          serviceDate: placed.serviceDate,
          breakLabel: placed.breakLabel,
          itemCount: placed.itemCount,
          totalPaise: placed.totalPaise,
        })}
        onViewOrder={() => navigation.navigate('Orders')}
        onBackToMenu={() => {
          setSettled(null);
          setPlaced(null);
          navigation.navigate('Tabs', { screen: 'Menu' });
        }}
      />
    );
  }

  if (paying) {
    return (
      <PaymentWaitingScreen
        elapsedMs={stillConfirming ? PENDING_AFTER_MS : 0}
        pending={pollGroupId !== null}
        failed={settled === 'failed' || checkout.phase.kind === 'failed'}
        dismissed={checkout.phase.kind === 'dismissed'}
        onSeeOrders={() => navigation.navigate('Orders')}
        onRetry={() => {
          setSettled(null);
          setPollGroupId(null);
          setStillConfirming(false);
          void beginCheckout();
        }}
      />
    );
  }

  return (
    <CartScreen
      onPlaceOrder={placeOrder}
      checkoutError={failure}
      dishInfo={dishInfo}
      breakWindows={breakWindows}
      breakTimeId={breakTimeId}
      onSelectBreakTime={setBreakTimeId}
      /*
       * `E05-45`, and the reason "cart to prototype" was still open: **five of the prototype's
       * cart states were built, tested, and never passed by this file.** The offline band, the
       * allergen warnings, the signed-out reassurance, the Change affordance and the empty
       * state's way out all existed in `CartScreen.tsx` with a test each, and none of them
       * could appear on a phone. `orphans.test.ts` covers contexts and required props, not
       * optional ones — which is the same gap that hid `dishInfo` until `E05-42`.
       *
       * Wired below in the order a parent meets them.
       */
      offline={offline}
      /*
       * `F1`. The reassurance that the cart survives sign-in, shown only to somebody who has
       * not signed in — for whom the gate is otherwise a surprise at the last step. `visitor`
       * rather than `!== 'ordering'`: a signed-in parent with no recipient has passed the gate
       * this sentence is about.
       */
      signedOut={audience.kind === 'visitor'}
      /* The empty cart pointed at the menu and had no button to get there. */
      onBrowseMenu={() => navigation.navigate('Tabs', { screen: 'Menu' })}
      onChangeRecipient={() => navigation.navigate('Children')}
      {...(cartAllergens === undefined ? {} : { allergens: cartAllergens })}
      /*
       * `E21`. The redemption offer. `packBalance` comes from the surface context rather than a
       * read here: the cart re-renders on every quantity change, and a fetch inside it would
       * fire on each one.
       *
       * `usingPackMeal` is state on this component and is deliberately NOT persisted — the
       * switch is off every time the cart is opened, because a meal is money and the prototype
       * is explicit that nothing is spent without a tap.
       */
      packBalance={packBalanceForCart}
      packIneligibility={packIneligibility}
      usingPackMeal={usingPackMeal}
      onTogglePackMeal={setUsingPackMeal}
      onSeePackOffers={() => navigation.navigate('Packs')}
    />
  );
}

const CartTab = withScreenFrame(CartTabScreen, TAB_SCREEN_EDGES);
const AccountTab = withScreenFrame(AccountScreen, TAB_SCREEN_EDGES);

const DishDetailStackScreen = withScreenFrame(DishDetailScreen, STACK_SCREEN_EDGES, { back: true });
/**
 * `E06-40`. The connected screen, not the presentational one.
 *
 * `OrdersScreen` was routed directly and given no props, so every state it can render — including
 * the error state — was unreachable and a parent with settled orders saw "no orders yet".
 */
const OrdersStackScreen = withScreenFrame(ConnectedOrdersScreen, STACK_SCREEN_EDGES, { back: true });

function ConnectedOrdersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <OrdersTabScreen
      onSelectOrder={(orderGroupId) => navigation.navigate('OrderDetail', { orderGroupId })}
      onSignIn={() => navigation.navigate('SignIn')}
      onBrowseMenu={() => navigation.navigate('Tabs', { screen: 'Menu' })}
    />
  );
}
/** `E06-34`. The connected screen — see `ConnectedOrdersScreen` for why bare routing was the bug. */
const OrderDetailStackScreen = withScreenFrame(ConnectedOrderDetailScreen, STACK_SCREEN_EDGES, {
  back: true,
});

function ConnectedOrderDetailScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, 'OrderDetail'>) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  /**
   * `E05-54`. A checkout session of its own, deliberately not the cart's.
   *
   * Resuming is a payment against an order that already exists, so it shares nothing with a
   * cart in progress — and reusing the cart's session would let a resume overwrite the
   * `placedGroupId` of an order somebody is midway through placing.
   */
  const checkout = useCheckout();
  return (
    <OrderDetailTabScreen
      orderGroupId={route.params.orderGroupId}
      onBackToMenu={() => navigation.navigate('Tabs', { screen: 'Menu' })}
      onContactSupport={() => navigation.navigate('Support')}
      /**
       * `E05-54`. The navigator owns the checkout machinery, so it supplies the resume — the
       * detail screen knows about an order, not about opening a payment sheet.
       */
      onResumePayment={async (orderGroupId) => {
        await checkout.resume(orderGroupId);
      }}
    />
  );
}
const AddChildStackScreen = withScreenFrame(AddChildScreen, STACK_SCREEN_EDGES, { back: true });
const ChildrenStackScreen = withScreenFrame(ChildrenScreen, STACK_SCREEN_EDGES, { back: true });
const SupportStackScreen = withScreenFrame(SupportScreen, STACK_SCREEN_EDGES, { back: true });
const DeleteAccountStackScreen = withScreenFrame(DeleteAccountScreen, STACK_SCREEN_EDGES, {
  back: true,
});
const PolicyStackScreen = withScreenFrame(PolicyScreen, STACK_SCREEN_EDGES, { back: true });

/**
 * `E21`. The pack screens, wired to the navigator that owns the routes.
 *
 * Both read the balance from `MealPackSurfaceContext` rather than fetching: one read serves the
 * Account row, the balance screen and the cart strip, so they cannot disagree about whether a
 * parent has meals — and the cart, which re-renders on every quantity change, does not fetch.
 */
function ConnectedPacksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <PacksScreen
      onOpenOffer={(offerId: string) => navigation.navigate('PackDetail', { offerId })}
      onBackToMenu={() => navigation.navigate('Tabs', { screen: 'Menu' })}
      onSeeBalance={() => navigation.navigate('MyPacks')}
    />
  );
}

function ConnectedMyPacksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const surface = useMealPackSurface();
  // Dates formatted here so the screen holds no date logic — it renders labels, never parses.
  const balance =
    surface.balance === null
      ? null
      : {
          packName: surface.balance.packName,
          mealsTotal: surface.balance.mealsTotal,
          mealsRemaining: surface.balance.mealsRemaining,
          purchasedLabel: formatServiceDateLong(surface.balance.purchasedAt.slice(0, 10)),
          expiresLabel: formatServiceDateLong(surface.balance.expiresAt.slice(0, 10)),
          expired: surface.balance.expired,
        };
  return (
    <MyPacksScreen
      balance={balance}
      onSeeOffers={() => navigation.navigate('Packs')}
      onPlanMeals={() => navigation.navigate('PackPlan')}
    />
  );
}

const PacksStackScreen = withScreenFrame(ConnectedPacksScreen, STACK_SCREEN_EDGES, { back: true });
const MyPacksStackScreen = withScreenFrame(ConnectedMyPacksScreen, STACK_SCREEN_EDGES, {
  back: true,
});
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
  /**
   * `E15-21`. One listener for every screen, rather than a `useEffect` in each.
   *
   * `onStateChange` fires after every navigation, and `getCurrentRoute()` is the screen the
   * parent is now looking at — including a tab switch, which is a screen change even though the
   * stack did not move.
   *
   * **A route with no mapping sends nothing.** `screenNameFor` returns `null` for anything not
   * vetted, which is the safe direction: a missing row in a path costs a question, an unvetted
   * name is how a screen titled from data would reach a vendor.
   *
   * The ref guards a real case rather than a theoretical one: React Navigation emits state
   * changes for reasons other than the route changing — a param update, a gesture that settles
   * back — and each would otherwise be a duplicate row in the path.
   */
  const lastScreen = useRef<string | null>(null);
  const navigationRef = useNavigationContainerRef();

  /**
   * Emit whatever screen a navigation settled on, once.
   *
   * Shared by `onReady` and `onStateChange` because the first screen needs it as much as the
   * rest, and duplicating the mapping in two handlers is how they drift.
   */
  const emitScreen = (name: string | undefined) => {
    const screen = screenNameFor(name);
    if (screen === null || screen === lastScreen.current) return;
    lastScreen.current = screen;
    track('screen_viewed', { screen });
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      /**
       * **`onStateChange` fires on changes, never on arrival.** Without this the first screen a
       * parent lands on — Home, on every single app open — would be the one screen missing from
       * their path, and a path whose first step is absent reads as though they started in the
       * middle. `onReady` is the only place the initial route is observable.
       */
      onReady={() => emitScreen(navigationRef.getCurrentRoute()?.name)}
      onStateChange={(state) => {
        if (state === undefined) return;
        const route = state.routes[state.index ?? 0];
        // The tab INSIDE `Tabs`, not the container: counting the container would double every
        // tab view, and `Tabs` is not a screen anyone is on.
        const nested = route?.state as { index?: number; routes?: { name: string }[] } | undefined;
        emitScreen(nested?.routes?.[nested.index ?? 0]?.name ?? route?.name);
      }}
    >
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
        {/* `E20-39`. Reached from Account, and deliberately not behind a session: someone
            whose complaint is that they cannot sign in must still be able to reach us. */}
        <Stack.Screen name="Support" component={SupportStackScreen} />
        {/* `E20-37`. A push, not a modal: this is somewhere you went deliberately from
            Account, and backing out of it should read as returning, not as dismissing. */}
        <Stack.Screen name="DeleteAccount" component={DeleteAccountStackScreen} />
        {/* `E20-38`. No session required — a visitor deciding whether to sign up is exactly
            who reads a privacy policy, and `[AZ-03]` requires it reachable without an account. */}
        <Stack.Screen name="Policy" component={PolicyStackScreen} />
        {/*
          `E21`. Registered always, navigated to only when the gate allows — see `types.ts`.
          Each renders the prototype's refusal when reached with the gate off, which is what
          makes a stale link land somewhere designed rather than crashing.
        */}
        <Stack.Screen name="Packs" component={PacksStackScreen} />
        <Stack.Screen name="MyPacks" component={MyPacksStackScreen} />
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
