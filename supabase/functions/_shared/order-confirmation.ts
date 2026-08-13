/**
 * "Your order is confirmed" — `E08-03`, and the one email v1 sends. Email only; no push (`#7`).
 *
 * Called from wherever settlement completes. Today that is only `checkout-status` — the webhook
 * records events but nothing consumes its queue yet (`E06-37`). `0050`'s unique index is already
 * in place for when the second route exists, because on a normal payment the two will settle
 * within seconds of each other: the loser's insert fails on `23505` and reads it as success
 * already achieved, rather than sending a parent a second confirmation for one lunch.
 *
 * # It never blocks settlement
 *
 * Every path here returns rather than throws. An order that is paid and whose email failed is a
 * support conversation; a settlement rolled back because an email provider was slow is money
 * taken with no order against it. The caller ignores the return value on purpose.
 *
 * # What is in the email, and what is not
 *
 * The recipient's **first name only** (§4.3, `G7`) — a parent may forward this. Never the class,
 * the section, or an allergen. And `notification_delivery` **never stores the rendered body**
 * (`E20-10`): the row records `template_code` and non-PII parameters, so the log does not become
 * another copy of children's data.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const TEMPLATE_ORDER_CONFIRMED = 'order_confirmed';

export interface ConfirmationInput {
  orderGroupId: string;
  correlationId: string | null;
}

type Outcome = 'sent' | 'already_sent' | 'suppressed' | 'failed';

export async function sendOrderConfirmation(
  admin: SupabaseClient,
  input: ConfirmationInput,
): Promise<Outcome> {
  try {
    const { data: group } = await admin
      .from('order_group')
      .select('id, customer_user_id, payable_paise')
      .eq('id', input.orderGroupId)
      .maybeSingle();
    if (!group) return 'failed';

    const { data: user } = await admin
      .from('app_user')
      .select('id, email, first_name')
      .eq('id', group.customer_user_id)
      .maybeSingle();

    // `app_user.email` is nullable — Apple private-relay opt-out leaves it null (`0018`). No
    // address is not a failure; it is a customer we cannot email, recorded as such.
    const address = typeof user?.email === 'string' ? user.email.trim() : '';

    const { data: orders } = await admin
      .from('order')
      .select('pickup_code, service_date, recipient_name_snapshot, break_label_snapshot, total_paise')
      .eq('order_group_id', input.orderGroupId)
      .order('service_date', { ascending: true });

    const rows = orders ?? [];
    if (rows.length === 0) return 'failed';

    const first = rows[0] as Record<string, unknown>;
    const fullName = String(first.recipient_name_snapshot ?? '').trim();
    const firstName = fullName === '' ? null : fullName.split(/\s+/)[0];
    const pickupCode = String(first.pickup_code ?? '');
    const totalPaise = rows.reduce(
      (sum, o) => sum + Number((o as Record<string, unknown>).total_paise ?? 0),
      0,
    );

    const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';

    // **Claim the send before making it.** The insert is the lock: if the other settlement route
    // got here first this fails on 23505 and we stop, which is the entire dedup mechanism.
    const claim = await admin.from('notification_delivery').insert({
      user_id: group.customer_user_id,
      channel: 'email',
      template_code: TEMPLATE_ORDER_CONFIRMED,
      order_group_id: input.orderGroupId,
      status: 'queued',
      provider: apiKey ? 'resend' : null,
      correlation_id: input.correlationId,
    });

    if (claim.error) {
      if (claim.error.code === '23505') return 'already_sent';
      console.error('order-confirmation: could not claim the send', claim.error.code);
      return 'failed';
    }

    const finish = async (status: string, extra: Record<string, unknown> = {}) => {
      await admin
        .from('notification_delivery')
        .update({ status, ...extra })
        .eq('order_group_id', input.orderGroupId)
        .eq('template_code', TEMPLATE_ORDER_CONFIRMED)
        .eq('channel', 'email');
    };

    if (address === '') {
      await finish('suppressed', { suppressed_reason: 'no_email_on_account' });
      return 'suppressed';
    }

    // Not configured is a state we are genuinely in on staging, and it must not read as a
    // provider failure — those are different problems with different owners (`E07-04`).
    if (!apiKey || !from) {
      console.error(
        'order-confirmation: RESEND_API_KEY / ORDER_EMAIL_FROM are not set — the order IS paid ' +
          'and the parent has NOT been told. Configuration fault, not a provider outage.',
      );
      await finish('suppressed', { suppressed_reason: 'email_provider_not_configured' });
      return 'suppressed';
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [address],
        subject: `Your GrayBag order is confirmed — pickup code ${pickupCode}`,
        text: renderText({
          greetingName: typeof user?.first_name === 'string' ? user.first_name : null,
          firstName,
          pickupCode,
          serviceDate: String(first.service_date ?? ''),
          breakLabel: String(first.break_label_snapshot ?? 'break'),
          itemCount: rows.length,
          totalPaise,
        }),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`order-confirmation: resend ${response.status}: ${body.slice(0, 200)}`);
      // `failed` rather than `suppressed`, and the partial index lets it be retried.
      await finish('failed', { failed_at: new Date().toISOString(), error_text: `resend_${response.status}` });
      return 'failed';
    }

    const sent = (await response.json()) as { id?: string };
    await finish('sent', {
      sent_at: new Date().toISOString(),
      ...(sent.id ? { provider_message_id: sent.id } : {}),
    });
    return 'sent';
  } catch (error) {
    // Never throws into the caller. See the header.
    console.error('order-confirmation: threw', String(error));
    return 'failed';
  }
}

/**
 * Plain text, deliberately.
 *
 * The pickup code is what the kitchen asks for, so it is on its own line and not buried in a
 * sentence. `null` for the recipient means the account holder ordered for themselves (`E05-38`),
 * and the copy says "you" rather than inventing a name.
 */
function renderText(o: {
  greetingName: string | null;
  firstName: string | null;
  pickupCode: string;
  serviceDate: string;
  breakLabel: string;
  itemCount: number;
  totalPaise: number;
}): string {
  const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const who = o.firstName === null ? 'you' : o.firstName;
  const hello = o.greetingName ? `Hi ${o.greetingName},` : 'Hi,';

  return [
    hello,
    '',
    `Your order for ${who} is confirmed.`,
    '',
    `Pickup code: ${o.pickupCode}`,
    '',
    `When: ${o.serviceDate}, at ${o.breakLabel}`,
    `Items: ${o.itemCount}`,
    `Paid: ${rupees(o.totalPaise)} (including GST)`,
    '',
    'Your tax invoice is available in the app under Orders.',
    '',
    'GrayBag',
  ].join('\n');
}
