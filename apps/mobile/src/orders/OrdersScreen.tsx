import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { design, menu as menuDomain, money } from '@graybag/shared';

import {
  BrandHeader,
  EmptyState,
  ErrorState,
  PatternTile,
  SectionHeading,
  Skeleton,
} from '../components';

const {
  bg, text, border, status, scale, space, layout, radius, borderWidth, touchTarget,
} = design;

/**
 * The orders list (`docs/ux-spec.md` §5.14), built to `docs/prototype/graybag-prototype.html`
 * at `#orders,signedin`.
 *
 * **It holds no data of its own.** `packages/shared/src/api` has no `fetchOrders` yet — `E06`
 * has not landed — so the orders arrive as a prop and default to none. That is deliberate:
 * inventing a client-side read against `order_group` would put a second, unreviewed
 * authorization path in the app (non-negotiable #1 and #2), and approximating the data would
 * put dates and amounts on screen that no server ever said. With no orders the screen renders
 * its empty state, which is the honest answer to "what have I ordered" for a build that cannot
 * ask.
 *
 * **Every state is a prop, not an inference.** §5.21 is the reason: *empty*, *we could not
 * ask*, *you are not signed in* and *this is what we had last time* are four different truths,
 * and a screen that derives them from "the array is empty" collapses all four into the one that
 * is least likely to be true. `state`, `signedOut` and `stale` keep them separate and make each
 * one renderable in a test.
 *
 * **Every amount comes from `money.formatPaise`** — `design/type.ts` forbids assembling a
 * currency string by hand — and every colour, size and gap is a token, because
 * `config/eslint-design-system.js` fails the build on a literal.
 */
export function OrdersScreen({
  orders = [],
  state = 'ready',
  access = 'pending',
  stale = false,
  today = todayInIndia(),
  onSelectOrder,
  onSignIn,
  onBrowseMenu,
  onRetry,
  testID = 'screen-orders',
}: {
  /** What the server said. Absent until `E06` gives `api/` something to ask. */
  orders?: OrderSummary[];
  state?: 'loading' | 'ready' | 'error';
  /** See `session/audience.ts`. `pending` shows neither the prompt nor the list. */
  access?: import('../session/audience').Access;
  /** These orders came from cache and no live read succeeded — N4 in §5.21. */
  stale?: boolean;
  /** `YYYY-MM-DD` in IST. Injectable so the upcoming/past split is testable. */
  today?: string;
  onSelectOrder?: (orderGroupId: string) => void;
  onSignIn?: () => void;
  onBrowseMenu?: () => void;
  onRetry?: () => void;
  testID?: string;
}) {
  /**
   * Signed out is checked before `state`, because a read that was never attempted did not
   * fail. §5.21's Orders row is explicit that this is a prompt and not an empty list — and
   * `AR7` is why it is not a wall either: the tab opens, and signing in is an invitation with
   * a reason attached.
   */
  if (access === 'pending') return null;
  if (access === 'signedOut') {
    return (
      <Frame testID={testID}>
        <Prompt
          testID="orders-signed-out"
          title="Your orders live here"
          body="Sign in to see what you've ordered and what's coming up."
          actionLabel="Sign in"
          onAction={onSignIn}
        />
      </Frame>
    );
  }

  if (state === 'error') {
    return (
      <Frame testID={testID}>
        <ErrorState
          testID="orders-error"
          body="We could not load your orders. Check your connection and try again."
          // `ErrorState` requires a retry because an error with no way forward is a dead end.
          // The no-op stands in only until a caller wires the refetch — which it must.
          onRetry={onRetry ?? (() => {})}
        />
      </Frame>
    );
  }

  /**
   * Skeletons are for a **first** load (`S5`). Loading over orders we already hold is a
   * refresh, and replacing real rows with grey boxes would make a background refetch look
   * like the history had been lost.
   */
  if (state === 'loading' && orders.length === 0) {
    return (
      <Frame testID={testID}>
        <Title />
        <View style={styles.rows} testID="orders-loading">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      </Frame>
    );
  }

  if (orders.length === 0) {
    return (
      <Frame testID={testID}>
        <Prompt
          testID="orders-empty"
          title="No orders yet"
          body="When you place your first order it'll appear here, with its pickup code."
          actionLabel="Browse the menu"
          onAction={onBrowseMenu}
        />
      </Frame>
    );
  }

  const { upcoming, past } = splitOrders(orders, today);

  return (
    <Frame testID={testID} scroll>
      {/* A quiet line, never a blocking banner: we are holding real orders, and saying where
          they came from is honest where hiding them would be worse (`P8`, `MC3`, §5.21 N4). */}
      {stale ? (
        <View style={styles.gutter}>
          <Text style={styles.stale} accessibilityLiveRegion="polite" testID="orders-stale">
            Offline — showing the orders you last loaded.
          </Text>
        </View>
      ) : null}

      <Title />

      {upcoming.length > 0 ? (
        <>
          <View style={styles.gutter}>
            <SectionHeading>Upcoming</SectionHeading>
          </View>
          <View style={styles.rows}>
            {upcoming.map((order) => (
              <OrderRow key={order.orderGroupId} order={order} onSelect={onSelectOrder} />
            ))}
          </View>
        </>
      ) : null}

      {past.length > 0 ? (
        <>
          <View style={styles.gutter}>
            <SectionHeading>Past</SectionHeading>
          </View>
          <View style={styles.rows}>
            {past.map((order) => (
              <OrderRow key={order.orderGroupId} order={order} onSelect={onSelectOrder} />
            ))}
          </View>
        </>
      ) : null}
    </Frame>
  );
}

/**
 * One order group, as a parent thinks of it: a day, a person, and what it cost.
 *
 * **Defined here rather than in `packages/shared`** because nothing server-side produces it
 * yet. When `E06` adds `api.fetchOrders`, its return type is the one that should survive and
 * this alias should be deleted rather than kept in step by hand.
 */
export interface OrderSummary {
  /** `order_group.id` — one payment, one child, one service date. */
  orderGroupId: string;
  /** `YYYY-MM-DD`, the calendar date the food is for. Never an instant (`menu/dates.ts`). */
  serviceDate: menuDomain.ServiceDate;
  /**
   * Who it is for. **`null` means the account holder**, and renders as "You" — the product is
   * recipient-neutral, an adult may order for themselves, and a row that insisted on a child's
   * name would have nothing to show.
   */
  recipientName: string | null;
  itemCount: number;
  /** Integer paise, GST inclusive — what was actually paid (non-negotiable #3). */
  totalPaise: number;
  status: OrderStatus;
}

/** `order_status` in `supabase/migrations/0001_initial_schema.sql`, exhaustively. */
export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

/**
 * The word and the colour for each status.
 *
 * **The word is what carries the meaning; the colour only reinforces it.** §2.10 of the design
 * system and the `status` role map both say so, and the reason is arithmetic: green-good /
 * red-bad is the worst possible pair for deuteranopia, which is roughly 6% of Indian men. Every
 * row therefore reads its status out loud, in the row's accessibility label as well as on
 * screen.
 *
 * All seven enum members are here rather than only the four the prototype draws. A status the
 * server can legitimately return and the client has no case for renders as a blank on the right
 * of the row, which reads as "nothing has happened yet" — the §5.21 mistake in miniature.
 */
const STATUS: Record<OrderStatus, { label: string; tone: keyof typeof TONE }> = {
  draft: { label: 'Draft', tone: 'muted' },
  pending_payment: { label: 'Payment pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  preparing: { label: 'With the kitchen', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  refunded: { label: 'Refunded', tone: 'warning' },
};

/** An order is done with when it has been delivered, cancelled or refunded. */
const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'delivered',
  'cancelled',
  'refunded',
]);

/**
 * Split the list into what is still coming and what is history, and order each the way it is
 * read: soonest first going forward, most recent first going back.
 *
 * **Both halves of the test matter.** A date alone puts this morning's delivered lunch under
 * "Upcoming" all afternoon; a status alone puts a paid order from last week there forever. An
 * order is upcoming when it is for today or later **and** something is still to happen to it.
 *
 * The comparison is string-wise on `YYYY-MM-DD`, which is chronological, and constructs no
 * `Date` — `menu/dates.ts` explains at length why deriving a calendar day from an instant is
 * how the same bug gets written twice.
 */
export function splitOrders(
  orders: readonly OrderSummary[],
  today: string,
): { upcoming: OrderSummary[]; past: OrderSummary[] } {
  const upcoming: OrderSummary[] = [];
  const past: OrderSummary[] = [];

  for (const order of orders) {
    if (order.serviceDate >= today && !TERMINAL.has(order.status)) upcoming.push(order);
    else past.push(order);
  }

  // Ties break on the id so the order of two orders for the same day is stable across
  // renders rather than dependent on however the server happened to sort them.
  const by = (direction: 1 | -1) => (a: OrderSummary, b: OrderSummary) =>
    a.serviceDate === b.serviceDate
      ? a.orderGroupId.localeCompare(b.orderGroupId)
      : direction * a.serviceDate.localeCompare(b.serviceDate);

  return { upcoming: upcoming.sort(by(1)), past: past.sort(by(-1)) };
}

/**
 * `2026-08-12` → `Wed 12 Aug`.
 *
 * Short forms, unlike the cutoff copy in the cart, which `R7` requires to spell the weekday and
 * month out: this is a scannable list of days a parent already knows about, not a statement
 * about when ordering closes. The weekday is present precisely so "12 Aug" cannot be read a day
 * wrong at a glance.
 *
 * Built from the parsed parts at UTC midnight and formatted in UTC, so the rendered day is the
 * service date itself and cannot slide across the device's timezone. `en-IN` puts a comma after
 * the weekday; it is stripped rather than the whole string being assembled by hand, so the day
 * and month names still come from the platform.
 */
export function formatOrderDate(serviceDate: menuDomain.ServiceDate): string {
  if (!menuDomain.isServiceDate(serviceDate)) return serviceDate;
  const { y, m, d } = menuDomain.parseServiceDate(serviceDate);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
    .replace(/,/g, '');
}

/**
 * Today's calendar date in India, as `YYYY-MM-DD`.
 *
 * IST is a fixed +05:30 with no daylight saving and has never been anything else, so the shift
 * is arithmetic rather than a timezone database lookup. That matters on device: Hermes' `Intl`
 * is a thin platform shim on Android and `timeZone` support there is not something to bet the
 * upcoming/past split on.
 */
export function todayInIndia(now: Date = new Date()): string {
  const IST_OFFSET_MINUTES = 330;
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** `2 items · ₹162.76`. */
function orderMeta(order: OrderSummary): string {
  const items = `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`;
  return `${items} · ${money.formatPaise(order.totalPaise)}`;
}

/** Who the food is for. A row with no recipient is the account holder's own order. */
function recipientLabel(order: OrderSummary): string {
  return order.recipientName ?? 'You';
}

/**
 * A row.
 *
 * **Not `ListRow`**, and the reason is the status word. `ListRow`'s pressable branch sets one
 * `accessibilityLabel` built from its title and subtitle, and an `accessible` container merges
 * its children — so anything in `trailing` stops being announced. The status is the only part
 * of this row carrying colour, which makes it exactly the part that must survive as a word
 * (§2.10). The geometry, tokens and hairline are `ListRow`'s; only the label is different.
 */
function OrderRow({
  order,
  onSelect,
}: {
  order: OrderSummary;
  // `| undefined` spelled out because `exactOptionalPropertyTypes` is on: passing a prop
  // through that may be absent is a different type from omitting it.
  onSelect?: ((orderGroupId: string) => void) | undefined;
}) {
  const { label, tone } = STATUS[order.status];
  const title = `${formatOrderDate(order.serviceDate)} · ${recipientLabel(order)}`;

  return (
    <Pressable
      testID={`order-row-${order.orderGroupId}`}
      accessibilityRole="button"
      // One stop for the whole row. Read as four separate nodes, a list of six orders is
      // twenty-four swipes for the same information.
      accessibilityLabel={`${title}, ${orderMeta(order)}, ${label}`}
      onPress={() => onSelect?.(order.orderGroupId)}
      // Nothing is disabled when `onSelect` is absent: the row is still the parent's record of
      // the order, and greying out four rows to say "detail isn't built" would be worse.
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowMeta}>{orderMeta(order)}</Text>
      </View>
      <Text style={[styles.statusWord, TONE[tone]]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A skeleton row, boxed exactly like a real one.
 *
 * `S5`: a skeleton that is roughly the right size is worse than none, because the content
 * jumps when it lands and a jump is the thing skeletons exist to prevent. These heights are
 * the line heights of the two texts above them.
 */
function SkeletonRow() {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Skeleton width="55%" height={scale.bodyStrong.lineHeight} />
        <Skeleton width="35%" height={scale.bodySm.lineHeight} />
      </View>
      <Skeleton width={space[16]} height={scale.label.lineHeight} />
    </View>
  );
}

/**
 * The brand-panel empty and signed-out compositions.
 *
 * The tile is `PatternTile` rather than a grey circle, for the same reason a dish with no
 * photograph gets one: a branded absence says "nothing here yet", a grey one says "broken".
 */
function Prompt({
  testID,
  title,
  body,
  actionLabel,
  onAction,
}: {
  testID: string;
  title: string;
  body: string;
  actionLabel: string;
  onAction?: (() => void) | undefined;
}) {
  return (
    <View style={styles.prompt}>
      <View style={styles.art}>
        <PatternTile />
      </View>
      {/*
        The action appears only when something can be done with it. `EmptyState` draws the
        button when both the label and the handler are present, so an unwired screen offers a
        sentence rather than a button that does nothing.
      */}
      <EmptyState
        testID={testID}
        title={title}
        body={body}
        {...(onAction === undefined ? {} : { actionLabel, onAction })}
      />
    </View>
  );
}

function Title() {
  return (
    <View style={styles.gutter}>
      <Text style={styles.title} accessibilityRole="header">
        Your orders
      </Text>
    </View>
  );
}

/**
 * Header, canvas, and the scroll container when there is a list.
 *
 * `screen-orders` is on **every** branch. The route's identity is the route, not whether it
 * happens to have anything on it — navigation asserts against this id, and a testID that
 * appears only in the happy state is a test that passes for the wrong reason.
 */
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
      <BrandHeader />
      {scroll ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </View>
  );
}

/**
 * Status colours, as semantic roles.
 *
 * `text.tertiary` for the settled states rather than a grey of its own: delivered and cancelled
 * are both "nothing more will happen", and the prototype's muted grey is what that role is for.
 * Amber for refunded because a refund is a thing that happened, not a failure — the same
 * reasoning that makes an allergen flag amber rather than red.
 */
const TONE = StyleSheet.create({
  success: { color: status.success },
  warning: { color: text.warning },
  info: { color: status.info },
  muted: { color: text.tertiary },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  scroll: { flex: 1 },
  // No horizontal padding: the rows are full-bleed so their hairlines reach both edges, as the
  // prototype draws them. Everything that is not a row gets `gutter`.
  content: { flexGrow: 1, paddingBottom: space[8] },
  gutter: { paddingHorizontal: layout.gutter },

  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    marginBottom: space[2],
  },
  stale: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    marginBottom: space[2],
  },

  rows: { backgroundColor: bg.surface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touchTarget.min,
    paddingVertical: layout.listRowPaddingY,
    paddingHorizontal: layout.gutter,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: border.subtle,
  },
  rowPressed: { backgroundColor: bg.surfaceMuted },
  rowText: { flex: 1, gap: space[1] },
  rowTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  rowMeta: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    // Tabular figures so a column of totals lines up rather than shimmering as digits change.
    fontVariant: ['tabular-nums'],
  },
  statusWord: {
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
    textAlign: 'right',
  },

  prompt: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4] },
  art: {
    width: space[16],
    height: space[16],
    borderRadius: radius.full,
    overflow: 'hidden',
  },
});
