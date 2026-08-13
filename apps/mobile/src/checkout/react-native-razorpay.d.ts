/**
 * Types for `react-native-razorpay`, which ships none. `E06-02`.
 *
 * Written narrowly and on purpose: this describes **the part of the SDK we use**, not the part
 * that exists. A generous `[key: string]: any` on the options object would typecheck the exact
 * mistake `razorpay.ts` exists to prevent — putting a child's name in `prefill` or a service date
 * in `notes` — and the compiler is the cheapest place to catch that.
 *
 * So the options here are a closed set. Adding a field to the outbound payload requires adding it
 * here first, which is a moment to ask whether it should be leaving at all.
 */
declare module 'react-native-razorpay' {
  /** What Razorpay's own docs call the "prefill" block. Deliberately email-only. */
  export interface RazorpayPrefill {
    /**
     * The **account holder's** address, never a child's. Optional because `app_user.email` is
     * nullable (`0018` — Apple private-relay opt-out).
     */
    email?: string;
  }

  export interface RazorpayCheckoutOptions {
    /** The publishable key id. The secret never reaches a handset. */
    key: string;
    /** `order_…`, from `payments-create-order`. */
    order_id: string;
    /** Paise. The same integer used everywhere else — never a rupee float. */
    amount: number;
    currency: string;
    /** The business name for the sheet header. */
    name: string;
    /** Fixed text. Not a per-order description, which is how a child's name gets out. */
    description: string;
    prefill: RazorpayPrefill;
    theme?: { color?: string };
  }

  export interface RazorpaySuccessResponse {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    /** `HMAC-SHA256(key_secret, "order_id|payment_id")`, verified server-side. */
    razorpay_signature?: string;
  }

  const RazorpayCheckout: {
    /** Rejects on cancellation as well as on failure — see `razorpay.ts`. */
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccessResponse>;
  };

  export default RazorpayCheckout;
}
