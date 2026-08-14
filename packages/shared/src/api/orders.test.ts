import { afterEach, describe, expect, it } from 'vitest';

import { setApiTransport } from './client.js';
import { fetchOrders } from './orders.js';
import { fakeTransport } from './test-support.js';

/**
 * `E06-40`. The read that did not exist while three settled orders sat on the server.
 *
 * The assertion that matters most is the negative one: **this must not filter by user id.**
 * Authorisation is `order_read_customer`, an RLS policy. A client-side `eq('customer_user_id', …)`
 * would produce the same list on a healthy day and hide a policy failure on a bad one — and the
 * point of default-deny is that the database refuses, not that the client remembers to ask nicely.
 */
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

  it('does NOT filter by user id — RLS is the authorisation', async () => {
    const { queries } = install([]);
    await fetchOrders();
    const filtered = queries[0]?.filters.map((f) => f.column) ?? [];
    expect(filtered).not.toContain('customer_user_id');
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
