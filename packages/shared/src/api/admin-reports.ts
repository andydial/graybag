/**
 * Orders and revenue, by school, by month — the narrow report Andy asked for.
 *
 * ## The column list is the compliance control
 *
 * Non-negotiable #4: children's data is regulated under the DPDP Act, and **never goes in school
 * reports**. `order` carries `recipient_name_snapshot`, `class_label_snapshot` and
 * `section_label_snapshot`, and `admin-orders.ts` reads all three because the order dashboard is
 * a record of individual orders that an operator opens to investigate one of them.
 *
 * This module reads **none of them**, and that is not an oversight to be tidied up later. A
 * report is aggregate by definition; the moment a child's name is in the query it is one
 * `console.log`, one CSV export or one screenshot away from a school's inbox. The list below is
 * the only thing preventing that, `admin-reports.test.ts` asserts it by name, and widening it
 * must be a deliberate, argued change.
 *
 * ## Why the aggregation is in TypeScript
 *
 * PostgREST cannot `GROUP BY`. The alternatives were a database view or an RPC, both of which
 * are a migration and a second place for the money rules to live. With three schools and a
 * bounded date range this is a few thousand rows at most, and `fetchMonthlyRevenue` caps the
 * range explicitly rather than letting it grow without anyone noticing.
 *
 * If this ever needs a year across fifty schools, it becomes a view — and the arithmetic below is
 * the specification for it.
 */
import { runQuery } from './client.js';

/**
 * Exactly what a report may read. **No recipient, no class, no section.**
 *
 * `school_name_snapshot` rather than a join to `school`: the report is of what happened, and a
 * school renamed in September must not silently restate August.
 */
export const REPORT_ORDER_COLUMNS =
  'service_date,status,school_id,school_name_snapshot,' +
  'subtotal_paise,tax_cgst_paise,tax_sgst_paise,discount_paise,total_paise,refunded_total_paise';

export class ReportError extends Error {
  constructor(detail: string) {
    super(`The report is not usable: ${detail}`);
    this.name = 'ReportError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Money is read strictly. A non-integer is a failure, never a coerced zero.
 *
 * `Number(null)` is `0`, and a month silently reported as ₹0.00 is the one error on this screen
 * nobody would question — it looks like a quiet month rather than like a bug.
 */
function paise(value: unknown, field: string, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ReportError(`${where} has a non-integer ${field}`);
  }
  return value;
}

/**
 * Which statuses are money we have actually taken — `E11-10`.
 *
 * The bug this replaces: the old code did `if cancelled or refunded … else count it as gross`,
 * which swept **`draft` and `pending_payment` into revenue**. An order nobody has paid for was
 * being reported as money. On production on 2026-08-20 that was ₹228.92 of two unpaid orders
 * shown as takings — and it is the single hardest error to notice on a report, because a bigger
 * number never looks wrong.
 *
 * `preparing` and `delivered` are earned: payment settled before the kitchen ever saw them.
 */
const EARNED = new Set(['paid', 'preparing', 'delivered']);
/** Placed, not paid. Real demand, not yet money — so it is its own column, never folded in. */
const IN_FLIGHT = new Set(['draft', 'pending_payment']);
const LOST = new Set(['cancelled', 'refunded']);

export interface ReportRow {
  /** `YYYY-MM`. */
  month: string;
  /** The service date, `YYYY-MM-DD`. Kept so the same rows can be grouped by day. */
  day: string;
  schoolId: string;
  schoolName: string;
  orders: number;
  /** Orders that were cancelled or refunded. Counted, never in `grossPaise`. */
  cancelled: number;
  /** Placed but unpaid. Counted, and **never** in `grossPaise`. */
  pending: number;
  /** All integer paise (non-negotiable #3). Paid, preparing and delivered only. */
  grossPaise: number;
  /** What unpaid orders would be worth if they were paid. Never added to gross. */
  pendingPaise: number;
  taxPaise: number;
  refundedPaise: number;
  /** `gross - refunded`. What was actually kept. */
  netPaise: number;
}

/**
 * The month a service date falls in, as `YYYY-MM`.
 *
 * Taken from the **string**, never from a `Date`. `service_date` is a Postgres `date` and arrives
 * as `2026-08-17`; parsing that into a `Date` interprets it as UTC midnight, and in IST — UTC+5:30
 * — formatting it back can land on the previous day, which at a month boundary puts the whole
 * order in the wrong month. That is `E09-32` exactly, and it cost this project a morning.
 */
export function monthOf(serviceDate: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(serviceDate);
  if (!match) throw new ReportError(`"${serviceDate}" is not a service date`);
  return `${match[1]}-${match[2]}`;
}

/**
 * Group orders into (month, school).
 *
 * **Cancelled and refunded orders are excluded from gross and counted separately.** A cancelled
 * order is not revenue, and including it would overstate the month to whoever reads this to
 * answer "what did we take" — but dropping it silently would make the order count disagree with
 * the kitchen's, which is how somebody starts distrusting the whole report.
 */
export function summarise(orders: unknown[]): ReportRow[] {
  const groups = new Map<string, ReportRow>();

  for (const [i, row] of orders.entries()) {
    if (!isRecord(row)) throw new ReportError(`row ${i} is not an object`);

    const serviceDate = typeof row.service_date === 'string' ? row.service_date : '';
    const month = monthOf(serviceDate);
    const schoolId = typeof row.school_id === 'string' ? row.school_id : '';
    const key = `${serviceDate}::${schoolId}`;
    const where = `${serviceDate} ${schoolId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        month,
        day: serviceDate,
        schoolId,
        schoolName: typeof row.school_name_snapshot === 'string' ? row.school_name_snapshot : '',
        orders: 0, cancelled: 0, pending: 0,
        grossPaise: 0, pendingPaise: 0, taxPaise: 0, refundedPaise: 0, netPaise: 0,
      });
    }

    const group = groups.get(key)!;
    const status = typeof row.status === 'string' ? row.status : '';

    group.orders += 1;
    if (LOST.has(status)) {
      group.cancelled += 1;
    } else if (IN_FLIGHT.has(status)) {
      // Counted and valued, in its own column. Somebody looking at a day wants to know there are
      // twelve unpaid orders on it; what they must not be told is that it is revenue.
      group.pending += 1;
      group.pendingPaise += paise(row.total_paise, 'total', where);
    } else if (EARNED.has(status)) {
      group.grossPaise += paise(row.total_paise, 'total', where);
      // CGST and SGST are held separately and rounded independently (`G1`). Summing for display
      // is the one safe direction; never split a stored total back into halves.
      group.taxPaise +=
        paise(row.tax_cgst_paise, 'CGST', where) + paise(row.tax_sgst_paise, 'SGST', where);
    } else {
      // A status this module has never heard of. Counted in `orders` so the total still
      // reconciles with the kitchen, and in no money column — guessing which side of the ledger
      // a new status belongs on is exactly how the `pending_payment` bug happened.
      throw new ReportError(`${where} has an unknown status "${status}"`);
    }
    group.refundedPaise += paise(row.refunded_total_paise, 'refunded total', where);
  }

  for (const group of groups.values()) group.netPaise = group.grossPaise - group.refundedPaise;

  // Newest month first — the question is nearly always about the month just gone — then school
  // name, so a month's rows read in a stable order.
  return [...groups.values()].sort(
    (a, b) => b.month.localeCompare(a.month) || a.schoolName.localeCompare(b.schoolName),
  );
}

/** Every school's figures for one month, plus the month's totals. */
export interface MonthTotals {
  month: string;
  orders: number;
  cancelled: number;
  grossPaise: number;
  taxPaise: number;
  refundedPaise: number;
  netPaise: number;
}

/**
 * One bucket of the report, whatever it is bucketed by — `E11-10`.
 *
 * Andy: *"reports does not have option to do per school or per month etc."* The rows coming out
 * of `summarise` are keyed by (day, school), which is the finest grain the source data has; every
 * view the screen offers is a fold of those, so the three groupings cannot disagree with each
 * other about a total. That is the reason for one function rather than three.
 */
export interface Bucket {
  /** `2026-08-17`, `2026-08`, or a school id — whatever `by` selected. */
  key: string;
  /** What to print. A month name, a date, or the school's name. */
  label: string;
  orders: number;
  cancelled: number;
  pending: number;
  grossPaise: number;
  pendingPaise: number;
  taxPaise: number;
  refundedPaise: number;
  netPaise: number;
}

export type GroupBy = 'day' | 'month' | 'school';

export function groupRows(rows: readonly ReportRow[], by: GroupBy): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const row of rows) {
    const key = by === 'day' ? row.day : by === 'month' ? row.month : row.schoolId;
    const label = by === 'school' ? row.schoolName : key;
    if (!out.has(key)) {
      out.set(key, {
        key, label, orders: 0, cancelled: 0, pending: 0,
        grossPaise: 0, pendingPaise: 0, taxPaise: 0, refundedPaise: 0, netPaise: 0,
      });
    }
    const b = out.get(key)!;
    b.orders += row.orders;
    b.cancelled += row.cancelled;
    b.pending += row.pending;
    b.grossPaise += row.grossPaise;
    b.pendingPaise += row.pendingPaise;
    b.taxPaise += row.taxPaise;
    b.refundedPaise += row.refundedPaise;
    b.netPaise += row.netPaise;
  }
  const list = [...out.values()];
  // Time runs forwards so a chart reads left to right; schools rank by what they are worth,
  // because that is the question being asked of a school breakdown.
  return by === 'school'
    ? list.sort((a, b) => b.netPaise - a.netPaise || a.label.localeCompare(b.label))
    : list.sort((a, b) => a.key.localeCompare(b.key));
}

/** Every bucket added up. The row that has to reconcile with the kitchen. */
export function totalOf(buckets: readonly Bucket[]): Bucket {
  return buckets.reduce<Bucket>(
    (t, b) => ({
      key: 'total', label: 'Total',
      orders: t.orders + b.orders,
      cancelled: t.cancelled + b.cancelled,
      pending: t.pending + b.pending,
      grossPaise: t.grossPaise + b.grossPaise,
      pendingPaise: t.pendingPaise + b.pendingPaise,
      taxPaise: t.taxPaise + b.taxPaise,
      refundedPaise: t.refundedPaise + b.refundedPaise,
      netPaise: t.netPaise + b.netPaise,
    }),
    { key: 'total', label: 'Total', orders: 0, cancelled: 0, pending: 0,
      grossPaise: 0, pendingPaise: 0, taxPaise: 0, refundedPaise: 0, netPaise: 0 },
  );
}

export function totalsByMonth(rows: ReportRow[]): MonthTotals[] {
  const months = new Map<string, MonthTotals>();
  for (const row of rows) {
    if (!months.has(row.month)) {
      months.set(row.month, {
        month: row.month, orders: 0, cancelled: 0,
        grossPaise: 0, taxPaise: 0, refundedPaise: 0, netPaise: 0,
      });
    }
    const m = months.get(row.month)!;
    m.orders += row.orders;
    m.cancelled += row.cancelled;
    m.grossPaise += row.grossPaise;
    m.taxPaise += row.taxPaise;
    m.refundedPaise += row.refundedPaise;
    m.netPaise += row.netPaise;
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * The largest span this will read in one go.
 *
 * A cap rather than no cap, because the aggregation is client-side: an unbounded range on a
 * school-gate connection is the performance priority this project names first. Thirteen months
 * so that "this month against the same month last year" fits in one read.
 */
export const MAX_REPORT_MONTHS = 13;

/**
 * Read the orders for a date range and summarise them.
 *
 * `from` and `to` are inclusive `YYYY-MM-DD`. Scope is RLS and nothing written here — there is no
 * `.eq('school_id', …)`, because a filter written client-side is a second, weaker copy of a rule
 * the database already enforces, and the weaker copy is the one that drifts.
 */
export async function fetchMonthlyRevenue(from: string, to: string): Promise<ReportRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ReportError('the range must be two YYYY-MM-DD dates');
  }
  if (to < from) throw new ReportError(`the range ends (${to}) before it starts (${from})`);

  const rows = await runQuery<unknown>((t) =>
    t
      .from('order')
      .select(REPORT_ORDER_COLUMNS)
      .gte('service_date', from)
      .lte('service_date', to)
      .order('service_date'),
  );

  return summarise(rows);
}
