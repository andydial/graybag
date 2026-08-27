import { useEffect, useState } from 'react';
import { track } from '../analytics/analytics';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, cart as cartDomain, design, money } from '@graybag/shared';

import { AllergenFlag, BrandHeader, FoodTypeMark, PatternTile } from '../components';
import { Button } from '../components/Button';
import { InlineError } from '../components/motion/InlineError';
import { DishImage } from '../components/DishImage';
import { Card, EmptyState } from '../components/Surfaces';
import { useCart } from './CartContext';
import { BreakTimePicker } from './BreakTimePicker';
import { KitchenNoteLine } from './KitchenNote';
import { CartTotals } from './CartTotals';
import { PackRedemptionStrip, type PackIneligibility } from '../packs/PackRedemptionStrip';
import { OrderForBlock, type OrderFor } from './OrderForBlock';

const { bg, text, border, scale, space, radius, borderWidth, touchTarget, layout, action } = design;

/** `P12`: 140 characters, and the field stops accepting input rather than truncating on save. */
/** Re-exported from `KitchenNote` so the cap lives with the field that enforces it (`P12`). */
export { KITCHEN_NOTE_MAX_LENGTH as COMMENT_MAX_LENGTH } from './KitchenNote';

/** The line thumbnail's box. `space[16]` rather than a number, like every other box. */
const THUMB = space[16];
/** The empty state's illustration, big enough to read as art rather than as a missing image. */
const EMPTY_ART = space[16] + space[8];
/** The stepper's visual circle. The *target* is `touchTarget.min` around it — see `StepperButton`. */
const STEPPER_CIRCLE = space[8];

export type CutoffState = 'open' | 'soon' | 'closed';

/**
 * When ordering closes, and how close that is.
 *
 * **This is an object rather than a bare `'open' | 'soon' | 'closed'` on purpose.** `C5` says
 * the copy is "Ordering closes on **Monday 11 Aug, 11:59 PM**" — a full weekday, date and time,
 * never a bare "00:00" — and a three-valued enum carries no time to render. A screen that knew
 * only "closed" would have to invent one, which is precisely what §5.21 forbids: an unknown
 * rendered as a known is a promise about when ordering shuts that we cannot keep.
 *
 * Absent means *unresolved*, and an unresolved cutoff renders **nothing**. There is no calendar
 * read in `api/` yet (`E05-30`), so today that is the ordinary case.
 */
export interface CartCutoff {
  state: CutoffState;
  /** ISO instant at which ordering closes. */
  closesAt: string;
  /**
   * The IANA zone the kitchen's cutoff is expressed in. **Rendered only when it differs from
   * the phone's** (`C4`) — the common case stays short, and the parent in London reading a
   * Mohali cutoff still gets it right.
   */
  timeZone?: string;
  /** Minutes remaining, for the `soon` band. Omitted rather than derived from the clock here. */
  minutesLeft?: number;
}

/** §7 `price_changed`, as the cart renders it. */
export interface CartPriceChange {
  dishName: string;
  /** Integer paise, GST-exclusive — the price the app displayed when the line was added. */
  fromPaise: number;
  /** Integer paise, GST-exclusive — what it costs now. */
  toPaise: number;
}

/**
 * What to warn about, per dish, for the child this order is for.
 *
 * **The recipient is part of the value, not a sibling prop.** §5.7 puts allergen warnings under
 * "for the selected child", and a warning with no child behind it is either a guess or a claim
 * about a child we did not check — so there is no way to pass allergens without also saying
 * whose they are. `AR6`/R6: the name is rendered and never logged.
 */
export interface CartAllergenCheck {
  recipientName: string;
  /** Allergen names to warn about, keyed by dish id. A dish absent from this map is not warned. */
  byDishId: Record<string, string[]>;
}

/**
 * Per-dish presentation a cart line cannot carry yet.
 *
 * `CartLineInput` (packages/shared) holds `dishName`, `unitPricePaise`, `quantity`, `comment`,
 * `menuItemId` and `dishId` — **no photo and no veg mark**. §5.7 asks for both on every line, so
 * they are taken as a prop keyed by dish id rather than invented here. When `CartLineInput`
 * grows `foodType` and `imageUri`, this prop and the lookups below delete.
 */
export interface CartLinePresentation {
  imageUri?: string | null;
  foodType?: 'veg' | 'egg' | 'non_veg' | null;
}

export interface CartScreenProps {
  onPlaceOrder?: () => void;
  /**
   * Why the last Place order attempt did not proceed, in the parent's words.
   *
   * Added after the first real tap **failed silently**: the order was refused, no sheet opened,
   * and the screen returned to the cart with nothing said. A refusal a parent cannot see is a
   * parent tapping the same button again — and `create_checkout`'s refusals are all actionable
   * ("the price changed", "ordering has closed"), so saying nothing throws away the one piece of
   * information they need.
   */
  checkoutError?: string | null;
  /**
   * The school's orderable break windows — `E05-30`, `P19`.
   *
   * `undefined` means not read yet. **`[]` means the school cannot take orders**, which is a
   * state rather than an absence: two of the three live schools have no windows, and `P19`
   * says they must not reach checkout.
   */
  breakWindows?: readonly api.BreakTime[] | undefined;
  /** The chosen window. Nothing is preselected — a default here is a choice made for a parent. */
  breakTimeId?: string | null;
  onSelectBreakTime?: (id: string) => void;
  /** The "For" block's Change affordance. Absent means the block renders read-only. */
  onChangeRecipient?: () => void;
  /** The cutoff-passed notice's way forward. §7: never a dead end. */
  onChooseAnotherDay?: () => void;
  /** The empty state's way out — §5.7 sends it at the menu, never at sign-in (`AR7`). */
  onBrowseMenu?: () => void;
  /** Retry for the repricing error. */
  onRetry?: () => void;

  /**
   * Offline (§5.7). **The cart itself never sets this**, and that is `R12`/§5.7.1: a cart
   * restored from disk after the OS killed the app is authoritative local intent, not a stale
   * cache, and must not render an offline banner. Connectivity is the caller's to know.
   */
  offline?: boolean;
  /** Repricing — the skeleton lands on the totals block only, never the whole screen. */
  repricing?: boolean;
  priceChanged?: CartPriceChange;
  cutoff?: CartCutoff;
  /** §7 `item_unavailable`. Dish ids withdrawn since the line was added. */
  unavailableDishIds?: string[];
  /** A failed reprice. The cart is still shown; only the total is untrustworthy. */
  error?: string;
  /**
   * Signed out. Only changes the caption under the button — the cart fills, edits and totals
   * exactly the same signed out (`AR7`), and nothing above the footer is gated.
   */
  signedOut?: boolean;
  allergens?: CartAllergenCheck;
  /** See `CartLinePresentation`. Keyed by dish id. */
  dishInfo?: Record<string, CartLinePresentation>;
  /**
   * `E21`. The parent's balance, or null when they hold none. Passed in rather than fetched
   * here: the cart already has more reasons to re-render than any other screen, and a read
   * inside it would fire on every quantity change.
   */
  packBalance?: import('../packs/MyPacksScreen').PackBalance | null;
  /** Why this cart cannot be paid with a meal. The SERVER decides; this only picks the copy. */
  packIneligibility?: PackIneligibility;
  /** Whether the parent has turned the switch on for THIS order. Never remembered. */
  usingPackMeal?: boolean;
  onTogglePackMeal?: ((next: boolean) => void) | undefined;
  onSeePackOffers?: (() => void) | undefined;
}

/**
 * The cart (`E05-04`, built to `docs/ux-spec.md` §5.7 and the prototype's `#cart` states).
 *
 * **It fills and edits signed out.** `AR7` puts the only gate at checkout, so the empty state
 * points at the menu and the words "sign in" appear nowhere above the footer — asserted in the
 * test, because this is the rule one well-meaning addition breaks.
 *
 * **One child, one service date** (`AR8`/`[DM-01]`). Every line shares a recipient and a date,
 * and the "For" block states them once, as a bordered card with a Change affordance.
 *
 * **Every price comes from `money.formatPaise`, and the tax split from `money.gstBreakdown`.**
 * Neither is assembled here — §6.2's per-line half-up rule is subtle enough that a second
 * implementation would eventually disagree with the invoice.
 *
 * ## What the cart cannot know about itself
 *
 * Offline, repricing, a price change, the cutoff, a withdrawn item and a failed reprice are all
 * facts about the *server* and the *network*, not about a local list of lines. They arrive as
 * props. That is not indirection for testability — it is what keeps §5.7.1's rule true: the
 * cart is authoritative local intent, so it must not be able to invent a banner about the world
 * outside it. Every one of them defaults to absent, and absent renders nothing.
 *
 * The two prices a line still cannot show — its photo and its veg mark — are `dishInfo`, for
 * the reason set out there.
 */
export function CartScreen({
  onPlaceOrder,
  checkoutError = null,
  breakWindows,
  breakTimeId = null,
  onSelectBreakTime,
  onChangeRecipient,
  onChooseAnotherDay,
  onBrowseMenu,
  onRetry,
  offline = false,
  repricing = false,
  priceChanged,
  cutoff,
  unavailableDishIds,
  error,
  signedOut = false,
  allergens,
  dishInfo,
  packBalance = null,
  packIneligibility = null,
  usingPackMeal = false,
  onTogglePackMeal,
  onSeePackOffers,
}: CartScreenProps = {}) {
  const { cart, setQuantity, setComment, remove } = useCart();
  const orderFor = useOrderFor(cart);

  if (cart.lines.length === 0) {
    return (
      // `screen-cart` is on every branch: the route's identity is the route, not whether it
      // happens to have anything in it, and navigation asserts against it.
      <View style={styles.screen} testID="screen-cart">
        <BrandHeader />
        <ScreenTitle />
        <View style={styles.emptyBody}>
          {/* Never a grey box and never a spinner — the branded tile, as everywhere else. */}
          <PatternTile style={styles.emptyArt} testID="cart-empty-art" />
          <EmptyState
            testID="cart-empty"
            title="Your order is empty"
            body="Add something from the menu and it'll show up here."
            {...(onBrowseMenu === undefined
              ? {}
              : { actionLabel: 'Browse the menu', onAction: onBrowseMenu })}
          />
        </View>
      </View>
    );
  }

  const breakdown = money.gstBreakdown(
    cart.lines.map((line) => ({
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
    })),
  );

  const withdrawn = new Set(unavailableDishIds ?? []);
  const withdrawnNames = [
    ...new Set(cart.lines.filter((l) => withdrawn.has(l.dishId)).map((l) => l.dishName)),
  ];
  const closed = cutoff?.state === 'closed';

  return (
    <View style={styles.screen} testID="screen-cart">
      <BrandHeader />
      <ScreenTitle />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/*
          Offline is a quiet band rather than a blocking notice: the cart is fully usable
          offline, and only the last step needs a connection (§5.7).
        */}
        {offline ? (
          <Text style={styles.offline} accessibilityLiveRegion="polite" testID="cart-offline">
            You&rsquo;re offline — we&rsquo;ll need a connection to place this order.
          </Text>
        ) : null}

        {priceChanged === undefined ? null : (
          <Notice
            tone="warning"
            testID="cart-price-changed"
            title="The price of one item changed"
            body={
              `${priceChanged.dishName} went from ${money.formatPaise(priceChanged.fromPaise)} ` +
              `to ${money.formatPaise(priceChanged.toPaise)} while your order was open. ` +
              `Check the new total before you pay.`
            }
          />
        )}

        {withdrawnNames.length === 0 ? null : (
          <Notice
            tone="danger"
            testID="cart-unavailable"
            title={
              withdrawnNames.length === 1
                ? 'One item is no longer available'
                : `${withdrawnNames.length} items are no longer available`
            }
            body={
              withdrawnNames.length === 1
                ? `${withdrawnNames[0]} came off the menu after you added it. Remove it and the rest of your order is unchanged.`
                : `${withdrawnNames.join(', ')} came off the menu after you added them. Remove them and the rest of your order is unchanged.`
            }
          />
        )}

        {closed ? (
          <Notice
            tone="danger"
            testID="cart-cutoff-passed"
            title="Ordering for this day has closed"
            body="The kitchen needs the list before the cutoff. Pick another day and we'll keep everything in your order."
            {...(onChooseAnotherDay === undefined
              ? {}
              : { actionLabel: 'Choose another day', onAction: onChooseAnotherDay })}
          />
        ) : null}

        {error === undefined ? null : (
          <Notice
            tone="danger"
            testID="cart-error"
            title="We couldn't check today's prices"
            body={error}
            {...(onRetry === undefined ? {} : { actionLabel: 'Try again', onAction: onRetry })}
          />
        )}

        <OrderForBlock
          orderFor={orderFor}
          {...(orderFor === null || onChangeRecipient === undefined
            ? {}
            : { onChange: onChangeRecipient })}
        />

        {cart.lines.map((line) => (
          <CartLineRow
            key={line.key}
            line={line}
            unavailable={withdrawn.has(line.dishId)}
            {...(dishInfo?.[line.dishId] === undefined
              ? {}
              : { presentation: dishInfo[line.dishId] })}
            {...(allergens === undefined
              ? {}
              : {
                  warnAllergens: allergens.byDishId[line.dishId] ?? [],
                  recipientName: allergens.recipientName,
                })}
            onIncrement={() => setQuantity(line.key, line.quantity + 1)}
            // The domain removes the line at zero. The screen adds no guard of its own: two
            // places deciding what the last decrement means is how they come to disagree.
            onDecrement={() => setQuantity(line.key, line.quantity - 1)}
            onRemove={() => remove(line.key)}
            onComment={(next) => setComment(line.key, next)}
          />
        ))}

        {cutoff === undefined ? null : <CutoffBand cutoff={cutoff} />}

        {/*
          `P19`. Three states, and the middle one is the point: no windows means this school is
          not open for ordering, and saying so here — before the button — is what replaces
          "break time is confirmed with the kitchen".
        */}
        {breakWindows === undefined ? null : breakWindows.length === 0 ? (
          <Card testID="cart-school-closed">
            <Text style={styles.closedHead}>We&rsquo;re still setting up ordering for this school</Text>
            <Text style={styles.closedBody}>
              We can&rsquo;t take orders here yet. Your cart is saved — we&rsquo;ll let you know
              as soon as this school opens.
            </Text>
          </Card>
        ) : (
          <Card>
            <BreakTimePicker
              windows={breakWindows}
              selectedId={breakTimeId}
              onSelect={(id) => onSelectBreakTime?.(id)}
              testID="cart-break-picker"
            />
          </Card>
        )}

        {/*
          `E21`. Above the totals, because it changes what the totals say: a redeemed meal makes
          the payable zero, and an offer that appeared *below* the number it changes would read as
          an afterthought. It renders nothing at all unless the parent has a balance or we sell
          packs here — the cart is not exempt from "no such concept".
        */}
        <PackRedemptionStrip
          mealsLeft={packBalance?.mealsRemaining ?? 0}
          mealsTotal={packBalance?.mealsTotal ?? 0}
          expiresLabel={packBalance?.expiresLabel ?? null}
          expired={packBalance?.expired ?? false}
          ineligible={packIneligibility}
          using={usingPackMeal}
          onToggle={onTogglePackMeal}
          onSeeOffers={onSeePackOffers}
        />

        {/* On a card like everything else on this canvas — the totals are the last block a
            parent reads before paying, and leaving them loose on the grey read as a footnote. */}
        <Card>
          <CartTotals breakdown={breakdown} loading={repricing} />
        </Card>
      </ScrollView>

      {/*
        Sticky, outside the ScrollView. The total a parent is about to pay is on the button
        itself — §5.7 — so the amount and the commitment are never on separate screens.
      */}
      <View style={styles.footer}>
        {/* Above the button, because it explains why the button did not work. */}
        <InlineError message={checkoutError} testID="cart-checkout-error" />
        <Button
          {...placeOrderState({
            totalPaise: breakdown.totalPaise,
            offline,
            closed,
            repricing,
            unavailable: withdrawnNames.length > 0,
            errored: error !== undefined,
            schoolClosed: breakWindows !== undefined && breakWindows.length === 0,
            breakNeeded:
              breakWindows !== undefined && breakWindows.length > 0 && breakTimeId === null,
            wired: onPlaceOrder !== undefined,
          })}
          testID="cart-place-order"
          onPress={() => {
            // `E15-21`. The tap, not the outcome. A parent who presses this and then dismisses
            // the sheet is the "reached checkout and turned back" shape — and it is invisible
            // if only successful checkouts are recorded.
            track('place_order_tapped', { line_count: cart.lines.length });
            onPlaceOrder?.();
          }}
        />
        {signedOut ? (
          /*
            The **only** place on this screen the gate is named, and it is reassurance rather
            than a wall: `F1` — a parent who fears losing the cart at the gate abandons before
            reaching it, so the sentence exists to say the cart survives.

            It is behind `signedOut` deliberately. `AR7`'s rule is that nothing on the cart
            *asks* for sign-in; a signed-out parent about to tap the button is the one case
            where staying silent would be a surprise instead of an absence. The default render
            still contains the phrase nowhere, which is what the test asserts.
          */
          <Text style={styles.footerNote} testID="cart-signed-out-note">
            We&rsquo;ll ask you to sign in — your order is kept.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What the primary action says, and whether it can be pressed.
 *
 * Collected in one function because the button has six reasons to be inert and every one of
 * them has to *say* which — `S?`/§2.10: a greyed control with an unchanged label is a dead end
 * that looks like a bug. The order is the order a parent would hit them in.
 */
function placeOrderState({
  totalPaise,
  offline,
  closed,
  repricing,
  unavailable,
  errored,
  schoolClosed,
  breakNeeded,
  wired,
}: {
  totalPaise: number;
  offline: boolean;
  closed: boolean;
  repricing: boolean;
  unavailable: boolean;
  errored: boolean;
  schoolClosed: boolean;
  breakNeeded: boolean;
  wired: boolean;
}): { label: string; disabled?: boolean; loading?: boolean } {
  /**
   * `P19`, and **first** — above the cutoff. A school with no break windows cannot take an
   * order at any hour, so "Ordering has closed" would be the wrong sentence: it says come back
   * tomorrow, and tomorrow is not the problem.
   */
  if (schoolClosed) return { label: 'Not available at this school yet', disabled: true };
  /**
   * **Offline before closed**, which is the prototype's order and was inverted here.
   *
   * Both are dead ends, so this is not about which is more actionable — it is about which is
   * *true for longer*. "Ordering has closed" is a fact about today that a parent can act on
   * tomorrow; being offline is a fact about right now, and a parent told the kitchen has closed
   * while their phone has no signal has been given a reason that may simply be wrong — the
   * cutoff state they are being shown was read before the connection went.
   */
  if (offline) return { label: "You're offline", disabled: true };
  if (closed) return { label: 'Ordering has closed', disabled: true };
  if (unavailable) return { label: 'Remove the unavailable item first', disabled: true };
  // Not "Place order · <amount>": the amount is the thing we could not confirm, and putting a
  // number we do not trust on the button is how a parent gets charged something else.
  if (errored) return { label: "We couldn't check prices", disabled: true };
  // Loading keeps the label and adds an indicator (`S5`) — but drops the amount, because the
  // amount is exactly what is being re-checked.
  if (repricing) return { label: 'Place order', loading: true };
  // Required everywhere (`P19`). The label names the missing step rather than saying "Place
  // order" and refusing — a disabled button with no reason is the thing parents tap twice.
  if (breakNeeded) return { label: 'Choose a delivery time', disabled: true };
  return { label: `Place order · ${money.formatPaise(totalPaise)}`, disabled: !wired };
}

/** "Your order" — §5.7's first element, in the brand green the prototype's bar uses. */
function ScreenTitle() {
  return (
    <Text style={styles.title} accessibilityRole="header" testID="cart-title">
      Your order
    </Text>
  );
}

/**
 * Resolve who the order is for, from the cart itself.
 *
 * Returns `null` — "no child chosen yet" — for a signed-out parent, for one with no children,
 * and when the read fails. That last case is deliberate and is the §5.21 rule applied: a failed
 * read must not render as a *different* child or as a confident blank, and the "For" block's
 * null state says in words that nothing has been chosen rather than implying it has.
 */
function useOrderFor(cart: cartDomain.Cart): OrderFor | null {
  const [orderFor, setOrderFor] = useState<OrderFor | null>(null);
  const first = cart.lines[0];
  const recipientId = first?.recipientId ?? null;
  const serviceDate = first?.serviceDate ?? null;

  useEffect(() => {
    let live = true;
    if (recipientId === null || serviceDate === null) {
      setOrderFor(null);
      return () => {
        live = false;
      };
    }

    api
      .fetchRecipients()
      .then((children) => {
        if (!live) return;
        const match = children.find((child) => child.id === recipientId);
        setOrderFor(
          match === undefined
            ? null
            : {
                childName: match.firstName,
                classLabel: match.classLabel,
                sectionLabel: match.sectionLabel,
                schoolName: match.schoolName,
                serviceDate: formatServiceDate(serviceDate),
              },
        );
      })
      .catch(() => {
        // Signed out, offline, or a failed read. All three mean "we cannot say who this is
        // for", which is what `null` renders. Nothing is logged: a failure here would carry a
        // recipient id, and ids about children stay out of logs (R6).
        if (live) setOrderFor(null);
      });

    return () => {
      live = false;
    };
  }, [recipientId, serviceDate]);

  return orderFor;
}

/**
 * `2026-08-12` → `Tuesday 12 August`.
 *
 * Full weekday and month, per R7 — the cutoff copy rule exists because "12/08" and a bare
 * "00:00" are each ambiguous enough to be read a whole day wrong. Parsed as UTC and formatted
 * in UTC so the rendered date is the service date itself and cannot slide by one across the
 * device's timezone.
 */
export function formatServiceDate(serviceDate: string): string {
  const parsed = new Date(`${serviceDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return serviceDate;
  return (
    parsed
      .toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      })
      // en-IN puts a comma after the weekday on some ICU builds and not others. Dropped here
      // as it is in `formatCutoffAt`, so the two dates on this screen are set the same way
      // whichever build the phone shipped with.
      .replace(/,/g, '')
  );
}

/** The phone's own zone, or `undefined` where the runtime cannot say. */
function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone === '' ? undefined : zone;
  } catch {
    return undefined;
  }
}

/**
 * An instant → `Monday 11 Aug, 11:59 PM`.
 *
 * **Never a bare time and never a bare date** (`C5`): "closes at 00:00" is ambiguous about
 * which midnight it means and reads as a whole day wrong, which is a missed lunch.
 *
 * **The zone is named only when it differs from the phone's** (`C4`). A Mohali parent on IST
 * gets the short form; a parent reading the same cutoff from London gets "11:59 PM GMT+5:30"
 * and does not miss it by five and a half hours.
 */
export function formatCutoffAt(closesAt: string, timeZone?: string): string {
  const at = new Date(closesAt);
  if (Number.isNaN(at.getTime())) return closesAt;

  const device = deviceTimeZone();
  const zone = timeZone ?? device;
  const showZone = timeZone !== undefined && timeZone !== device;

  try {
    const day = at
      .toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        ...(zone === undefined ? {} : { timeZone: zone }),
      })
      // en-IN puts a comma after the weekday on some ICU builds and not others. Removing it
      // makes the rendered string the same everywhere, which is what the copy rule asks for.
      .replace(/,/g, '');

    const time = at
      .toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(zone === undefined ? {} : { timeZone: zone }),
        ...(showZone ? { timeZoneName: 'short' as const } : {}),
      })
      // Newer ICU emits a narrow no-break space before the meridiem, which renders as a
      // missing space in some Android fonts. Written as an escape rather than pasted: a
      // literal U+202F in source is invisible in every diff it ever appears in.
      .replace(/\u202f/g, ' ')
      // Some ICU builds return "pm"; the copy rule asks for "11:59 PM".
      .replace(/\b(am|pm)\b/g, (meridiem) => meridiem.toUpperCase());

    return `${day}, ${time}`;
  } catch {
    // An unknown IANA zone throws. Returning the instant unformatted is ugly and honest; a
    // guessed time would be neither.
    return closesAt;
  }
}

/** The cutoff copy, per state. Every variant carries the full date and time. */
export function cutoffCopy(cutoff: CartCutoff): string {
  const at = formatCutoffAt(cutoff.closesAt, cutoff.timeZone);
  if (cutoff.state === 'closed') return `Ordering closed on ${at}.`;
  if (cutoff.state === 'soon') {
    // The urgency is in the words as well as the tint. §2.10: nothing in this product conveys
    // a state by colour alone, and an amber band a colour-blind parent reads as the green one
    // is the whole failure mode.
    return cutoff.minutesLeft === undefined
      ? `Ordering closes soon, on ${at}.`
      : `Ordering closes in ${cutoff.minutesLeft} minutes — on ${at}.`;
  }
  return `Ordering closes on ${at}.`;
}

function CutoffBand({ cutoff }: { cutoff: CartCutoff }) {
  const tone =
    cutoff.state === 'closed'
      ? styles.bandDanger
      : cutoff.state === 'soon'
        ? styles.bandWarning
        : styles.bandInfo;
  const ink =
    cutoff.state === 'closed'
      ? styles.bandDangerText
      : cutoff.state === 'soon'
        ? styles.bandWarningText
        : styles.bandInfoText;

  return (
    <View style={[styles.band, tone]} testID={`cart-cutoff-${cutoff.state}`}>
      <Text style={[styles.bandText, ink]} accessibilityLiveRegion="polite">
        {cutoffCopy(cutoff)}
      </Text>
    </View>
  );
}

type NoticeTone = 'info' | 'warning' | 'danger';

/**
 * A titled banner with an optional way forward.
 *
 * Local to the cart rather than in `components/`: three screens would have to agree on it
 * before it is shared furniture, and one of them making it up is how a component library grows
 * a second card. Promoting it is a separate change.
 */
function Notice({
  tone,
  title,
  body,
  actionLabel,
  onAction,
  testID,
}: {
  tone: NoticeTone;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const fill =
    tone === 'danger' ? styles.bandDanger : tone === 'warning' ? styles.bandWarning : styles.bandInfo;
  const ink =
    tone === 'danger'
      ? styles.bandDangerText
      : tone === 'warning'
        ? styles.bandWarningText
        : styles.bandInfoText;

  return (
    <View style={[styles.notice, fill]} testID={testID}>
      <Text style={[styles.noticeTitle, ink]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.bandText, ink]} accessibilityLiveRegion="polite">
        {body}
      </Text>
      {actionLabel === undefined || onAction === undefined ? null : (
        <View style={styles.noticeAction}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      )}
    </View>
  );
}

function CartLineRow({
  line,
  presentation,
  unavailable,
  warnAllergens,
  recipientName,
  onIncrement,
  onDecrement,
  onRemove,
  onComment,
}: {
  line: cartDomain.CartLine;
  presentation?: CartLinePresentation;
  unavailable: boolean;
  warnAllergens?: string[];
  recipientName?: string;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  onComment: (next: string | null) => void;
}) {
  const imageUri = presentation?.imageUri ?? null;
  const foodType = presentation?.foodType ?? null;
  // **Both, or neither.** A warning is only ever shown against a named child; there is no
  // branch here that renders "Contains Peanuts" with nobody to be allergic to it, because a
  // warning with no subject reads as a property of the dish and would appear on every cart.
  const warned =
    recipientName !== undefined && warnAllergens !== undefined && warnAllergens.length > 0;

  return (
    <Card testID={`cart-line-${line.key}`}>
      <View style={styles.lineHeader}>
        <View style={styles.thumb}>
          {imageUri === null ? (
            // Most of the catalogue has no photograph yet, so this is the ordinary case.
            <PatternTile testID={`cart-line-image-${line.key}`} />
          ) : (
            <DishImage
              testID={`cart-line-image-${line.key}`}
              uri={imageUri}
              // `fill`, because the box above already sizes it — one implementation of the
              // recycling key, the disk cache and the cross-fade.
              size={0}
              fill
              recyclingKey={line.dishId}
            />
          )}
        </View>

        <View style={styles.lineText}>
          <View style={styles.nameRow}>
            <FoodTypeMark foodType={foodType} testID={`cart-line-foodtype-${line.key}`} />
            <Text style={styles.dishName}>{line.dishName}</Text>
          </View>
          <Text style={styles.unitPrice}>
            {money.formatPaise(line.unitPricePaise)} each · excl. GST
          </Text>

          {warned ? (
            <View style={styles.allergenRow}>
              <AllergenFlag
                allergens={warnAllergens ?? []}
                testID={`cart-line-allergen-${line.key}`}
              />
              <Text style={styles.allergenWho}>{recipientName} is allergic</Text>
            </View>
          ) : null}

          {unavailable ? (
            <Text style={styles.unavailable} testID={`cart-line-unavailable-${line.key}`}>
              No longer available
            </Text>
          ) : null}
        </View>

        <View style={styles.stepperPill}>
          <StepperButton
            glyph="−"
            // The label names the dish, not "minus". A screen-reader user moving through a cart
            // of six lines hears "Remove one" six times otherwise, with no way to tell which
            // line they are on.
            label={`Remove one ${line.dishName}`}
            testID={`cart-line-decrement-${line.key}`}
            onPress={onDecrement}
          />
          <Text style={styles.quantity} testID={`cart-line-qty-${line.key}`}>
            {line.quantity}
          </Text>
          <StepperButton
            glyph="+"
            emphasis
            label={`Add one ${line.dishName}`}
            testID={`cart-line-increment-${line.key}`}
            onPress={onIncrement}
          />
        </View>
      </View>

      <View style={styles.lineFooter}>
        <Pressable
          onPress={onRemove}
          testID={`cart-line-remove-${line.key}`}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${line.dishName} from cart`}
          style={styles.removeButton}
        >
          <Text style={styles.removeLabel}>Remove</Text>
        </Pressable>
        <Text style={styles.lineTotal} testID={`cart-line-total-${line.key}`}>
          {money.formatPaise(line.unitPricePaise * line.quantity)}
        </Text>
      </View>

      {/*
        Compact, and tap-to-edit (Andy, 2026-08-11). The full field is on the dish sheet, where
        the parent is actually looking at the dish; a permanently-open textarea under every
        line made the cart a form when it should read as a receipt.
      */}
      <KitchenNoteLine
        value={line.comment}
        onCommit={onComment}
        testID={`cart-line-note-${line.key}`}
      />
    </Card>
  );
}


/**
 * One end of the stepper.
 *
 * The **visual** circle is `STEPPER_CIRCLE`; the **target** is `touchTarget.min` around it.
 * `docs/design-tokens.md` is explicit that those are separate concerns, and the stepper is the
 * case it names — a 32pt circle inside a 48pt press area, not a 48pt circle.
 */
function StepperButton({
  glyph,
  label,
  testID,
  emphasis = false,
  onPress,
}: {
  glyph: string;
  label: string;
  testID: string;
  emphasis?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.stepperTarget}
    >
      <View style={[styles.stepperCircle, emphasis && styles.stepperCircleEmphasis]}>
        <Text style={[styles.stepperGlyph, emphasis && styles.stepperGlyphEmphasis]}>{glyph}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  closedHead: {
    color: text.primary,
    fontSize: scale.label.size,
    fontWeight: scale.label.weight,
    marginBottom: space[2],
  },
  closedBody: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  screen: { flex: 1, backgroundColor: bg.canvas },
  scroll: { flex: 1 },
  content: { padding: layout.gutter, gap: layout.blockGap },

  // `text.link` is `primary-700`. The brand `#00af52` is 2.9:1 on white — graphics and large
  // text only — so the title takes the darker role, as the menu's does.
  title: {
    color: text.link,
    backgroundColor: bg.surface,
    paddingHorizontal: layout.gutter,
    paddingBottom: space[3],
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },

  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4] },
  emptyArt: {
    width: EMPTY_ART,
    height: EMPTY_ART,
    flex: 0,
    borderRadius: radius.xl,
  },

  offline: {
    color: text.secondary,
    backgroundColor: bg.surfaceMuted,
    padding: space[3],
    borderRadius: radius.md,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  notice: { borderRadius: radius.lg, padding: space[4], gap: space[1] },
  noticeTitle: { fontSize: scale.bodyStrong.size, fontWeight: scale.bodyStrong.weight },
  noticeAction: { marginTop: space[3], alignItems: 'flex-start' },

  band: { borderRadius: radius.md, paddingHorizontal: space[4], paddingVertical: space[3] },
  bandText: { fontSize: scale.bodySm.size, lineHeight: scale.bodySm.lineHeight },
  bandInfo: { backgroundColor: bg.surfaceAccent },
  // `onAccent` rather than `link`: `primary-700` on the lime ground is 4.09 and fails.
  bandInfoText: { color: text.onAccent },
  bandWarning: { backgroundColor: bg.surfaceWarning },
  bandWarningText: { color: text.warning },
  bandDanger: { backgroundColor: bg.surfaceDanger },
  bandDangerText: { color: text.danger },

  lineHeader: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: bg.surfaceMuted,
  },
  lineText: { flex: 1, gap: space[1] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  dishName: {
    flex: 1,
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  unitPrice: { color: text.secondary, fontSize: scale.caption.size },
  allergenRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  allergenWho: { color: text.warning, fontSize: scale.caption.size },
  unavailable: { color: text.danger, fontSize: scale.caption.size, fontWeight: scale.label.weight },

  stepperPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: bg.surfaceMuted,
    borderRadius: radius.full,
    paddingHorizontal: space[1],
  },
  stepperTarget: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperCircle: {
    width: STEPPER_CIRCLE,
    height: STEPPER_CIRCLE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.surface,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
  },
  stepperCircleEmphasis: { backgroundColor: action.primaryBg, borderColor: action.primaryBg },
  stepperGlyph: { color: text.link, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  stepperGlyphEmphasis: { color: action.primaryFg },
  quantity: {
    minWidth: space[6],
    textAlign: 'center',
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    fontWeight: scale.bodyStrong.weight,
    fontVariant: ['tabular-nums'],
  },

  lineFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[1],
  },
  removeButton: { minHeight: touchTarget.min, justifyContent: 'center' },
  removeLabel: { color: text.secondary, fontSize: scale.label.size },
  lineTotal: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    fontWeight: scale.bodyStrong.weight,
    fontVariant: ['tabular-nums'],
  },

  footer: {
    padding: layout.gutter,
    gap: space[2],
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
    backgroundColor: bg.surface,
  },
  footerNote: { color: text.secondary, fontSize: scale.caption.size, textAlign: 'center' },
});
