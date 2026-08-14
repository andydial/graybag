import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The session the read scopes itself to. Mocked rather than stubbed through the transport,
// because `currentUser` goes through the auth client and not through a query.
let mockUser: { userId: string; email: string | null } | null = { userId: 'user-1', email: null };
vi.mock('./auth.js', () => ({ currentUser: async () => mockUser }));

import { setApiTransport } from './client.js';
import { fetchOrderDetail, fetchOrders } from './orders.js';
import { fakeTransport } from './test-support.js';

/**
 * `E06-40`. The read that did not exist while three settled orders sat on the server.
 *
 * **This header used to say the opposite of what the file now asserts**, and it survived the fix
 * because a comment is not compiled. It required that the read must *not* filter by user id, on
 * the reasoning that RLS is the authorisation and a client-side filter would mask a policy
 * failure. `E06-43` — see the test at "scopes to the signed-in customer" — is what that cost, and
 * leaving two contradictory records in one file is how the wrong one gets read next.
 *
 * The rule that replaced it: **scope belongs in the query, authorisation belongs in the policy,
 * ship both.** A "mine" screen states its own scope; RLS is what stops the query being able to
 * widen the result.
 */
beforeEach(() => { mockUser = { userId: 'user-1', email: null }; });
afterEach(() => setApiTransport(null));

const install = (rows: unknown, error: { message: string; code?: string } | null = null) => {
  const fake = fakeTransport(rows, error);
  setApiTransport(fake.transport);
  return fake;
};

const ROW = {
  id: 'o1',
  order_group_id: 'g1',
  order_ref: 'GB-FC17KH',
  service_date: '2026-08-15',
  recipient_name_snapshot: 'Aarav Dial',
  status: 'paid',
  total_paise: 14_596,
  order_line: [{ id: 1 }, { id: 2 }],
  order_group: { invoice: [{ invoice_number: 'GB/26-27/000001' }] },
};

describe('fetchOrders', () => {
  it('returns a settled order with its invoice number', async () => {
    install([ROW]);
    const [order] = await fetchOrders();
    expect(order).toMatchObject({
      orderGroupId: 'g1',
      orderRef: 'GB-FC17KH',
      status: 'paid',
      itemCount: 2,
      totalPaise: 14_596,
      invoiceNumber: 'GB/26-27/000001',
    });
  });

  it('shows the recipient’s FIRST name only', async () => {
    // §4.3, `G7`. The snapshot holds the full name because the invoice needs it; a list a parent
    // may hold up in a queue does not.
    install([ROW]);
    const [order] = await fetchOrders();
    expect(order?.recipientName).toBe('Aarav');
  });

  it('renders an order with no recipient as the account holder', async () => {
    install([{ ...ROW, recipient_name_snapshot: null }]);
    const [order] = await fetchOrders();
    // `null` means "you" — `E05-38`, an adult may order for themselves.
    expect(order?.recipientName).toBeNull();
  });

  it('reports no invoice as null rather than inventing one', async () => {
    install([{ ...ROW, status: 'pending_payment', order_group: { invoice: [] } }]);
    const [order] = await fetchOrders();
    expect(order?.invoiceNumber).toBeNull();
  });

  /**
   * **This test asserted the opposite, and the opposite was wrong.** `E06-43`.
   *
   * It required `fetchOrders` NOT to filter by user id, on the reasoning that RLS is the
   * authorisation and a client-side filter would mask a policy failure. Andy opened "My Orders"
   * on an account holding `orders.view` at kitchen scope and saw **65 orders, 5 of them his** —
   * sixty other families' children, names and classes included.
   *
   * The error was treating scope as an authorisation question. `order` has two SELECT policies:
   * `order_read_customer` and `order_read_backoffice`. "Every order I may read" is a strictly
   * larger set than "my orders", and for a back-office account it is dramatically larger. **The
   * scope is part of what the screen means.** RLS remains defence in depth — it is what stops the
   * filter being able to widen the result — but it was never going to narrow it to *mine*.
   */
  it('scopes to the signed-in customer, because "My Orders" means mine', async () => {
    const { queries } = install([]);
    await fetchOrders();
    const filter = queries[0]?.filters.find((f) => f.column === 'customer_user_id');
    expect(filter?.value).toBe('user-1');
  });

  it('refuses rather than returning an empty list when nobody is signed in', async () => {
    // An empty list would render as "no orders yet" for a caller that should never have asked.
    mockUser = null;
    await expect(fetchOrders()).rejects.toThrow(/signed in/i);
  });

  it('selects named columns, never a glob', async () => {
    // The column list is the redaction, as in `schools.ts`: `order` also carries
    // `config_snapshot`, the school and kitchen ids, and the FULL recipient name. A policy
    // filters rows and never columns.
    const { queries } = install([]);
    await fetchOrders();
    expect(queries[0]?.columns).not.toContain('*');
    expect(queries[0]?.columns).not.toContain('config_snapshot');
  });

  it('caps the number of rows it asks for', async () => {
    // A family ordering daily accrues hundreds of rows a year, and the connection is the
    // constraint this project names first.
    const { queries } = install([]);
    await fetchOrders();
    expect(queries[0]?.limits[0]).toBeGreaterThan(0);
  });

  it('throws on a failed read rather than returning an empty list', async () => {
    // §5.21, and the whole reason the Orders screen takes a `state`. "No orders yet" rendered
    // over an outage is an unknown presented as a known.
    install(null, { message: 'network is down', code: 'PGRST000' });
    await expect(fetchOrders()).rejects.toThrow(/network is down/);
  });
});

/**
 * `E06-42`. The cancellation boundary, and the three ways to get it wrong.
 *
 * The arithmetic itself is asserted in `supabase/tests/cancellation_window.test.sql`, against a
 * real snapshot and a kitchen that edits its config mid-test. What is asserted here is the
 * carriage: that the read **asks** for the computed columns, that `config_snapshot` is still not
 * among the things it asks for, and that a null crosses the boundary as a null.
 */
const DETAIL_ROW = {
  ...ROW,
  subtotal_paise: 13_900,
  tax_cgst_paise: 348,
  tax_sgst_paise: 348,
  school_name_snapshot: 'Wisdom Tree',
  class_label_snapshot: '4',
  section_label_snapshot: 'B',
  break_label_snapshot: 'Lunch',
  pickup_code: '4417',
  placed_at: '2026-08-13T09:00:00Z',
  confirmed_at: '2026-08-13T09:00:12Z',
  preparing_at: null,
  delivered_at: null,
  cancellation_closes_at: '2026-08-14T18:30:00Z',
  cancellation_allowed: true,
  order_line: [{ id: 1, dish_name_snapshot: 'Paneer wrap', quantity: 2, unit_price_paise: 6_950 }],
};

describe('fetchOrderDetail', () => {
  it('carries the cancellation window the server computed', async () => {
    install([DETAIL_ROW]);
    const detail = await fetchOrderDetail('g1');
    expect(detail?.cancellationClosesAt).toBe('2026-08-14T18:30:00Z');
    expect(detail?.cancellationAllowed).toBe(true);
  });

  it('asks the server for the window rather than deriving it', async () => {
    // The whole of `E06-42`. If these leave the column list, the screen silently returns to
    // "we can't tell" for every order — a regression with no error and no failing assertion
    // anywhere else, because `null` is a legal value for this field.
    const { queries } = install([DETAIL_ROW]);
    await fetchOrderDetail('g1');
    expect(queries[0]?.columns).toContain('cancellation_closes_at');
    expect(queries[0]?.columns).toContain('cancellation_allowed');
  });

  it('still never asks for config_snapshot', async () => {
    // The alternative implementation — fetch the snapshot, subtract in TypeScript — passes the
    // test above and ships `revenue_share_bps`, the commercial term with the school, to the
    // parent's device. The column list is the redaction.
    const { queries } = install([DETAIL_ROW]);
    await fetchOrderDetail('g1');
    expect(queries[0]?.columns).not.toContain('config_snapshot');
    expect(queries[0]?.columns).not.toContain('*');
  });

  it('passes an unknown window through as null, never as the cutoff', async () => {
    // A backfilled order, or one written before the config carried these keys. "We can't tell"
    // is the honest render; `?? cutoff_at` would be a promise made from missing data.
    install([{ ...DETAIL_ROW, cancellation_closes_at: null, cancellation_allowed: null }]);
    const detail = await fetchOrderDetail('g1');
    expect(detail?.cancellationClosesAt).toBeNull();
    expect(detail?.cancellationAllowed).toBe(false);
  });

  it('scopes to the signed-in customer, for the same reason the list does', async () => {
    // `E06-43`. A back-office grant would otherwise open any order's detail from the customer
    // screen — including a named child's class and section.
    const { queries } = install([DETAIL_ROW]);
    await fetchOrderDetail('g1');
    expect(queries[0]?.filters.find((f) => f.column === 'customer_user_id')?.value).toBe('user-1');
  });

  it('returns null for a missing order but throws on a failed read', async () => {
    // Two different facts, and the screen renders them differently (§5.21).
    install([]);
    expect(await fetchOrderDetail('nope')).toBeNull();

    install(null, { message: 'network is down', code: 'PGRST000' });
    await expect(fetchOrderDetail('g1')).rejects.toThrow(/network is down/);
  });
});
