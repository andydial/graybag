/**
 * "Your refund is on its way." `E06-46`.
 *
 * A refund issued by hand in the Razorpay dashboard is invisible to the parent otherwise: their
 * order goes quiet, the money reappears in a bank statement days later with a reference nobody
 * recognises, and the only person who knows why is whoever clicked the button.
 *
 * # It says the money HAS been sent, because by the time this runs it has
 *
 * `consumeRefund` only calls this after Razorpay itself reports `status === 'processed'` on an
 * authenticated read. `refund.created` — the refund accepted but not yet sent — does not get
 * here. That ordering is the whole reason the copy can be in the past tense, and it is the
 * difference between an email a parent trusts and one they have to interpret.
 *
 * # What it deliberately does not say
 *
 * **No date.** `E06-33` is the open task for a per-instrument figure somebody has confirmed, and
 * the invented "5–7 working days" it exists to replace is exactly the sentence a parent plans
 * around. "Your bank decides when it lands" is true and is not a promise.
 *
 * **No `notes` from the dashboard.** Razorpay's `notes` are free text somebody typed, and
 * nothing guarantees it is free of a child's name. It reaches the ledger memo and stops there
 * (non-negotiable #4).
 *
 * **No recipient name, class or section.** Tier P data (§13.3). The order is identified by its
 * reference and the amount, which is what a parent matches against a bank statement anyway.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const TEMPLATE_REFUND_SENT = 'refund_sent';

export type RefundNoticeOutcome = 'sent' | 'already_sent' | 'suppressed' | 'failed';

export interface RefundNoticeInput {
  orderGroupId: string;
  amountPaise: number;
  /** `null` when the group was never invoiced — there is then no document to mention. */
  creditNoteId: string | null;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function sendRefundNotice(
  admin: SupabaseClient,
  input: RefundNoticeInput,
): Promise<RefundNoticeOutcome> {
  try {
    if (!input.orderGroupId) return 'failed';

    const { data: group } = await admin
      .from('order_group')
      .select('id, customer_user_id, correlation_id')
      .eq('id', input.orderGroupId)
      .maybeSingle();
    if (!group) return 'failed';

    const { data: user } = await admin
      .from('app_user')
      .select('id, email, first_name')
      .eq('id', group.customer_user_id)
      .maybeSingle();

    // Nullable by design — an Apple private-relay opt-out leaves it null (`0018`). No address is
    // not a failure; it is a customer we cannot email, recorded as such.
    const address = typeof user?.email === 'string' ? user.email.trim() : '';

    const { data: orders } = await admin
      .from('order')
      .select('order_ref, service_date')
      .eq('order_group_id', input.orderGroupId)
      .order('service_date', { ascending: true });

    const orderRef = String((orders ?? [])[0]?.order_ref ?? '');

    const { data: note } = input.creditNoteId
      ? await admin
          .from('invoice')
          .select('invoice_number')
          .eq('id', input.creditNoteId)
          .maybeSingle()
      : { data: null };

    const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';

    // **Claim the send before making it**, exactly as `order-confirmation` does. The insert is
    // the lock: `uq_notification_one_per_order_group` keys on `template_code` too, so this
    // cannot collide with the order confirmation — and a redelivered refund event that somehow
    // got past `record_refund`'s dedupe still cannot send a second email.
    const claim = await admin.from('notification_delivery').insert({
      user_id: group.customer_user_id,
      channel: 'email',
      template_code: TEMPLATE_REFUND_SENT,
      order_group_id: input.orderGroupId,
      status: 'queued',
      provider: apiKey ? 'resend' : null,
      correlation_id: group.correlation_id ?? null,
    });

    if (claim.error) {
      if (claim.error.code === '23505') return 'already_sent';
      console.error('refund-notice: could not claim the send', claim.error.code);
      return 'failed';
    }

    const finish = async (status: string, extra: Record<string, unknown> = {}) => {
      await admin
        .from('notification_delivery')
        .update({ status, ...extra })
        .eq('order_group_id', input.orderGroupId)
        .eq('template_code', TEMPLATE_REFUND_SENT)
        .eq('channel', 'email');
    };

    if (address === '') {
      await finish('suppressed', { suppressed_reason: 'no_email_on_account' });
      return 'suppressed';
    }

    if (!apiKey || !from) {
      // A state we are genuinely in on staging. It must not read as a provider failure — those
      // are different problems with different owners (`E07-04`).
      console.error(
        'refund-notice: RESEND_API_KEY / ORDER_EMAIL_FROM are not set — the refund HAS been sent ' +
          'and the parent has NOT been told. Configuration fault, not a provider outage.',
      );
      await finish('suppressed', { suppressed_reason: 'email_provider_not_configured' });
      return 'suppressed';
    }

    const greeting =
      typeof user?.first_name === 'string' && user.first_name.trim() !== ''
        ? `Hi ${user.first_name.trim()},`
        : 'Hi,';

    const creditNoteLine = note?.invoice_number
      ? `<p style="margin:0 0 16px">We have issued credit note <strong>${note.invoice_number}</strong> ` +
        `for this order. It cancels the tax invoice we sent you.</p>`
      : '';

    const html =
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
      `font-size:16px;line-height:1.5;color:#141a16;max-width:560px">` +
      `<p style="margin:0 0 16px">${greeting}</p>` +
      `<p style="margin:0 0 16px">We have refunded <strong>${rupees(input.amountPaise)}</strong>` +
      `${orderRef ? ` for order <strong>${orderRef}</strong>` : ''}.</p>` +
      creditNoteLine +
      // No date. See the header, and `E06-33`.
      `<p style="margin:0 0 16px">It has gone back to the card or account you paid with. How ` +
      `long it takes to appear is up to your bank.</p>` +
      `<p style="margin:0">If anything looks wrong, reply to this email and we will sort it ` +
      `out.</p></div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [address],
        subject: orderRef ? `Your refund for order ${orderRef}` : 'Your refund',
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      // The status AND a truncated body: a bare `resend_403` says a send failed and nothing
      // about why. `notification_delivery` still never holds the rendered body (`E20-10`).
      console.error(`refund-notice: resend ${response.status}: ${body.slice(0, 200)}`);
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
    console.error('refund-notice: threw', String(thrown));
    return 'failed';
  }
}
