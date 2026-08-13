/**
 * The kitchen dashboard's backend calls (`E09-04`, `E09-05`, `E09-17`).
 *
 * Handed to the web thread by Andy on 2026-08-12 while the payments thread is deep in `E06`.
 * **This file and `supabase/functions/kitchen-order-status/` are the only two things the web
 * thread touched in `packages/shared` and `supabase`** — plus one export line in
 * `./index.js`, without which nothing here is reachable from `apps/web`.
 *
 * Reads use the Supabase client; the write goes through an Edge Function. `A4`, non-negotiable
 * #1, and the reason this file exists at all rather than the screen querying for itself.
 *
 * ## What is deliberately not selected
 *
 * No money. `order` carries `subtotal_paise`, `total_paise` and `refunded_total_paise`, and
 * `orders.view_financials` is a **separate** grant from `orders.view` (`D3`, `E09-09`). A policy
 * filters rows, never columns, so nothing in the database stops `select('*')` here from handing
 * a kitchen porter every total in the school. The named column list below is the only thing that
 * does — the same reasoning, and the same shape, as `SCHOOL_COLUMNS` in `schools.ts`.
 */
import { ApiError, invokeFunction, runQuery } from './client.js';

/** The statuses the kitchen may act on. `pending_payment` is excluded — `L5`. */
export type KitchenOrderStatus = 'paid' | 'preparing' | 'delivered' | 'cancelled';

export type KitchenStatusAction = 'preparing' | 'delivered' | 'cancelled';

export interface ApiKitchenOrderLine {
  dishId: string;
  dishName: string;
  quantity: number;
  /** The parent's request for this line. Tier P — never logged. `null` when there is none. */
  note: string | null;
}

export interface ApiKitchenOrder {
  id: string;
  orderRef: string;
  schoolId: string;
  schoolName: string;
  breakId: string | null;
  breakLabel: string | null;
  /** Tier P. Present only because staff hand food to a named child — never logged. */
  recipientName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  status: KitchenOrderStatus;
  pickupCode: string | null;
  lines: ApiKitchenOrderLine[];
}

/**
 * Exactly what may leave the `order` table for this screen. Exported so the test can assert it.
 *
 * Every column is a snapshot taken at order time, which is what makes the kitchen list stable:
 * renaming a dish tomorrow does not rewrite what was cooked today.
 */
export const KITCHEN_ORDER_COLUMNS =
  'id,order_ref,school_id,school_name_snapshot,break_time_id,break_label_snapshot,' +
  'recipient_name_snapshot,class_label_snapshot,section_label_snapshot,status,pickup_code,' +
  'order_line(dish_id,dish_name_snapshot,quantity,special_comments)';

/** The statuses a kitchen list may contain, filtered client-side. See `fetchKitchenOrders`. */
const KITCHEN_STATUSES: readonly string[] = ['paid', 'preparing', 'delivered', 'cancelled'];

export class KitchenPayloadError extends Error {
  constructor(detail: string) {
    super(`The kitchen order list is not usable: ${detail}`);
    this.name = 'KitchenPayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Every order for one service date, as the kitchen sees it.
 *
 * RLS does the authorization: `order_read_backoffice` admits only rows where the caller holds
 * `orders.view` for that school. An operator with no grant gets an empty list, and the screen
 * turns that into an explanation rather than into "nobody ordered today" — `ux-spec` §5.21's N3,
 * which in a kitchen has the worst possible misreading, because the response to it is that
 * nobody cooks.
 *
 * **The status filter is applied here rather than in the query**, and that is a deliberate
 * limitation rather than an oversight: `SelectBuilder` has `eq`, `is` and `order` but no `in`,
 * and widening that interface means editing `client.ts` — outside what this thread was handed.
 * Filtering in memory costs one extra pass over a few hundred rows and keeps the change to two
 * files. When `in()` is added for another caller, this should move into the query.
 */
export async function fetchKitchenOrders(serviceDate: string): Promise<ApiKitchenOrder[]> {
  const rows = await runQuery<unknown>((t) =>
    t
      .from('order')
      .select(KITCHEN_ORDER_COLUMNS)
      .eq('service_date', serviceDate)
      .order('school_name_snapshot')
      .order('class_label_snapshot'),
  );

  const orders: ApiKitchenOrder[] = [];

  for (const [i, row] of rows.entries()) {
    if (!isRecord(row)) throw new KitchenPayloadError(`row ${i} is not an object`);

    const id = str(row.id);
    const status = str(row.status);
    if (!id) throw new KitchenPayloadError(`row ${i} has no id`);
    if (!status) throw new KitchenPayloadError(`order ${i} has no status`);

    // A status outside the kitchen's set is not an error — it is a `pending_payment` or `draft`
    // order the caller may legitimately read and the kitchen must never cook against (`L5`).
    if (!KITCHEN_STATUSES.includes(status)) continue;

    const rawLines = Array.isArray(row.order_line) ? row.order_line : [];
    const lines: ApiKitchenOrderLine[] = [];
    for (const line of rawLines) {
      if (!isRecord(line)) continue;
      const dishId = str(line.dish_id);
      const dishName = str(line.dish_name_snapshot);
      const quantity = typeof line.quantity === 'number' ? line.quantity : null;
      /**
       * The parent's per-line note (`ux-spec` §5.6.1). **Tier P: never logged, never to Sentry.**
       *
       * It comes through because the spec makes the field conditional on the kitchen reading it:
       * "a note the packing list drops is a lie told to a parent at the moment they are trying to
       * be careful". It is a request and never a safety record — never used to compute a warning,
       * never treated as allergen data, whatever a parent may have typed into it.
       *
       * Blank and whitespace-only both become `null`, so the screen has one thing to test rather
       * than rendering an empty flag against a dish.
       */
      const note = str(line.special_comments)?.trim() || null;
      // A line we cannot read is dropped loudly rather than rendered as a mystery: a kitchen
      // list showing "1 × undefined" is worse than one short line somebody can query.
      if (!dishId || !dishName || quantity === null) {
        throw new KitchenPayloadError(`order ${id} has an unreadable line`);
      }
      lines.push({ dishId, dishName, quantity, note });
    }

    orders.push({
      id,
      orderRef: str(row.order_ref) ?? '',
      schoolId: str(row.school_id) ?? '',
      schoolName: str(row.school_name_snapshot) ?? '',
      breakId: str(row.break_time_id),
      breakLabel: str(row.break_label_snapshot),
      // Never defaulted to a placeholder. An order whose child we cannot name is a bug, and
      // "Unknown" on a kitchen list is a bag nobody can hand to anybody.
      recipientName: str(row.recipient_name_snapshot) ?? '',
      classLabel: str(row.class_label_snapshot),
      sectionLabel: str(row.section_label_snapshot),
      status: status as KitchenOrderStatus,
      pickupCode: str(row.pickup_code),
      lines,
    });
  }

  return orders;
}

/**
 * The grant codes this operator holds, so the screen can draw the right controls (`E09-09`).
 *
 * `permission_grant_read_self` (migration `0002`) lets a user read their own grants, so this
 * needs no function and no elevated key. Revoked and expired grants are excluded.
 *
 * **This is presentation only.** Every one of these is enforced server-side regardless — hiding
 * a button is a courtesy to the person, not a control. A screen that could not read this would
 * still be safe; it would just draw buttons the server then refuses, which is worse UX and no
 * worse security.
 */
export async function fetchMyGrants(): Promise<string[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('permission_grant').select('permission_code').is('revoked_at', null),
  );

  const codes = new Set<string>();
  for (const row of rows) {
    if (isRecord(row)) {
      const code = str(row.permission_code);
      if (code) codes.add(code);
    }
  }
  return [...codes].sort();
}

export interface KitchenSchool {
  id: string;
  name: string;
  /** `false` for a school we have stopped serving — still shown if it has orders that day. */
  isActive: boolean;
}

/**
 * The schools this account may see, from the `school` table (`E09-28`).
 *
 * **Not derived from today's orders**, which is what this replaced. Deriving it meant the filter
 * appeared and disappeared with the day's data: a school that happened to order nothing vanished
 * from the control, and a day with one school showed no filter at all — so the operator could not
 * tell whether they were looking at every school or at one of several. The list of schools a
 * kitchen serves is a property of the kitchen, not of a Tuesday.
 *
 * The scope is **RLS**, not a filter written here. `permission_grant` widens from platform down
 * to school, so this returns exactly the schools the caller's grants cover — one school for a
 * school-scoped operator, every school in a kitchen for a kitchen-scoped one.
 *
 * `is_active` is **returned rather than filtered on here**, because the caller needs both halves:
 * the schools we currently serve, plus any school with orders on the day being viewed. A school
 * we have stopped serving still has last week's orders, and a filter that cannot name a school
 * whose orders are on the board is worse than one showing an extra name (Andy, 2026-08-13).
 */
export async function fetchKitchenSchools(): Promise<KitchenSchool[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('school').select('id,name,is_active').order('name'),
  );

  const schools: KitchenSchool[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    const name = str(row.name);
    // A school we cannot name is not offered. An unlabelled chip is a control nobody can use.
    // `is_active` defaults to active when absent: hiding a school because a column did not come
    // back is the wrong way to be wrong.
    if (id && name) schools.push({ id, name, isActive: row.is_active !== false });
  }
  return schools;
}

export interface KitchenStatusResult {
  updated: string[];
  /** Already in the target state. Not a failure — see the function's idempotency note. */
  skipped: string[];
}

/**
 * Move a batch of orders to a new status (`E09-05`).
 *
 * A write, so it goes through an Edge Function and never touches a table from here (`A4`).
 *
 * **Bulk by design.** One tap marks a whole class delivered (`L8`), and a per-order call
 * multiplied by thirty children on kitchen wifi is the wrong shape entirely.
 *
 * A cancellation carries its reason. `cancel_reason_code` is how a refund is later explained,
 * and a cancellation without one loses *why* the food was not delivered — which is exactly what
 * `order-lifecycle.md` refuses to allow when it forbids `paid → refunded` directly.
 */
export async function updateKitchenOrderStatus(input: {
  orderIds: string[];
  to: KitchenStatusAction;
  reasonCode?: string;
}): Promise<KitchenStatusResult> {
  if (input.orderIds.length === 0) return { updated: [], skipped: [] };
  if (input.to === 'cancelled' && !input.reasonCode) {
    throw new ApiError('A cancellation needs a reason code.', 'reason_required');
  }

  const payload = await invokeFunction<unknown>('kitchen-order-status', {
    orderIds: input.orderIds,
    to: input.to,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
  });

  if (!isRecord(payload) || !Array.isArray(payload.updated)) {
    throw new KitchenPayloadError('the status update returned an unexpected shape');
  }

  return {
    updated: payload.updated.filter((id): id is string => typeof id === 'string'),
    skipped: Array.isArray(payload.skipped)
      ? payload.skipped.filter((id): id is string => typeof id === 'string')
      : [],
  };
}
