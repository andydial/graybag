import type { KitchenAction, KitchenDay, KitchenFilters, KitchenOrder, KitchenStatus } from './types.js';

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
export function allowedActions(status: KitchenStatus): KitchenAction[] {
  switch (status) {
    case 'paid':
      return ['preparing', 'delivered', 'cancelled'];
    case 'preparing':
      return ['delivered', 'cancelled'];
    case 'delivered':
    case 'cancelled':
      return [];
  }
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

  const visible = applyFilters(input.day.orders, input.filters);
  const groups = groupByClass(visible);

  if (input.offline) return { kind: 'stale', groups, loadedAt: input.day.loadedAt };
  if (input.day.orders.length === 0) return { kind: 'empty-day' };
  if (visible.length === 0) return { kind: 'empty-filter' };
  return { kind: 'data', groups };
}
