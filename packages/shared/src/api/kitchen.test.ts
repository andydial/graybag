import { afterEach, describe, expect, it } from 'vitest';

import {
  KITCHEN_ORDER_COLUMNS,
  KitchenPayloadError,
  fetchKitchenOrders,
  fetchKitchenSchools,
  fetchMyGrants,
  setApiTransport,
  updateKitchenOrderStatus,
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
      allergenCodes: null,
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

describe('allergen flags — E09-33', () => {
  const withAllergens = (codes: string[] | null) =>
    ROW({ recipient: codes === null ? null : { recipient_allergen: codes.map((code) => ({ allergen: { code } })) } });

  it('selects the enumerated codes, never the free-text notes', () => {
    // `recipient.allergy_note` and `recipient_allergen.note` are things a parent typed. Andy,
    // 2026-08-14: "No parent notes, no severity prose, no medical detail."
    expect(KITCHEN_ORDER_COLUMNS).toContain('recipient(recipient_allergen(allergen(code)))');
    expect(KITCHEN_ORDER_COLUMNS).not.toContain('allergy_note');
    expect(KITCHEN_ORDER_COLUMNS).not.toContain('severity');
  });

  it('does not select the recipient id, only the embed', () => {
    // The kitchen needs badges, not an identifier it could join on.
    expect(KITCHEN_ORDER_COLUMNS).not.toContain('recipient_id');
  });

  it('returns sorted, de-duplicated codes', async () => {
    install([withAllergens(['tree_nut', 'milk', 'milk'])]);
    const [order] = await fetchKitchenOrders('2026-08-14');
    expect(order?.allergenCodes).toEqual(['milk', 'tree_nut']);
  });

  it('distinguishes "none recorded" from "not readable"', async () => {
    // The single worst way for this to be wrong is a permissions failure rendering as a clean
    // bill of health. PostgREST returns `recipient: null` when RLS filters the row, and an empty
    // array when the child simply has none.
    install([withAllergens([])]);
    expect((await fetchKitchenOrders('2026-08-14'))[0]?.allergenCodes).toEqual([]);

    install([withAllergens(null)]);
    expect((await fetchKitchenOrders('2026-08-14'))[0]?.allergenCodes).toBeNull();
  });

  it('drops an unreadable code rather than rendering an empty badge', async () => {
    install([ROW({ recipient: { recipient_allergen: [{ allergen: { code: null } }, { allergen: { code: 'soy' } }] } })]);
    expect((await fetchKitchenOrders('2026-08-14'))[0]?.allergenCodes).toEqual(['soy']);
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
      { id: 's1', name: 'Alpha Public School', is_active: true },
      { id: 's2', name: 'Bravo International School', is_active: true },
    ]);
    expect((await fetchKitchenSchools()).map((s) => s.name)).toEqual([
      'Alpha Public School',
      'Bravo International School',
    ]);
  });

  it('drops a school it cannot name rather than drawing a blank chip', async () => {
    install([{ id: 's1', name: null }, { id: 's2', name: 'Bravo International School' }]);
    expect((await fetchKitchenSchools()).map((s) => s.id)).toEqual(['s2']);
  });

  describe('is_active is reported, not applied', () => {
    // The caller needs both halves: active schools, plus any school with orders on the day being
    // viewed. Filtering here would make the second half impossible.
    it('carries the flag through', async () => {
      install([
        { id: 's1', name: 'Retired School', is_active: false },
        { id: 's2', name: 'Serving School', is_active: true },
      ]);
      expect(await fetchKitchenSchools()).toEqual([
        { id: 's1', name: 'Retired School', isActive: false },
        { id: 's2', name: 'Serving School', isActive: true },
      ]);
    });

    it('never filters an inactive school out of the read', async () => {
      install([{ id: 's1', name: 'Retired School', is_active: false }]);
      expect(await fetchKitchenSchools()).toHaveLength(1);
    });

    it('treats a missing column as active, because hiding a school is the worse way to be wrong', async () => {
      install([{ id: 's1', name: 'Alpha Public School' }]);
      expect((await fetchKitchenSchools())[0]?.isActive).toBe(true);
    });
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

describe('updateKitchenOrderStatus — a cancellation must say what happened (E09-38)', () => {
  const cancel = (over: Record<string, unknown> = {}) =>
    updateKitchenOrderStatus({
      orderIds: ['11111111-1111-1111-1111-111111111111'],
      to: 'cancelled',
      reasonCode: 'dish_unavailable',
      ...over,
    } as never);

  it('refuses a cancellation with no typed detail', async () => {
    // The whole point of E09-38: the customer is emailed, and a reason code alone reaches them
    // as "Dish unavailable", which does not tell a parent whether their child ate.
    await expect(cancel()).rejects.toThrow(/sentence saying what happened/i);
  });

  it('refuses whitespace, which is how a required field gets satisfied in a hurry', async () => {
    await expect(cancel({ reasonDetail: '   ' })).rejects.toThrow(/sentence saying what happened/i);
  });

  it('refuses a single keystroke', async () => {
    await expect(cancel({ reasonDetail: 'x' })).rejects.toThrow(/sentence saying what happened/i);
  });

  it('still refuses a cancellation with no reason code, and says so distinctly', async () => {
    // Two different faults with two different fixes; one message for both would be worse than
    // either. The code check comes first because it is the older contract.
    await expect(
      cancel({ reasonCode: undefined, reasonDetail: 'The van broke down.' }),
    ).rejects.toThrow(/reason code/i);
  });

  it('accepts a short but real sentence', async () => {
    // "Van broke" is four characters past the floor and is a perfectly good explanation. The
    // guard exists to refuse a keystroke, not to demand an essay — so this must get past
    // validation and fail later, on the transport, which is not installed here.
    await expect(cancel({ reasonDetail: 'Van broke down' })).rejects.not.toThrow(
      /sentence saying what happened/i,
    );
  });

  it('asks nothing extra of the other transitions', async () => {
    // Marking delivered is the action taken nineteen times in twenty. It must not acquire a
    // dialog because cancelling did.
    await expect(
      updateKitchenOrderStatus({ orderIds: [], to: 'delivered' }),
    ).resolves.toEqual({ updated: [], skipped: [] });
  });
});
