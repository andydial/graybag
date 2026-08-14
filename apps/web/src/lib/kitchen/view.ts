import type {
  KitchenAction,
  KitchenDay,
  KitchenFilters,
  KitchenOrder,
  KitchenPermissions,
  KitchenStatus,
} from './types.js';

/**
 * Everything the kitchen dashboard computes, as pure functions (`E09-04`).
 *
 * No DOM, no fetching, no `Date`. The screen renders what these return, which means the awkward
 * parts — what "partly delivered" means, which actions an order may take, what the production
 * summary says once a filter is applied — are settled here and tested, rather than being decided
 * inside a render function where nobody can see them.
 */

/** How a status is spoken about. Never colour alone — §2.10, and a kitchen is a bad place for it. */
export const STATUS_LABEL: Record<KitchenStatus, string> = {
  paid: 'To make',
  preparing: 'Making',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * Which actions an order may take, straight from `order-lifecycle.md` §4.1.
 *
 * The screen asks this rather than deciding for itself, so a button that cannot work is never
 * drawn. `delivered` is terminal — a delivered order offers nothing, because a goodwill refund
 * afterwards does not un-deliver it (`[OL-04]`) and this screen does not do refunds anyway.
 */
export function allowedActions(status: KitchenStatus, permissions?: KitchenPermissions): KitchenAction[] {
  const byLifecycle: KitchenAction[] =
    status === 'paid' ? ['preparing', 'delivered', 'cancelled']
    : status === 'preparing' ? ['delivered', 'cancelled']
    : [];

  if (!permissions) return byLifecycle;

  // Two independent gates, and both have to pass. The lifecycle says what is *possible*; the
  // grants say what this person may do. Neither implies the other.
  return byLifecycle.filter((action) => {
    if (action === 'cancelled') return permissions.cancelOrders;
    // `preparing` and `delivered` are both handover-side and both ride on mark_delivered.
    return permissions.markDelivered;
  });
}

export function applyFilters(orders: KitchenOrder[], filters: KitchenFilters): KitchenOrder[] {
  return orders.filter(
    (o) =>
      (!filters.schoolId || o.schoolId === filters.schoolId) &&
      (!filters.breakId || o.breakId === filters.breakId) &&
      (!filters.status || o.status === filters.status),
  );
}

export interface ClassGroup {
  key: string;
  schoolId: string;
  schoolName: string;
  breakId: string | null;
  breakLabel: string | null;
  classLabel: string;
  orders: KitchenOrder[];
  /** Excludes cancelled orders: a cancelled lunch is not an undelivered one. */
  deliverable: number;
  delivered: number;
  /** The ids "mark all delivered" would act on — never the cancelled or already-delivered ones. */
  outstandingIds: string[];
}

/**
 * Group into the unit the kitchen physically works in: a school, a break, a class.
 *
 * That is the order the food moves in (`E09-03` groups the packing list the same way), and it is
 * the unit "mark all delivered" acts on — one tap per tray, which is what `E09-05` asks for.
 */
export function groupByClass(orders: KitchenOrder[]): ClassGroup[] {
  const groups = new Map<string, ClassGroup>();

  for (const order of orders) {
    const classLabel = [order.classLabel, order.sectionLabel].filter(Boolean).join('-') || 'No class';
    const key = `${order.schoolId}|${order.breakId ?? ''}|${classLabel}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        schoolId: order.schoolId,
        schoolName: order.schoolName,
        breakId: order.breakId,
        breakLabel: order.breakLabel,
        classLabel,
        orders: [],
        deliverable: 0,
        delivered: 0,
        outstandingIds: [],
      };
      groups.set(key, group);
    }

    group.orders.push(order);
    // A cancelled order is not outstanding and not delivered. Counting it either way makes the
    // "12 of 18" line lie in one direction or the other.
    if (order.status !== 'cancelled') {
      group.deliverable += 1;
      if (order.status === 'delivered') group.delivered += 1;
      else group.outstandingIds.push(order.id);
    }
  }

  // School, then break, then class — the order the food moves, and stable between renders.
  return [...groups.values()].sort(
    (a, b) =>
      a.schoolName.localeCompare(b.schoolName) ||
      (a.breakLabel ?? '').localeCompare(b.breakLabel ?? '') ||
      a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true }),
  );
}

/** One order's worth of a single dish, as the person plating it sees it. */
export interface DishPortion {
  orderId: string;
  recipientName: string;
  schoolName: string;
  classLabel: string;
  breakLabel: string | null;
  quantity: number;
  note: string | null;
  status: KitchenStatus;
}

export interface DishGroup {
  key: string;
  dishId: string;
  dishName: string;
  /** Every portion of this dish, so the block header can say "10 Paneer Wrap". */
  quantity: number;
  portions: DishPortion[];
  /** Portions still to hand over, on orders that are neither delivered nor cancelled. */
  outstandingIds: string[];
}

/**
 * Group by dish rather than by class — the view somebody plating food actually wants.
 *
 * `groupByClass` is the *handover* unit: one tray, one classroom, one trip. This is the
 * **cooking** unit: make ten Paneer Wraps, and here is who each one is for and what they asked
 * for. Same orders, same data, different question — which is why it is a toggle on one screen
 * and not a second page to build, test and teach.
 *
 * Cancelled orders are excluded outright rather than shown struck through. In the class view a
 * cancelled row still matters, because somebody is standing in that classroom expecting a bag.
 * Here the only question is how much food to make, and a cancelled order is not food.
 *
 * Ordered by quantity descending: the biggest batch is the one to start.
 */
export function groupByDish(orders: KitchenOrder[]): DishGroup[] {
  const groups = new Map<string, DishGroup>();

  for (const order of orders) {
    if (order.status === 'cancelled') continue;

    for (const line of order.lines) {
      let group = groups.get(line.dishId);
      if (!group) {
        group = {
          key: line.dishId,
          dishId: line.dishId,
          dishName: line.dishName,
          quantity: 0,
          portions: [],
          outstandingIds: [],
        };
        groups.set(line.dishId, group);
      }

      group.quantity += line.quantity;
      group.portions.push({
        orderId: order.id,
        recipientName: order.recipientName,
        schoolName: order.schoolName,
        classLabel: [order.classLabel, order.sectionLabel].filter(Boolean).join('-') || 'No class',
        breakLabel: order.breakLabel,
        quantity: line.quantity,
        note: line.note,
        status: order.status,
      });

      // An order with two lines of this dish would otherwise be listed twice as outstanding, and
      // "mark all delivered" would send the same id twice. The endpoint is idempotent, but a
      // count that says 11 when there are 10 orders is wrong on the screen before it gets there.
      if (order.status !== 'delivered' && !group.outstandingIds.includes(order.id)) {
        group.outstandingIds.push(order.id);
      }
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.quantity - a.quantity || a.dishName.localeCompare(b.dishName),
  );
}

export type GroupState = 'none' | 'partial' | 'all' | 'empty';

/** Partial is its own state and is never inferred from a colour — the brief's "12 of 18". */
export function groupState(group: ClassGroup): GroupState {
  if (group.deliverable === 0) return 'empty';
  if (group.delivered === 0) return 'none';
  return group.delivered === group.deliverable ? 'all' : 'partial';
}

export function groupProgress(group: ClassGroup): string {
  if (group.deliverable === 0) return 'Nothing to hand over';
  if (group.delivered === group.deliverable) return `All ${group.deliverable} delivered`;
  return `${group.delivered} of ${group.deliverable} delivered`;
}

export interface DishTotal {
  dishId: string;
  dishName: string;
  quantity: number;
}

/**
 * The production summary — "how much do we cook" — over whatever is currently filtered.
 *
 * Recomputed from the visible orders rather than fetched separately, which is the point of
 * folding Cook into this screen: filter to one break and the totals answer the question for that
 * break, with no second screen to keep in step.
 *
 * **Cancelled orders are excluded.** Cooking against a cancelled order is the one arithmetic
 * mistake here that wastes food.
 */
export function productionTotals(orders: KitchenOrder[]): DishTotal[] {
  const totals = new Map<string, DishTotal>();

  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    for (const line of order.lines) {
      const existing = totals.get(line.dishId);
      if (existing) existing.quantity += line.quantity;
      else totals.set(line.dishId, { dishId: line.dishId, dishName: line.dishName, quantity: line.quantity });
    }
  }

  // Biggest batch first — it is what gets started first — and alphabetical within a tie so the
  // list does not reshuffle between renders. Same rule as `packages/shared/src/kitchen/lists.ts`.
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity || a.dishName.localeCompare(b.dishName));
}

export interface DaySummary {
  orders: number;
  items: number;
  delivered: number;
  outstanding: number;
  cancelled: number;
}

export function summarise(orders: KitchenOrder[]): DaySummary {
  return {
    orders: orders.length,
    items: orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((n, o) => n + o.lines.reduce((m, l) => m + l.quantity, 0), 0),
    delivered: orders.filter((o) => o.status === 'delivered').length,
    outstanding: orders.filter((o) => o.status === 'paid' || o.status === 'preparing').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  };
}

/**
 * What the screen is currently showing, as one value it must exhaust.
 *
 * `ux-spec.md` §5.21 is emphatic that emptiness is four different things and a screen that
 * cannot tell them apart lies. That reasoning applies here with more force, not less: a kitchen
 * seeing an empty list at 7am needs to know whether nobody ordered or whether the request
 * failed, and those have opposite responses.
 */
export type BoardState =
  | { kind: 'loading' }
  | { kind: 'data'; groups: ClassGroup[] }
  | { kind: 'empty-day' }
  | { kind: 'empty-filter' }
  | { kind: 'unreachable'; message: string }
  /** N3 — "you can't see this". Never rendered as an empty list, which would read as N1. */
  | { kind: 'forbidden' }
  | { kind: 'stale'; groups: ClassGroup[]; loadedAt: string };

export function boardState(input: {
  day: KitchenDay | null;
  filters: KitchenFilters;
  loading: boolean;
  offline: boolean;
  error: string | null;
}): BoardState {
  if (input.error && !input.day) return { kind: 'unreachable', message: input.error };
  if (input.loading && !input.day) return { kind: 'loading' };
  if (!input.day) return { kind: 'unreachable', message: 'No data yet.' };

  // N3 before everything else. An operator without `orders.view` seeing an empty list would read
  // it as "no orders today" — §5.21's exact warning, and the one with the worst consequence in a
  // kitchen: nobody cooks.
  if (!input.day.permissions.viewOrders) return { kind: 'forbidden' };

  const visible = applyFilters(input.day.orders, input.filters);
  const groups = groupByClass(visible);

  if (input.offline) return { kind: 'stale', groups, loadedAt: input.day.loadedAt };
  if (input.day.orders.length === 0) return { kind: 'empty-day' };
  if (visible.length === 0) return { kind: 'empty-filter' };
  return { kind: 'data', groups };
}

/**
 * Which secondary filters are worth drawing.
 *
 * **A control that cannot change the answer is worse than no control.** With one school in
 * scope, a school filter is a dropdown whose every option returns the same list — it takes up
 * the same room as a real control, invites the same tap, and teaches the operator that the
 * controls here do nothing. Same for a school with a single break.
 *
 * So the bar is built from what is actually on the day, and a kitchen serving one school sees
 * date, status, and nothing else.
 */
export interface FilterOptions {
  schools: { id: string; name: string }[];
  breaks: { id: string; label: string }[];
  showSchools: boolean;
  showBreaks: boolean;
}

export function filterOptions(day: KitchenDay | null): FilterOptions {
  const schools = day?.schools ?? [];
  const breaks = day?.breaks ?? [];
  return {
    schools,
    breaks,
    showSchools: schools.length > 1,
    showBreaks: breaks.length > 1,
  };
}

/**
 * The line above the list: "24 orders · 3 classes · 2 breaks".
 *
 * It answers "does today look right" before anyone reads a single name, which is the question
 * somebody actually has at 7am. An empty screen with four dropdowns answers nothing — it cannot
 * even distinguish "no orders" from "wrong date".
 *
 * Counted over what is *visible*, so it agrees with the list underneath rather than describing a
 * day the filters have hidden.
 */
/**
 * What the collapsed filter line says: the selection, or "All orders".
 *
 * Names the *values* and never the categories — "Lunch break · Amity" rather than
 * "Break: Lunch break · School: Amity". A category label is only useful when you are choosing;
 * once chosen, the value identifies itself and the label is half the line's width spent saying
 * nothing.
 *
 * Order follows the chips, so the line and the expanded rows read the same way round.
 */
export function filterSummary(
  filters: KitchenFilters,
  options: { schools: { id: string; name: string }[]; breaks: { id: string; label: string }[] },
): string {
  const parts: string[] = [];

  const school = options.schools.find((s) => s.id === filters.schoolId);
  if (school) parts.push(school.name);

  const brk = options.breaks.find((b) => b.id === filters.breakId);
  if (brk) parts.push(brk.label);

  if (filters.status) parts.push(STATUS_LABEL[filters.status] ?? filters.status);

  // "All orders" rather than "No filters": it describes what you are looking at, not what you
  // have failed to do. The same reasoning as naming the empty states in §5.21.
  return parts.length === 0 ? 'All orders' : parts.join(' · ');
}

export function countLine(
  orders: KitchenOrder[],
  groups: ClassGroup[],
  /**
   * Named when exactly one school has orders today, and omitted when several do.
   *
   * The school filter is hidden in that case because an inert control is worse than none — but
   * hiding it silently leaves the board unlabelled, and "24 orders" means something different if
   * you did not know you were looking at one school out of three. So the scope moves from a
   * control into the sentence. When several schools have orders the chips are drawn instead, and
   * they say which one is selected, so repeating it here would be noise.
   */
  onlySchoolName?: string | null,
): string {
  if (orders.length === 0) return 'No orders';

  const classes = new Set(groups.map((g) => `${g.schoolId}|${g.classLabel}`)).size;
  const breaks = new Set(orders.map((o) => o.breakId ?? '')).size;

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const parts = [plural(orders.length, 'order'), plural(classes, 'class', 'classes')];
  // A school with no break times is a real case (`break_label_snapshot` is nullable), and
  // "1 break" for a school that has none would be an invented fact.
  if (orders.some((o) => o.breakId)) parts.push(plural(breaks, 'break'));

  return [onlySchoolName, ...parts].filter(Boolean).join(' · ');
}

/**
 * The date, as a kitchen reads it.
 *
 * Weekday first, because "is this today's list" is answered by the day name faster than by the
 * number — and `R7`'s reasoning for the app's cutoff line is the same: a bare date is ambiguous
 * in a way a weekday is not.
 */
export function describeDate(iso: string, today: string): string {
  const relative = relativeDay(iso, today);
  const formatted = new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    // Formatted in UTC because the value was *constructed* in UTC. Mixing the two renders
    // "Wednesday" for a Thursday anywhere east of Greenwich — which is everywhere we operate.
    timeZone: 'UTC',
  });
  return relative ? `${relative} · ${formatted}` : formatted;
}

/** `Today` / `Tomorrow` / `Yesterday`, or null when it is none of them. */
export function relativeDay(iso: string, today: string): string | null {
  if (iso === today) return 'Today';
  if (iso === shiftDate(today, 1)) return 'Tomorrow';
  if (iso === shiftDate(today, -1)) return 'Yesterday';
  return null;
}

/**
 * Move a service date by whole days, staying on `YYYY-MM-DD`.
 *
 * **Built and read entirely in UTC**, and that is not pedantry. The obvious version —
 * `new Date(`${iso}T00:00:00`)`, `setDate(+1)`, `toISOString()` — parses as *local* midnight and
 * then serialises as UTC, so anywhere east of Greenwich the day goes backwards across the
 * conversion. In IST, `shiftDate('2026-08-31', 1)` returned `'2026-08-31'`.
 *
 * A service date is a calendar label, not an instant. It never needs a timezone and must never
 * acquire one — `packages/shared/src/menu/dates.ts` reaches the same conclusion for the menu.
 */
export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}
