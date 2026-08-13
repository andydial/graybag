/**
 * Razorpay signature verification — `E06-03`.
 *
 * ## Two different signatures, and they are not interchangeable
 *
 * **The webhook signature** is `HMAC-SHA256(webhook_secret, raw_request_body)`, sent in
 * `x-razorpay-signature`. Its secret is the one configured in the dashboard when the endpoint
 * is subscribed.
 *
 * **The callback signature** is `HMAC-SHA256(key_secret, "<order_id>|<payment_id>")`, returned to
 * the client when a payment succeeds. Its secret is the API key secret. `E19-01` verified this
 * shape against a real payment on a handset, which is the only reason it is stated as fact here
 * rather than as a reading of the documentation.
 *
 * Using one secret for the other's check fails 100% of the time and looks exactly like an attack
 * (§5.5), which is why they are two named functions rather than one with a parameter.
 *
 * ## Pure, and therefore testable
 *
 * Nothing here touches `Deno`, the network, or a database — only Web Crypto, which Deno and Node
 * 22 both provide as `globalThis.crypto.subtle`. That is deliberate: the Edge Function imports
 * it, and so does a vitest suite, so the one piece of cryptography in the product is not the one
 * piece with no tests.
 */

/** `HMAC-SHA256(secret, message)` as lowercase hex — Razorpay's encoding for both signatures. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time comparison of two hex strings.
 *
 * **`a === b` leaks the length of the matching prefix through timing.** That is a real attack on
 * a signature check and a cheap one to close: the comparison below always inspects every
 * character of `expected`, and the early `length` check reveals only the length of a value the
 * attacker already chose.
 *
 * Case-insensitive on the *received* value, because hex is hex — a provider that changed its
 * casing should not look like an attacker.
 */
export function timingSafeEqualHex(expected: string, received: string): boolean {
  const a = expected.toLowerCase();
  const b = received.toLowerCase();
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Verify a webhook against the **raw body** — §5.2.
 *
 * The caller must pass the bytes as received. Parsing to JSON and re-serialising changes key
 * order, whitespace, unicode escaping and number formatting, and the HMAC then never matches:
 * the failure is total and uniform, which is what makes it dangerous — it looks like an attack
 * rather than like a bug.
 *
 * An empty or absent header is `false` rather than a throw. An unsigned request is simply not
 * verified, and the endpoint records it and returns `200` (§6.3) rather than giving an attacker
 * a different response shape to probe.
 */
export async function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  headerSignature: string | null,
): Promise<boolean> {
  if (!webhookSecret || !headerSignature) return false;
  return timingSafeEqualHex(await hmacSha256Hex(webhookSecret, rawBody), headerSignature);
}

/**
 * Verify the client's success callback — §5.3, and the shape `E19-01` confirmed on a handset.
 *
 * `HMAC-SHA256(key_secret, "<order_id>|<payment_id>")`. The pipe is literal and the order is
 * fixed; reversing the two ids produces a valid-looking hex string that never matches.
 *
 * **A verified callback proves the body was not tampered with. It does not prove money moved**
 * (§3.6, `R8`) — the server still fetches the payment from Razorpay before settling. This
 * function exists to reject forgeries early, not to authorise anything.
 */
export async function verifyCallbackSignature(
  keySecret: string,
  providerOrderId: string,
  providerPaymentId: string,
  received: string | null,
): Promise<boolean> {
  if (!keySecret || !received || !providerOrderId || !providerPaymentId) return false;
  const expected = await hmacSha256Hex(keySecret, `${providerOrderId}|${providerPaymentId}`);
  return timingSafeEqualHex(expected, received);
}
