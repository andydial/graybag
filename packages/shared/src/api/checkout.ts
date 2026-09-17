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
  /**
   * The group's status as the server left it. `E21-98`.
   *
   * Almost always `pending_payment`, awaiting a webhook. It is **`paid`** on one path and only
   * one: a pack covered the whole cart, so `create_checkout` confirmed the redemptions, allocated
   * the pickup codes and set `paid_at` inline — there is no payment and no webhook that could ever
   * do it later.
   *
   * The server has returned this from the beginning, on both the fresh and the replayed path, and
   * nothing read it. The client went on to ask for a Razorpay order regardless, which on that path
   * is a 409 `nothing_payable` — a placed, paid, confirmed order reported to the parent as a
   * failure. Read it; do not infer it from `payablePaise === 0`, which is the symptom rather than
   * the fact.
   */
  status: string;
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
    // `pending_payment` when absent, never `paid`: an unknown status must fall to the path that
    // asks for money, because the failure there is a refusal a parent can see and retry. Falling
    // to `paid` would skip the payment on a response we did not understand.
    status: String(data.status ?? 'pending_payment'),
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
