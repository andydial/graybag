import { StyleSheet, Text, View } from 'react-native';
import { design, menu as menuDomain, money } from '@graybag/shared';

import { BrandPanel, Lockup } from '../components';
import { Button } from '../components/Button';
import { NameCapture } from '../account/NameCapture';
// `R7`: full weekday and month, parsed and formatted in UTC so the rendered day cannot slide.
// Imported rather than copied — two date formatters is how "Wednesday 12 August" and "12/08"
// end up on two screens describing the same lunch. This is the order-detail screen's
// formatter specifically, because order detail is where "View order" goes next and the same
// date must not change shape between the two.
import { formatServiceDateLong } from '../orders/OrderDetailScreen';
import { BrandAction } from './PaymentWaitingScreen';
import { NON_ROUTE_SCREENS } from '../analytics/screens';
import { useScreenView } from '../analytics/useScreenView';

const { bg, text, border, scale, space, radius, layout, borderWidth } = design;

export const ORDER_PLACED_TEST_ID = 'screen-order-placed';

/**
 * Four digits, `docs/order-lifecycle.md` §9.4. Unique per `(school_id, service_date)`.
 */
export const PICKUP_CODE_PATTERN = /^\d{4}$/;

/**
 * The brand. Module-private and deliberately unexported: it is the reason a `PlacedOrder`
 * cannot be written down anywhere except by `placedOrder()` below.
 *
 * A real `Symbol`, not a `declare const`, because it is used as a computed key at run time as
 * well as in the type — a declared-only symbol would be a `ReferenceError` the first time this
 * screen was actually reached.
 */
const SETTLEMENT_CONFIRMED: unique symbol = Symbol('graybag.settlementConfirmed');

/**
 * An order that has **settled**, server-side — the only thing this screen will render.
 *
 * The brand property is the whole mechanism. It makes `{ pickupCode: '4821', … }` a type error
 * wherever a `PlacedOrder` is wanted, so there is no honest way to reach this screen except
 * through `placedOrder()`, and `placedOrder()` will not accept anything but a settled order.
 * `R8` stops being a rule people remember and becomes a rule the compiler holds.
 */
export interface PlacedOrder {
  readonly [SETTLEMENT_CONFIRMED]: true;
  /** Four digits. Allocated on capture (§9.4) — see `placedOrder()`. */
  readonly pickupCode: string;
  /** **`null` means the account holder** and renders as "you". The product is recipient-neutral. */
  readonly recipientName: string | null;
  /** `YYYY-MM-DD`. The calendar date the food is for, never an instant. */
  readonly serviceDate: menuDomain.ServiceDate;
  /** "Lunch break", as the school names it. */
  readonly breakLabel: string;
  readonly itemCount: number;
  /** Integer paise, GST-inclusive — what was actually paid (non-negotiable #3). */
  readonly totalPaise: number;
}

/**
 * What the server says once settlement is confirmed, and the only input `placedOrder()` takes.
 *
 * `status` is the literal `'paid'` rather than an `OrderStatus`, which is what makes
 * `payment_pending` a compile error here instead of a code review comment. There is no
 * widening of this type that is a bug fix.
 */
export interface ConfirmedSettlement {
  /** `order_status` after settlement. The literal, not the enum. */
  status: 'paid';
  /** Four digits, allocated at T5 — **on capture, not at checkout** (§9.4). */
  pickupCode: string;
  recipientName: string | null;
  serviceDate: menuDomain.ServiceDate;
  breakLabel: string;
  itemCount: number;
  totalPaise: number;
}

/**
 * The only way to make a `PlacedOrder`.
 *
 * Two checks, and they are not belt-and-braces on the same thing:
 *
 * **`status === 'paid'`** is the type's job and the runtime check is for the wire — the object
 * arrives as JSON, and a JSON body is `any` no matter what the signature says.
 *
 * **A four-digit pickup code** is a second, independent witness that money moved. §9.4
 * allocates the code *on capture*, precisely so that a code cannot exist for an order nobody
 * paid for. A settled order without one is not a settled order; it is a bug upstream, and it
 * should stop here rather than be shown to a parent who will then quote it at a counter.
 *
 * **Nothing thrown from here contains the code or the name.** A pickup code is not a secret and
 * a child's name is regulated under the DPDP Act (non-negotiable #4); an exception message ends
 * up in a log or in Sentry, so neither goes into one.
 */
export function placedOrder(settlement: ConfirmedSettlement): PlacedOrder {
  if (settlement.status !== 'paid') {
    throw new Error('Not a settled order: only a paid order can be shown as placed (R8).');
  }
  if (!PICKUP_CODE_PATTERN.test(settlement.pickupCode)) {
    throw new Error('Not a settled order: a settled order has a four-digit pickup code (§9.4).');
  }
  if (!Number.isInteger(settlement.totalPaise) || settlement.totalPaise < 0) {
    throw new Error('Total must be a non-negative integer number of paise.');
  }
  if (!Number.isInteger(settlement.itemCount) || settlement.itemCount < 1) {
    throw new Error('A placed order has at least one item.');
  }

  return Object.freeze({
    [SETTLEMENT_CONFIRMED]: true as const,
    pickupCode: settlement.pickupCode,
    recipientName: settlement.recipientName,
    serviceDate: settlement.serviceDate,
    breakLabel: settlement.breakLabel,
    itemCount: settlement.itemCount,
    totalPaise: settlement.totalPaise,
  });
}

export interface OrderPlacedScreenProps {
  /**
   * **Required, and unforgeable.** Not optional, not defaulted, and there is no `pending`
   * sibling — `payment_pending` belongs on `PaymentWaitingScreen` and nowhere else.
   */
  order: PlacedOrder;
  onViewOrder?: () => void;
  onBackToMenu?: () => void;
  testID?: string;
}

/**
 * "Order placed" — `docs/ux-spec.md` §5.13, `E13`.
 *
 * ## Why this file's types look the way they do
 *
 * `R8` and `docs/order-lifecycle.md` §13 say the confirmation screen must be unreachable until
 * settlement is confirmed server-side. That is a **correctness** rule — a tick shown on the
 * strength of the Razorpay sheet is a parent walking to a school gate with an order that does
 * not exist — so it is held by the type system rather than by a convention:
 *
 * 1. `order` is required. There is no default and no loading variant.
 * 2. `PlacedOrder` carries a brand keyed by a module-private symbol, so it cannot be written by
 *    hand — the only expression of that type in the codebase is `placedOrder()`'s return.
 * 3. `placedOrder()` takes `status: 'paid'` as a **literal**, so `'payment_pending'` does not
 *    typecheck, and re-checks it at run time because the value crosses the wire as JSON.
 * 4. The pickup code is checked, because §9.4 allocates it on capture: no capture, no code.
 *
 * The net effect is that "show the confirmation early" is not a mistake somebody can make
 * quickly. They would have to write a cast, and a cast is visible in review.
 *
 * ## The pickup code
 *
 * Four digits are guessable — `[DM-10]` is the standing warning — which is why the line under
 * the panel is not decoration: **staff match the name as well as the code**. It is the control,
 * not a courtesy. Recipient-neutral, because an adult may have ordered their own lunch.
 *
 * The code is never logged. It is not a secret, but it is quotable at a counter, and the name
 * beside it is regulated under the DPDP Act (non-negotiable #4).
 *
 * ## Why the fill is `surfaceBrandStrong`
 *
 * White on `bg.surfaceBrand` is 3.85 — large text only. This screen carries a 12-word sentence
 * about staff checks and a metadata line, both of which are body copy. `bg.surfaceBrandStrong`
 * is the same green as `action.primaryBg`, adds no colour, and white on it is 5.19. See the
 * longer note in `PaymentWaitingScreen`.
 */
export function OrderPlacedScreen({
  order,
  onViewOrder,
  onBackToMenu,
  testID = ORDER_PLACED_TEST_ID,
}: OrderPlacedScreenProps) {
  useScreenView(NON_ROUTE_SCREENS.orderPlaced);

  const whose = order.recipientName === null ? 'Your' : `${order.recipientName}’s`;
  const theirName = order.recipientName === null ? 'your name' : `${order.recipientName}’s name`;
  const items = order.itemCount === 1 ? '1 item' : `${order.itemCount} items`;

  return (
    <BrandPanel radius={radius.none} style={styles.panel} testID={testID}>
      <View style={styles.body}>
        <Lockup height={space[10]} white />

        <View style={styles.copy}>
          <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
            Order placed
          </Text>
          {/*
            Who and when, in that order and in one sentence, because that is the pair a parent
            checks first — and "on the kitchen's list" is the fact that has just become true.
          */}
          <Text style={styles.lead} testID={`${testID}-who-when`}>
            {whose} lunch is on the kitchen’s list for {formatServiceDateLong(order.serviceDate)}.
          </Text>
          <Text style={styles.meta} testID={`${testID}-meta`}>
            {order.breakLabel} · {items} · {money.formatPaise(order.totalPaise)}
          </Text>
        </View>

        <View style={styles.code}>
          <Text style={styles.codeLabel}>Pickup code</Text>
          <Text
            style={styles.codeDigits}
            testID={`${testID}-pickup-code`}
            // Spaced out for the screen reader, which would otherwise read 4821 as "four
            // thousand eight hundred and twenty-one" — not a thing anyone can quote at a gate.
            accessibilityLabel={`Pickup code, ${order.pickupCode.split('').join(' ')}`}
          >
            {order.pickupCode}
          </Text>
        </View>

        {/*
          `[DM-10]`. Four digits are guessable, so the name is the second factor and this line
          is the one that says the check exists.
        */}
        <Text style={styles.footnote} testID={`${testID}-name-check`}>
          Staff will match {theirName} as well as the code.
        </Text>

        {/*
          `P18` / `E05-39`: the account holder's own name, asked **here** rather than at
          checkout. Andy settled it — checkout is the most fragile screen in the funnel, and
          nothing breaks without a name, so there is no reason to risk the payment moment for a
          field we can collect thirty seconds later.

          Mounted unconditionally on purpose. `NameCapture` reads the profile and renders
          nothing unless there is no name and no record of having asked, so there is no version
          of this that forgets the "never asked twice" half of the rule. It sits below the
          pickup code because the code is what the parent came here for.
        */}
        <NameCapture testID={`${testID}-name`} />
      </View>

      <View style={styles.actions}>
        {onViewOrder === undefined ? null : (
          <Button
            label="View order"
            variant="secondary"
            onPress={onViewOrder}
            testID={`${testID}-view-order`}
          />
        )}
        {onBackToMenu === undefined ? null : (
          <BrandAction
            label="Back to menu"
            onPress={onBackToMenu}
            testID={`${testID}-back-to-menu`}
          />
        )}
      </View>
    </BrandPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    justifyContent: 'space-between',
    padding: layout.gutter,
    // Not the `BrandPanel` default green — 3.85 there is illegal for the body copy this screen
    // carries, 5.19 here. See the note at the top of the file.
    backgroundColor: bg.surfaceBrandStrong,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4] },
  copy: { alignItems: 'center', gap: space[2] },
  title: {
    color: text.onBrand,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    letterSpacing: scale.h1.size * scale.h1.tracking,
    textAlign: 'center',
  },
  lead: {
    color: text.onBrand,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    textAlign: 'center',
  },
  meta: {
    color: text.onBrand,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  code: {
    alignItems: 'center',
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    borderRadius: radius.xl,
    borderWidth: borderWidth.emphasis,
    borderStyle: 'dashed',
    // `border.accent` is the brand's own "soft separator" — decorative by definition, which is
    // what this outline is. It never bounds a control, so its 1.27-on-white ceiling is not in
    // play here.
    borderColor: border.accent,
    // Opaque, and the same green as the screen: the pattern behind it would otherwise sit
    // under the one string on this screen that gets read aloud at a counter.
    backgroundColor: bg.surfaceBrandStrong,
  },
  codeLabel: {
    color: text.onBrand,
    fontSize: scale.overline.size,
    lineHeight: scale.overline.lineHeight,
    fontWeight: scale.overline.weight,
    // `tracking` is em, as `css.ts` emits it; React Native's `letterSpacing` is points.
    letterSpacing: scale.overline.size * scale.overline.tracking,
    textTransform: 'uppercase',
  },
  codeDigits: {
    color: text.onBrand,
    fontSize: scale.display.size,
    lineHeight: scale.display.lineHeight,
    fontWeight: scale.display.weight,
    fontVariant: ['tabular-nums'],
  },
  footnote: {
    color: text.onBrand,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    textAlign: 'center',
  },

  actions: { gap: space[3] },
});
