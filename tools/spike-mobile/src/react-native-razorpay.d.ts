/**
 * `react-native-razorpay@3.0.0` ships no type declarations, so this declares the slice of
 * its surface the spike uses.
 *
 * Written by hand rather than `declare module '...'` with `any`, because the shape of the
 * success and failure payloads IS one of the things E19-01 has to confirm — §3.5 depends on
 * all three success fields existing, and on the failure object carrying a code and a
 * description. Stating the expectation here means a mismatch shows up as a type error or a
 * runtime undefined rather than as a silent `any`.
 */
declare module 'react-native-razorpay' {
  /** Only the options the spike sends. The real SDK accepts many more. */
  export interface RazorpayOptions {
    key: string
    order_id: string
    /** Paise. Non-negotiable #3. */
    amount: number
    currency: 'INR'
    name?: string
    description?: string
    image?: string
    prefill?: { email?: string; contact?: string; name?: string }
    notes?: Record<string, string>
    theme?: { color?: string }
    /** Present so the spike can force a method if the default sheet proves unhelpful. */
    method?: Record<string, boolean>
  }

  /** What §3.5 says the app must post to POST /checkout/:group/verify. */
  export interface RazorpaySuccess {
    razorpay_payment_id: string
    razorpay_order_id: string
    razorpay_signature: string
  }

  /** The failure handler's payload — treated by the server as a hint, never a fact. */
  export interface RazorpayError {
    code: number | string
    description: string
    source?: string
    step?: string
    reason?: string
    metadata?: Record<string, unknown>
  }

  const RazorpayCheckout: {
    open(options: RazorpayOptions): Promise<RazorpaySuccess>
  }

  export default RazorpayCheckout
}
