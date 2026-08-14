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
 * # Scoped to the signed-in customer, explicitly
 *
 * This first shipped without a `customer_user_id` filter, on the reasoning that RLS is the
 * authorisation and a client-side filter would hide a policy failure. **That reasoning was wrong
 * for this screen**, and Andy caught it by opening "My Orders" and seeing sixty other families'
 * children.
 *
 * `order_read_customer` is not the only SELECT policy on `order`. `order_read_backoffice` admits
 * anyone holding `orders.view` for the school — which is correct, and is how the kitchen screen
 * works. So "every order I am authorised to read" is a strictly larger set than "my orders", and
 * for an account with a back-office grant it is dramatically larger.
 *
 * **The scope is part of the screen's meaning, not an authorisation shortcut.** "My Orders" means
 * mine. The back-office view is a different screen with different semantics and its own query.
 * RLS stays as defence in depth: it is what makes the filter unable to *widen* the result.
 *
 * Non-negotiable #1 holds — reads may use the Supabase client; writes go through Edge Functions.
 *
 * **The column list is the redaction**, as in `schools.ts`. `order` carries
 * `recipient_name_snapshot`, `config_snapshot` and the school and kitchen ids; a policy filters
 * rows and never columns. Only what a list row renders is selected.
 */
import { currentUser } from './auth.js';
import { ApiError, runQuery } from './client.js';

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
  const user = await currentUser();
  if (user === null) {
    // Not "return []": a signed-out caller asking for *my* orders is a bug in the caller, and an
    // empty list would let it look like a parent with no orders. §5.21 again.
    throw new ApiError('Not signed in.', 'not_signed_in');
  }

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
      // **The scope, stated.** See the header: RLS admits more than "mine" for any account with a
      // back-office grant, and this screen means mine.
      .eq('customer_user_id', user.userId)
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

export interface ApiOrderDetail extends ApiOrderSummary {
  schoolName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  breakLabel: string | null;
  /** The server's own figures. This is a settled order; the receipt reports, it does not compute. */
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  pickupCode: string | null;
  placedAt: string | null;
  paidAt: string | null;
  preparingAt: string | null;
  deliveredAt: string | null;
  lines: { key: string; name: string; quantity: number; unitPricePaise: number }[];
}

/**
 * One order, for Order detail. `E06-34`.
 *
 * The screen was routed bare for a fortnight — every state it can render was unreachable, and
 * tapping a row showed an empty screen with the invoice number it is supposed to surface nowhere
 * in the app. `reachability.test.ts` caught it the day that guard was written.
 *
 * **Keyed on `order_group_id`, not `order.id`**, because that is what `OrdersScreen` hands over
 * and what `E06-16` polls. One group is one payment, one recipient, one service date (`AR8`).
 *
 * Throws rather than returning `null` for a failed read, exactly as `fetchOrders` does: a blank
 * detail screen must only be renderable over a read that succeeded (§5.21).
 */
export async function fetchOrderDetail(orderGroupId: string): Promise<ApiOrderDetail | null> {
  const user = await currentUser();
  if (user === null) throw new ApiError('Not signed in.', 'not_signed_in');

  const rows = await runQuery<Record<string, unknown>>((client) =>
    client
      .from('order')
      .select(
        'id, order_group_id, order_ref, service_date, recipient_name_snapshot, status, total_paise, ' +
          'subtotal_paise, tax_cgst_paise, tax_sgst_paise, school_name_snapshot, class_label_snapshot, ' +
          'section_label_snapshot, break_label_snapshot, pickup_code, placed_at, confirmed_at, ' +
          'preparing_at, delivered_at, ' +
          'order_line(id, dish_name_snapshot, quantity, unit_price_paise), ' +
          'order_group(invoice(invoice_number))',
      )
      .eq('order_group_id', orderGroupId)
      // Scoped for the same reason as the list: a back-office grant would otherwise open any
      // order's detail — including a child's name, class and section — from the customer screen.
      .eq('customer_user_id', user.userId)
      .limit(1),
  );

  const row = rows[0];
  // Not found is a legitimate answer and distinct from a failed read, which threw above.
  if (!row) return null;

  const full = typeof row.recipient_name_snapshot === 'string' ? row.recipient_name_snapshot.trim() : '';
  const group = row.order_group as { invoice?: { invoice_number?: unknown }[] } | null | undefined;
  const lines = Array.isArray(row.order_line) ? (row.order_line as Record<string, unknown>[]) : [];

  return {
    orderGroupId: String(row.order_group_id ?? ''),
    orderId: String(row.id ?? ''),
    orderRef: String(row.order_ref ?? ''),
    serviceDate: String(row.service_date ?? ''),
    recipientName: full === '' ? null : (full.split(/\s+/)[0] ?? null),
    itemCount: lines.length,
    totalPaise: Number(row.total_paise ?? 0),
    status: String(row.status ?? 'draft') as ApiOrderStatus,
    invoiceNumber:
      typeof group?.invoice?.[0]?.invoice_number === 'string' ? group.invoice[0].invoice_number : null,
    schoolName: String(row.school_name_snapshot ?? ''),
    classLabel: (row.class_label_snapshot as string | null) ?? null,
    sectionLabel: (row.section_label_snapshot as string | null) ?? null,
    breakLabel: (row.break_label_snapshot as string | null) ?? null,
    subtotalPaise: Number(row.subtotal_paise ?? 0),
    cgstPaise: Number(row.tax_cgst_paise ?? 0),
    sgstPaise: Number(row.tax_sgst_paise ?? 0),
    pickupCode: (row.pickup_code as string | null) ?? null,
    placedAt: (row.placed_at as string | null) ?? null,
    // **`confirmed_at`, not `paid_at`.** `order` has no `paid_at` — the settlement instant is
    // `confirmed_at` (§4.1's T5). `order_group` is what carries `paid_at`, and reaching for the
    // familiar name here would have been a 400 at the first tap.
    paidAt: (row.confirmed_at as string | null) ?? null,
    preparingAt: (row.preparing_at as string | null) ?? null,
    deliveredAt: (row.delivered_at as string | null) ?? null,
    lines: lines.map((l) => ({
      key: String(l.id),
      name: String(l.dish_name_snapshot ?? ''),
      quantity: Number(l.quantity ?? 0),
      unitPricePaise: Number(l.unit_price_paise ?? 0),
    })),
  };
}
