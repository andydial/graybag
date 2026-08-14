/**
 * The consumer for `payment_webhook_event`. `E06-37`.
 *
 * `payments-webhook` records and does not settle — that split is deliberate (§3.6), and its
 * header says so. What was missing is the other half: **nothing read the queue.** Every verified
 * capture sat at `processing_status = 'pending'` for ever, and the only thing that ever settled an
 * order was the app polling `checkout-status`. A parent who paid and closed the app had a captured
 * payment and no order, indefinitely.
 *
 * Found the honest way, on the first real payment: ₹145.96 captured at Razorpay, `order_group`
 * still `pending_payment`, no invoice, no ledger.
 *
 * # It never trusts the event body
 *
 * A verified signature proves the bytes were not tampered with in transit. It does **not** prove
 * money moved — and §3.6 requires the server to fetch the payment from Razorpay before settling
 * either way. So the row supplies only two identifiers, and the amount and status come from an
 * authenticated call to the provider. An attacker who somehow got a signed body still cannot
 * settle an order that Razorpay does not agree was captured.
 *
 * # Idempotent at every layer
 *
 * `settle_payment` refuses a repeat (§7.1 layers 5–8), so the same event processed twice is a
 * no-op, and the app's poller settling first is equally harmless. That is what lets this run
 * inline after the insert **and** from a scheduled drain without coordination between them.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { sendOrderConfirmation } from './order-confirmation.ts';

export interface DrainResult {
  considered: number;
  settled: number;
  failed: number;
  skipped: number;
}

/** Only these move money. Anything else recorded `pending` is marked processed and left alone. */
const SETTLES = new Set(['payment.captured']);

export async function drainPendingEvents(
  admin: SupabaseClient,
  options: { limit?: number; keyId: string; keySecret: string },
): Promise<DrainResult> {
  const result: DrainResult = { considered: 0, settled: 0, failed: 0, skipped: 0 };

  const { data: rows, error } = await admin
    .from('payment_webhook_event')
    .select('id, event_type, payload, attempt_count')
    .eq('processing_status', 'pending')
    .eq('signature_verified', true)
    .order('received_at', { ascending: true })
    .limit(options.limit ?? 20);

  if (error) {
    console.error('settle-from-events: could not read the queue', error.message);
    return result;
  }

  if (!options.keyId || !options.keySecret) {
    // Leave them pending. Marking them processed would lose the queue to a misconfiguration —
    // the events are the only record that money moved, and a later drain must still find them.
    console.error(
      'settle-from-events: Razorpay credentials missing — the queue is UNPROCESSED and events ' +
        'are being left pending on purpose. Configuration fault, not a provider outage.',
    );
    return result;
  }

  const auth = `Basic ${btoa(`${options.keyId}:${options.keySecret}`)}`;

  for (const row of rows ?? []) {
    result.considered += 1;
    const id = row.id as number;

    if (!SETTLES.has(String(row.event_type))) {
      // Recorded, acknowledged, and not a money movement we act on yet. `refund.processed` and
      // `settlement.processed` land here until `E06-08` and `E06-27` consume them; marking them
      // processed keeps the queue honest about what is actually outstanding.
      await mark(admin, id, 'processed');
      result.skipped += 1;
      continue;
    }

    const entity = extractPaymentEntity(row.payload);
    if (!entity) {
      await mark(admin, id, 'failed', 'no payment entity in payload');
      result.failed += 1;
      continue;
    }

    try {
      // **The authoritative read.** Not the event body.
      const res = await fetch(`https://api.razorpay.com/v1/payments/${entity.paymentId}`, {
        headers: { Authorization: auth },
      });
      if (!res.ok) {
        console.error(`settle-from-events: razorpay ${res.status} for ${entity.paymentId}`);
        await bumpAttempt(admin, id, row.attempt_count as number);
        result.failed += 1;
        continue;
      }

      const payment = (await res.json()) as {
        status?: string;
        order_id?: string;
        amount?: number;
      };

      if (payment.status !== 'captured') {
        // Razorpay does not agree money moved. Not an error, and not ours to settle.
        await mark(admin, id, 'processed');
        result.skipped += 1;
        continue;
      }

      const { error: settleError } = await admin.rpc('settle_payment', {
        p_provider_order_id: String(payment.order_id ?? entity.orderId),
        p_provider_payment_id: entity.paymentId,
        p_amount_paise: Number(payment.amount),
      });

      if (settleError) {
        /**
         * **`payment_not_found` is terminal, not transient**, and `0046` says why: §10.9, "almost
         * always the other environment's account talking to us... an order we will never have".
         *
         * One test-mode Razorpay account serves several things — the `E19-07` payment links were
         * paid against orders this system never created — so their captures arrive here with no
         * `payment` row to match. Retrying those for ever would fill the queue with events that
         * cannot succeed, and a genuinely stuck settlement would be invisible among them.
         */
        if (String(settleError.hint ?? '') === 'payment_not_found') {
          await mark(admin, id, 'ignored', 'no payment row: an order this system did not create');
          result.skipped += 1;
          continue;
        }
        console.error(`settle-from-events: settle_payment failed for ${entity.paymentId}`, settleError.message);
        await bumpAttempt(admin, id, row.attempt_count as number, settleError.message);
        result.failed += 1;
        continue;
      }

      await mark(admin, id, 'processed');
      result.settled += 1;

      // Best effort, and never allowed to fail the settlement — `0050`'s unique index means the
      // app's poller and this cannot both send one.
      const groupId = await groupFor(admin, String(payment.order_id ?? entity.orderId));
      if (groupId) await sendOrderConfirmation(admin, { orderGroupId: groupId, correlationId: null });
    } catch (thrown) {
      console.error('settle-from-events: threw', String(thrown));
      await bumpAttempt(admin, id, row.attempt_count as number, String(thrown));
      result.failed += 1;
    }
  }

  return result;
}

/** `payload.payload.payment.entity` — Razorpay's envelope, defensively. */
function extractPaymentEntity(payload: unknown): { paymentId: string; orderId: string } | null {
  const root = payload as Record<string, unknown> | null;
  const inner = (root?.payload ?? {}) as Record<string, unknown>;
  const payment = (inner.payment ?? {}) as Record<string, unknown>;
  const entity = (payment.entity ?? {}) as Record<string, unknown>;
  const paymentId = typeof entity.id === 'string' ? entity.id : '';
  const orderId = typeof entity.order_id === 'string' ? entity.order_id : '';
  if (!paymentId) return null;
  return { paymentId, orderId };
}

async function groupFor(admin: SupabaseClient, providerOrderId: string): Promise<string | null> {
  const { data } = await admin
    .from('payment')
    .select('order_group_id')
    .eq('provider_order_id', providerOrderId)
    .maybeSingle();
  return (data?.order_group_id as string | undefined) ?? null;
}

async function mark(admin: SupabaseClient, id: number, status: string, errorText?: string) {
  await admin
    .from('payment_webhook_event')
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      ...(errorText ? { error_text: errorText.slice(0, 500) } : {}),
    })
    .eq('id', id);
}

/**
 * A transient failure stays `pending` so the next drain retries it, with the count visible.
 *
 * No cap here on purpose: an event stuck at a high `attempt_count` is exactly what `E06-28`'s
 * alert should surface, and silently giving up on a captured payment is worse than retrying one
 * that will never succeed.
 */
async function bumpAttempt(admin: SupabaseClient, id: number, current: number, errorText?: string) {
  await admin
    .from('payment_webhook_event')
    .update({
      attempt_count: (Number(current) || 0) + 1,
      ...(errorText ? { error_text: errorText.slice(0, 500) } : {}),
    })
    .eq('id', id);
}
