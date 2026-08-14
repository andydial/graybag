/**
 * The parent's own orders. `E06-40`.
 *
 * # Why this did not exist until a real order had been paid for
 *
 * `OrdersScreen` was built with every state it needs — loading, ready, error, stale, signed out —
 * and **nothing ever passed it any of them**, because `api/` had no read. Its own header said so:
 * "It holds no data of its own." So three settled orders, three invoices and a balanced ledger
 * sat on the server while the screen rendered "no orders yet", and the confirmation email told the
 * parent their invoice was available in the app.
 *
 * That is the seventh instance of both-sides-built-wire-missing in this codebase, and the first
 * where the missing wire made an outbound email into a false promise.
 *
 * # A read, so the Supabase client is correct here
 *
 * Non-negotiable #1: reads may use the Supabase client, writes always go through Edge Functions.
 * RLS is the authorisation — `order_read_customer` admits `customer_user_id = auth.uid()` — so
 * this deliberately does **not** filter by user id in the query. Doing so would hide a policy
 * failure behind a client-side filter, and the point of default-deny is that the database refuses,
 * not that the client remembers to ask nicely.
 *
 * **The column list is the redaction**, as in `schools.ts`. `order` carries
 * `recipient_name_snapshot`, `config_snapshot` and the school and kitchen ids; a policy filters
 * rows and never columns. Only what a list row renders is selected.
 */
import { runQuery } from './client.js';

export type ApiOrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export interface ApiOrderSummary {
  /** `order_group.id` — what `E06-16` polls and what Order detail is keyed on. */
  orderGroupId: string;
  orderId: string;
  orderRef: string;
  serviceDate: string;
  /** **First name only** (§4.3, `G7`). `null` means the account holder — renders as "You". */
  recipientName: string | null;
  itemCount: number;
  /** Integer paise, GST-inclusive (non-negotiable #3). */
  totalPaise: number;
  status: ApiOrderStatus;
  /** Present once `issue_invoice` has run. The screen shows it as proof there is a document. */
  invoiceNumber: string | null;
}

/**
 * Every order this parent may see, newest service date first.
 *
 * Throws on failure rather than returning `[]`. **An empty list and a failed read are different
 * facts** (§5.21) and collapsing them is how "no orders yet" gets rendered over an outage — which
 * is exactly what the caller must be able to tell apart, so this refuses to make that impossible.
 */
export async function fetchOrders(): Promise<ApiOrderSummary[]> {
  const rows = await runQuery<Record<string, unknown>>((client) =>
    client
      .from('order')
      .select(
        // The invoice hangs off `order_group`, not off `order`, so it is a **nested** embed.
        // `invoice:order_group_id(...)` reads as an alias for the parent row and fails with
        // `42703: column order_group_1.invoice_number does not exist` — verified against staging
        // rather than guessed, because PostgREST's embed syntax is easy to write plausibly wrong.
        'id, order_group_id, order_ref, service_date, recipient_name_snapshot, status, total_paise, ' +
          'order_line(id), order_group(invoice(invoice_number))',
      )
      .order('service_date', { ascending: false })
      .limit(100),
  );

  return (rows ?? []).map((row) => {
    const lines = Array.isArray(row.order_line) ? row.order_line : [];
    const full = typeof row.recipient_name_snapshot === 'string' ? row.recipient_name_snapshot.trim() : '';
    // `invoice` is an array on the embed — a group has at most one `document_type = 'invoice'`,
    // but PostgREST returns the relationship, not our cardinality.
    const group = row.order_group as { invoice?: { invoice_number?: unknown }[] } | null | undefined;
    const invoice = group?.invoice?.[0];

    return {
      orderGroupId: String(row.order_group_id ?? ''),
      orderId: String(row.id ?? ''),
      orderRef: String(row.order_ref ?? ''),
      serviceDate: String(row.service_date ?? ''),
      // First name only. The snapshot holds the full name because the invoice needs it; a list
      // a parent may show to somebody else does not.
      recipientName: full === '' ? null : (full.split(/\s+/)[0] ?? null),
      itemCount: lines.length,
      totalPaise: Number(row.total_paise ?? 0),
      status: String(row.status ?? 'draft') as ApiOrderStatus,
      invoiceNumber:
        invoice && typeof invoice.invoice_number === 'string' ? invoice.invoice_number : null,
    };
  });
}
