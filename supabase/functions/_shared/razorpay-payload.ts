/**
 * What may leave this system in a Razorpay request. `E06-25`, §3.7 and §6.5.
 *
 * # Why this is a module and not a careful `JSON.stringify`
 *
 * Non-negotiable #4: children's data is regulated under the DPDP Act. A recipient's name, class,
 * section or allergen must never reach a payment processor — and `payment.notes` is the field
 * that invites it, because it is free-form, it is genuinely useful for support, and every
 * example in every payment-gateway tutorial fills it with the customer's name.
 *
 * The failure mode is not a leak anyone would notice. It is a `notes` object that quietly carries
 * `"child": "Aarav Sharma, 5-B"` into a third party's dashboard, indefinitely, where no erasure
 * request we ever honour can reach it. Razorpay is not a sub-processor we can instruct to forget.
 *
 * So the payload is **built by allow-list**, never by taking an object and removing things.
 * A deny-list is wrong here for the ordinary reason — it is a list of the mistakes we have
 * already thought of — and for a specific one: the cart shape changes as the product grows, and
 * every new field would be included by default and excluded only if somebody remembered.
 *
 * # What is allowed, and why each one is safe
 *
 * Ids only, and only ids that are meaningless outside our own database:
 *
 * - `order_group_id` — a uuid. Identifies the purchase for support, resolves to nothing without
 *   our database.
 * - `correlation_id` — a uuid, and the whole point of `§13.6`: quote it and the entire life of
 *   an order can be reconstructed across the app, the functions, Razorpay and the ledger.
 * - `attempt_no` — a small integer, so a duplicated charge can be told from a retry.
 * - `app_env` — which environment produced it, so a test payment in the live dashboard (or the
 *   reverse) is visible immediately rather than after an argument.
 *
 * Note what is **not** here: no order_ref, because it is shown to the customer and printed on a
 * document; no school; no service date, which combined with a school narrows a child to a class.
 * None of those is a name, and that is exactly why they need saying out loud — the rule is not
 * "no names", it is "nothing that identifies a child, including in combination".
 */

/** The complete set of keys that may appear in an outbound `notes` object. Nothing else. */
export const ALLOWED_NOTE_KEYS = ['order_group_id', 'correlation_id', 'attempt_no', 'app_env'] as const;

export interface RazorpayOrderRequest {
  amount: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}

/**
 * Builds the Razorpay Orders API body.
 *
 * Every value is stringified: Razorpay's `notes` are string-to-string, and a number that arrives
 * as a number comes back as a string anyway, which makes comparisons during reconciliation
 * quietly type-dependent.
 *
 * `receipt` is the **correlation id**, not the order ref. Razorpay caps it at 40 characters, a
 * uuid is 36, and the correlation id is the one identifier that already means "this purchase"
 * everywhere else in the system. The order ref is customer-facing and belongs on the invoice.
 */
export function buildOrderRequest(input: {
  amountPaise: number;
  currency: string;
  orderGroupId: string;
  correlationId: string;
  attemptNo: number;
  appEnv: string;
}): RazorpayOrderRequest {
  return {
    // Razorpay takes the smallest currency unit, which for INR is paise — the same integer we
    // hold (non-negotiable #3). No conversion, and nothing here may ever introduce one.
    amount: input.amountPaise,
    currency: input.currency,
    receipt: input.correlationId,
    notes: {
      order_group_id: input.orderGroupId,
      correlation_id: input.correlationId,
      attempt_no: String(input.attemptNo),
      app_env: input.appEnv,
    },
  };
}

/**
 * Proves an outbound payload carries only allowed keys, and returns the offenders.
 *
 * Exported so it can be asserted in a test **and** called on the real payload immediately before
 * it is sent. A rule that only exists in a test is a rule that holds until somebody adds a field
 * in a hurry; this makes the send itself the enforcement point.
 */
export function disallowedNoteKeys(notes: Record<string, unknown>): string[] {
  const allowed = new Set<string>(ALLOWED_NOTE_KEYS);
  return Object.keys(notes).filter((key) => !allowed.has(key));
}
