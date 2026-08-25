/**
 * The one alert. `E06-39`.
 *
 * Andy, 2026-08-15: *"Not a platform. One thing that emails `support@graybag.com` when
 * `payments-drain` reports a non-zero stuck count or a money path fails twice. Three money paths
 * can now fail silently and nothing watches any of them."*
 *
 * Those three: a settlement that fails on every attempt (`E06-38` was invisible for a day — the
 * only trace was a `console.error` in a function log Andy happened to read), a refund issued by
 * hand that this system cannot record, and a partial refund, which is refused outright and leaves
 * money moved with nothing written down.
 *
 * ## Deliberately not a platform
 *
 * No severities, no routing rules, no escalation, no dashboard. One address, one sentence, one
 * subject line that says which path. `E06-28`/`E15-05` are the real thing and are not this.
 *
 * ## One email per day per kind, not one per drain
 *
 * The dedupe key is `kind + the IST date`, in `ops_alert` (`0056`) with a unique index on exactly
 * that pair. Without it an hourly cron sends twenty-four identical emails about one stuck payment
 * and everybody learns to ignore the sender — which is the failure mode of most alerting, and it
 * is worse than no alert because it also hides the next one.
 *
 * A day is the right grain because the action is human and the response time is hours: somebody
 * opens the Razorpay dashboard and reconciles. Anything finer is telling them something they
 * already know.
 *
 * ## IST, not UTC
 *
 * The date in the key is the Indian one. A UTC day boundary falls at 05:30 IST, so a problem
 * starting at 06:00 IST and a problem starting at 05:00 IST would land in different buckets on
 * the same working morning — `E05-49` is the entry about a UTC date being wrong for five and a
 * half hours a day.
 *
 * ## No PII, ever
 *
 * Non-negotiable #4. The body carries counts, a payment or refund id, and a function name. It
 * never carries a child's name, a parent's name or an email address — an alert is forwarded and
 * pasted into chat far more casually than a customer email is.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type MoneyAlertKind =
  | 'settlement_stuck'
  | 'refund_unrecordable'
  | 'partial_refund_refused'
  // `E15-15`. Raised by `ops-heartbeat` rather than by a money path, but they belong in the same
  // channel and the same once-per-day dedupe: they are the things that must reach Andy today.
  // `ops_alert.kind` is deliberately free text (`0056`), so adding one needs no migration.
  | 'endpoint_down'
  | 'payment_without_order'
  | 'settlement_retried'
  | 'email_undelivered'
  | 'drain_backlog';

export interface MoneyAlert {
  kind: MoneyAlertKind;
  /** One line. Appears in the subject, so it must read on a phone's lock screen. */
  summary: string;
  /** Provider ids, counts, function names. **Never** a name or an address. */
  detail?: Record<string, string | number | null>;
}

const SUBJECTS: Record<MoneyAlertKind, string> = {
  settlement_stuck: 'GrayBag: money captured and not recorded',
  refund_unrecordable: 'GrayBag: a refund could not be recorded',
  partial_refund_refused: 'GrayBag: a partial refund was refused and is unrecorded',
  endpoint_down: 'GrayBag: something customers use is not responding',
  payment_without_order: 'GrayBag: a payment was captured with no order',
  settlement_retried: 'GrayBag: a settlement has failed more than once',
  email_undelivered: 'GrayBag: transactional email is not being delivered',
  drain_backlog: 'GrayBag: the payment drain queue is backing up',
};

/** The IST calendar date, as `YYYY-MM-DD`. See the header for why not UTC. */
function istDate(now: Date): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Send it, at most once per kind per day.
 *
 * **Never throws and never fails its caller.** Every call site is a money path that has already
 * gone wrong; an alert that could turn a recorded failure into an unrecorded one by raising
 * inside a catch block would be strictly worse than no alert. Returns what happened so a caller
 * can log it, and swallows everything.
 */
export async function sendMoneyAlert(
  admin: SupabaseClient,
  alert: MoneyAlert,
  now: Date = new Date(),
): Promise<'sent' | 'already_sent_today' | 'suppressed' | 'failed'> {
  try {
    const to = Deno.env.get('SUPPORT_ALERT_EMAIL') ?? 'support@graybag.com';
    const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';

    // The claim IS the dedupe: the insert either succeeds or fails on `23505`, so there is no
    // read-then-write window for two concurrent drains to both decide nothing has been sent.
    //
    // `ops_alert`, not `notification_delivery` (`0056`). That table's `user_id` is NOT NULL and
    // it is in the DPDP retention and erasure story — an alert about a stuck payment must not
    // become something we have to delete when a parent exercises their rights. Its unique index
    // is also partial on `order_group_id`, so it would not have deduped these at all.
    const claim = await admin.from('ops_alert').insert({
      kind: alert.kind,
      alert_date: istDate(now),
      summary: alert.summary,
      detail: alert.detail ?? {},
      status: 'queued',
    });

    if (claim.error) {
      if (claim.error.code === '23505') return 'already_sent_today';
      console.error('money-alert: could not claim the send', claim.error.code);
      return 'failed';
    }

    if (!apiKey || !from) {
      await admin.from('ops_alert').update({ status: 'suppressed' })
        .eq('kind', alert.kind).eq('alert_date', istDate(now));
      // Staging is genuinely in this state. Log loudly: the *underlying* problem is a money
      // problem and it is now doubly invisible — once because the path failed, and once because
      // we could not say so.
      console.error(
        `money-alert: RESEND_API_KEY / ORDER_EMAIL_FROM are not set — ${alert.kind} was NOT ` +
          `emailed. ${alert.summary} ${JSON.stringify(alert.detail ?? {})}`,
      );
      return 'suppressed';
    }

    const rows = Object.entries(alert.detail ?? {})
      .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0"><code>${k}</code></td><td>${v}</td></tr>`)
      .join('');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: SUBJECTS[alert.kind],
        html:
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px">` +
          `<p style="margin:0 0 12px"><strong>${alert.summary}</strong></p>` +
          (rows ? `<table style="border-collapse:collapse">${rows}</table>` : '') +
          `<p style="margin:12px 0 0;color:#555">One email per day per kind. Check the Razorpay ` +
          `dashboard and the <code>payment_webhook_event</code> queue.</p></div>`,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`money-alert: resend ${response.status}: ${body.slice(0, 200)}`);
      await admin
        .from('ops_alert')
        .update({ status: 'failed', error_text: `resend_${response.status}` })
        .eq('kind', alert.kind)
        .eq('alert_date', istDate(now));
      return 'failed';
    }

    await admin
      .from('ops_alert')
      .update({ status: 'sent', sent_at: now.toISOString() })
      .eq('kind', alert.kind)
      .eq('alert_date', istDate(now));
    return 'sent';
  } catch (thrown) {
    console.error('money-alert: threw', String(thrown));
    return 'failed';
  }
}
