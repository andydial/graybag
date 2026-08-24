import { afterEach, describe, expect, it } from 'vitest';

import { setApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';
import { ADMIN_ORDER_COLUMNS } from './admin-orders.js';
import {
  compare,
  fetchOrdersPlaced,
  groupRows,
  istDayOf,
  previousWindow,
  totalOf,
  weekOf,
  MAX_REPORT_MONTHS,
  REPORT_ORDER_COLUMNS,
  ReportError,
  fetchMonthlyRevenue,
  monthOf,
  summarise,
  totalsByMonth,
} from './admin-reports.js';

afterEach(() => setApiTransport(null));

const order = (o: Record<string, unknown> = {}) => ({
  service_date: '2026-08-17',
  status: 'paid',
  school_id: 's-1',
  school_name_snapshot: 'Amity',
  subtotal_paise: 10000,
  tax_cgst_paise: 250,
  tax_sgst_paise: 250,
  discount_paise: 0,
  total_paise: 10500,
  refunded_total_paise: 0,
  ...o,
});

describe('the column list is the compliance control', () => {
  // Non-negotiable #4: children's data is regulated under the DPDP Act and never goes in a
  // school report. `order` carries all three of these and `admin-orders.ts` reads them, because
  // that screen is a record of individual orders. A report is aggregate by definition, and the
  // moment a name is in the query it is one export away from a school's inbox.
  it.each(['recipient_name_snapshot', 'class_label_snapshot', 'section_label_snapshot'])(
    'never reads %s',
    (column) => {
      expect(REPORT_ORDER_COLUMNS).not.toContain(column);
    },
  );

  it('never selects *', () => {
    expect(REPORT_ORDER_COLUMNS).not.toContain('*');
  });

  it('is strictly narrower than the order dashboard, which does read the child', () => {
    // Stated as a contrast so the difference is deliberate rather than incidental. If somebody
    // ever makes these equal, this fails and they have to say why.
    expect(ADMIN_ORDER_COLUMNS).toContain('recipient_name_snapshot');
    expect(REPORT_ORDER_COLUMNS).not.toContain('recipient_name_snapshot');
  });
});

describe('monthOf', () => {
  it('takes the month from the string, never through a Date', () => {
    // A `date` arrives as `2026-08-01`. Parsing it into a Date reads it as UTC midnight, and in
    // IST — UTC+5:30 — formatting back can land on 31 July, putting the order in the wrong month.
    // That is E09-32, which cost this project a morning.
    expect(monthOf('2026-08-01')).toBe('2026-08');
    expect(monthOf('2026-01-31')).toBe('2026-01');
    expect(monthOf('2026-12-31')).toBe('2026-12');
  });

  it('refuses something that is not a service date rather than guessing', () => {
    expect(() => monthOf('17/08/2026')).toThrow(ReportError);
    expect(() => monthOf('')).toThrow(ReportError);
  });
});

describe('summarise', () => {
  it('groups by day and school — the finest grain the source has', () => {
    // **Changed in `E11-10`**, deliberately: this used to group by month and school, which meant
    // a per-day or per-school view had to re-read the orders and could disagree with the monthly
    // one about a total. Every view the screen offers is now a fold of these rows, so they
    // cannot. `groupRows` is what folds them.
    const rows = summarise([
      order(),
      order({ service_date: '2026-08-18' }),
      order({ service_date: '2026-09-01' }),
      order({ school_id: 's-2', school_name_snapshot: 'Gem' }),
    ]);
    // Two on the default date (one per school), plus 08-18, plus 09-01.
    expect(rows).toHaveLength(4);
    expect(groupRows(rows, 'month').find((b) => b.key === '2026-08')!.orders).toBe(3);
    expect(groupRows(rows, 'school').find((b) => b.label === 'Gem')!.orders).toBe(1);
  });

  it('sums money as integer paise throughout', () => {
    const [row] = summarise([order(), order()]);
    expect(row!.grossPaise).toBe(21000);
    expect(row!.taxPaise).toBe(1000);
    expect(Number.isInteger(row!.grossPaise)).toBe(true);
  });

  it('excludes a cancelled order from gross but still counts it', () => {
    // A cancelled order is not revenue. Dropping it entirely would make the order count disagree
    // with the kitchen's, which is how somebody starts distrusting the whole report.
    const [row] = summarise([order(), order({ status: 'cancelled' })]);
    expect(row!.orders).toBe(2);
    expect(row!.cancelled).toBe(1);
    expect(row!.grossPaise).toBe(10500);
  });

  it('treats a refunded order the same way as a cancelled one', () => {
    const [row] = summarise([order({ status: 'refunded', refunded_total_paise: 10500 })]);
    expect(row!.cancelled).toBe(1);
    expect(row!.grossPaise).toBe(0);
    expect(row!.refundedPaise).toBe(10500);
  });

  it('subtracts refunds from gross to give net', () => {
    const [row] = summarise([order(), order({ refunded_total_paise: 500 })]);
    expect(row!.grossPaise).toBe(21000);
    expect(row!.refundedPaise).toBe(500);
    expect(row!.netPaise).toBe(20500);
  });

  it('counts a partial refund on an otherwise live order', () => {
    // A partly refunded order is still revenue, minus the part given back. It must not be
    // excluded like a cancellation.
    const [row] = summarise([order({ refunded_total_paise: 2000 })]);
    expect(row!.grossPaise).toBe(10500);
    expect(row!.netPaise).toBe(8500);
  });

  it('refuses a non-integer total rather than reporting a quiet zero', () => {
    // `Number(null)` is 0, and a month reported as ₹0.00 is the one error here nobody questions.
    expect(() => summarise([order({ total_paise: null })])).toThrow(ReportError);
    expect(() => summarise([order({ total_paise: 105.5 })])).toThrow(ReportError);
  });

  it('uses the snapshotted school name, so a rename does not restate history', () => {
    const [row] = summarise([order({ school_name_snapshot: 'Amity International' })]);
    expect(row!.schoolName).toBe('Amity International');
  });

  it('orders newest month first, then by school name', () => {
    const rows = summarise([
      order({ service_date: '2026-07-01', school_name_snapshot: 'Zeta' }),
      order({ service_date: '2026-08-01', school_name_snapshot: 'Beta', school_id: 's-2' }),
      order({ service_date: '2026-08-01', school_name_snapshot: 'Alpha', school_id: 's-3' }),
    ]);
    expect(rows.map((r) => `${r.month} ${r.schoolName}`)).toEqual([
      '2026-08 Alpha', '2026-08 Beta', '2026-07 Zeta',
    ]);
  });

  it('summarises nothing as nothing', () => {
    expect(summarise([])).toEqual([]);
  });
});

describe('totalsByMonth', () => {
  it('adds every school in a month together', () => {
    const rows = summarise([
      order(),
      order({ school_id: 's-2', school_name_snapshot: 'Gem' }),
      order({ service_date: '2026-09-01' }),
    ]);
    const totals = totalsByMonth(rows);
    expect(totals).toHaveLength(2);
    const august = totals.find((t) => t.month === '2026-08')!;
    expect(august.orders).toBe(2);
    expect(august.grossPaise).toBe(21000);
  });

  it('is newest first, like the rows', () => {
    const rows = summarise([order({ service_date: '2026-07-01' }), order()]);
    expect(totalsByMonth(rows).map((t) => t.month)).toEqual(['2026-08', '2026-07']);
  });
});

describe('fetchMonthlyRevenue', () => {
  it('asks for both ends of the range as a range, not as two equalities', async () => {
    const fake = fakeTransport([order()]);
    setApiTransport(fake.transport);
    await fetchMonthlyRevenue('2026-08-01', '2026-08-31');
    expect(fake.queries[0]!.gteFilters).toEqual([{ column: 'service_date', value: '2026-08-01' }]);
    expect(fake.queries[0]!.lteFilters).toEqual([{ column: 'service_date', value: '2026-08-31' }]);
  });

  it('never filters by school — scope is RLS', async () => {
    // A filter written client-side is a second, weaker copy of a rule the database already
    // enforces, and the weaker copy is the one that drifts.
    const fake = fakeTransport([order()]);
    setApiTransport(fake.transport);
    await fetchMonthlyRevenue('2026-08-01', '2026-08-31');
    expect(fake.queries[0]!.filters).toEqual([]);
  });

  it('refuses a backwards range rather than returning nothing', async () => {
    // An empty result and an impossible question look identical on screen otherwise.
    setApiTransport(fakeTransport([]).transport);
    await expect(fetchMonthlyRevenue('2026-08-31', '2026-08-01')).rejects.toThrow(ReportError);
  });

  it('refuses a malformed date', async () => {
    setApiTransport(fakeTransport([]).transport);
    await expect(fetchMonthlyRevenue('August 2026', '2026-08-31')).rejects.toThrow(ReportError);
  });

  it('caps the span it will read in one go', () => {
    // The aggregation is client-side, so an unbounded range on a school-gate connection is the
    // performance priority this project names first. Thirteen months so year-on-year fits.
    expect(MAX_REPORT_MONTHS).toBe(13);
  });
});

describe('unpaid orders are not revenue (E11-10)', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    service_date: '2026-08-17', status: 'paid', school_id: 's-1', school_name_snapshot: 'Amity',
    subtotal_paise: 10000, tax_cgst_paise: 250, tax_sgst_paise: 250, discount_paise: 0,
    total_paise: 10500, refunded_total_paise: 0, ...over,
  });

  it('keeps a pending_payment order out of gross', () => {
    // The bug this replaces. The old code was `if cancelled or refunded … else count as gross`,
    // so an order nobody had paid for was reported as money. On production that was ₹228.92 of
    // takings that did not exist — and a number being too big is the one error nobody queries.
    const [row] = summarise([order(), order({ status: 'pending_payment' })]);
    expect(row!.orders).toBe(2);
    expect(row!.grossPaise).toBe(10500);
    expect(row!.pending).toBe(1);
    expect(row!.pendingPaise).toBe(10500);
  });

  it('keeps a draft order out of gross too', () => {
    const [row] = summarise([order({ status: 'draft' })]);
    expect(row!.grossPaise).toBe(0);
    expect(row!.pendingPaise).toBe(10500);
  });

  it('counts preparing and delivered as earned — payment settled before the kitchen saw them', () => {
    const [row] = summarise([order({ status: 'preparing' }), order({ status: 'delivered' })]);
    expect(row!.grossPaise).toBe(21000);
    expect(row!.pending).toBe(0);
  });

  it('never adds pending money into gross, whatever the mix', () => {
    const [row] = summarise([
      order(), order({ status: 'pending_payment' }), order({ status: 'cancelled' }),
    ]);
    expect(row!.grossPaise).toBe(10500);
    expect(row!.netPaise).toBe(10500);
    expect(row!.orders).toBe(3);
  });

  it('refuses a status it has never heard of rather than guessing a side of the ledger', () => {
    // Guessing is precisely how `pending_payment` ended up in revenue. A new status must break
    // this loudly, in a test run, not quietly in a number somebody trusts.
    expect(() => summarise([order({ status: 'awaiting_something_new' })])).toThrow(/unknown status/);
  });
});

describe('groupRows and totalOf (E11-10)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    service_date: '2026-08-17', status: 'paid', school_id: 's-1', school_name_snapshot: 'Amity',
    subtotal_paise: 10000, tax_cgst_paise: 250, tax_sgst_paise: 250, discount_paise: 0,
    total_paise: 10500, refunded_total_paise: 0, ...over,
  });

  const rows = summarise([
    row(),
    row({ service_date: '2026-08-18' }),
    // 50000 so Gem genuinely outranks Amity's two orders at 10500 each — the first version of
    // this used 20000, which made Amity the bigger school and the ranking test was asserting
    // the wrong intent rather than catching a wrong sort.
    row({ service_date: '2026-09-02', school_id: 's-2', school_name_snapshot: 'Gem', total_paise: 50000 }),
  ]);

  it('folds to the same total however it is grouped', () => {
    // The property that makes three views trustworthy: they are folds of one set of rows, so a
    // per-school total and a per-month total cannot disagree.
    const totals = (['day', 'month', 'school'] as const).map((by) => totalOf(groupRows(rows, by)));
    expect(new Set(totals.map((t) => t.grossPaise)).size).toBe(1);
    expect(new Set(totals.map((t) => t.orders)).size).toBe(1);
    expect(totals[0]!.grossPaise).toBe(71000);
  });

  it('runs time forwards so a chart reads left to right', () => {
    expect(groupRows(rows, 'day').map((b) => b.key)).toEqual(['2026-08-17', '2026-08-18', '2026-09-02']);
    expect(groupRows(rows, 'month').map((b) => b.key)).toEqual(['2026-08', '2026-09']);
  });

  it('ranks schools by what they are worth, not alphabetically', () => {
    // A school breakdown is asked in order to see who the biggest is. Alphabetical buries it.
    expect(groupRows(rows, 'school').map((b) => b.label)).toEqual(['Gem', 'Amity']);
  });

  it('labels a school bucket with its name, not its id', () => {
    expect(groupRows(rows, 'school')[0]!.label).toBe('Gem');
  });

  it('totals an empty report to zeroes rather than throwing', () => {
    expect(totalOf([])).toMatchObject({ orders: 0, grossPaise: 0, netPaise: 0 });
  });
});

describe('placement-date reporting (E11-12)', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    service_date: '2026-08-21', status: 'paid', school_id: 's-1', school_name_snapshot: 'Amity',
    placed_at: '2026-08-19T23:11:57Z',
    subtotal_paise: 10000, tax_cgst_paise: 250, tax_sgst_paise: 250, discount_paise: 0,
    total_paise: 10500, refunded_total_paise: 0, ...over,
  });

  it('buckets an evening order into the IST day, not the UTC one', () => {
    // The real data this was built from: 3 of the first 4 production orders were placed after
    // 18:30 UTC. Bucketing by the UTC date would put most orders on the wrong day, in the one
    // report whose whole purpose is to say which day was busy.
    expect(istDayOf('2026-08-19T23:11:57Z')).toBe('2026-08-20');
    expect(istDayOf('2026-08-18T22:48:23Z')).toBe('2026-08-19');
    // Just before the boundary stays put.
    expect(istDayOf('2026-08-19T18:29:00Z')).toBe('2026-08-19');
    // Exactly on it rolls over.
    expect(istDayOf('2026-08-19T18:30:00Z')).toBe('2026-08-20');
  });

  it('returns empty rather than a phantom day for a missing timestamp', () => {
    expect(istDayOf(null)).toBe('');
    expect(istDayOf('')).toBe('');
    expect(istDayOf('nonsense')).toBe('');
  });

  it('separates orders for one service date placed on different days', () => {
    // The reason the row key had to get finer. Two orders for Friday's lunch, taken on different
    // evenings, are two facts to a demand report.
    const rows = summarise([
      order({ placed_at: '2026-08-18T22:00:00Z' }),
      order({ placed_at: '2026-08-19T23:00:00Z' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(groupRows(rows, 'placedDay').map((b) => b.key)).toEqual(['2026-08-19', '2026-08-20']);
    // ...and the service-date view still sees one day with both.
    expect(groupRows(rows, 'day')).toHaveLength(1);
    expect(groupRows(rows, 'day')[0]!.orders).toBe(2);
  });

  it('folds to the same totals on every axis, placement included', () => {
    const rows = summarise([
      order({ placed_at: '2026-08-18T22:00:00Z' }),
      order({ placed_at: '2026-08-19T23:00:00Z', service_date: '2026-08-22' }),
      order({ placed_at: '2026-08-24T05:00:00Z', school_id: 's-2', school_name_snapshot: 'Gem' }),
    ]);
    const axes = ['day', 'month', 'school', 'placedDay', 'placedWeek', 'placedMonth'] as const;
    const totals = axes.map((by) => totalOf(groupRows(rows, by)));
    expect(new Set(totals.map((t) => t.grossPaise)).size).toBe(1);
    expect(new Set(totals.map((t) => t.orders)).size).toBe(1);
    expect(totals[0]!.orders).toBe(3);
  });

  it('drops a row with no placed_at from the placement axes only', () => {
    // A draft that never reached checkout is not demand. It must not appear under an empty-string
    // key, which would sort to the top of every chart as a phantom period.
    const rows = summarise([order(), order({ placed_at: null })]);
    expect(totalOf(groupRows(rows, 'placedDay')).orders).toBe(1);
    expect(totalOf(groupRows(rows, 'day')).orders).toBe(2);
  });

  it('starts weeks on Monday, matching Mon–Sat service', () => {
    expect(weekOf('2026-08-24')).toBe('2026-08-24');  // a Monday
    expect(weekOf('2026-08-26')).toBe('2026-08-24');  // Wednesday
    expect(weekOf('2026-08-23')).toBe('2026-08-17');  // Sunday belongs to the week before
    expect(weekOf('2026-08-22')).toBe('2026-08-17');  // Saturday
  });

  it('compares against the window immediately before, of the same length', () => {
    // "Last 30 days" must be measured against the 30 before it, not a calendar month of a
    // different length — otherwise February always looks like a decline.
    expect(previousWindow('2026-08-18', '2026-08-24')).toEqual({ from: '2026-08-11', to: '2026-08-17' });
    expect(previousWindow('2026-08-24', '2026-08-24')).toEqual({ from: '2026-08-23', to: '2026-08-23' });
  });

  it('refuses to express growth from nothing as a percentage', () => {
    // A rise from zero is not a percentage, and rendering it as one is the infinity that makes a
    // dashboard untrustworthy.
    expect(compare(5, 0).change).toBeNull();
    expect(compare(0, 0).change).toBeNull();
    expect(compare(6, 4).change).toBeCloseTo(0.5);
    expect(compare(2, 4).change).toBeCloseTo(-0.5);
  });
});

describe('fetchOrdersPlaced windows in IST (E11-12)', () => {
  it('shifts both bounds by 5h30, and makes the upper one exclusive', async () => {
    const fake = fakeTransport([]);
    setApiTransport(fake.transport);
    await fetchOrdersPlaced('2026-08-20', '2026-08-20');

    const q = fake.queries[0]!;
    // 00:00 IST on the 20th is 18:30 UTC on the 19th.
    expect(q.gteFilters).toContainEqual({ column: 'placed_at', value: '2026-08-19T18:30:00.000Z' });
    // 00:00 IST on the 21st, exclusive — so the whole of the 20th is inside the window and an
    // order placed exactly at midnight belongs to the 21st, not to this day.
    expect(q.ltFilters).toContainEqual({ column: 'placed_at', value: '2026-08-20T18:30:00.000Z' });
  });

  it('refuses a backwards range', async () => {
    setApiTransport(fakeTransport([]).transport);
    await expect(fetchOrdersPlaced('2026-08-20', '2026-08-01')).rejects.toThrow(/ends .* before it starts/);
  });
});
