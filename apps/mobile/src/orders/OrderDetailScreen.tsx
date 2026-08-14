import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { design, menu as menuDomain, money } from '@graybag/shared';

import { Button, EmptyState, ErrorState, SectionHeading, Skeleton } from '../components';
import { DishImage } from '../components/DishImage';
import { OrderForBlock } from '../cart/OrderForBlock';
import { formatOrderDate, type OrderStatus } from './OrdersScreen';

const {
  bg, text, border, status: statusColor, scale, space, layout, radius, borderWidth,
} = design;

/**
 * Order detail (`docs/ux-spec.md` §5.15), built to `docs/prototype/graybag-prototype.html`
 * at `#orderdetail,signedin`.
 *
 * **It holds no data of its own, and that is deliberate.** `packages/shared/src/api` has no
 * `fetchOrder` — `E06` has not landed — so the order arrives as a prop and defaults to
 * `null`. Reading `order_group` straight from the Supabase client here would put a second,
 * unreviewed authorization path in the app (non-negotiables #1 and #2), and approximating
 * the row would put a pickup code, a status and an amount on screen that no server ever
 * said. With nothing given, this screen says it has nothing.
 *
 * **No back bar.** `RootNavigator.withScreenFrame(..., { back: true })` draws it once at the
 * registration site, for the same reason the safe-area inset is applied there: a route
 * cannot then be added without a way out of it. A second chevron here would be two.
 *
 * ## The three rules this screen exists to get right
 *
 * **Cancel is offered only when it is genuinely possible, and refused out loud when it is
 * not.** `docs/order-lifecycle.md` §9.2 E5 / T10: a customer may cancel a `paid` order while
 * `now() < cutoff_at − customer_cancellation_cutoff_minutes`, and never once the kitchen has
 * it. When that window has closed the button does **not** quietly disappear — a control that
 * vanishes reads as a feature we never built, and the parent's next move is a support ticket
 * asking where it went. It is replaced by the reason and a route to a human.
 *
 * **The pickup code exists only once money is captured** (§9.4, `I11`). It is allocated at
 * capture, not at checkout, so before then there is nothing to show — and a placeholder,
 * dashes or a spinner in its place would be a code a parent could try to quote at a counter.
 * `null` renders no heading at all.
 *
 * **A recipient's name is regulated data** (DPDP, non-negotiable #4). It is displayed,
 * because the whole point of the screen is whose lunch this is — and it is never logged,
 * never sent anywhere, and never put in a message. There is no `console` call in this file
 * and none may be added.
 *
 * Every amount comes from `money.formatPaise` over integer paise (#3); every colour, size,
 * gap and radius is a token, because `config/eslint-design-system.js` fails the build on a
 * literal.
 */
export function OrderDetailScreen({
  order = null,
  state = 'ready',
  cancelling = false,
  stale = false,
  now = new Date(),
  onCancel,
  onRetry,
  onBackToMenu,
  onContactSupport,
  testID = 'screen-order-detail',
}: OrderDetailScreenProps = {}) {
  /**
   * `screen-order-detail` is on **every** branch. The route's identity is the route, not
   * whether the read happened to succeed — navigation asserts against this id, and a testID
   * that appears only in the happy state is a test passing for the wrong reason.
   */
  if (state === 'error') {
    return (
      <Frame testID={testID}>
        <ErrorState
          testID={`${testID}-error`}
          body="We could not load this order. Check your connection and try again."
          // `ErrorState` requires a retry because an error with no way forward is a dead end.
          // The no-op stands in only until a caller wires the refetch — which it must.
          onRetry={onRetry ?? (() => {})}
        />
      </Frame>
    );
  }

  /**
   * Skeletons are for a **first** load (`S5`). Loading over an order we already hold is a
   * refresh, and replacing it with grey boxes would make a background refetch look like the
   * order had been lost.
   */
  if (order === null && state === 'loading') {
    return (
      <Frame testID={testID}>
        <LoadingBody testID={testID} />
      </Frame>
    );
  }

  /**
   * Nothing to show. §5.21 N1 wording — the request is simply not answerable in this build,
   * so the screen offers the menu rather than a retry it cannot honour or an error that
   * blames the connection.
   */
  if (order === null) {
    return (
      <Frame testID={testID}>
        <EmptyState
          testID={`${testID}-empty`}
          title="We can't show this order"
          body="We don't have the details for it on this device. Your orders list still has it."
          {...(onBackToMenu === undefined
            ? {}
            : { actionLabel: 'Back to menu', onAction: onBackToMenu })}
        />
      </Frame>
    );
  }

  const cancel = cancelAvailability(order, now);
  const paid = PAID_STATUSES.has(order.status);

  return (
    <Frame testID={testID} scroll>
      {/* A quiet line, never a blocking banner: this is a real order and saying where it came
          from is honest where hiding it would be worse (§5.21 N4, `MC3`). */}
      {stale ? (
        <Text style={styles.stale} accessibilityLiveRegion="polite" testID={`${testID}-stale`}>
          Offline — showing this order as you last loaded it.
        </Text>
      ) : null}

      <OrderForBlock
        testID={`${testID}-for`}
        orderFor={{
          // `null` is the account holder ordering for themselves — the product is
          // recipient-neutral and an order with no child is not an order with no owner.
          childName: order.recipientName ?? 'You',
          classLabel: order.classLabel,
          sectionLabel: order.sectionLabel,
          schoolName: order.schoolName,
          serviceDate: formatServiceDateLong(order.serviceDate),
          breakLabel: order.breakLabel,
        }}
      />

      {/*
        §9.4: the code is allocated **on capture**. Before that there is no code, and this
        renders nothing rather than a placeholder somebody could try to quote at a counter.
      */}
      {order.pickupCode === null ? null : (
        <View
          style={styles.pickup}
          testID={`${testID}-pickup-code`}
          accessible
          // Digit by digit: "four thousand eight hundred and twenty-one" is not a code you can
          // repeat at a counter.
          accessibilityLabel={`Pickup code ${order.pickupCode.split('').join(' ')}`}
        >
          <SectionHeading>{`Pickup code ${order.pickupCode}`}</SectionHeading>
        </View>
      )}

      <Timeline steps={buildTimeline(order)} testID={`${testID}-timeline`} />

      <View style={styles.lines}>
        {order.lines.map((line) => (
          <LineRow key={line.key} line={line} />
        ))}
      </View>

      <View style={styles.block}>
        <Totals totals={order.totals} paid={paid} testID={`${testID}-totals`} />
      </View>

      {order.refund === 'none' ? null : (
        <View style={styles.block}>
          <RefundNotice
            refund={order.refund}
            amountPaise={order.totals.totalPaise}
            testID={`${testID}-refund`}
            {...(onContactSupport === undefined ? {} : { onContactSupport })}
          />
        </View>
      )}

      {/*
        The cancel affordance, in whichever of its three forms is true. `none` — an order
        already cancelled — draws nothing, because the refund notice above has already said
        what happened and a refusal to cancel a cancelled order is noise.
      */}
      {cancel.kind === 'available' ? (
        <View style={styles.block}>
          <Button
            label="Cancel this order"
            variant="secondary"
            testID={`${testID}-cancel`}
            loading={cancelling}
            // Same call as the cart's "Place order": an unwired handler disables the control
            // rather than pretending to work.
            disabled={onCancel === undefined}
            onPress={() => onCancel?.()}
          />
          <Text style={styles.note} testID={`${testID}-cancel-closes`}>
            {`Cancelling closes at ${cancel.deadline}.`}
          </Text>
          {cancelling ? (
            <Text
              style={styles.note}
              accessibilityLiveRegion="polite"
              testID={`${testID}-cancelling`}
            >
              Cancelling your order and starting your refund…
            </Text>
          ) : null}
        </View>
      ) : null}

      {cancel.kind === 'closed' ? (
        <View style={styles.block}>
          <View style={styles.notice} testID={`${testID}-cancel`}>
            <Text style={styles.noticeTitle}>This order can no longer be cancelled</Text>
            <Text style={styles.noticeBody} testID={`${testID}-cancel-reason`}>
              {cancel.reason}
            </Text>
            {/* Never a dead end. The window closing is not the end of the conversation —
                a kitchen or an admin can still cancel (T11, T12), and this is how a parent
                reaches one. */}
            {onContactSupport === undefined ? null : (
              <Button
                label="Contact us"
                variant="secondary"
                testID={`${testID}-cancel-support`}
                onPress={onContactSupport}
              />
            )}
          </View>
        </View>
      ) : null}

      <Text style={styles.footnote} testID={`${testID}-invoice`}>
        {invoiceFootnote(order.invoiceNumber)}
      </Text>
    </Frame>
  );
}

export interface OrderDetailScreenProps {
  /**
   * What the server said. Absent until `E06` gives `api/` something to ask, and `null` is a
   * state this screen renders rather than a case it crashes on.
   */
  order?: OrderDetail | null;
  state?: 'loading' | 'ready' | 'error';
  /** A cancellation is in flight — the button keeps its label and gains an indicator (`S5`). */
  cancelling?: boolean;
  /** This came from cache and no live read succeeded — N4 in §5.21. */
  stale?: boolean;
  /**
   * Injectable clock. The cancellation window is a comparison against wall time, and a test
   * that cannot move the clock cannot assert either side of it.
   *
   * The client's answer is **courtesy, never the guard** (`R7`): the server re-evaluates E5
   * inside the transaction, and a cancel offered here can still be refused there.
   */
  now?: Date;
  onCancel?: () => void;
  onRetry?: () => void;
  onBackToMenu?: () => void;
  /** Where a parent goes when cancelling has closed, or a refund has failed (§10.12). */
  onContactSupport?: () => void;
  testID?: string;
}

/**
 * One order group, as the detail screen needs it.
 *
 * **Defined here rather than in `packages/shared`** because nothing server-side produces it
 * yet. When `E06` adds `api.fetchOrder`, its return type is the one that should survive and
 * this interface should be deleted rather than kept in step by hand.
 */
export interface OrderDetail {
  /** `order_group.id` — one payment, one recipient, one service date (`AR8`, `[DM-01]`). */
  orderGroupId: string;
  status: OrderStatus;
  /** `YYYY-MM-DD`, the calendar day the food is for. Never an instant (`menu/dates.ts`). */
  serviceDate: menuDomain.ServiceDate;
  /** **`null` means the account holder**, and renders as "You". */
  recipientName: string | null;
  classLabel: string | null;
  sectionLabel: string | null;
  schoolName: string;
  /** Absent until the break is resolvable (`E05-29`). Never invented — §5.21. */
  breakLabel: string | null;
  lines: readonly OrderDetailLine[];
  /**
   * **The server's numbers, not a recomputation.** This is a settled order: the amounts on it
   * are the amounts on the invoice, and a client that re-derived them from the lines would
   * eventually disagree with the invoice by a paise — which is a support ticket rather than a
   * rounding curiosity. The cart computes; the receipt reports.
   */
  totals: money.GstBreakdown;
  /** Four digits, allocated **on capture** (§9.4, `I11`). `null` before then, never a stand-in. */
  pickupCode: string | null;
  /** ISO 8601 instants. `null` where the step has not happened. */
  placedAt: string | null;
  paidAt: string | null;
  preparingAt: string | null;
  deliveredAt: string | null;
  /**
   * `cutoff_at − customer_cancellation_cutoff_minutes` as an ISO instant — E5's boundary,
   * computed server-side from the order's own `config_snapshot` so that a kitchen changing
   * its cutoff tonight cannot retroactively move this order's (§9, `C9`).
   *
   * `null` means we do not know it. That renders as "we can't tell", never as "you can".
   */
  cancellationClosesAt: string | null;
  /** `customer_cancellation_allowed` from the resolved config — the other half of T10's guard. */
  cancellationAllowed: boolean;
  refund: RefundState;
  /** `null` until a capture exists — `I6`/`M3`: a failed payment must not burn an invoice number. */
  invoiceNumber: string | null;
}

export interface OrderDetailLine {
  /** `order_line.id`. */
  key: string;
  name: string;
  quantity: number;
  /** Integer paise, **GST-exclusive** — menu prices are exclusive and 5% is added at checkout. */
  unitPricePaise: number;
  imageUri?: string | null;
}

/** Where the money is, once an order has been cancelled. `refund.status`, §7.3. */
export type RefundState = 'none' | 'pending' | 'completed' | 'failed';

/** The statuses at or past capture — the ones for which "Total paid" is a true label. */
const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'paid',
  'preparing',
  'delivered',
  'cancelled',
  'refunded',
]);

/* -------------------------------------------------------------------------- cancellation */

/**
 * Whether this order can be cancelled from the app, and if not, **why not in words**.
 *
 * There is no fourth answer where the button is simply absent. §5.15 is explicit — "not
 * cancellable (with the reason, not a hidden button)" — and the reasoning is the same as
 * §5.21's: a control that disappears and a control that never existed look identical, and the
 * user's conclusion is that we did not build it.
 *
 * `none` is the one case with nothing to say: an order that is already cancelled cannot be
 * cancelled again, and the refund notice above it has already explained the situation.
 */
export type CancelAvailability =
  | { kind: 'available'; deadline: string }
  | { kind: 'closed'; reason: string }
  | { kind: 'none' };

export function cancelAvailability(order: OrderDetail, now: Date): CancelAvailability {
  if (order.status === 'cancelled' || order.status === 'refunded') return { kind: 'none' };

  if (order.status === 'delivered') {
    return { kind: 'closed', reason: 'This order has already been delivered.' };
  }

  // T11 and T12: past `paid`, only a kitchen or an admin may cancel, and they are not
  // cutoff-bound. So the honest answer is not "too late" — it is "not from here".
  if (order.status === 'preparing') {
    return {
      kind: 'closed',
      reason:
        "The kitchen has already started preparing this order, so it can't be cancelled from " +
        'the app. Get in touch and we will see what can be done.',
    };
  }

  if (order.status === 'draft' || order.status === 'pending_payment') {
    return {
      kind: 'closed',
      reason:
        "This order hasn't been paid for yet, so there is nothing to cancel — it will close " +
        'by itself if the payment does not come through.',
    };
  }

  /**
   * Unknown is not "yes". §5.21 again: offering a cancel we cannot evaluate is a promise we
   * may not be able to keep, and the server would refuse it anyway (E5 is re-checked in the
   * transaction). Saying we cannot tell, and routing to a human, is the truthful version.
   *
   * **Checked before `cancellationAllowed`, and the order is the point** — `E06-45`.
   * `cancellation_allowed` coalesces a missing key to `false` (`0052`), which collapses "the
   * snapshot says no" and "the snapshot does not say" into one value, and they deserve
   * different sentences. The other way round, an order with an empty `config_snapshot` was
   * told "this kitchen doesn't take cancellations" — a claim about a kitchen that nothing in
   * the data supports. `cancel_order` checks them in this same order, so the sentence a
   * parent gets from the server matches the one the screen already showed them.
   */
  if (order.cancellationClosesAt === null) {
    return {
      kind: 'closed',
      reason:
        "We can't tell when cancelling closes for this order, so we are not going to guess. " +
        'Get in touch and we will check.',
    };
  }

  if (!order.cancellationAllowed) {
    return {
      kind: 'closed',
      reason:
        "This kitchen doesn't take cancellations through the app. Get in touch and we will " +
        'sort it out with them.',
    };
  }

  const closesAt = Date.parse(order.cancellationClosesAt);
  if (Number.isNaN(closesAt)) {
    return {
      kind: 'closed',
      reason:
        "We can't tell when cancelling closes for this order, so we are not going to guess. " +
        'Get in touch and we will check.',
    };
  }

  const deadline = formatDeadline(order.cancellationClosesAt);

  // `C1`: the comparison is strict. Exactly at the boundary, cancellation is **closed**.
  if (now.getTime() >= closesAt) {
    return {
      kind: 'closed',
      reason: `Cancelling closed at ${deadline}. Get in touch if something is wrong and we will sort it out.`,
    };
  }

  return { kind: 'available', deadline };
}

/* ---------------------------------------------------------------------------- timeline */

export type TimelineStepState = 'done' | 'current' | 'todo';

export interface TimelineStep {
  key: string;
  title: string;
  detail: string | null;
  state: TimelineStepState;
  /** A step that is not simply progress — a failed refund. Amber, and it says so in words. */
  tone?: 'attention';
}

/** `order_status`, ranked along the live path. Cancelled and refunded leave it (§4.1). */
const LIVE_RANK: Record<OrderStatus, number> = {
  draft: 0,
  pending_payment: 1,
  paid: 2,
  preparing: 3,
  delivered: 4,
  // Off the live path — `buildTimeline` branches before these are read.
  cancelled: -1,
  refunded: -1,
};

/**
 * The `order_status` progression, as four steps a parent recognises.
 *
 * **The current step is the first one that is not done**, which is why a `paid` order shows
 * the ring on "With the kitchen" — that is what is happening next, and the prototype draws it
 * exactly so. The alternative, putting the ring on the last completed step, leaves a paid
 * order looking finished.
 *
 * **A cancelled order gets a different tail, not a greyed-out one.** Drawing "With the
 * kitchen" and "Delivered" as pending under a cancelled order says food is still coming.
 */
export function buildTimeline(order: OrderDetail): TimelineStep[] {
  const placed: TimelineStep = {
    key: 'placed',
    title: 'Order placed',
    detail: formatMoment(order.placedAt),
    state: 'done',
  };

  const delivered = order.recipientName === null ? 'Delivered' : `Delivered to ${order.recipientName}`;

  if (order.status === 'cancelled' || order.status === 'refunded') {
    const steps: TimelineStep[] = [
      placed,
      {
        key: 'payment',
        title: 'Payment confirmed',
        detail: formatMoment(order.paidAt),
        // An unpaid order can be cancelled too (T6). Its payment step never happened, and
        // marking it done would be a claim that money moved.
        state: order.paidAt === null ? 'todo' : 'done',
      },
      { key: 'cancelled', title: 'Cancelled', detail: null, state: 'done' },
    ];

    if (order.refund === 'pending') {
      steps.push({
        key: 'refund',
        title: 'Refund on its way',
        detail: 'Refunds usually reach your account within 5–7 working days.',
        state: 'current',
      });
    } else if (order.refund === 'completed') {
      steps.push({ key: 'refund', title: 'Refunded', detail: null, state: 'done' });
    } else if (order.refund === 'failed') {
      // §10.12: the order stays `cancelled` and never reaches `refunded`, which is correct —
      // the customer has not had their money back, and the timeline must not say they have.
      steps.push({
        key: 'refund',
        title: "Refund hasn't gone through yet",
        detail: 'We are on it — see below.',
        state: 'current',
        tone: 'attention',
      });
    }

    return steps;
  }

  const rank = LIVE_RANK[order.status];

  return [
    placed,
    {
      key: 'payment',
      title: 'Payment confirmed',
      detail:
        rank >= 2
          ? formatMoment(order.paidAt)
          : rank === 1
            ? 'Waiting for your payment to be confirmed.'
            : null,
      state: rank >= 2 ? 'done' : rank === 1 ? 'current' : 'todo',
    },
    {
      key: 'kitchen',
      title: 'With the kitchen',
      detail:
        rank >= 4
          ? formatMoment(order.preparingAt)
          : rank === 3
            ? 'Being prepared now.'
            : rank === 2
              ? `Prepared on ${formatOrderDate(order.serviceDate)}.`
              : null,
      state: rank >= 4 ? 'done' : rank >= 2 ? 'current' : 'todo',
    },
    {
      key: 'delivered',
      title: delivered,
      detail: rank >= 4 ? formatMoment(order.deliveredAt) : null,
      state: rank >= 4 ? 'done' : 'todo',
    },
  ];
}

/**
 * The timeline.
 *
 * **Every step says its state out loud.** §2.10 — a filled dot, a ring and a hollow grey
 * circle are three shades of the same shape, and to a screen reader they are nothing at all.
 * The accessibility label carries "done", "happening now" or "still to come", so the progress
 * survives without sight and without colour vision.
 */
function Timeline({ steps, testID }: { steps: readonly TimelineStep[]; testID: string }) {
  return (
    // No gap: the connector between two dots *is* the gap, and a second one would break it.
    <View testID={testID}>
      {steps.map((step, index) => (
        <View
          key={step.key}
          style={styles.step}
          accessible
          accessibilityLabel={`${step.title}${step.detail === null ? '' : `, ${step.detail}`}, ${STATE_WORD[step.state]}`}
          testID={`${testID}-${step.key}`}
        >
          <View style={styles.rail}>
            <View
              style={[
                styles.dot,
                step.state === 'done' && styles.dotDone,
                step.state === 'current' && styles.dotCurrent,
                step.state === 'current' && step.tone === 'attention' && styles.dotAttention,
              ]}
            >
              {step.state === 'done' ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            {index === steps.length - 1 ? null : <View style={styles.connector} />}
          </View>

          <View style={styles.stepText}>
            <Text style={[styles.stepTitle, step.state === 'todo' && styles.stepTitleTodo]}>
              {step.title}
            </Text>
            {step.detail === null ? null : <Text style={styles.stepDetail}>{step.detail}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

/** What each step state is called when it is read rather than seen. */
const STATE_WORD: Record<TimelineStepState, string> = {
  done: 'done',
  current: 'happening now',
  todo: 'still to come',
};

/* ------------------------------------------------------------------------------- pieces */

function LineRow({ line }: { line: OrderDetailLine }) {
  return (
    <View style={styles.line} testID={`order-line-${line.key}`}>
      <DishImage
        uri={line.imageUri ?? null}
        size={space[12]}
        recyclingKey={line.key}
        testID={`order-line-${line.key}-image`}
      />
      <View style={styles.lineText}>
        <Text style={styles.lineName}>{line.name}</Text>
        <Text style={styles.lineMeta}>
          {`${line.quantity} × ${money.formatPaise(line.unitPricePaise)}`}
        </Text>
      </View>
      <Text style={styles.lineTotal}>
        {money.formatPaise(line.unitPricePaise * line.quantity)}
      </Text>
    </View>
  );
}

/**
 * Subtotal · CGST 2.5% · SGST 2.5% · Total — `M2`, `SC2`, and the same shape the cart shows,
 * so a parent comparing the two is comparing like with like.
 *
 * **Not `CartTotals`**, and the difference is one word: on a settled order the last row is
 * "Total paid", which is a statement about money that has moved, and on an unpaid one it is
 * "Total", which is not. A receipt that says "paid" over an order at `pending_payment` is the
 * §5.21 mistake with a currency symbol on it.
 */
function Totals({
  totals,
  paid,
  testID,
}: {
  totals: money.GstBreakdown;
  paid: boolean;
  testID: string;
}) {
  return (
    <View style={styles.totals} testID={testID}>
      <TotalRow label="Subtotal" value={totals.taxablePaise} testID={`${testID}-subtotal`} />
      <TotalRow label="CGST 2.5%" value={totals.cgstPaise} testID={`${testID}-cgst`} />
      <TotalRow label="SGST 2.5%" value={totals.sgstPaise} testID={`${testID}-sgst`} />
      <TotalRow
        label={paid ? 'Total paid' : 'Total'}
        value={totals.totalPaise}
        testID={`${testID}-total`}
        emphasis
      />
    </View>
  );
}

function TotalRow({
  label,
  value,
  testID,
  emphasis = false,
}: {
  label: string;
  value: number;
  testID: string;
  emphasis?: boolean;
}) {
  return (
    <View style={[styles.totalRow, emphasis && styles.grandRow]}>
      <Text style={emphasis ? styles.grandLabel : styles.totalLabel}>{label}</Text>
      <Text style={emphasis ? styles.grandValue : styles.totalValue} testID={testID}>
        {money.formatPaise(value)}
      </Text>
    </View>
  );
}

/**
 * Where the money is.
 *
 * The failed case is §10.12's, and the copy is chosen against what actually happened: the
 * refund row is terminal at `failed`, an admin raises a **new** refund, and the order stays
 * `cancelled`. So the true sentence is "we are on it", not "it failed" — the parent has not
 * lost anything and has nothing to do, but they must not be left to discover a missing credit
 * on a statement in a fortnight.
 */
function RefundNotice({
  refund,
  amountPaise,
  onContactSupport,
  testID,
}: {
  // `none` is excluded at the type level rather than handled with a branch that renders
  // nothing: an order with no refund has no notice, and the caller is the one place that
  // knows it.
  refund: Exclude<RefundState, 'none'>;
  amountPaise: number;
  onContactSupport?: (() => void) | undefined;
  testID: string;
}) {
  const amount = money.formatPaise(amountPaise);

  const copy: Record<Exclude<RefundState, 'none'>, { title: string; body: string }> = {
    pending: {
      title: 'Your refund is on its way',
      body: `We have sent ${amount} back to the way you paid. Refunds usually take 5–7 working days to appear.`,
    },
    completed: {
      title: 'Refunded',
      body: `${amount} has gone back to the way you paid.`,
    },
    failed: {
      title: "Your refund hasn't reached you yet",
      body: `Your ${amount} is not lost — the transfer did not go through and we are on it. We will send it again and email you when it lands.`,
    },
  };

  const { title, body } = copy[refund];

  return (
    <View style={[styles.notice, refund === 'failed' && styles.noticeAttention]} testID={testID}>
      {/* The word carries the meaning; the amber only reinforces it (§2.10). */}
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      {refund === 'failed' && onContactSupport !== undefined ? (
        <Button
          label="Contact us"
          variant="secondary"
          testID={`${testID}-support`}
          onPress={onContactSupport}
        />
      ) : null}
    </View>
  );
}

/**
 * The skeleton, boxed like the real thing.
 *
 * `S5`: a skeleton that is roughly the right size is worse than none, because the content
 * jumps when it lands and a jump is what skeletons exist to prevent. These heights are the
 * line heights of the texts they stand in for.
 */
function LoadingBody({ testID }: { testID: string }) {
  return (
    <View style={styles.loading} testID={`${testID}-loading`}>
      <Skeleton width="100%" height={space[16]} />
      <Skeleton width="55%" height={scale.h3.lineHeight} />
      <Skeleton width="80%" height={scale.body.lineHeight} />
      <Skeleton width="80%" height={scale.body.lineHeight} />
      <Skeleton width="65%" height={scale.body.lineHeight} />
    </View>
  );
}

/* ------------------------------------------------------------------------------ helpers */

/**
 * `2026-08-12` → `Tuesday 12 August`.
 *
 * Spelled out, unlike the orders list's `Wed 12 Aug`: this is the one screen stating which
 * day a specific child's food arrives, and `R7`'s reasoning about ambiguous dates applies for
 * the same reason it applies to a cutoff.
 *
 * Built from the parsed parts at UTC midnight and formatted in UTC, so the rendered day is
 * the service date itself and cannot slide across the device's timezone.
 */
export function formatServiceDateLong(serviceDate: menuDomain.ServiceDate): string {
  if (!menuDomain.isServiceDate(serviceDate)) return serviceDate;
  const { y, m, d } = menuDomain.parseServiceDate(serviceDate);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
    .replace(/,/g, '');
}

/**
 * IST is a fixed +05:30 with no daylight saving and has been since 1945.
 *
 * The shift is therefore arithmetic rather than a timezone-database lookup, and that matters
 * on device: Hermes' `Intl` is a thin platform shim on Android and `timeZone` support there is
 * not something to bet a delivery time on. Everything below shifts the instant and then
 * formats **in UTC**, which is the same trick `todayInIndia` uses and for the same reason.
 *
 * `C3` says not to hard-code `+05:30` for cutoff *arithmetic* — that is server-side, where the
 * named zone is resolved from config. This is display of an instant the server already
 * decided, in the one state v1 serves (`M2`: Mohali only).
 */
const IST_OFFSET_MINUTES = 330;
const SCHOOL_TIME_ZONE = 'Asia/Kolkata';

function inIndia(iso: string): Date | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + IST_OFFSET_MINUTES * 60_000);
}

/** `en-IN` puts a narrow no-break space before "pm". Normalise it, or a test cannot say so. */
const tidy = (value: string) => value.replace(/\s+/g, ' ').replace(/,/g, '').trim();

function timeInIndia(shifted: Date): string {
  return tidy(
    shifted.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    }),
  ).toUpperCase();
}

/**
 * An instant that has already happened → `10 Aug, 9:14 PM`.
 *
 * 12-hour, because `R7`'s own worked example is 12-hour and one screen with two clock formats
 * on it is a screen somebody misreads.
 */
export function formatMoment(iso: string | null): string | null {
  if (iso === null) return null;
  const shifted = inIndia(iso);
  if (shifted === null) return null;

  const day = tidy(
    shifted.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  );
  return `${day}, ${timeInIndia(shifted)}`;
}

/**
 * A deadline → `12:00 AM on Tuesday 12 August`, plus ` IST` for a device that is not on
 * India time.
 *
 * **Written in full, always** (`R7`). "Cancelling closed at 00:00" is ambiguous about which
 * midnight and reads a whole day wrong — `C5` is precisely that mistake, and the prototype's
 * own copy makes it. The weekday is there so the date cannot be misread at a glance.
 *
 * **The zone is shown only when it differs from the device's** (`C4`), so the common case
 * stays short and a parent in London still gets it right. If the device will not say what
 * zone it is in, the zone is shown — an unnecessary "IST" is harmless, a missing one is not.
 */
export function formatDeadline(iso: string, deviceTimeZone = resolveDeviceTimeZone()): string {
  const shifted = inIndia(iso);
  if (shifted === null) return iso;

  const day = tidy(
    shifted.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }),
  );

  const zone = deviceTimeZone === SCHOOL_TIME_ZONE ? '' : ' IST';
  return `${timeInIndia(shifted)}${zone} on ${day}`;
}

function resolveDeviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // Hermes without full `Intl` — say "IST" rather than guess that the device is on it.
    return null;
  }
}

/**
 * The invoice footnote.
 *
 * `M2`/`R11`: one state, so 5% is always CGST 2.5% + SGST 2.5% and there is no IGST line to
 * write. `I6` is why the number can be absent — no capture, no invoice — and saying so beats
 * an empty "Invoice ·" that reads like a missing field.
 */
export function invoiceFootnote(invoiceNumber: string | null): string {
  const gst = 'GST 5% (CGST 2.5% + SGST 2.5%) · Mohali, Punjab';
  return invoiceNumber === null
    ? `${gst}. Your invoice appears here once the payment is confirmed.`
    : `Invoice ${invoiceNumber} · ${gst}`;
}

/** Header-less canvas — the back bar belongs to the navigator. */
function Frame({
  children,
  testID,
  scroll = false,
}: {
  children: React.ReactNode;
  testID: string;
  scroll?: boolean;
}) {
  return (
    <View style={styles.screen} testID={testID}>
      {scroll ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.centred}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  scroll: { flex: 1 },
  // One gutter for the whole screen, unlike the orders list: there is no full-bleed row here,
  // because the items are a card on the canvas rather than a tappable list.
  content: { flexGrow: 1, paddingHorizontal: layout.gutter, paddingBottom: space[8], gap: space[4] },
  centred: { flex: 1, justifyContent: 'center' },
  /** A group of things that belong together — a control and the sentence explaining it. */
  block: { gap: space[2] },

  stale: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },

  pickup: { marginTop: space[2] },

  step: { flexDirection: 'row', gap: space[3] },
  rail: { alignItems: 'center' },
  dot: {
    width: space[5],
    height: space[5],
    borderRadius: radius.full,
    borderWidth: borderWidth.emphasis,
    borderColor: border.subtle,
    backgroundColor: bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: statusColor.success, borderColor: statusColor.success },
  dotCurrent: { borderColor: statusColor.success },
  dotAttention: { borderColor: statusColor.warning },
  tick: { color: text.onBrand, fontSize: scale.caption.size, fontWeight: scale.label.weight },
  connector: {
    flex: 1,
    width: borderWidth.emphasis,
    backgroundColor: border.subtle,
    marginVertical: space[1],
  },
  stepText: { flex: 1, paddingBottom: space[5], gap: space[1] },
  stepTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  stepTitleTodo: { color: text.tertiary },
  stepDetail: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },

  lines: { backgroundColor: bg.surface, borderRadius: radius.lg, overflow: 'hidden' },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: layout.cardPadding,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: border.subtle,
  },
  lineText: { flex: 1, gap: space[1] },
  lineName: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  lineMeta: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontVariant: ['tabular-nums'],
  },
  lineTotal: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    fontWeight: scale.bodyStrong.weight,
    fontVariant: ['tabular-nums'],
  },

  totals: { gap: space[1] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  grandRow: {
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
    paddingTop: space[3],
    marginTop: space[2],
  },
  totalLabel: { color: text.secondary, fontSize: scale.body.size },
  // Tabular figures so the column of amounts lines up rather than shimmering as digits change.
  totalValue: { color: text.secondary, fontSize: scale.body.size, fontVariant: ['tabular-nums'] },
  grandLabel: { color: text.primary, fontSize: scale.h3.size, fontWeight: scale.h3.weight },
  grandValue: {
    color: text.primary,
    fontSize: scale.h3.size,
    fontWeight: scale.h3.weight,
    fontVariant: ['tabular-nums'],
  },

  notice: {
    backgroundColor: bg.surface,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    borderRadius: radius.lg,
    padding: layout.cardPadding,
    gap: space[2],
    alignItems: 'flex-start',
  },
  noticeAttention: { backgroundColor: bg.surfaceWarning, borderColor: border.subtle },
  noticeTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  noticeBody: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  note: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
  footnote: {
    color: text.tertiary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    marginTop: space[2],
  },

  loading: { padding: layout.gutter, gap: space[3] },
});
