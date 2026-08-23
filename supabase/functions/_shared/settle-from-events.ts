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
import { sendOrderAlerts } from './order-alert.ts';
import { sendRefundNotice } from './refund-notice.ts';
import { sendMoneyAlert } from './money-alert.ts';

export interface DrainResult {
  considered: number;
  settled: number;
  failed: number;
  skipped: number;
  /**
   * Events that have failed repeatedly and are still pending — money captured and not recorded.
   *
   * **Reported because `E06-38` was invisible for a day.** Every settlement was failing with
   * `21000`, and the only trace was a `console.error` in a function log that Andy happened to
   * read by hand. A count in the response is not an alert, but it is a number a scheduled caller
   * can act on, and it turns "the drain ran" into "the drain ran and two payments are stuck".
   *
   * Real alerting is `E06-28`/`E15-05` and is not built.
   */
  stuck: number;
  /** Refunds issued in the Razorpay dashboard and recorded here for the first time. `E06-46`. */
  refunded: number;
}

/** Only these move money. Anything else recorded `pending` is marked processed and left alone. */
const SETTLES = new Set(['payment.captured']);

/**
 * Refunds issued by hand in the Razorpay dashboard. `E06-46`.
 *
 * **Both event types, deliberately.** `refund.created` fires when the refund is accepted and
 * `refund.processed` when it has actually gone; for an instant refund they arrive together, and
 * for a normal one they are minutes apart. Consuming only `processed` would leave a refunded
 * order reading `cancelled` for that gap; consuming only `created` would tell a parent their
 * money was sent before it was.
 *
 * We take **both** and let `record_refund` dedupe on `provider_refund_id`, which is the same id
 * on both events. The second one to arrive is a no-op. That is the whole reason the dedupe is on
 * the provider's id rather than on the event.
 */
const REFUNDS = new Set(['refund.created', 'refund.processed']);

export async function drainPendingEvents(
  admin: SupabaseClient,
  options: { limit?: number; keyId: string; keySecret: string },
): Promise<DrainResult> {
  const result: DrainResult = {
    considered: 0, settled: 0, failed: 0, skipped: 0, stuck: 0, refunded: 0,
  };

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

    if (REFUNDS.has(String(row.event_type))) {
      const outcome = await consumeRefund(admin, row, auth);
      if (outcome === 'recorded') result.refunded += 1;
      else if (outcome === 'failed') result.failed += 1;
      else result.skipped += 1;
      continue;
    }

    if (!SETTLES.has(String(row.event_type))) {
      // Recorded, acknowledged, and not a money movement we act on yet. `settlement.processed`
      // lands here until `E06-27` consumes it; marking them processed keeps the queue honest
      // about what is actually outstanding.
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
      if (groupId) {
        await sendOrderConfirmation(admin, { orderGroupId: groupId, correlationId: null });
        // The kitchen's alert (`E08-16`). After the customer's confirmation and, like it, unable
        // to fail settlement — it returns an outcome and never throws.
        await sendOrderAlerts(admin, { orderGroupId: groupId });
      }
    } catch (thrown) {
      console.error('settle-from-events: threw', String(thrown));
      await bumpAttempt(admin, id, row.attempt_count as number, String(thrown));
      result.failed += 1;
    }
  }

  // Counted after the pass, over the whole queue rather than this batch: an event that has failed
  // three times is the signal, and it may well be outside the `limit` window of a busy drain.
  const { count } = await admin
    .from('payment_webhook_event')
    .select('id', { count: 'exact', head: true })
    .eq('processing_status', 'pending')
    .eq('signature_verified', true)
    .gte('attempt_count', 2);
  result.stuck = count ?? 0;

  if (result.stuck > 0) {
    console.error(
      `settle-from-events: ${result.stuck} verified event(s) have failed 2+ times and are still ` +
        'pending. Money has been captured and not recorded against an order.',
    );
    // `E06-39`. The count was already here and nothing read it — `E06-38` was invisible for a
    // day because the only trace was a line in a function log somebody happened to open.
    // `stuck` is already "failed at least twice", which is the threshold Andy named.
    await sendMoneyAlert(admin, {
      kind: 'settlement_stuck',
      summary:
        `${result.stuck} verified payment event(s) have failed twice or more and are still ` +
        'pending — money captured, no order recorded.',
      detail: {
        stuck: result.stuck,
        considered: result.considered,
        settled: result.settled,
        failed: result.failed,
      },
    });
  }

  return result;
}

/**
 * One `refund.created` / `refund.processed` event. `E06-46`.
 *
 * **The authoritative read, again.** Same rule as a capture (§3.6, `R8`): a verified signature
 * proves the bytes are ours, not that money moved. The amount and status come from an
 * authenticated GET, never from the body — otherwise anybody who obtained a signed payload could
 * reverse a sale in our ledger and issue a credit note withdrawing a real tax invoice.
 */
async function consumeRefund(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  auth: string,
): Promise<'recorded' | 'skipped' | 'failed'> {
  const id = row.id as number;
  const entity = extractRefundEntity(row.payload);

  if (!entity) {
    await mark(admin, id, 'failed', 'no refund entity in payload');
    return 'failed';
  }

  try {
    const res = await fetch(`https://api.razorpay.com/v1/refunds/${entity.refundId}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) {
      console.error(`settle-from-events: razorpay ${res.status} for refund ${entity.refundId}`);
      await bumpAttempt(admin, id, row.attempt_count as number);
      return 'failed';
    }

    const refund = (await res.json()) as {
      status?: string;
      payment_id?: string;
      amount?: number;
      notes?: Record<string, unknown>;
    };

    // `created` is not `processed`. Razorpay's refund statuses are `pending`, `processed` and
    // `failed`; only the middle one means the money has gone. A `refund.created` event whose
    // refund is still `pending` is left ALONE — not marked processed — so the later
    // `refund.processed` delivery finds a queue that still knows about it.
    if (refund.status !== 'processed') {
      if (refund.status === 'failed') {
        // The provider tried and did not send it. Nothing to record; the pending `refund` row
        // stays pending, which is true.
        await mark(admin, id, 'processed', `refund ${entity.refundId} failed at the provider`);
        return 'skipped';
      }
      await mark(admin, id, 'processed', `refund ${entity.refundId} not yet processed`);
      return 'skipped';
    }

    const { data, error } = await admin.rpc('record_refund', {
      p_provider_refund_id: entity.refundId,
      p_provider_payment_id: String(refund.payment_id ?? entity.paymentId),
      p_amount_paise: Number(refund.amount),
      // Razorpay's `notes` are free text somebody typed in the dashboard. Passed through as a
      // memo and **never** rendered to a parent: nothing guarantees it is free of PII, and
      // non-negotiable #4 is not satisfied by "it probably won't be".
      p_notes: typeof refund.notes?.reason === 'string' ? refund.notes.reason : null,
    });

    if (error) {
      const hint = String((error as { hint?: string }).hint ?? '');
      if (hint === 'payment_not_found') {
        // §10.9 again: one test-mode account serves several things, and a refund can arrive for
        // a charge this system never took. Terminal, exactly as it is for a capture.
        await mark(admin, id, 'ignored', 'no payment row: a charge this system did not take');
        return 'skipped';
      }
      if (hint === 'partial_refund_unsupported') {
        // Deliberately terminal AND loud. Retrying cannot help — the amount will not change —
        // and money has genuinely left the account without being recorded, which is the one
        // thing nobody may find out about later.
        console.error(
          `settle-from-events: PARTIAL REFUND ${entity.refundId} was issued in the dashboard and ` +
            'is NOT recorded. The ledger and the order are unchanged and no credit note exists. ' +
            'E06-08 is the task; until then a partial refund must be reversed by hand.',
        );
        // `E06-39`. Money has left the account with nothing written down, and retrying cannot
        // help — this is the single most important thing in this file to be told about.
        await sendMoneyAlert(admin, {
          kind: 'partial_refund_refused',
          summary:
            'A PARTIAL refund was issued in the Razorpay dashboard and could not be recorded. ' +
            'The money has gone; the ledger, the order and the credit note are unchanged.',
          detail: { refund_id: entity.refundId, payment_id: entity.paymentId, task: 'E06-08' },
        });
        await mark(admin, id, 'failed', 'partial refund: unsupported, see E06-08');
        return 'failed';
      }
      console.error(`settle-from-events: record_refund failed for ${entity.refundId}`, error.message);
      // `E06-39`, "a money path fails twice". `attempt_count` is the count BEFORE this failure,
      // so `>= 1` means this is the second — the same threshold `stuck` uses for settlements.
      if ((Number(row.attempt_count) || 0) >= 1) {
        await sendMoneyAlert(admin, {
          kind: 'refund_unrecordable',
          summary:
            'A refund issued in the Razorpay dashboard has failed to record twice. The money ' +
            'may have gone; the ledger and the order are unchanged.',
          detail: {
            refund_id: entity.refundId,
            attempts: (Number(row.attempt_count) || 0) + 1,
            hint: hint || null,
          },
        });
      }
      await bumpAttempt(admin, id, row.attempt_count as number, error.message);
      return 'failed';
    }

    await mark(admin, id, 'processed');

    const recorded = (data ?? {}) as Record<string, unknown>;
    if (recorded.already_recorded === true) {
      // A redelivery. The whole point of the dedupe — and worth a `skipped` rather than a
      // `refunded`, so the count means "refunds newly recorded" and not "events seen".
      return 'skipped';
    }

    // Best effort, and never allowed to fail the recording: the money is already back, and a
    // mail server being down must not make the ledger wrong.
    await sendRefundNotice(admin, {
      orderGroupId: String(recorded.order_group_id ?? ''),
      amountPaise: Number(recorded.amount_paise ?? 0),
      creditNoteId: (recorded.credit_note_id as string | null) ?? null,
    });

    return 'recorded';
  } catch (thrown) {
    console.error('settle-from-events: refund threw', String(thrown));
    await bumpAttempt(admin, id, row.attempt_count as number, String(thrown));
    return 'failed';
  }
}

/** `payload.payload.refund.entity` — Razorpay's envelope, defensively. */
function extractRefundEntity(
  payload: unknown,
): { refundId: string; paymentId: string } | null {
  const root = payload as Record<string, unknown> | null;
  const inner = (root?.payload ?? {}) as Record<string, unknown>;
  const refund = (inner.refund ?? {}) as Record<string, unknown>;
  const entity = (refund.entity ?? {}) as Record<string, unknown>;
  const refundId = typeof entity.id === 'string' ? entity.id : '';
  const paymentId = typeof entity.payment_id === 'string' ? entity.payment_id : '';
  if (!refundId) return null;
  return { refundId, paymentId };
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
