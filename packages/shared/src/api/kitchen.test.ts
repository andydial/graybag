import { afterEach, describe, expect, it } from 'vitest';

import {
  KITCHEN_ORDER_COLUMNS,
  KitchenPayloadError,
  fetchKitchenOrders,
  fetchKitchenSchools,
  fetchMyGrants,
  setApiTransport,
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
  school_id: 's1',
  school_name_snapshot: 'Alpha Public School',
  break_time_id: 'b1',
  break_label_snapshot: 'Lunch break',
  recipient_name_snapshot: 'Aarav Sharma',
  class_label_snapshot: '5',
  section_label_snapshot: 'A',
  status: 'paid',
  pickup_code: null,
  order_line: [{ dish_id: 'd1', dish_name_snapshot: 'Veg Sandwich', quantity: 2 }],
  ...over,
});

describe('fetchKitchenOrders', () => {
  it('reads the order table directly, under RLS', async () => {
    // `order_read_backoffice` carries the caller's authority. If this ever becomes an RPC the
    // boundary moves from the database into a function body, and the policies stop deciding.
    const fake = install([ROW()]);
    await fetchKitchenOrders('2026-08-13');
    expect(fake.queries[0]?.table).toBe('order');
  });

  it('filters to the service date', async () => {
    const fake = install([ROW()]);
    await fetchKitchenOrders('2026-08-13');
    expect(fake.queries[0]?.filters).toContainEqual({ column: 'service_date', value: '2026-08-13' });
  });

  describe('the column list, which is the redaction', () => {
    it('selects no money column', async () => {
      // `orders.view_financials` is a separate grant from `orders.view` (D3, E09-09). A policy
      // filters rows, never columns — so this list is the only thing standing between a kitchen
      // porter and every total in the school. A test on the returned objects alone would pass
      // just as happily with select('*').
      for (const column of [
        'subtotal_paise', 'total_paise', 'tax_cgst_paise', 'tax_sgst_paise',
        'refunded_total_paise', 'discount_paise',
      ]) {
        expect(KITCHEN_ORDER_COLUMNS, column).not.toContain(column);
      }
    });

    it('selects no customer identity beyond the child being handed food', async () => {
      // The kitchen needs the child's name to hand over a bag. It does not need the parent.
      expect(KITCHEN_ORDER_COLUMNS).not.toContain('customer_user_id');
      expect(KITCHEN_ORDER_COLUMNS).not.toContain('recipient_id');
    });

    it('is the list actually sent', async () => {
      const fake = install([ROW()]);
      await fetchKitchenOrders('2026-08-13');
      expect(fake.queries[0]?.columns).toBe(KITCHEN_ORDER_COLUMNS);
    });
  });

  describe('the parent\u2019s per-line note', () => {
    // `ux-spec` §5.6.1 makes the field conditional on the kitchen seeing it: either the kitchen
    // renders the note against its line, or the field is not built at all. That makes the column
    // being in the select a product requirement, not an implementation detail.
    it('is selected, because a note the kitchen never sees is why the field would not exist', () => {
      expect(KITCHEN_ORDER_COLUMNS).toContain('special_comments');
    });

    it('comes through against its own line', async () => {
      install([ROW({ order_line: [
        { dish_id: 'd1', dish_name_snapshot: 'Veg Sandwich', quantity: 1, special_comments: 'Less spicy' },
        { dish_id: 'd2', dish_name_snapshot: 'Cold Coffee', quantity: 1, special_comments: null },
      ] })]);
      const [order] = await fetchKitchenOrders('2026-08-13');
      // Per line and not per order: "less spicy" on one wrap and not the other is the case the
      // field was designed around, and an order-level note cannot express it.
      expect(order?.lines.map((l) => l.note)).toEqual(['Less spicy', null]);
    });

    it('treats blank and whitespace-only as no note', async () => {
      // Otherwise the screen renders an empty amber flag against a dish, which reads as "there
      // is something to know here" when there is not.
      install([ROW({ order_line: [
        { dish_id: 'd1', dish_name_snapshot: 'A', quantity: 1, special_comments: '   ' },
      ] })]);
      const [order] = await fetchKitchenOrders('2026-08-13');
      expect(order?.lines[0]?.note).toBeNull();
    });

    it('is trimmed rather than rendered with its padding', async () => {
      install([ROW({ order_line: [
        { dish_id: 'd1', dish_name_snapshot: 'A', quantity: 1, special_comments: '  No onion  ' },
      ] })]);
      const [order] = await fetchKitchenOrders('2026-08-13');
      expect(order?.lines[0]?.note).toBe('No onion');
    });

    it('is absent, not undefined, when the column is missing from the payload', async () => {
      install([ROW()]);
      const [order] = await fetchKitchenOrders('2026-08-13');
      expect(order?.lines[0]?.note).toBeNull();
    });
  });

  it('maps a row to the shape the dashboard renders', async () => {
    install([ROW()]);
    const [order] = await fetchKitchenOrders('2026-08-13');
    expect(order).toEqual({
      id: 'o1',
      orderRef: 'SEED-001',
      schoolId: 's1',
      schoolName: 'Alpha Public School',
      breakId: 'b1',
      breakLabel: 'Lunch break',
      recipientName: 'Aarav Sharma',
      classLabel: '5',
      sectionLabel: 'A',
      status: 'paid',
      pickupCode: null,
      lines: [{ dishId: 'd1', dishName: 'Veg Sandwich', quantity: 2, note: null }],
    });
  });

  it('drops a pending_payment order rather than showing it', async () => {
    // `L5`: the kitchen never cooks against money that has not arrived, and a dashboard that
    // shows one invites exactly that. Not an error — the caller may legitimately read it.
    install([ROW({ id: 'a', status: 'pending_payment' }), ROW({ id: 'b', status: 'paid' })]);
    const orders = await fetchKitchenOrders('2026-08-13');
    expect(orders.map((o) => o.id)).toEqual(['b']);
  });

  it('drops a draft order too', async () => {
    install([ROW({ status: 'draft' })]);
    expect(await fetchKitchenOrders('2026-08-13')).toEqual([]);
  });

  it('keeps cancelled orders, because the screen has to show them', async () => {
    install([ROW({ status: 'cancelled' })]);
    expect(await fetchKitchenOrders('2026-08-13')).toHaveLength(1);
  });

  it('returns an empty list when the caller may see nothing', async () => {
    // RLS filtering everything out is not an error. The screen turns this into an explanation
    // rather than into "nobody ordered today" — §5.21's N3, whose misreading in a kitchen means
    // nobody cooks.
    install([]);
    expect(await fetchKitchenOrders('2026-08-13')).toEqual([]);
  });

  describe('a row it cannot read is a failure, not a guess', () => {
    it('refuses a row with no id', async () => {
      install([ROW({ id: null })]);
      await expect(fetchKitchenOrders('2026-08-13')).rejects.toThrow(KitchenPayloadError);
    });

    it('refuses a line with no dish name rather than rendering "1 × undefined"', async () => {
      install([ROW({ order_line: [{ dish_id: 'd1', dish_name_snapshot: null, quantity: 1 }] })]);
      await expect(fetchKitchenOrders('2026-08-13')).rejects.toThrow(/unreadable line/);
    });

    it('refuses a line with no quantity', async () => {
      install([ROW({ order_line: [{ dish_id: 'd1', dish_name_snapshot: 'x', quantity: null }] })]);
      await expect(fetchKitchenOrders('2026-08-13')).rejects.toThrow(/unreadable line/);
    });
  });

  it('handles an order with no lines without inventing any', async () => {
    install([ROW({ order_line: [] })]);
    const [order] = await fetchKitchenOrders('2026-08-13');
    expect(order?.lines).toEqual([]);
  });

  it('handles a school with no breaks', async () => {
    install([ROW({ break_time_id: null, break_label_snapshot: null })]);
    const [order] = await fetchKitchenOrders('2026-08-13');
    expect(order?.breakId).toBeNull();
    expect(order?.breakLabel).toBeNull();
  });
});

describe('fetchKitchenSchools', () => {
  it('reads the school table, not the day’s orders', async () => {
    // Deriving the list from orders made the filter appear and disappear with the data: a school
    // that ordered nothing vanished, and a one-school day showed no filter at all — so nobody
    // could tell whether they were seeing every school or one of several.
    const fake = install([{ id: 's1', name: 'Alpha Public School' }]);
    await fetchKitchenSchools();
    expect(fake.queries[0]?.table).toBe('school');
  });

  it('returns them in name order', async () => {
    install([
      { id: 's1', name: 'Alpha Public School' },
      { id: 's2', name: 'Bravo International School' },
    ]);
    expect(await fetchKitchenSchools()).toEqual([
      { id: 's1', name: 'Alpha Public School' },
      { id: 's2', name: 'Bravo International School' },
    ]);
  });

  it('drops a school it cannot name rather than drawing a blank chip', async () => {
    install([{ id: 's1', name: null }, { id: 's2', name: 'Bravo International School' }]);
    expect(await fetchKitchenSchools()).toEqual([{ id: 's2', name: 'Bravo International School' }]);
  });

  it('scopes by RLS rather than by a filter written here', async () => {
    // `permission_grant` widens platform -> city -> kitchen -> school, so the policy returns
    // exactly what the caller may see. A `.eq('kitchen_id', ...)` here would be a second,
    // weaker copy of that rule which could disagree with it.
    const fake = install([]);
    await fetchKitchenSchools();
    expect(fake.queries[0]?.filters ?? []).toEqual([]);
  });

  it('returns nothing for an account with no schools, rather than failing', async () => {
    install([]);
    expect(await fetchKitchenSchools()).toEqual([]);
  });
});

describe('fetchMyGrants', () => {
  it('reads the caller’s own grants under permission_grant_read_self', async () => {
    const fake = install([{ permission_code: 'orders.view' }]);
    await fetchMyGrants();
    expect(fake.queries[0]?.table).toBe('permission_grant');
  });

  it('excludes revoked grants', async () => {
    const fake = install([]);
    await fetchMyGrants();
    // `eq('revoked_at', null)` would render as `= null`, which is never true — so a revoked
    // grant would be filtered by nothing at all. The same trap `fetchRecipients` hit.
    expect(fake.queries[0]?.isFilters).toContainEqual({ column: 'revoked_at', value: null });
  });

  it('deduplicates and sorts, because one code can be granted at several scopes', async () => {
    install([
      { permission_code: 'orders.view' },
      { permission_code: 'orders.view' },
      { permission_code: 'menu.edit' },
    ]);
    expect(await fetchMyGrants()).toEqual(['menu.edit', 'orders.view']);
  });

  it('returns nothing for an account with no grants, rather than failing', async () => {
    install([]);
    expect(await fetchMyGrants()).toEqual([]);
  });
});
