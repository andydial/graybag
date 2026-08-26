/**
 * The three reads behind the growth report — `E11-08`.
 *
 * ## The column lists are the privacy control
 *
 * `recipient_read_admin` grants a platform admin every column on every child. This module selects
 * **three** of them, none of which identifies anybody, and the types have nowhere to put a name.
 * Non-negotiable #4 is not "do not display a child's name" — it is do not put it where it can be
 * displayed, logged or exported by accident, and the narrowest possible `select` is how that is
 * enforced at the boundary rather than in a template.
 *
 * The same reasoning as `REPORT_ORDER_COLUMNS` in `admin-reports.ts`, which is why that screen
 * could not show a child if somebody tried.
 *
 * ## Everything is scoped by RLS, not here
 *
 * All three need `users.view` at platform scope. A caller without it gets empty arrays rather than
 * an error, which is the same ambiguity `/reports` has and is handled the same way: the screen says
 * both possibilities rather than picking one.
 */
import { runQuery } from './client.js';

/**
 * No name, no phone. **The email is read**, and only for one purpose — `E11-15`.
 *
 * Andy: *"Where I need to act on an individual — a parent stuck with no children — show me their
 * email address and nothing about the child."* That is the whole justification: an address is
 * what makes a stuck parent actionable, and it is the only personal field on this screen.
 *
 * It is still never shown beside anything about a child, because the screen has nothing about a
 * child to show — `GROWTH_CHILD_COLUMNS` is an id, a school and a timestamp.
 */
export const GROWTH_USER_COLUMNS = 'id,email,created_at';

/** No name, no class, no section — see the header. */
export const GROWTH_CHILD_COLUMNS = 'id,school_id,created_at';

export const GROWTH_LINK_COLUMNS = 'user_id,recipient_id';

/**
 * What the funnel needs from an order — `E11-15`.
 *
 * `customer_user_id` so a parent can be counted once, `placed_at` so "first" and "in the last
 * seven days" mean something, `status` so an unpaid order is not a conversion, and the total for
 * revenue. **No recipient, class or section** — the same rule as every other report here.
 *
 * `service_date` joined the list in `E11-17`. Reports counts money by the day the food is served,
 * and the usage block now sits on the same screen. Counting parents by the day they *paid*
 * instead would put two order counts beside each other that disagree by whatever crossed a
 * midnight, and a screen that contradicts itself is read as broken long before anybody works out
 * which half was right. It is a date on an order — no child field is added here, and none may be.
 */
export const GROWTH_ORDER_COLUMNS =
  'customer_user_id,placed_at,service_date,status,total_paise,school_id';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface GrowthOrder {
  customerUserId: string;
  placedAt: string;
  /** The day the food is served. The basis Reports counts on — see `GROWTH_ORDER_COLUMNS`. */
  serviceDate: string;
  status: string;
  totalPaise: number;
  schoolId: string;
}

export interface GrowthData {
  users: { id: string; email: string | null; createdAt: string }[];
  children: { id: string; schoolId: string; createdAt: string }[];
  links: { userId: string; recipientId: string }[];
  orders: GrowthOrder[];
}

/* =============================================================================
   The bounded read behind Reports — `E11-19`
   ============================================================================= */

/**
 * The most rows any single bounded read here will return before it refuses to answer.
 *
 * Not a page size and not a silent cap: a read that comes back holding exactly this many rows
 * throws. Its filter was supposed to bound it far below this, so hitting it means the bound is
 * wrong, and the alternative to throwing is returning a truncated answer that renders as a
 * confident, smaller number.
 *
 * 20,000 is roughly a year of orders at the volume Andy is planning for, so a correct read cannot
 * reach it and a broken one will.
 */
const READ_CAP = 20_000;

/** A bounded read that fails loudly rather than truncating. See `READ_CAP`. */
async function capped<T>(
  what: string,
  build: (t: import('./client.js').ApiTransport) => import('./client.js').SelectBuilder,
): Promise<T[]> {
  const rows = await runQuery<T>((t) => build(t).limit(READ_CAP));
  if (rows.length >= READ_CAP) {
    throw new Error(
      `The ${what} read returned ${rows.length} rows, which is its cap. It is filtered by date ` +
        `and should be nowhere near this, so the filter is not doing what it should. Refusing to ` +
        `report a truncated total — see E11-19.`,
    );
  }
  return rows;
}

/** IST is `+05:30`, fixed — no daylight saving, one zone. */
const IST = '+05:30';

/**
 * A day either side of the range, as instants.
 *
 * **The server bound is deliberately a superset and the client bound is authoritative.** Every
 * date on these screens is an IST calendar date while `created_at` and `placed_at` are instants,
 * and `funnelForCohort` already re-filters precisely by IST day. Widening by a day means an
 * arithmetic slip here can only ever cost a few extra rows, where narrowing would silently drop
 * a real registration from the cohort. Those two failures are not worth trading evenly.
 */
function window_(from: string, to: string): { start: string; endExclusive: string } {
  const shift = (date: string, days: number) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return {
    start: `${shift(from, -1)}T00:00:00${IST}`,
    endExclusive: `${shift(to, 2)}T00:00:00${IST}`,
  };
}

/**
 * Every registration there has ever been — and it is unbounded on purpose, up to a point.
 *
 * `E11-19` bounded the Reports reads by the range on screen and deliberately left this one alone.
 * The difference is what the two screens are *about*: Reports answers a question about a window
 * the reader chose, so reading outside it is waste. Growth answers "how many families have ever
 * arrived, and how many of them ever ordered", and those are all-time by definition — a cumulative
 * curve and an adoption count cannot be computed from a slice.
 *
 * So the honest fix here is not a date filter, which would change what the numbers mean. It is a
 * server-side aggregate, and that needs a view or an RPC — DDL this thread does not hold. `E11-24`
 * carries it.
 *
 * What is added meanwhile is the same **loud cap** `fetchReportsGrowth` uses. It does not make the
 * read cheap; it makes the day it stops being viable a stated failure rather than a screen quietly
 * reporting a smaller product than exists.
 */
export async function fetchGrowth(): Promise<GrowthData> {
  const [userRows, childRows, linkRows, orderRows] = await Promise.all([
    // Soft-deleted accounts are excluded: somebody who deleted their account is not a registration
    // we still have. `deleted_at` is the DPDP erasure marker (§13.4).
    capped<unknown>('registrations', (t) => t.from('app_user').select(GROWTH_USER_COLUMNS).is('deleted_at', null)),
    capped<unknown>('children', (t) => t.from('recipient').select(GROWTH_CHILD_COLUMNS).is('deleted_at', null)),
    // `revoked_at` rather than a delete — links are revoked and kept (`0001`), and a revoked
    // guardian is no longer a family at that school.
    capped<unknown>('guardian links', (t) => t.from('guardian_link').select(GROWTH_LINK_COLUMNS).is('revoked_at', null)),
    // Orders, for the adoption half. Scoped by `order_read_backoffice`, so this needs
    // `orders.view` as well as `users.view` — both are checked by RLS, not here.
    capped<unknown>('orders', (t) => t.from('order').select(GROWTH_ORDER_COLUMNS)),
  ]);

  return {
    users: userRows.filter(isRecord).map((r) => ({
      id: str(r.id),
      email: str(r.email) === '' ? null : str(r.email),
      createdAt: str(r.created_at),
    })),
    children: childRows.filter(isRecord).map((r) => ({
      id: str(r.id),
      schoolId: str(r.school_id),
      createdAt: str(r.created_at),
    })),
    links: linkRows.filter(isRecord).map((r) => ({
      userId: str(r.user_id),
      recipientId: str(r.recipient_id),
    })),
    orders: orderRows.filter(isRecord).map((r) => ({
      customerUserId: str(r.customer_user_id),
      placedAt: str(r.placed_at),
      serviceDate: str(r.service_date),
      status: str(r.status),
      totalPaise: typeof r.total_paise === 'number' ? r.total_paise : 0,
      schoolId: str(r.school_id),
    })),
  };
}

export interface ReportsGrowthData {
  /** Accounts registered inside the window. The cohort, before the precise IST cut. */
  users: { id: string; email: string | null; createdAt: string }[];
  /** Guardian links created inside the window — see `fetchReportsGrowth`. */
  links: { userId: string; recipientId: string }[];
  /**
   * Children that have been **soft-deleted**, by id.
   *
   * Inverted deliberately. The funnel needs to know whether a link points at a live child, and
   * reading every live child to answer that is the unbounded read this task exists to remove.
   * Deletions are rare and creations are not, so the complement is small, and "not in this set"
   * is exactly as correct as "in the set of live children".
   */
  deletedChildIds: string[];
  /** Orders placed at or after the window start. The cohort's orders, measured to the present. */
  funnelOrders: GrowthOrder[];
  /** Orders **served** inside the range. The usage block, on the same basis as the money. */
  usageOrders: GrowthOrder[];
}

/**
 * Everything Reports needs about people, bounded by the range on the screen — `E11-19`.
 *
 * ## Why not `fetchGrowth`
 *
 * `fetchGrowth` reads four tables whole. That is defensible for the Growth page, which is *about*
 * every registration there has ever been. It is indefensible for Reports, where the answer only
 * ever concerns a range the reader chose, and where the cost is paid on a school-gate connection
 * (`P11`). At 400 registrations a week it also fails in the nastiest available direction: the
 * revenue half is filtered by date in the database and stays correct, while the usage half beside
 * it quietly shrinks. `E11-17` put a guard on the screen for exactly that; a guard is not a fix.
 *
 * ## Every read is bounded by a date, and the bounds are provable
 *
 * Two of these are not obvious and are the reason this is four cheap reads rather than a join:
 *
 * - **Links are bounded by `created_at`.** A guardian link made *by* somebody who registered
 *   inside the window cannot pre-date their own registration, so no link belonging to the cohort
 *   can fall before the window start.
 * - **Funnel orders are bounded by `placed_at`.** Same argument: a member of the cohort cannot
 *   have ordered before they existed. There is no upper bound, because the funnel measures the
 *   cohort *to the present* — that is the whole point of `funnelForCohort`, and clipping it to
 *   the range end would report yesterday's cohort as converting at zero.
 *
 * Usage orders are bounded by `service_date`, matching `fetchMonthlyRevenue` exactly so the two
 * halves of the screen count the same orders.
 */
export async function fetchReportsGrowth(from: string, to: string): Promise<ReportsGrowthData> {
  const { start, endExclusive } = window_(from, to);

  const [userRows, linkRows, deletedRows, funnelRows, usageRows] = await Promise.all([
    capped<unknown>('registrations', (t) =>
      t.from('app_user').select(GROWTH_USER_COLUMNS)
        .is('deleted_at', null).gte('created_at', start).lt('created_at', endExclusive)),
    capped<unknown>('guardian links', (t) =>
      t.from('guardian_link').select(GROWTH_LINK_COLUMNS)
        .is('revoked_at', null).gte('created_at', start)),
    // Ids only. Nothing here identifies a child, and there is nowhere to put a name.
    capped<unknown>('deleted children', (t) =>
      t.from('recipient').select('id').not('deleted_at', 'is', null)),
    capped<unknown>('cohort orders', (t) =>
      t.from('order').select(GROWTH_ORDER_COLUMNS).gte('placed_at', start)),
    capped<unknown>('orders served in the range', (t) =>
      t.from('order').select(GROWTH_ORDER_COLUMNS)
        .gte('service_date', from).lte('service_date', to)),
  ]);

  const order = (r: Record<string, unknown>): GrowthOrder => ({
    customerUserId: str(r.customer_user_id),
    placedAt: str(r.placed_at),
    serviceDate: str(r.service_date),
    status: str(r.status),
    totalPaise: typeof r.total_paise === 'number' ? r.total_paise : 0,
    schoolId: str(r.school_id),
  });

  return {
    users: userRows.filter(isRecord).map((r) => ({
      id: str(r.id),
      email: str(r.email) === '' ? null : str(r.email),
      createdAt: str(r.created_at),
    })),
    links: linkRows.filter(isRecord).map((r) => ({
      userId: str(r.user_id),
      recipientId: str(r.recipient_id),
    })),
    deletedChildIds: deletedRows.filter(isRecord).map((r) => str(r.id)),
    funnelOrders: funnelRows.filter(isRecord).map(order),
    usageOrders: usageRows.filter(isRecord).map(order),
  };
}
