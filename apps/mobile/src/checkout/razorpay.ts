/**
 * The Razorpay native SDK, behind one function. `E06-02`.
 *
 * # Why a wrapper rather than calling the SDK from a screen
 *
 * Three reasons, in order of how much they cost when ignored:
 *
 * 1. **What we hand a third party is decided here, in one place.** `RazorpayCheckout.open` takes
 *    a `prefill` object, and the obvious things to put in it — the parent's name, the child's
 *    name to remind them what they are paying for — are exactly what non-negotiable #4 forbids
 *    leaving the system. `E06-25` covers the server's outbound call; this is the *other* outbound
 *    path, and it is the one that looks like UI code rather than like an API request.
 * 2. **The SDK's result shape is not our domain.** It resolves with a payment id and a signature,
 *    and rejects with a numbered error whose `description` is written for a developer. Screens
 *    should branch on "the parent cancelled" versus "the payment failed", not on `code === 0`.
 * 3. **It is native, so nothing above this line can be tested without it.** Jest cannot load the
 *    native module; keeping the boundary here means the checkout flow is testable by mocking one
 *    function instead of the whole SDK surface.
 *
 * # What "success" from the SDK means, and what it does not
 *
 * `R8`, and the single most important thing in this file: **a resolved promise here is not a paid
 * order.** It means Razorpay's sheet reported success on the handset. The order is confirmed when
 * the webhook is verified server-side and `settle_payment` runs (`E06-06`) — which may be seconds
 * later, may arrive before this promise resolves, and may never arrive at all if the process is
 * killed mid-payment.
 *
 * So this function's job ends at "the sheet closed and said this". The caller goes to a waiting
 * state and asks the server (`E06-16`), and must never write "paid" on the strength of this
 * return value.
 */
import { design } from '@graybag/shared';
import RazorpayCheckout from 'react-native-razorpay';

/** What the sheet reported. Not a confirmation — see the header. */
export interface RazorpaySheetSuccess {
  outcome: 'reported_success';
  /** `pay_…`. The server verifies it; we only carry it. */
  providerPaymentId: string;
  providerOrderId: string;
  /** The callback signature, `HMAC-SHA256(key_secret, "order_id|payment_id")`. Server-checked. */
  signature: string;
}

export interface RazorpaySheetCancelled {
  outcome: 'cancelled';
}

export interface RazorpaySheetFailed {
  outcome: 'failed';
  /** Razorpay's own code, carried for support and logs. Never shown to a parent verbatim. */
  providerCode?: string;
}

export type RazorpaySheetResult =
  | RazorpaySheetSuccess
  | RazorpaySheetCancelled
  | RazorpaySheetFailed;

export interface OpenCheckoutInput {
  keyId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  /** For the sheet's header. The business name, not the customer's. */
  displayName?: string;
  /**
   * The account holder's own email, if we hold one, for the receipt Razorpay sends.
   *
   * **The adult's, never the child's**, and optional because `app_user.email` is nullable — Apple
   * private-relay opt-out leaves it null (`0018`). Absent is fine: Razorpay simply does not
   * prefill, which costs a parent one field and costs us nothing.
   */
  accountEmail?: string | null;
}

/**
 * Razorpay's cancellation code. The SDK rejects rather than resolves when a parent backs out,
 * which makes "gave up" arrive down the same channel as "card declined" — so it is separated
 * here rather than in a screen.
 */
const PAYMENT_CANCELLED = 'payment_cancelled';

/**
 * Opens the payment sheet.
 *
 * Never rejects. Every outcome — success, cancellation, failure — comes back as a value, because
 * a rejected promise at a call site that is mid-checkout is how an error boundary eats a payment
 * and leaves the parent on a blank screen with money possibly taken.
 */
export async function openRazorpayCheckout(
  input: OpenCheckoutInput,
): Promise<RazorpaySheetResult> {
  try {
    const result = await RazorpayCheckout.open({
      key: input.keyId,
      order_id: input.providerOrderId,
      // Paise, the same integer everything else uses (non-negotiable #3). No conversion here,
      // ever: a `* 100` on this line charges a hundred times the price and looks plausible.
      amount: input.amountPaise,
      currency: input.currency,
      name: input.displayName ?? 'GrayBag',
      // Deliberately generic. The obvious description — "Lunch for Aarav, 15 Aug" — names a child
      // and a date to a payment processor, and appears on a card statement.
      description: 'School meal order',
      prefill: input.accountEmail ? { email: input.accountEmail } : {},
      // No `notes` from the client. The server already attached the only metadata that may
      // travel (`E06-25`), where it is checked before the send rather than trusted from a handset.
      //
      // The token, not the literal. `S7` — and the lint rule caught a hard-coded `#00af52` here,
      // which is the rule earning its keep in the one file where a brand colour crosses into a
      // third party's UI and would otherwise never be re-checked against the palette again.
      theme: { color: design.action.primaryBg },
    });

    return {
      outcome: 'reported_success',
      providerPaymentId: String(result.razorpay_payment_id ?? ''),
      providerOrderId: String(result.razorpay_order_id ?? input.providerOrderId),
      signature: String(result.razorpay_signature ?? ''),
    };
  } catch (error) {
    const err = (error ?? {}) as { code?: unknown; description?: unknown; error?: unknown };

    // The SDK is inconsistent about where it puts the reason — sometimes at the top level,
    // sometimes nested under `error`. Both are checked because getting this wrong turns every
    // cancellation into a "payment failed" message, which tells a parent something untrue about
    // their money.
    const nested = (err.error ?? {}) as { code?: unknown; description?: unknown; reason?: unknown };
    const code = String(err.code ?? nested.code ?? '');
    const description = String(err.description ?? nested.description ?? '');
    const reason = String(nested.reason ?? '');

    const cancelled =
      code === PAYMENT_CANCELLED ||
      reason === PAYMENT_CANCELLED ||
      /cancelled by user/i.test(description);

    if (cancelled) return { outcome: 'cancelled' };
    // `exactOptionalPropertyTypes` is on, so the key is omitted rather than set to `undefined`.
    // That is the stricter and more honest shape: "we have no code" and "the code is undefined"
    // serialise differently in a log, and only one of them is true.
    return code ? { outcome: 'failed', providerCode: code } : { outcome: 'failed' };
  }
}
