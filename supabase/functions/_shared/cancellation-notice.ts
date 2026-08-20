/**
 * "Your order has been cancelled." — `E09-38`.
 *
 * Before this, cancelling an order told the parent nothing. No food arrived at the break, the app
 * showed a status they had no reason to be looking at, and nobody could tell them — kitchen staff
 * cannot read a customer's email address, and must not be able to (§13.3 rule 4, `0002`).
 *
 * Andy's report was the downstream symptom: *"if the staff intends to cancel — and the system does
 * not send a notification — they don't know how to notify the person who ordered."* The fix is the
 * system doing it, not the address appearing on the board.
 *
 * # It carries what the person typed, verbatim
 *
 * A reason code alone is "Dish unavailable", which does not tell a parent whether their child ate.
 * `kitchen-order-status` now requires a sentence, and it is sent unedited — rewriting somebody's
 * explanation into house style is how the specific becomes vague.
 *
 * **It is escaped, not trusted.** It is free text typed by a member of staff and interpolated into
 * HTML; without escaping, a stray `<` corrupts the mail and a deliberate one is an injection into
 * a message we send on our own domain.
 *
 * **And it is never logged.** Non-negotiable #4: it may contain a child's name whatever the box
 * asked for, so it does not appear in `console.error`, does not reach Sentry, and does not go into
 * `notification_delivery` — that table holds no rendered body by design (`E20-10`).
 *
 * # What it does not say
 *
 * No recipient name, class or section — tier P (§13.3), and the parent knows which child they
 * ordered for. No money. Whether a cancellation is refunded is a separate decision made by a
 * separate grant (`orders.refund`, deliberately split from `orders.cancel` in `0001`), and
 * `refund-notice` is what says so once it has actually happened. Promising a refund here that
 * nobody has issued would be worse than saying nothing.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const TEMPLATE_ORDER_CANCELLED = 'order_cancelled';

export type CancellationNoticeOutcome = 'sent' | 'already_sent' | 'suppressed' | 'failed';

export interface CancellationNoticeInput {
  orderId: string;
  /** The `reason_code` chosen. Used only to look up its customer-facing display name. */
  reasonCode: string | null;
  /** What the person cancelling typed. Sent verbatim, escaped. Never logged. */
  reasonDetail: string | null;
}

/** Escape for interpolation into HTML. The detail is typed by a person and is never trusted. */
const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

export async function sendCancellationNotice(
  admin: SupabaseClient,
  input: CancellationNoticeInput,
): Promise<CancellationNoticeOutcome> {
  try {
    if (!input.orderId) return 'failed';

    const { data: order } = await admin
      .from('order')
      .select('id, order_ref, service_date, customer_user_id, order_group_id, correlation_id')
      .eq('id', input.orderId)
      .maybeSingle();
    if (!order) return 'failed';

    const { data: user } = await admin
      .from('app_user')
      .select('id, email, first_name')
      .eq('id', order.customer_user_id)
      .maybeSingle();

    // Nullable by design — an Apple private-relay opt-out leaves it null (`0018`). Not a failure:
    // a customer we cannot email, recorded as such.
    const address = typeof user?.email === 'string' ? user.email.trim() : '';

    const { data: reason } = input.reasonCode
      ? await admin
          .from('reason_code')
          .select('display_name, is_customer_visible')
          .eq('code', input.reasonCode)
          .maybeSingle()
      : { data: null };

    const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';

    // Claim the send before making it. `uq_notification_one_per_order` (0065) is the lock, so a
    // retried request cannot send a parent a second cancellation for the same order.
    const claim = await admin.from('notification_delivery').insert({
      user_id: order.customer_user_id,
      channel: 'email',
      template_code: TEMPLATE_ORDER_CANCELLED,
      order_id: order.id,
      order_group_id: order.order_group_id ?? null,
      status: 'queued',
      provider: apiKey ? 'resend' : null,
      correlation_id: order.correlation_id ?? null,
    });

    if (claim.error) {
      if (claim.error.code === '23505') return 'already_sent';
      console.error('cancellation-notice: could not claim the send', claim.error.code);
      return 'failed';
    }

    const finish = async (status: string, extra: Record<string, unknown> = {}) => {
      await admin
        .from('notification_delivery')
        .update({ status, ...extra })
        .eq('order_id', order.id)
        .eq('template_code', TEMPLATE_ORDER_CANCELLED)
        .eq('channel', 'email');
    };

    if (address === '') {
      await finish('suppressed', { suppressed_reason: 'no_email_on_account' });
      return 'suppressed';
    }

    if (!apiKey || !from) {
      // Deliberately worded as a configuration fault. `E12-34` was exactly this failing silently
      // and being read as a provider outage for a day.
      console.error(
        'cancellation-notice: RESEND_API_KEY / ORDER_EMAIL_FROM are not set — an order HAS been ' +
          'cancelled and the parent has NOT been told. Configuration fault, not a provider outage.',
      );
      await finish('suppressed', { suppressed_reason: 'email_provider_not_configured' });
      return 'suppressed';
    }

    const greeting =
      typeof user?.first_name === 'string' && user.first_name.trim() !== ''
        ? `Hi ${esc(user.first_name.trim())},`
        : 'Hi,';

    const orderRef = String(order.order_ref ?? '');
    const served = String(order.service_date ?? '');

    // Only a customer-visible code is named. `is_customer_visible` exists for codes that are
    // internal vocabulary; showing one would be leaking an operational category into a customer's
    // inbox. The typed detail is what carries the meaning anyway.
    const headline =
      reason?.is_customer_visible && typeof reason.display_name === 'string'
        ? `<p style="margin:0 0 16px">Reason: <strong>${esc(reason.display_name)}</strong></p>`
        : '';

    const detail = (input.reasonDetail ?? '').trim();
    const detailBlock = detail
      ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f4f6f4;border-radius:8px">` +
        `${esc(detail)}</p>`
      : '';

    const html =
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
      `font-size:16px;line-height:1.5;color:#141a16;max-width:560px">` +
      `<p style="margin:0 0 16px">${greeting}</p>` +
      `<p style="margin:0 0 16px">We have had to cancel your order` +
      `${orderRef ? ` <strong>${esc(orderRef)}</strong>` : ''}` +
      `${served ? ` for <strong>${esc(served)}</strong>` : ''}. ` +
      `<strong>No food will be delivered for it.</strong></p>` +
      headline +
      detailBlock +
      // No refund promise. `orders.refund` is a separate grant and a separate decision, and
      // `refund-notice` is what says the money has moved, once it has.
      `<p style="margin:0 0 16px">If this order was paid for, any refund due is handled ` +
      `separately and we will email you again when it has been sent.</p>` +
      `<p style="margin:0">If this does not look right, reply to this email and we will sort it ` +
      `out.</p></div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [address],
        subject: orderRef ? `Your order ${orderRef} has been cancelled` : 'Your order has been cancelled',
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      // The status and a truncated provider body. Neither contains the typed detail — that is
      // never in a log line, and Resend echoes only its own error shape here.
      console.error(`cancellation-notice: resend ${response.status}: ${body.slice(0, 200)}`);
      await finish('failed', {
        failed_at: new Date().toISOString(),
        error_text: `resend_${response.status}: ${body.slice(0, 300)}`,
      });
      return 'failed';
    }

    const sent = (await response.json()) as { id?: string };
    await finish('sent', {
      sent_at: new Date().toISOString(),
      provider_message_id: sent.id ?? null,
    });
    return 'sent';
  } catch (thrown) {
    // `String(thrown)` and nothing else. An exception here must not become the vector that puts
    // the typed detail into a log.
    console.error('cancellation-notice: threw', String(thrown));
    return 'failed';
  }
}
