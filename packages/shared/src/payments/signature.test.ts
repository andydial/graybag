import { describe, expect, it } from 'vitest';

import {
  hmacSha256Hex,
  timingSafeEqualHex,
  verifyCallbackSignature,
  verifyWebhookSignature,
  // Imported from the Edge Function's own directory rather than copied into this package.
  // The one piece of cryptography in the product must not be the one piece with two
  // implementations that can drift — and `supabase/functions/_shared/` is where Deno will
  // bundle it from, so that is where it lives. This suite is how it gets tested at all.
} from '../../../../supabase/functions/_shared/signature.js';

/**
 * `E06-03`. The shapes here are the ones `E19-01` confirmed against a real payment on a handset,
 * not a reading of the documentation — which matters, because the spike also found the docs
 * implied `authorized` where a real UPI intent gives `captured`.
 */
describe('hmacSha256Hex', () => {
  it('produces the known RFC 4231 test vector', async () => {
    // RFC 4231 case 1: key = 20 bytes of 0x0b, data = "Hi There". A published vector rather than
    // a value this code produced, so the test cannot agree with a broken implementation.
    const key = '\x0b'.repeat(20);
    expect(await hmacSha256Hex(key, 'Hi There')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('is lowercase hex of the full 32 bytes', async () => {
    const mac = await hmacSha256Hex('secret', 'payload');
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes completely when one byte of the message changes', async () => {
    const a = await hmacSha256Hex('secret', '{"a":1}');
    const b = await hmacSha256Hex('secret', '{"a":2}');
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqualHex', () => {
  it('matches equal values and rejects different ones', () => {
    expect(timingSafeEqualHex('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqualHex('abcdef', 'abcdee')).toBe(false);
  });

  it('rejects a different length without comparing content', () => {
    expect(timingSafeEqualHex('abcdef', 'abcde')).toBe(false);
  });

  it('treats hex case as insignificant', () => {
    // A provider that changed its casing should not look like an attacker.
    expect(timingSafeEqualHex('ABCDEF', 'abcdef')).toBe(true);
  });

  it('inspects every character rather than stopping at the first difference', () => {
    // The property the loop exists for. `a === b` leaks the matching-prefix length through
    // timing, which is a real attack on a signature check and a cheap one to close. Asserted
    // structurally — a value differing only in its LAST character must still be rejected, which
    // an implementation that bailed early would also do; so this is a guard on behaviour, and
    // the constant-time property lives in the implementation's shape rather than in a timer
    // (a timing assertion in CI is a flaky test, not a security control).
    expect(timingSafeEqualHex('aaaaaaab', 'aaaaaaaa')).toBe(false);
    expect(timingSafeEqualHex('baaaaaaa', 'aaaaaaaa')).toBe(false);
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_7e57';
  // Deliberately NOT compact-and-already-canonical. A first draft of this suite used minified
  // JSON with keys in insertion order, and `JSON.stringify(JSON.parse(body)) === body` — so the
  // raw-body test passed for the wrong reason and would have kept passing against an
  // implementation that re-serialised. This body has the two things a real payload has that a
  // round trip destroys: whitespace, and a `\u` escape that unescapes.
  const body =
    '{ "event": "payment.captured", "payload": { "note": "caf\\u00e9" }, "amount": 21000 }';

  it('accepts a signature over the exact bytes received', async () => {
    expect(await verifyWebhookSignature(secret, body, await hmacSha256Hex(secret, body))).toBe(true);
  });

  it('rejects a signature over a re-serialised body — §5.2, the raw-body rule', async () => {
    // The failure this test exists for. Parsing and re-serialising changes key order, whitespace
    // and escaping, so the HMAC never matches — and because it fails for EVERY event uniformly,
    // it looks like an attack rather than like a bug. That is why the endpoint reads `req.text()`
    // first and parses only after verifying.
    const reserialised = JSON.stringify(JSON.parse(body));
    const signedOverRaw = await hmacSha256Hex(secret, body);
    expect(reserialised).not.toBe(body);
    expect(await verifyWebhookSignature(secret, reserialised, signedOverRaw)).toBe(false);
  });

  it('rejects a missing header rather than throwing', async () => {
    // An unsigned request must not get a different response shape from a wrongly-signed one —
    // that is a probe an attacker can read.
    expect(await verifyWebhookSignature(secret, body, null)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, '')).toBe(false);
  });

  it('rejects when the secret is missing, rather than verifying against an empty key', async () => {
    // A misconfigured environment must fail CLOSED — an unset `RAZORPAY_WEBHOOK_SECRET` must
    // reject everything, not accept anything.
    //
    // The signature offered here is arbitrary rather than computed with an empty key, because
    // Web Crypto REFUSES a zero-length HMAC key outright (`DataError: Zero-length key is not
    // supported`). Which is a useful thing to have learned: an implementation that did not
    // return early would not silently verify against '' — it would throw, on every event, and
    // the endpoint would 500 rather than record. The early return is what turns that into a
    // recorded, unverified event and a `200`.
    const anySignature = 'a'.repeat(64);
    expect(await verifyWebhookSignature('', body, anySignature)).toBe(false);
  });

  it('rejects the right body signed with the wrong secret', async () => {
    expect(await verifyWebhookSignature(secret, body, await hmacSha256Hex('other', body))).toBe(false);
  });
});

describe('verifyCallbackSignature', () => {
  const keySecret = 'rzp_test_secret';
  const orderId = 'order_9A33XWu170gUtm';
  const paymentId = 'pay_29QQoUBi66xm2f';

  it('accepts HMAC over "order_id|payment_id" — the shape E19-01 confirmed', async () => {
    const signature = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
    expect(await verifyCallbackSignature(keySecret, orderId, paymentId, signature)).toBe(true);
  });

  it('rejects the two ids in the wrong order', async () => {
    // Reversed, it is still a valid-looking 64-character hex string. Nothing about a hex digest
    // tells you it was computed over the wrong thing, which is why the order is asserted.
    const reversed = await hmacSha256Hex(keySecret, `${paymentId}|${orderId}`);
    expect(await verifyCallbackSignature(keySecret, orderId, paymentId, reversed)).toBe(false);
  });

  it('rejects a signature made with the WEBHOOK secret', async () => {
    // The two signatures use different secrets, and using one for the other fails 100% of the
    // time — indistinguishable from an attack (§5.5). That is why they are two named functions
    // rather than one with a parameter.
    const wrongSecret = await hmacSha256Hex('whsec_7e57', `${orderId}|${paymentId}`);
    expect(await verifyCallbackSignature(keySecret, orderId, paymentId, wrongSecret)).toBe(false);
  });

  it('rejects missing ids rather than signing an empty pair', async () => {
    expect(await verifyCallbackSignature(keySecret, '', paymentId, 'anything')).toBe(false);
    expect(await verifyCallbackSignature(keySecret, orderId, '', 'anything')).toBe(false);
  });

  it('rejects when the key secret is missing', async () => {
    // Same fail-closed rule as the webhook, and the same reason the check is an early return
    // rather than a hash: Web Crypto throws on a zero-length key.
    expect(await verifyCallbackSignature('', orderId, paymentId, 'a'.repeat(64))).toBe(false);
  });
});
