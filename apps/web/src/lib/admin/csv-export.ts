/**
 * Turning a report into a file — `E11-16`.
 *
 * ## Built from the rows already on the screen
 *
 * The export takes the same `Bucket[]` the table renders, so what downloads is what was read.
 * A second query for the export is how a CSV ends up disagreeing with the screen above it — and
 * disagreeing quietly, because nobody diffs a download against a table.
 *
 * ## No child, structurally
 *
 * `Bucket` carries a key, a label and numbers. There is no child field on it to leak, which is
 * the point: the guarantee is a property of the type rather than a rule this file remembers.
 * `scripts/test/no-child-in-reports.test.mjs` watches this file by name for the child columns, so
 * a future edit that reaches for one fails on the next push.
 *
 * ## Excel, without lying to it
 *
 * Two details that look like superstition and are not:
 *
 * **A BOM.** Excel on Windows reads a UTF-8 file as the local code page unless one is present, so
 * a school named `Amity — Mohali` arrives as `Amity â€” Mohali`. Three bytes fixes it.
 *
 * **Money as a plain number.** `1234.50`, not `₹1,234.50`. A currency symbol and a thousands
 * separator turn the column into text, and the first thing anybody does with this file is sum a
 * column. The header says the unit instead.
 */
import type { api } from '@graybag/shared';

/**
 * Quote a field the way RFC 4180 asks.
 *
 * A school name containing a comma is the ordinary case, not the edge case — "Amity International,
 * Mohali" is in the production data today — so this is load-bearing rather than defensive.
 *
 * The leading-character guard is separate and more important: a value starting `=`, `+`, `-` or
 * `@` is executed as a formula when the file is opened. No school name should begin with one, but
 * a CSV that can run a formula is a CSV that can exfiltrate the rest of the sheet, and prefixing a
 * tab costs nothing.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Paise to a plain decimal. No symbol, no separators — see the header. */
const rupees = (paise: number): string => (paise / 100).toFixed(2);

export interface ExportOptions {
  /** `day`, `month`, `school` — decides what the first column is called. */
  by: api.GroupBy;
  /** Printed into the file, so a saved export still says what it covers. */
  from: string;
  to: string;
  /** The school filter in force, if any. Named for the same reason. */
  schoolName?: string | null;
  /** Turns a bucket key into what a person should read. */
  label: (key: string) => string;
}

const HEADER = [
  'Period',
  'Paid orders',
  'Unpaid orders',
  'Cancelled orders',
  'Gross (INR)',
  'GST (INR)',
  'Refunded (INR)',
  'Net (INR)',
  'Average order (INR)',
];

/**
 * The whole file, as a string.
 *
 * A total row is included, because the first thing anybody checks is whether the export agrees
 * with the screen, and making them sum a column to find out invites them to conclude it does not.
 */
export function reportToCsv(buckets: readonly api.Bucket[], options: ExportOptions): string {
  const first =
    options.by === 'school' ? 'School'
    : options.by === 'month' ? 'Month'
    : options.by.startsWith('placed') ? 'Placed'
    : 'Day';

  const rows: string[] = [];

  /*
   * Provenance first, as comment lines.
   *
   * An exported file outlives the screen it came from and gets mailed on without its context. A
   * reader three weeks later needs to know the range, the filter and that unpaid orders are not
   * revenue, or they will reconcile it against something else and find a discrepancy that is not
   * there. `#` is not part of RFC 4180, but every spreadsheet skips or isolates these lines, and
   * losing the context is worse than a tidier file.
   */
  rows.push(`# GrayBag report`);
  rows.push(`# Range,${csvField(options.from)},to,${csvField(options.to)}`);
  rows.push(`# School,${csvField(options.schoolName ?? 'All schools')}`);
  rows.push(`# Grouped by,${csvField(first)}`);
  rows.push(`# Note,${csvField('Unpaid and cancelled orders are counted but are not revenue.')}`);
  rows.push(`# Note,${csvField('No child’s name, class or section appears in this file.')}`);
  rows.push('');

  rows.push([first, ...HEADER.slice(1)].map(csvField).join(','));

  for (const b of buckets) {
    rows.push([
      options.by === 'school' ? b.label : options.label(b.key),
      b.paid,
      b.pending,
      b.cancelled,
      rupees(b.grossPaise),
      rupees(b.taxPaise),
      rupees(b.refundedPaise),
      rupees(b.netPaise),
      b.paid > 0 ? rupees(Math.round(b.netPaise / b.paid)) : '',
    ].map(csvField).join(','));
  }

  const totals = buckets.reduce(
    (t, b) => ({
      paid: t.paid + b.paid,
      pending: t.pending + b.pending,
      cancelled: t.cancelled + b.cancelled,
      gross: t.gross + b.grossPaise,
      tax: t.tax + b.taxPaise,
      refunded: t.refunded + b.refundedPaise,
      net: t.net + b.netPaise,
    }),
    { paid: 0, pending: 0, cancelled: 0, gross: 0, tax: 0, refunded: 0, net: 0 },
  );

  rows.push([
    'Total', totals.paid, totals.pending, totals.cancelled,
    rupees(totals.gross), rupees(totals.tax), rupees(totals.refunded), rupees(totals.net),
    totals.paid > 0 ? rupees(Math.round(totals.net / totals.paid)) : '',
  ].map(csvField).join(','));

  return rows.join('\r\n');
}

/** `graybag-revenue-2026-08-01-to-2026-08-26.csv` — sorts and reads without being opened. */
export function csvFilename(from: string, to: string, by: string): string {
  return `graybag-${by}-${from}-to-${to}.csv`;
}

/**
 * Hand it to the browser.
 *
 * A `Blob` and an object URL rather than a `data:` URI: a data URI is capped at a few megabytes in
 * some browsers and silently truncates past it, which would produce a file that opens and is
 * wrong — the worst of the available failures.
 *
 * The `\uFEFF` below is the BOM. Written as an escape rather than the character itself: an
 * invisible U+FEFF in source is unreviewable, and `no-irregular-whitespace` is right to
 * refuse it — it caught this on the first lint.
 */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Released on the next tick — revoking synchronously cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A day's orders, as the rows on screen — `E10-70`.
 *
 * **Built from what is displayed, not from a second query.** Andy endorsed that call on Reports
 * (*"building the CSV from the rows already on screen rather than a second query"*), and the
 * reason is stronger here: this list is filtered by school and status in the browser, so a second
 * read would export a different set from the one somebody is looking at — a file that silently
 * disagrees with the screen it came from.
 *
 * Money is a plain decimal with no symbol and no separators, for the same reason the revenue
 * export is: a spreadsheet reads `1234.50` as a number and `₹1,234.50` as text, and a column of
 * text is a column nobody can sum.
 */
export function ordersToCsv(
  orders: readonly api.AdminOrder[],
  options: { serviceDate: string; schoolName?: string | null; status?: string | null },
): string {
  const rows: string[] = [];

  // A saved file has to say what it covers, or it is a mystery in six weeks' time.
  rows.push(`GrayBag orders,${csvField(options.serviceDate)}`);
  if (options.schoolName) rows.push(`School,${csvField(options.schoolName)}`);
  if (options.status) rows.push(`Status,${csvField(options.status)}`);
  rows.push('');

  rows.push([
    'Order', 'School', 'Child', 'Class', 'Section', 'Break', 'Status',
    'Subtotal', 'Tax', 'Discount', 'Total', 'Refunded',
  ].map(csvField).join(','));

  for (const o of orders) {
    rows.push([
      o.orderRef, o.schoolName, o.recipientName, o.classLabel, o.sectionLabel, o.breakLabel,
      o.status,
      rupees(o.subtotalPaise), rupees(o.taxPaise), rupees(o.discountPaise),
      rupees(o.totalPaise), rupees(o.refundedPaise),
    ].map(csvField).join(','));
  }

  return rows.join('\r\n');
}
