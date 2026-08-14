import { afterEach, describe, expect, it } from 'vitest';

import {
  ADMIN_ORDER_COLUMNS,
  AdminOrderPayloadError,
  fetchAdminOrders,
  setApiTransport,
  totalsFor,
} from './index.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

const install = (rows: unknown, error: { message: string; code?: string } | null = null) => {
  const fake = fakeTransport(rows, error);
  setApiTransport(fake.transport);
  return fake;
};

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  order_ref: 'SEED-001',
  service_date: '2026-08-14',
  status: 'paid',
  school_id: 's1',
  school_name_snapshot: 'Alpha Public School',
  kitchen_id: 'k1',
  break_label_snapshot: 'Lunch break',
  recipient_name_snapshot: 'Aarav Sharma',
  class_label_snapshot: '5',
  section_label_snapshot: 'A',
  subtotal_paise: 10_000,
  tax_cgst_paise: 250,
  tax_sgst_paise: 250,
  discount_paise: 0,
  total_paise: 10_500,
  refunded_total_paise: 0,
  ...over,
});

const order = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
function base() {
  return {
    id: 'o1', orderRef: 'r', serviceDate: '2026-08-14', status: 'paid',
    schoolId: 's1', schoolName: 'Alpha', kitchenId: 'k1', breakLabel: null,
    recipientName: 'A', classLabel: null, sectionLabel: null,
    subtotalPaise: 10_000, taxPaise: 500, discountPaise: 0, totalPaise: 10_500, refundedPaise: 0,
  };
}

describe('fetchAdminOrders', () => {
  it('reads the order table directly, under RLS', async () => {
    const fake = install([ROW()]);
    await fetchAdminOrders('2026-08-14');
    expect(fake.queries[0]?.table).toBe('order');
  });

  it('never filters by kitchen — RLS decides which kitchens the caller sees', async () => {
    // `permission_grant` widens platform -> city -> kitchen -> school. A `.eq('kitchen_id', …)`
    // here would be a second, weaker copy of that rule, and the weaker copy is the one that
    // drifts. The only filter is the day.
    const fake = install([]);
    await fetchAdminOrders('2026-08-14');
    expect(fake.queries[0]?.filters).toEqual([{ column: 'service_date', value: '2026-08-14' }]);
  });

  describe('the column list, which is the other half of D3', () => {
    it('selects money, unlike the kitchen list', async () => {
      for (const column of ['subtotal_paise', 'total_paise', 'refunded_total_paise']) {
        expect(ADMIN_ORDER_COLUMNS).toContain(column);
      }
    });

    it('is the list actually sent', async () => {
      const fake = install([ROW()]);
      await fetchAdminOrders('2026-08-14');
      expect(fake.queries[0]?.columns).toBe(ADMIN_ORDER_COLUMNS);
    });
  });

  it('maps a row, summing the two GST halves for display', async () => {
    install([ROW()]);
    const [o] = await fetchAdminOrders('2026-08-14');
    expect(o?.taxPaise).toBe(500);
    expect(o?.totalPaise).toBe(10_500);
  });

  it('keeps a pending_payment order, unlike the kitchen board', async () => {
    // `L5` keeps unpaid orders off the *kitchen's* list so nobody cooks against money that has
    // not arrived. This screen answers "what happened to this order", and an order that never
    // got paid for is exactly the case somebody is looking into.
    install([ROW({ status: 'pending_payment' })]);
    expect(await fetchAdminOrders('2026-08-14')).toHaveLength(1);
  });

  describe('money is read strictly', () => {
    it('refuses a missing total rather than rendering a free order', async () => {
      // `Number(null)` is 0, and ₹0.00 is the one error here nobody would question — it looks
      // like a free order, not like a bug.
      install([ROW({ total_paise: null })]);
      await expect(fetchAdminOrders('2026-08-14')).rejects.toThrow(AdminOrderPayloadError);
    });

    it('refuses a non-integer amount', async () => {
      // Non-negotiable #3 is about the type as much as the arithmetic.
      install([ROW({ total_paise: 105.5 })]);
      await expect(fetchAdminOrders('2026-08-14')).rejects.toThrow(/non-integer total/);
    });

    it('names the order in the error, so it can be found', async () => {
      install([ROW({ order_ref: 'SEED-042', subtotal_paise: undefined })]);
      await expect(fetchAdminOrders('2026-08-14')).rejects.toThrow(/SEED-042/);
    });
  });

  it('returns an empty list when the caller may see nothing', async () => {
    install([]);
    expect(await fetchAdminOrders('2026-08-14')).toEqual([]);
  });
});

describe('totalsFor', () => {
  it('sums gross across the orders on screen', () => {
    expect(totalsFor([order(), order({ id: 'o2' })]).grossPaise).toBe(21_000);
  });

  it('excludes cancelled orders from gross, and counts them separately', () => {
    // A cancelled order is not revenue. Counting it would overstate the day to whoever reads
    // this to answer "what did we take".
    const t = totalsFor([order(), order({ id: 'o2', status: 'cancelled' })]);
    expect(t.grossPaise).toBe(10_500);
    expect(t.cancelled).toBe(1);
    expect(t.orders).toBe(2);
  });

  it('nets refunds off the gross', () => {
    const t = totalsFor([order({ refundedPaise: 2_000 })]);
    expect(t.netPaise).toBe(8_500);
  });

  it('counts a refund against an otherwise ordinary order', () => {
    // A partly refunded order is still revenue, minus the refund — not a cancellation.
    const t = totalsFor([order({ refundedPaise: 500 })]);
    expect(t.cancelled).toBe(0);
    expect(t.grossPaise).toBe(10_500);
    expect(t.refundedPaise).toBe(500);
  });

  it('is zero for an empty day rather than NaN', () => {
    expect(totalsFor([])).toEqual({
      orders: 0, grossPaise: 0, refundedPaise: 0, netPaise: 0, cancelled: 0,
    });
  });
});
