// `/payments-webhook` — Razorpay's events, verified and recorded. `E06-04`, `E06-03`.
//
// **This endpoint records, then hands the recorded row to the consumer.** Turning a captured
// event into a paid order is `settle_payment()` (`E06-06`), which runs from the recorded row via
// `drainPendingEvents` (`E06-37`) — because §3.6 says a verified
// signature proves the body was not tampered with, not that money moved, and the server fetches
// the payment from Razorpay before settling either way. Splitting them means a storm of events
// cannot become a storm of settlements, and a replayed event is a no-op at the database rather
// than a second attempt at the money.
//
// ## The order of operations is the security property
//
//   1. `req.text()` — the RAW bytes, first. Never `req.json()`.
//   2. HMAC over those bytes, compared in constant time.
//   3. `JSON.parse` — only now, and only to extract the id and type for the row.
//   4. Insert, `on conflict do nothing`.
//
// Step 3 after step 2 is the rule: **an unverified body is never interpreted.** Step 1 before
// everything is §5.2 — parsing and re-serialising changes key order, whitespace and escaping, so
// the HMAC would never match and the failure would be total, uniform, and indistinguishable from
// an attack.
//
// ## Always 200 — §6.3
//
// A bad signature returns `200`. That reads wrong and is right: a `4xx` makes Razorpay retry a
// request we will never accept, for ever, and the retry storm buries the real events. The event
// is recorded with `signature_verified = false` and `E06-28`'s alert is what makes it visible.
//
// **The single exception is a failed INSERT.** If the row cannot be written, the event exists
// nowhere and their retry is the only remaining copy — so that, and only that, returns `500`.
//
// ## Idempotency — §7.1 layer 4, the load-bearing one
//
// `payment_webhook_event_unique (provider, provider_event_id)` and `on conflict do nothing`. A
// replay is `200` with nothing written. Layers 5–8 make the *settlement* idempotent without a
// flag; this layer makes the *recording* idempotent, and they are different jobs.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { drainPendingEvents } from '../_shared/settle-from-events.ts';
import { verifyWebhookSignature } from '../_shared/signature.ts';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * The event types we act on. Anything else is recorded `ignored` and returns `200` — an unknown
 * type must never 500, because Razorpay retries for ever and the storm buries the real events
 * (§6.3). Subscribing to more in the dashboard than we list here is therefore safe.
 */
const HANDLED = new Set([
  'payment.captured',
  'payment.failed',
  'payment.authorized',
  'refund.processed',
  'refund.failed',
  'settlement.processed',
]);

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  // (1) The raw bytes, before anything else touches them.
  const raw = await request.text();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

  if (!supabaseUrl || !serviceKey) {
    // No database means the event cannot be recorded at all — the one case where Razorpay's
    // retry is the only copy, so ask for it.
    console.error('payments-webhook: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (2) Verify. A missing secret verifies NOTHING — fail closed, record, alert (`E06-28`).
  const verified = await verifyWebhookSignature(
    webhookSecret,
    raw,
    request.headers.get('x-razorpay-signature'),
  );

  /**
   * **Why an absent secret is reported differently from a bad signature.**
   *
   * Both fail closed and both record `signature_verified = false`, which is correct and is not
   * what changed. What changed is that they were **indistinguishable from outside**, and they are
   * completely different problems:
   *
   * - a bad signature is *someone else's* fault, and the system working;
   * - **no secret configured is our fault, and the system not working at all** — every genuine
   *   Razorpay event will be recorded unverified and never processed, silently, forever.
   *
   * This cost a real misreading. `recorded_unverified` was reported to Andy as evidence the
   * webhook was live and working, when it was the fail-safe firing because no secret existed. A
   * fail-safe working is not a payment path working, and a probe with a deliberately wrong
   * signature could not tell the two apart — it returns `recorded_unverified` either way.
   *
   * It stays a **200**: Razorpay retrying cannot fix our missing configuration, and a retry storm
   * on top of a misconfiguration is two problems. The status string is the signal, and
   * `assert_webhook_health()` is what makes it loud.
   */
  const configured = webhookSecret.length > 0;
  if (!configured) {
    console.error(
      'payments-webhook: RAZORPAY_WEBHOOK_SECRET is not set — every event will be recorded ' +
        'unverified and none will be processed. This is a configuration fault, not a bad sender.',
    );
  }

  // (3) Parse, only now. A malformed body from a verified sender is still recorded, because the
  // fact that it arrived is itself worth having.
  let event: Record<string, unknown> = {};
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    event = {};
  }

  const eventType = typeof event.event === 'string' ? event.event : 'unparseable';
  // `x-razorpay-event-id` is the dedup key when present. Whether Razorpay always sends it is
  // `E19-07` row 1 and is NOT yet answered — so the fallback is a hash of the raw body, which is
  // stable across retries of the same event and different between distinct ones. It is a weaker
  // key than a provider id and it is honest about being one.
  const headerEventId = request.headers.get('x-razorpay-event-id');
  const providerEventId = headerEventId && headerEventId.length > 0
    ? headerEventId
    : `sha256:${await sha256Hex(raw)}`;

  const asService = createClient(supabaseUrl, serviceKey);

  const { error } = await asService.from('payment_webhook_event').insert({
    provider: 'razorpay',
    provider_event_id: providerEventId,
    event_type: eventType,
    signature_verified: verified,
    payload: event,
    // Unverified events are never processed. Recording them is for the alert and for forensics,
    // not for the settlement path to pick up later.
    processing_status: verified && HANDLED.has(eventType) ? 'pending' : 'ignored',
  });

  if (error) {
    // 23505 is layer 4 doing its job: we have seen this event. That is success, not conflict.
    if (error.code === '23505') return json(200, { status: 'already_seen' });

    // The one case that earns a 500: the event is recorded nowhere, so their retry is the only
    // remaining copy of it.
    console.error('payments-webhook: could not record event', { code: error.code });
    return json(500, { error: 'could not record event' });
  }

  // Everything else is 200, including a bad signature. See the header.
  /**
   * `E06-37`. The row is written; now something reads it.
   *
   * **Awaited, and its result ignored.** Awaited because an Edge Function's process can be torn
   * down the moment it responds, so a floating promise here is a settlement that sometimes
   * happens. Ignored because the reply to Razorpay is about whether we *recorded* the event —
   * §6.3's "always 200" — and a settlement failure must not become a retry storm on an event we
   * already hold. The queue keeps it `pending` and the next drain tries again.
   */
  if (verified) {
    const drained = await drainPendingEvents(asService, {
      limit: 5,
      keyId: Deno.env.get('RAZORPAY_KEY_ID') ?? '',
      keySecret: Deno.env.get('RAZORPAY_KEY_SECRET') ?? '',
    });
    if (drained.settled > 0 || drained.failed > 0) {
      console.log(`payments-webhook: drained ${JSON.stringify(drained)}`);
    }
  }

  return json(200, {
    status: verified ? 'recorded' : configured ? 'recorded_unverified' : 'recorded_no_secret',
  });
});

/** Fallback dedup key while `E19-07` row 1 is unanswered. Stable per body, distinct per event. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
