import { afterEach, describe, expect, it } from 'vitest';

import { setApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';
import { ADMIN_ORDER_COLUMNS } from './admin-orders.js';
import {
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
  it('groups by month and school', () => {
    const rows = summarise([
      order(),
      order({ service_date: '2026-08-18' }),
      order({ service_date: '2026-09-01' }),
      order({ school_id: 's-2', school_name_snapshot: 'Gem' }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.month === '2026-08' && r.schoolId === 's-1')!.orders).toBe(2);
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
