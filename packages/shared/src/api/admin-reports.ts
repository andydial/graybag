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
  // `placed_at` — `E11-12`. When the parent completed checkout, which is a different question
  // from when the food is served and the only one that answers "was yesterday a big day".
  // Still no recipient, class or section: this widening is one business timestamp, not a person.
  'placed_at,' +
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
  /**
   * The **IST** day the order was placed — `E11-12`. Empty when `placed_at` is null, which is
   * only possible for a row that never reached checkout.
   */
  placedDay: string;
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
/**
 * The IST calendar date of an instant — `E11-12`.
 *
 * **Not the UTC date.** India is UTC+5:30 with no daylight saving, so anything after 18:30 UTC
 * belongs to the next day locally. That is not an edge case here: of the first real orders on
 * production, **three of four were placed after 18:30 UTC** — parents order in the evening — so
 * bucketing by the UTC date would have put most of them on the wrong day, in the one report whose
 * entire purpose is to say which day was busy.
 *
 * The same trap as `E09-32`, on a different column.
 */
export function istDayOf(instant: string | null | undefined): string {
  if (typeof instant !== 'string' || instant === '') return '';
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return '';
  return new Date(t + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * The Monday of the ISO week a date falls in, as `YYYY-MM-DD`.
 *
 * Monday because service runs Monday to Saturday (`docs/mvp-scope.md`), so a week that starts on
 * Sunday would split every operating week across two buckets.
 */
export function weekOf(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const t = Date.parse(`${day}T12:00:00Z`);
  const dow = new Date(t).getUTCDay();          // 0 Sun … 6 Sat
  const back = dow === 0 ? 6 : dow - 1;          // days since Monday
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

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
    /*
     * Keyed by placed day **as well as** service day — `E11-12`.
     *
     * Two orders for the same lunch placed on different evenings are different facts to a report
     * about demand, and merging them would make the placement view unable to separate them. The
     * grain only ever gets finer, so every existing view still folds from this one set and cannot
     * disagree with the new one.
     */
    const placedDay = istDayOf(typeof row.placed_at === 'string' ? row.placed_at : null);
    const key = `${serviceDate}::${placedDay}::${schoolId}`;
    const where = `${serviceDate} ${schoolId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        month,
        day: serviceDate,
        placedDay,
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

/**
 * How a report is bucketed.
 *
 * The `placed*` axes are `E11-12` — **when the order was taken**, not when the food is served.
 * They are a different question from the rest: "was yesterday busy" versus "what are we cooking
 * on Thursday". Both fold from the same rows, so a total can never differ between them.
 */
export type GroupBy =
  | 'day' | 'month' | 'school'
  | 'placedDay' | 'placedWeek' | 'placedMonth';

export function groupRows(rows: readonly ReportRow[], by: GroupBy): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const row of rows) {
    const key =
      by === 'day' ? row.day
      : by === 'month' ? row.month
      : by === 'school' ? row.schoolId
      : by === 'placedDay' ? row.placedDay
      : by === 'placedWeek' ? weekOf(row.placedDay)
      : row.placedDay.slice(0, 7);
    // A row whose order never reached checkout has no placed day and cannot appear on a
    // placement axis. Dropping it is right — it is not demand — and silently bucketing it under
    // the empty string would put it in a phantom period at the top of every chart.
    if (key === '') continue;
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


/**
 * Orders **placed** in a window — `E11-12`.
 *
 * Andy: *"Currently orders are only seen for the day the delivery is requested for, I want to see
 * sales (orders) placed for a given day. That way I can see when a large order day comes."*
 *
 * ## The window is IST, the column is UTC
 *
 * `placed_at` is a `timestamptz`. Asking PostgREST for `placed_at >= '2026-08-20'` compares
 * against **midnight UTC**, which is 05:30 IST — so a day asked for in IST would start five and a
 * half hours late and end five and a half hours early, losing every order placed in the evening.
 * That is most of them. The bounds are therefore shifted explicitly, and the day each row lands in
 * is decided by `istDayOf` afterwards.
 *
 * The upper bound is **exclusive** and one day past `to`, so "to the 20th" includes the whole of
 * the 20th in IST rather than stopping at its first instant.
 */
export async function fetchOrdersPlaced(from: string, to: string): Promise<ReportRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ReportError('the range must be two YYYY-MM-DD dates');
  }
  if (to < from) throw new ReportError(`the range ends (${to}) before it starts (${from})`);

  // 00:00 IST on `from` is 18:30 UTC the previous day.
  const startUtc = new Date(Date.parse(`${from}T00:00:00Z`) - 5.5 * 3600 * 1000).toISOString();
  // 00:00 IST on the day after `to`, exclusive.
  const endUtc = new Date(
    Date.parse(`${to}T00:00:00Z`) + 86_400_000 - 5.5 * 3600 * 1000,
  ).toISOString();

  const rows = await runQuery<unknown>((t) =>
    t
      .from('order')
      .select(REPORT_ORDER_COLUMNS)
      .gte('placed_at', startUtc)
      .lt('placed_at', endUtc)
      .order('placed_at'),
  );

  return summarise(rows);
}

/**
 * This period against the one immediately before it — `E11-12`.
 *
 * Andy: *"I want to be able to see growth or reduction in orders."* A total on its own cannot
 * answer that; it needs something to be bigger or smaller **than**. The comparison window is the
 * same length and ends where this one starts, so "last 30 days" is measured against the 30 before
 * it rather than against a calendar month of a different length.
 *
 * `change` is null when the previous period had nothing — a rise from zero is not a percentage,
 * and rendering it as one produces the infinity that makes a dashboard untrustworthy.
 */
export interface Comparison {
  now: number;
  previous: number;
  change: number | null;
}

export function compare(now: number, previous: number): Comparison {
  return {
    now,
    previous,
    change: previous === 0 ? null : (now - previous) / previous,
  };
}

/** The window of the same length ending where `from` begins. Inclusive dates, as elsewhere. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: day(start - days * 86_400_000), to: day(start - 86_400_000) };
}
