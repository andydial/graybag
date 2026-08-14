import { runQuery } from './client.js';

/**
 * Orders across every kitchen, with money — `E10-08`.
 *
 * ## Why this is not `fetchKitchenOrders` with a flag
 *
 * `kitchen.ts` deliberately selects **no money column at all**: `orders.view_financials` is a
 * separate grant from `orders.view` (`D3`, `E09-09`), a policy filters rows and never columns,
 * so that column list is the only thing standing between a kitchen porter and every total in the
 * school. Adding `includeMoney: true` to it would put the redaction behind a boolean that one
 * careless caller can flip.
 *
 * Two functions with two column lists means the kitchen path cannot leak money by mistake — the
 * columns are not in the query it sends. That is worth the duplication.
 *
 * ## What scopes this
 *
 * **RLS, and nothing written here.** `permission_grant` widens platform → city → kitchen →
 * school, so a platform-scoped admin gets every kitchen from this query and a kitchen-scoped
 * operator gets one. There is no `.eq('kitchen_id', …)` because a filter written client-side is a
 * second, weaker copy of a rule the database already enforces — and the weaker copy is the one
 * that drifts.
 */

/**
 * Money **and** the child's name are both here, and they are regulated differently.
 *
 * `recipient_name_snapshot` is tier P (non-negotiable #4) and `total_paise` is behind
 * `orders.view_financials`. This screen needs both, which is precisely why it is a separate
 * surface with a separate grant rather than a column added to the kitchen board.
 */
export const ADMIN_ORDER_COLUMNS =
  'id,order_ref,service_date,status,school_id,school_name_snapshot,kitchen_id,' +
  'break_label_snapshot,recipient_name_snapshot,class_label_snapshot,section_label_snapshot,' +
  'subtotal_paise,tax_cgst_paise,tax_sgst_paise,discount_paise,total_paise,refunded_total_paise';

export interface AdminOrder {
  id: string;
  orderRef: string;
  serviceDate: string;
  status: string;
  schoolId: string;
  schoolName: string;
  kitchenId: string | null;
  breakLabel: string | null;
  recipientName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  /** All integer paise. Never floats, anywhere (non-negotiable #3). */
  subtotalPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  refundedPaise: number;
}

export class AdminOrderPayloadError extends Error {
  constructor(detail: string) {
    super(`The order list is not usable: ${detail}`);
    this.name = 'AdminOrderPayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Money is read strictly: a non-integer is a failure, never a coerced zero.
 *
 * `Number(undefined)` is `NaN` and `Number(null)` is `0`, and a total silently rendered as ₹0.00
 * is the one error on this screen nobody would question — it looks like a free order rather than
 * like a bug. Non-negotiable #3 is about the type as much as the arithmetic.
 */
function paise(value: unknown, field: string, ref: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AdminOrderPayloadError(`order ${ref} has a non-integer ${field}`);
  }
  return value;
}

/** Every order on a service date, across every kitchen the caller's grants reach. */
export async function fetchAdminOrders(serviceDate: string): Promise<AdminOrder[]> {
  const rows = await runQuery<unknown>((t) =>
    t
      .from('order')
      .select(ADMIN_ORDER_COLUMNS)
      .eq('service_date', serviceDate)
      .order('school_name_snapshot')
      .order('order_ref'),
  );

  const orders: AdminOrder[] = [];

  for (const [i, row] of rows.entries()) {
    if (!isRecord(row)) throw new AdminOrderPayloadError(`row ${i} is not an object`);

    const id = str(row.id);
    const status = str(row.status);
    if (!id) throw new AdminOrderPayloadError(`row ${i} has no id`);
    if (!status) throw new AdminOrderPayloadError(`order ${i} has no status`);

    // Unlike the kitchen board, a `draft` or `pending_payment` order is kept. This screen answers
    // "what happened to this order", and an order that never got paid for is exactly the case
    // somebody is looking into. `L5` keeps them off the *kitchen's* list, not out of the record.
    const ref = str(row.order_ref) ?? id;

    orders.push({
      id,
      orderRef: ref,
      serviceDate: str(row.service_date) ?? serviceDate,
      status,
      schoolId: str(row.school_id) ?? '',
      schoolName: str(row.school_name_snapshot) ?? '',
      kitchenId: str(row.kitchen_id),
      breakLabel: str(row.break_label_snapshot),
      recipientName: str(row.recipient_name_snapshot) ?? '',
      classLabel: str(row.class_label_snapshot),
      sectionLabel: str(row.section_label_snapshot),
      subtotalPaise: paise(row.subtotal_paise, 'subtotal', ref),
      // CGST and SGST are held separately and summed for display only. They are calculated
      // independently and rounded independently (`G1`), so this is the one direction the
      // addition is safe in — never split a stored total back into halves.
      taxPaise: paise(row.tax_cgst_paise, 'CGST', ref) + paise(row.tax_sgst_paise, 'SGST', ref),
      discountPaise: paise(row.discount_paise, 'discount', ref),
      totalPaise: paise(row.total_paise, 'total', ref),
      refundedPaise: paise(row.refunded_total_paise, 'refunded total', ref),
    });
  }

  return orders;
}

export interface AdminOrderTotals {
  orders: number;
  grossPaise: number;
  refundedPaise: number;
  netPaise: number;
  cancelled: number;
}

/**
 * The day's money, over whatever subset is on screen.
 *
 * **Cancelled orders are excluded from gross.** A cancelled order is not revenue, and counting it
 * would overstate the day to whoever reads this to answer "what did we take". They are counted
 * separately so the number is not silently missing either.
 */
export function totalsFor(orders: AdminOrder[]): AdminOrderTotals {
  let grossPaise = 0;
  let refundedPaise = 0;
  let cancelled = 0;

  for (const order of orders) {
    if (order.status === 'cancelled' || order.status === 'refunded') {
      cancelled += 1;
    } else {
      grossPaise += order.totalPaise;
    }
    refundedPaise += order.refundedPaise;
  }

  return {
    orders: orders.length,
    grossPaise,
    refundedPaise,
    netPaise: grossPaise - refundedPaise,
    cancelled,
  };
}
