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
