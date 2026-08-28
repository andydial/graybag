/**
 * What today looks like, for the person who opens the back office first — `E10-67`.
 *
 * `/dashboard` was a launcher: fourteen cards, each a link with a one-line description. That was
 * the right thing to build for `E10-43`, when the complaint was *"I need to find and paste URL
 * endpoints"* — and it is no longer the question anyone opens it with. The prototype's Today is a
 * **status page**: what is blocking orders, what today has taken, what needs a person, and what
 * the kitchen is doing right now. The sidebar has been the way to navigate since `E10-55`; a
 * second navigation underneath it is a screen spent saying nothing.
 *
 * ## Everything here is derived, and nothing here is authoritative
 *
 * Every number below is computed from a read some other screen already makes, against data RLS
 * has already scoped. Nothing on this page is a new source of truth, and nothing on it is a
 * control — it is a place to look, and every line says where to go and fix the thing it names.
 *
 * ## A number that could not be read is never rendered as zero
 *
 * This is the whole reason `Panel` exists rather than a plain `number`. This page is assembled
 * from six or seven independent reads, each behind a different grant, and a kitchen operator will
 * legitimately be unable to read most of them. `ux-spec` §5.21: an unknown must never render as a
 * known, and "₹0 today" is the single worst way for that rule to be broken here — it is a
 * sentence somebody would act on.
 *
 * So a panel is either readable with a value, or unreadable with the reason, and the page renders
 * the reason.
 */
import type { api } from '@graybag/shared';

import type { SchoolMenuRow } from './catalogue-view.js';
import type { SchoolReadiness } from './school-readiness.js';

/** Readable with a value, or unreadable with a reason. Never a zero standing in for either. */
export type Panel<T> = { readable: true; value: T } | { readable: false; why: string };

export const readable = <T>(value: T): Panel<T> => ({ readable: true, value });
export const unreadable = <T>(why: string): Panel<T> => ({ readable: false, why });

/* ------------------------------------------------------------------ orders today */

export interface OrdersToday {
  total: number;
  /** Only the statuses the kitchen deals in. `pending_payment` and `draft` are not orders yet. */
  byStatus: Record<string, number>;
  /** Cancelled, counted separately because it is the one status that is not a meal to make. */
  cancelled: number;
}

/**
 * Today's order count, from the **kitchen** read.
 *
 * Deliberately not from `fetchAdminOrders`: that one selects `total_paise` and its siblings, and
 * `orders.view_financials` is a separate grant from `orders.view` (`D3`, `E09-09`). Counting
 * orders is not a money question, so it is answered by the read that carries no money — which
 * means a kitchen operator sees this card and a card they may not see stays absent rather than
 * empty.
 */
export function ordersToday(orders: api.ApiKitchenOrder[]): OrdersToday {
  const byStatus: Record<string, number> = {};
  let cancelled = 0;
  for (const order of orders) {
    byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
    if (order.status === 'cancelled') cancelled += 1;
  }
  return { total: orders.length, byStatus, cancelled };
}

/* ------------------------------------------------------------------ revenue today */

export interface RevenueToday {
  grossPaise: number;
  refundedPaise: number;
  netPaise: number;
  cancelled: number;
}

/**
 * Today's money, over the orders this account may read.
 *
 * Cancelled and refunded orders are excluded from gross and counted separately — the same rule
 * `totalsFor` applies on `/orders`, restated here rather than imported so the two cannot drift
 * apart silently. A cancelled order is not revenue, and counting it would overstate the day to
 * exactly the person who reads this to answer "what did we take".
 *
 * ## What this does NOT do, and why it says so on screen
 *
 * The prototype's card reads *"Excludes pack redemptions — that money came in when the pack was
 * sold"*, and **this cannot do that yet.** A meal paid from a pack is recorded in
 * `meal_pack_redemption`, whose only read policy is `meal_pack_redemption_read_own` (`0068`) —
 * a back-office account cannot read it at all. An embed would come back empty and this would
 * report "0 paid with a pack", which is an unknown rendering as a known on a money figure.
 *
 * So the card states what it counts and names what it cannot separate. `E21-63` is the fix: a
 * back-office read of redemptions, which is a policy and therefore a migration.
 */
export function revenueToday(orders: api.AdminOrder[]): RevenueToday {
  let grossPaise = 0;
  let refundedPaise = 0;
  let cancelled = 0;

  for (const order of orders) {
    if (order.status === 'cancelled' || order.status === 'refunded') cancelled += 1;
    else grossPaise += order.totalPaise;
    refundedPaise += order.refundedPaise;
  }

  return { grossPaise, refundedPaise, netPaise: grossPaise - refundedPaise, cancelled };
}

/* ------------------------------------------------------------------ packs */

export interface PacksToday {
  packsSold: number;
  collectedPaise: number;
  /**
   * Meals **sold**, not meals outstanding.
   *
   * `sold × mealsCount` is how many meals have been paid for. It is not how many are left, because
   * subtracting redemptions needs `meal_pack_redemption`, which no back-office account can read.
   * The packs screen called this same number "meals outstanding", which is exact only while no
   * meal has ever been eaten — true today, because packs are dark on production, and wrong the
   * first day they are not. Corrected in both places rather than copied into a second one.
   */
  mealsSold: number;
  liveOffers: number;
}

export function packsToday(
  offers: api.AdminPackOffer[],
  sold: Record<string, number>,
): PacksToday {
  let packsSold = 0;
  let collectedPaise = 0;
  let mealsSold = 0;

  for (const offer of offers) {
    const n = sold[offer.id] ?? 0;
    packsSold += n;
    // The offer's current price, which is the honest approximation available here and not the
    // same thing as what each pack was actually sold for: price is stamped onto the pack at sale
    // (`0068`), and an offer edited since would give a different answer. Reading the stamped
    // prices means reading `meal_pack`, which is `read_own`. Named on screen.
    collectedPaise += n * offer.netPricePaise;
    mealsSold += n * offer.mealsCount;
  }

  return {
    packsSold,
    collectedPaise,
    mealsSold,
    liveOffers: offers.filter((o) => o.isActive).length,
  };
}

/* ------------------------------------------------------------------ what blocks an order */

export interface BlockingDishes {
  /** Dishes a parent can see and cannot understand. */
  count: number;
  /** A few names, so the banner is about something rather than about a number. */
  names: string[];
  /** Schools whose live menu carries at least one of them. */
  schools: string[];
}

/**
 * Dishes on a **live** menu with no veg / non-veg / egg marking.
 *
 * The prototype leads Today with this, and it is the right thing to lead with: it is the one
 * catalogue fault a parent meets directly. `[DM-17]` left `food_type` nullable because the Bubble
 * source had no such field, so every imported dish starts here — this is not a hypothetical.
 *
 * **Live menus only.** An unmarked dish on a draft menu is a task; an unmarked dish a parent can
 * put in a cart is a defect, and a banner that cannot tell them apart is a banner that reads as
 * noise by the second week.
 *
 * Deduped by dish, because one dish on three schools' menus is one thing to fix.
 */
export function dishesBlockingOrders(
  rows: SchoolMenuRow[],
  dishes: api.AdminDish[],
): BlockingDishes {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const found = new Map<string, string>();
  const schools = new Set<string>();

  for (const row of rows) {
    const menu = row.live?.menu;
    if (!menu) continue;
    for (const item of menu.items) {
      if (!item.isActive) continue;
      const dish = byId.get(item.dishId);
      // A retired dish still has its menu row, and `is_active` on the dish is the catalogue-wide
      // switch — it wins. Fixing a dish nobody is offered is busywork.
      if (!dish || !dish.isActive || dish.foodType !== null) continue;
      found.set(dish.id, dish.name);
      schools.add(row.school.name);
    }
  }

  return { count: found.size, names: [...found.values()].sort(), schools: [...schools].sort() };
}

/* ------------------------------------------------------------------ needs you */

export interface AttentionItem {
  key: string;
  /** One sentence, saying what is wrong and what it stops. */
  text: string;
  fix: { label: string; href: string } | null;
}

/**
 * The things that need a person, in the order they block money.
 *
 * A school that cannot take an order comes before a dish that cannot be understood, which comes
 * before a school that cannot be sent its report. Each item names **what it stops**, not what is
 * missing: "has no break windows" is a fact about a database, and "cannot take an order" is the
 * consequence somebody would act on.
 *
 * `readiness` already decides what blocks and what merely lacks — `blocking: false` on the report
 * contact is its judgement, made once, and this reads it rather than making a second one.
 */
export function attention(
  schools: SchoolReadiness[],
  blocking: BlockingDishes,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const school of schools) {
    if (school.blockers.length === 0) continue;
    const first = school.blockers[0]!;
    items.push({
      key: `school:${school.school.id}`,
      text:
        `${school.school.name} cannot take an order — ${first.detail}` +
        (school.blockers.length > 1 ? `, and ${school.blockers.length - 1} more` : ''),
      fix: first.fix,
    });
  }

  if (blocking.count > 0) {
    items.push({
      key: 'dishes:food-type',
      text:
        `${blocking.count} dish${blocking.count === 1 ? '' : 'es'} on a live menu ` +
        `${blocking.count === 1 ? 'has' : 'have'} no veg or non-veg marking, so a parent cannot ` +
        `tell what they are ordering`,
      fix: { label: 'Fix in Dishes', href: '/admin/dishes?type=unset' },
    });
  }

  // Non-blocking last, and only once nothing blocking is left — otherwise a missing report email
  // sits beside a school that cannot trade, at the same weight.
  for (const school of schools) {
    const gaps = school.gates.filter((g) => !g.blocking && g.state !== 'ok');
    for (const gap of gaps) {
      items.push({
        key: `gap:${school.school.id}:${gap.key}`,
        text: `${school.school.name} — ${gap.detail}`,
        fix: gap.fix,
      });
    }
  }

  return items;
}

/* ------------------------------------------------------------------ the board */

export interface BoardRow {
  id: string;
  recipientName: string;
  classLabel: string | null;
  schoolName: string;
  breakLabel: string | null;
  items: number;
  status: string;
  /** `null` when this account may not see money — never `0`, which is a real total. */
  totalPaise: number | null;
}

/**
 * Today's orders as one scannable list.
 *
 * Two reads are joined here on purpose, and the seam is `D3`'s. `fetchKitchenOrders` carries the
 * child, the break and the lines and **no money column at all**; `fetchAdminOrders` carries the
 * money. Merging them client-side keeps the kitchen path unable to leak a total by mistake — the
 * columns are simply not in the query it sends — which is the property `admin-orders.ts` argues
 * for at length and which one shared function with a flag would give away.
 *
 * `money` is `null` for an account without `orders.view_financials`, and every row's
 * `totalPaise` is then `null`. Not `0`: zero is a real total, and a free meal and a hidden price
 * must not read the same.
 */
export function boardRows(
  kitchen: api.ApiKitchenOrder[],
  money: api.AdminOrder[] | null,
): BoardRow[] {
  const totals = new Map((money ?? []).map((o) => [o.id, o.totalPaise]));

  return kitchen.map((order) => ({
    id: order.id,
    recipientName: order.recipientName,
    classLabel: order.classLabel,
    schoolName: order.schoolName,
    breakLabel: order.breakLabel,
    items: order.lines.reduce((n, line) => n + line.quantity, 0),
    status: order.status,
    totalPaise: money === null ? null : totals.get(order.id) ?? null,
  }));
}

/**
 * School, then break, then class — the order somebody physically works through a day.
 *
 * Not by status: a list that reorders itself as orders are marked delivered is a list you lose
 * your place in, and this screen is read while doing something else.
 */
export function sortBoard(rows: BoardRow[]): BoardRow[] {
  // An unlabelled break sorts **last** within its school rather than first. Empty string would
  // sort before every real label, putting the one row nobody can place at the top of the list.
  const label = (v: string | null) => (v === null || v === '' ? '\uffff' : v);

  return [...rows].sort(
    (a, b) =>
      a.schoolName.localeCompare(b.schoolName) ||
      label(a.breakLabel).localeCompare(label(b.breakLabel)) ||
      label(a.classLabel).localeCompare(label(b.classLabel)) ||
      a.recipientName.localeCompare(b.recipientName),
  );
}
