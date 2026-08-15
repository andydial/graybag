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

export interface ReportRow {
  /** `YYYY-MM`. */
  month: string;
  schoolId: string;
  schoolName: string;
  orders: number;
  /** Orders that were cancelled or refunded. Counted, never in `grossPaise`. */
  cancelled: number;
  /** All integer paise (non-negotiable #3). */
  grossPaise: number;
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
    const key = `${month}::${schoolId}`;
    const where = `${month} ${schoolId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        month,
        schoolId,
        schoolName: typeof row.school_name_snapshot === 'string' ? row.school_name_snapshot : '',
        orders: 0, cancelled: 0, grossPaise: 0, taxPaise: 0, refundedPaise: 0, netPaise: 0,
      });
    }

    const group = groups.get(key)!;
    const status = typeof row.status === 'string' ? row.status : '';

    group.orders += 1;
    if (status === 'cancelled' || status === 'refunded') {
      group.cancelled += 1;
    } else {
      group.grossPaise += paise(row.total_paise, 'total', where);
      // CGST and SGST are held separately and rounded independently (`G1`). Summing for display
      // is the one safe direction; never split a stored total back into halves.
      group.taxPaise +=
        paise(row.tax_cgst_paise, 'CGST', where) + paise(row.tax_sgst_paise, 'SGST', where);
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
