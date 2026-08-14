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

import { renderInvoiceHtml, renderInvoiceText, type InvoiceEmailInput } from './invoice-email.ts';

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

    /**
     * `E07-04`. **The invoice is the email**, not an attachment — `E07-18`'s stored PDF is
     * fast-follow, and Rule 46 prescribes particulars rather than a file format.
     *
     * If the invoice row is missing the email is still sent, as a plain confirmation: an order
     * that settled and could not be described is still an order the parent must be told about.
     * That case is loud in the log, because it means `issue_invoice` did not run.
     */
    const invoice = await loadInvoice(admin, input.orderGroupId);
    if (!invoice) {
      console.error(
        `order-confirmation: no invoice for ${input.orderGroupId} — sending a bare confirmation. ` +
          'issue_invoice should have run inside settle_payment (D14).',
      );
    }

    const subject = invoice
      ? `Your GrayBag tax invoice ${invoice.invoiceNumber} — pickup code ${pickupCode}`
      : `Your GrayBag order is confirmed — pickup code ${pickupCode}`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [address],
        /**
         * **Replies must reach a human, and `from` cannot.**
         *
         * The sending domain `mail.graybag.com` is a subdomain with no inbox — it carries the
         * SES bounce MX and nothing else — so a parent who hits Reply on their invoice would be
         * writing to an address that silently discards it. Which is worse than no reply address:
         * they would believe they had told us something.
         *
         * `from` stays on the verified sending domain because deliverability depends on it
         * (SPF/DKIM are published there); `reply_to` routes the conversation to the aliased
         * mailbox that reaches Andy. Overridable per environment, defaulted so it is never absent.
         */
        reply_to: Deno.env.get('ORDER_EMAIL_REPLY_TO') ?? 'info@graybag.com',
        subject,
        ...(invoice
          ? { html: renderInvoiceHtml(invoice), text: renderInvoiceText(invoice) }
          : {
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
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`order-confirmation: resend ${response.status}: ${body.slice(0, 200)}`);
      // `failed` rather than `suppressed`, and the partial index lets it be retried.
      /**
       * **The provider's own message, not just the status code.**
       *
       * A bare `resend_403` says a send failed and nothing about why — unverified domain, wrong
       * key scope, and a rejected from-address are three different problems with three different
       * owners, and they are indistinguishable from the number alone. Diagnosing one meant
       * reproducing the call by hand, which is exactly the round trip instrumentation exists to
       * remove.
       *
       * Safe to store: Resend's errors describe the account and the domain, not the recipient.
       * Truncated, and `notification_delivery` still never holds the rendered body (`E20-10`).
       */
      await finish('failed', {
        failed_at: new Date().toISOString(),
        error_text: `resend_${response.status}: ${body.slice(0, 300)}`,
      });
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

/**
 * The issued invoice and its lines, shaped for the renderer.
 *
 * Read after settlement, never assembled from the cart: the invoice is the statutory record and
 * the email must agree with it exactly. A total computed a second way here is a second total.
 */
async function loadInvoice(
  admin: SupabaseClient,
  orderGroupId: string,
): Promise<InvoiceEmailInput | null> {
  const { data: inv } = await admin
    .from('invoice')
    .select(
      'id, invoice_number, issued_at, seller_legal_name, seller_address, seller_gstin, sac_code, ' +
        'place_of_supply_state_code, buyer_name_snapshot, buyer_gstin, taxable_value_paise, ' +
        'cgst_rate_bps, cgst_paise, sgst_rate_bps, sgst_paise, round_off_paise, total_paise, pickup_codes',
    )
    .eq('order_group_id', orderGroupId)
    .eq('document_type', 'invoice')
    .maybeSingle();
  if (!inv) return null;

  const { data: lines } = await admin
    .from('invoice_line')
    .select('description, sac_code, quantity, taxable_value_paise, cgst_paise, sgst_paise, total_paise')
    .eq('invoice_id', inv.id)
    .order('line_no', { ascending: true });

  const { data: orders } = await admin
    .from('order')
    .select('order_ref')
    .eq('order_group_id', orderGroupId)
    .order('service_date', { ascending: true });

  return {
    invoiceNumber: String(inv.invoice_number),
    issuedAt: String(inv.issued_at),
    sellerLegalName: String(inv.seller_legal_name),
    sellerAddress: String(inv.seller_address),
    sellerGstin: String(inv.seller_gstin),
    sacCode: String(inv.sac_code),
    placeOfSupplyStateCode: String(inv.place_of_supply_state_code),
    // Never fabricated — `E07-22`, Rule 46(f). Absent is lawful below ₹50,000.
    buyerName: (inv.buyer_name_snapshot as string | null) ?? null,
    buyerGstin: (inv.buyer_gstin as string | null) ?? null,
    taxableValuePaise: Number(inv.taxable_value_paise),
    cgstRateBps: Number(inv.cgst_rate_bps),
    cgstPaise: Number(inv.cgst_paise),
    sgstRateBps: Number(inv.sgst_rate_bps),
    sgstPaise: Number(inv.sgst_paise),
    roundOffPaise: Number(inv.round_off_paise ?? 0),
    totalPaise: Number(inv.total_paise),
    pickupCodes: (inv.pickup_codes as string[] | null) ?? [],
    orderRefs: (orders ?? []).map((o) => String((o as Record<string, unknown>).order_ref)),
    lines: (lines ?? []).map((l) => {
      const r = l as Record<string, unknown>;
      return {
        description: String(r.description),
        sacCode: String(r.sac_code),
        quantity: Number(r.quantity),
        taxableValuePaise: Number(r.taxable_value_paise),
        cgstPaise: Number(r.cgst_paise),
        sgstPaise: Number(r.sgst_paise),
        totalPaise: Number(r.total_paise),
      };
    }),
  };
}
