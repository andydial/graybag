/**
 * Placing an order — `E05-09` from the client's side.
 *
 * The first WRITE in the `api/` module, and it goes through an Edge Function because every
 * write does (`A4`, non-negotiable #1). Nothing here computes money: the server prices the
 * cart, and `expectedTotalPaise` is sent so the server can REFUSE if its answer differs
 * (`L7`), not so it can be believed.
 */
import { invokeFunction } from './client.js';

export interface CheckoutLine {
  recipientId: string;
  /** ISO date, the day the food is eaten. */
  serviceDate: string;
  menuItemId: string;
  quantity: number;
  breakTimeId?: string | null;
}

export interface CheckoutResult {
  orderGroupId: string;
  correlationId: string;
  payablePaise: number;
  /** True when this was a replay of an earlier identical request (`E05-12`). */
  replayed: boolean;
  orders: { orderId: string; orderRef: string; serviceDate: string; totalPaise: number }[];
}

/**
 * Place a checkout.
 *
 * `idempotencyKey` is the caller's, and it must be **stable across retries of the same
 * cart** — that is the entire mechanism (`E05-12`). Generate it once when the customer taps
 * Pay, not per attempt: a key regenerated on retry turns a timeout into a second order.
 *
 * `expectedTotalPaise` is what the customer was shown. A mismatch comes back as
 * `ApiError` with `code = 'price_changed'` and the checkout is not created.
 */
export async function createCheckout(input: {
  idempotencyKey: string;
  expectedTotalPaise: number | null;
  lines: CheckoutLine[];
}): Promise<CheckoutResult> {
  const data = await invokeFunction<Record<string, unknown>>('checkout', {
    idempotency_key: input.idempotencyKey,
    expected_total_paise: input.expectedTotalPaise,
    lines: input.lines.map((l) => ({
      recipient_id: l.recipientId,
      service_date: l.serviceDate,
      menu_item_id: l.menuItemId,
      quantity: l.quantity,
      break_time_id: l.breakTimeId ?? null,
    })),
  });

  const orders = Array.isArray(data.orders) ? data.orders : [];
  return {
    orderGroupId: String(data.order_group_id ?? ''),
    correlationId: String(data.correlation_id ?? ''),
    payablePaise: Number(data.payable_paise ?? 0),
    replayed: data.replayed === true,
    orders: orders.map((o) => {
      const row = o as Record<string, unknown>;
      return {
        orderId: String(row.order_id ?? ''),
        orderRef: String(row.order_ref ?? ''),
        serviceDate: String(row.service_date ?? ''),
        totalPaise: Number(row.total_paise ?? 0),
      };
    }),
  };
}
