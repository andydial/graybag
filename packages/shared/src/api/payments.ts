/**
 * Starting a payment — `E06-02`, the client's side.
 *
 * Two calls, in order, and they are separate on purpose:
 *
 *   1. `createCheckout` prices and places the orders (`./checkout.ts`);
 *   2. `createPaymentOrder` asks the server for a **Razorpay order** to open a sheet against.
 *
 * They are not one call because the second is retryable and the first is not. A parent whose
 * payment sheet is dismissed, or whose card is declined, taps Pay again — and that must produce a
 * new payment attempt against the **same** order group, not a second order group full of
 * duplicate lunches. `begin_payment` numbers the attempts; the orders are created once.
 */
import { invokeFunction } from './client.js';

export interface PaymentOrder {
  /**
   * Razorpay's **publishable** key id. The secret stays in the Edge Function and never reaches
   * a handset — a key secret in a mobile binary is extractable by anyone who downloads the app.
   */
  keyId: string;
  /** Razorpay's order id, `order_…`. What the SDK is opened against. */
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  orderGroupId: string;
  /** §13.6 — quote this to support and the whole life of the order can be reconstructed. */
  correlationId: string;
  /** 1 for the first attempt. A retry after a decline is 2, and is not a duplicate order. */
  attemptNo: number;
}

/**
 * Ask the server to create a Razorpay order for an already-placed order group.
 *
 * Refusals arrive as `ApiError` with a `code`, and each one means something different to a
 * parent standing in a school gate queue:
 *
 * - `already_paid` — this order settled. Do not open a sheet; show the order.
 * - `not_payable` — cancelled or refunded. There is nothing to pay.
 * - `amount_mismatch` — the price changed under us. Send them back to the cart rather than
 *   charging a figure they were not shown (`L7`).
 * - `nothing_payable` — a zero payable, which wallet-only checkout will produce (`E06-10`).
 *
 * A 404 is deliberately returned both for an order that does not exist and one belonging to
 * somebody else, so the caller cannot tell them apart. Do not try to.
 */
export async function createPaymentOrder(orderGroupId: string): Promise<PaymentOrder> {
  const data = await invokeFunction<Record<string, unknown>>('payments-create-order', {
    order_group_id: orderGroupId,
  });

  return {
    keyId: String(data.key_id ?? ''),
    providerOrderId: String(data.provider_order_id ?? ''),
    amountPaise: Number(data.amount_paise ?? 0),
    currency: String(data.currency ?? 'INR'),
    orderGroupId: String(data.order_group_id ?? orderGroupId),
    correlationId: String(data.correlation_id ?? ''),
    attemptNo: Number(data.attempt_no ?? 1),
  };
}

/**
 * What the server says happened to a checkout — `E06-16`.
 *
 * `pending` is the important one and the reason this is not a boolean: it means **money may have
 * moved and we cannot yet say**. It is never a failure and must never be rendered as one. A UPI
 * intent payment app-switches away by construction, so this is the ordinary path, not the sad one.
 */
export type CheckoutStatus = 'paid' | 'pending' | 'unpaid' | 'failed' | 'cancelled';

/**
 * The settled order, present only when `status === 'paid'`.
 *
 * Assembled by the server from settled rows, never by the client — `OrderPlacedScreen` takes a
 * branded type that only a four-digit pickup code can satisfy, which is `R8` in the type system.
 * The recipient's **first name only** (§4.3, `G7`).
 */
export interface SettledOrderSummary {
  pickupCode: string;
  serviceDate: string;
  recipientFirstName: string | null;
  breakLabel: string;
  itemCount: number;
  totalPaise: number;
}

export interface CheckoutStatusResult {
  status: CheckoutStatus;
  order?: SettledOrderSummary;
  /**
   * True when the server reached Razorpay to answer. False means it fell back to our own row —
   * an answer worth less, and worth knowing is worth less.
   */
  reconciled: boolean;
}

/**
 * Ask whether a checkout settled.
 *
 * Safe to call repeatedly: the server reconciles against Razorpay and settles idempotently, so
 * polling cannot double-settle. That is what makes this the recovery path for a process killed
 * mid-payment (§10.3) rather than merely a status read.
 */
export async function fetchCheckoutStatus(orderGroupId: string): Promise<CheckoutStatusResult> {
  // The group id rides in the query string because this is a GET — the function reads it from
  // the URL, and identity comes from the JWT, never from either.
  const data = await invokeFunction<Record<string, unknown>>(
    `checkout-status?group=${encodeURIComponent(orderGroupId)}`,
    undefined,
    'GET',
  );
  const raw = data.order as Record<string, unknown> | null | undefined;
  return {
    status: (data.status as CheckoutStatus) ?? 'pending',
    reconciled: data.reconciled === true,
    ...(raw
      ? {
          order: {
            pickupCode: String(raw.pickup_code ?? ''),
            serviceDate: String(raw.service_date ?? ''),
            recipientFirstName: raw.recipient_first_name == null ? null : String(raw.recipient_first_name),
            breakLabel: String(raw.break_label ?? 'Break'),
            itemCount: Number(raw.item_count ?? 0),
            totalPaise: Number(raw.total_paise ?? 0),
          },
        }
      : {}),
  };
}
