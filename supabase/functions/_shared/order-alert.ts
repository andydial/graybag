/**
 * "Order 14 of today." The kitchen alert — `E08-16`.
 *
 * Andy: *"When an order is paid, email a configurable list of addresses… Also the running count
 * for that service date, so I can see 'order 14 of today' at a glance."*
 *
 * # No child appears in this email, ever
 *
 * Andy again, and it is the constraint that shapes the whole file: *"No child names, classes or
 * sections in the alert. That's tier-S data under DPDP and email is not a controlled channel —
 * the kitchen board is where names belong."*
 *
 * So the query selects `order_ref`, the school and break **snapshots**, the service date, the
 * dish names and quantities, and the total. It does **not** select
 * `recipient_name_snapshot`, `class_label_snapshot` or `section_label_snapshot` — the same
 * technique as `REPORT_ORDER_COLUMNS`, where the column list is the control rather than a
 * template that remembers not to print something it was handed.
 *
 * # One alert per order, claimed before it is sent
 *
 * Both settlement paths can reach a paid order within seconds: the webhook push and the
 * `checkout-status` pull. `settle_payment` is idempotent and an email is not, so the claim is a
 * **conditional update** on `staff_alert_sent_at` — `is null` in the predicate — and the send only
 * happens if this call was the one that wrote it. That is the same "claim before you send" shape
 * as `order-confirmation` and `refund-notice`, expressed with a column instead of a unique index
 * because `notification_delivery.user_id` is `NOT NULL` and an alert is not addressed to a person
 * (`0056`).
 *
 * # Never throws
 *
 * Settlement has already happened by the time this runs. An alert that fails must not unwind a
 * payment, so every path returns an outcome and the caller ignores it.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type OrderAlertOutcome = 'sent' | 'already_sent' | 'no_recipients' | 'suppressed' | 'failed';

const esc = (s: string): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The columns an alert may read.
 *
 * **No recipient, no class, no section.** Widening this is the only way a child's name could
 * reach an inbox from here, which is what makes it the control rather than the template.
 */
const ALERT_ORDER_COLUMNS =
  'id,order_ref,service_date,status,school_id,school_name_snapshot,break_label_snapshot,' +
  'total_paise,tax_cgst_paise,tax_sgst_paise,staff_alert_sent_at,' +
  'order_line(dish_name_snapshot,quantity)';

interface Line { dish_name_snapshot?: unknown; quantity?: unknown }

export async function sendOrderAlerts(
  admin: SupabaseClient,
  input: { orderGroupId: string },
): Promise<OrderAlertOutcome> {
  try {
    if (!input.orderGroupId) return 'failed';

    const { data: orders } = await admin
      .from('order')
      .select(ALERT_ORDER_COLUMNS)
      .eq('order_group_id', input.orderGroupId);

    const payable = (orders ?? []).filter(
      (o: Record<string, unknown>) =>
        typeof o.status === 'string' &&
        ['paid', 'preparing', 'delivered'].includes(o.status) &&
        o.staff_alert_sent_at === null,
    );
    if (payable.length === 0) return 'already_sent';

    const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';

    let outcome: OrderAlertOutcome = 'already_sent';

    for (const order of payable) {
      const orderId = String(order.id);
      const schoolId = String(order.school_id ?? '');
      const serviceDate = String(order.service_date ?? '');

      // Which kitchen cooks it. The recipient list is per kitchen (`0066`), and the order carries
      // a school rather than a kitchen, so this is the one join the alert needs.
      const { data: school } = await admin
        .from('school').select('kitchen_id').eq('id', schoolId).maybeSingle();
      const kitchenId = (school?.kitchen_id as string | undefined) ?? null;
      if (!kitchenId) continue;

      const { data: recipients } = await admin
        .from('kitchen_alert_recipient')
        .select('email')
        .eq('kitchen_id', kitchenId)
        .eq('is_enabled', true);

      const to = (recipients ?? [])
        .map((r: { email?: unknown }) => (typeof r.email === 'string' ? r.email : ''))
        .filter(Boolean);

      if (to.length === 0) {
        // Nobody is listed, or everybody is switched off. Both are a deliberate configuration and
        // neither is a failure — but the order is **not** marked as alerted, so adding a recipient
        // does not silently skip the orders that arrived while the list was empty.
        outcome = outcome === 'sent' ? 'sent' : 'no_recipients';
        continue;
      }

      /*
       * The claim. `is('staff_alert_sent_at', null)` in the predicate is what makes this safe
       * against the two settlement paths racing: whichever update matches a row first wins, and
       * the loser gets zero rows back and sends nothing.
       */
      const stamp = new Date().toISOString();
      const { data: claimed } = await admin
        .from('order')
        .update({ staff_alert_sent_at: stamp })
        .eq('id', orderId)
        .is('staff_alert_sent_at', null)
        .select('id');

      if (!claimed || claimed.length === 0) continue;

      if (!apiKey || !from) {
        // Configuration, not a provider outage — the distinction `E12-34` cost a day. The claim
        // is released so the alert is not lost once the key is set.
        console.error(
          'order-alert: RESEND_API_KEY / ORDER_EMAIL_FROM are not set — an order was paid and ' +
            'the kitchen has NOT been told. Configuration fault, not a provider outage.',
        );
        await admin.from('order').update({ staff_alert_sent_at: null }).eq('id', orderId);
        outcome = 'suppressed';
        continue;
      }

      /*
       * "Order 14 of today", counted per kitchen for the service date.
       *
       * Counted **after** the claim, so this order is included — the number a person wants is
       * "this is the fourteenth", not "there were thirteen before it". `head: true` with
       * `count: 'exact'` returns the number without the rows.
       */
      const { data: kitchenSchools } = await admin
        .from('school').select('id').eq('kitchen_id', kitchenId);
      const schoolIds = (kitchenSchools ?? []).map((s: { id: unknown }) => String(s.id));

      const { count } = await admin
        .from('order')
        .select('id', { count: 'exact', head: true })
        .eq('service_date', serviceDate)
        .in('school_id', schoolIds)
        .in('status', ['paid', 'preparing', 'delivered']);

      const lines = Array.isArray(order.order_line) ? (order.order_line as Line[]) : [];
      const items = lines
        .map((l) =>
          `<tr><td style="padding:4px 12px 4px 0;text-align:right">${Number(l.quantity ?? 0)}×</td>` +
          `<td style="padding:4px 0">${esc(String(l.dish_name_snapshot ?? ''))}</td></tr>`,
        )
        .join('');

      const gst =
        Number(order.tax_cgst_paise ?? 0) + Number(order.tax_sgst_paise ?? 0);

      const html =
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
        `font-size:16px;line-height:1.5;color:#141a16;max-width:560px">` +
        `<p style="margin:0 0 4px;font-size:20px"><strong>Order ${count ?? '?'} of ${esc(serviceDate)}</strong></p>` +
        `<p style="margin:0 0 16px;color:#4a544c">${esc(String(order.order_ref ?? ''))}</p>` +
        `<p style="margin:0 0 16px">` +
          `<strong>${esc(String(order.school_name_snapshot ?? ''))}</strong><br>` +
          `${esc(String(order.break_label_snapshot ?? ''))} · ${esc(serviceDate)}` +
        `</p>` +
        `<table style="margin:0 0 16px;border-collapse:collapse">${items}</table>` +
        `<p style="margin:0 0 16px">` +
          `<strong>${rupees(Number(order.total_paise ?? 0))}</strong> ` +
          `<span style="color:#4a544c">including ${rupees(gst)} GST</span>` +
        `</p>` +
        // Said out loud, because somebody will eventually ask why the name is missing.
        `<p style="margin:0;color:#4a544c;font-size:14px">` +
          `No child's name is included in this alert — open the kitchen board for that.` +
        `</p></div>`;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          subject:
            `Order ${count ?? ''} · ${String(order.school_name_snapshot ?? '')} · ${serviceDate}`.trim(),
          html,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`order-alert: resend ${response.status}: ${body.slice(0, 200)}`);
        // Released, so a provider outage does not permanently silence this order.
        await admin.from('order').update({ staff_alert_sent_at: null }).eq('id', orderId);
        outcome = 'failed';
        continue;
      }

      outcome = 'sent';
    }

    return outcome;
  } catch (thrown) {
    console.error('order-alert: threw', String(thrown));
    return 'failed';
  }
}
