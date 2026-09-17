/**
 * "Your child's lunch was delivered." `E21-99`.
 *
 * Andy, 2026-09-17: *"parents should hear that their child got the food, and right now we tell
 * them nothing."* He is right, and it was checked rather than assumed before this was written:
 * `kitchen-order-status` is the only thing that marks an order delivered, and its sole email call
 * sat inside `if (to === 'cancelled')`. Delivering wrote `delivered_at`, `delivered_by_user_id`
 * and an `order_event` row, and told the parent nothing at all.
 *
 * ## The child's name is in this email, and in nothing else
 *
 * Andy: *"The child's name is fine here — it's going to their own parent, which is the one place
 * that data belongs."* So it is rendered, and that is the whole extent of it. It is **not** in
 * `notification_delivery` — `0001`'s comment on that table names this exact email as the reason
 * the rule exists: *"A push telling a parent 'Aarav's lunch has been delivered' contains a
 * child's name, and storing it multiplies the copies of children's PII for no operational gain."*
 * It is not in any log line here either: every `console.error` below carries a status code or a
 * provider body, never a row. Non-negotiable #4.
 *
 * ## Exactly once, and keyed on the state change
 *
 * Two mechanisms, and they are independent on purpose.
 *
 *   1. **The caller passes only orders that actually moved.** `kitchen-order-status` separates
 *      `updated` from `skipped` inside a transaction that has already taken `for update` on the
 *      rows, so an order that was already `delivered` is never in the list — and a second tablet
 *      pressing the same button blocks on the lock and then finds nothing to do. That is Andy's
 *      *"key it on the state change, not the button"*, and it is where the rule belongs.
 *   2. **`uq_notification_one_per_order` is the backstop.** `(order_id, template_code, channel)`,
 *      partial on `status <> 'failed'`. The insert below IS the claim, and `23505` reads as
 *      "somebody already did this" rather than as an error — the same lock `E08-03` and `E09-38`
 *      use, needing no migration because the index is per-order and the template code is new.
 *
 * ### `order_group_id` is deliberately NOT set on the row, and this is the subtle one
 *
 * The other per-order sender (`cancellation-notice.ts`) sets it, and that is a latent defect
 * rather than a pattern to copy — `E21-100`. `uq_notification_one_per_order_group` is unique on
 * `(order_group_id, template_code, channel)`, and **a cart spanning three days is one group with
 * three orders.** Marking that group's three orders delivered would claim once and then collide
 * twice, each collision read as `already_sent`, and two of the three parents' meals would go
 * unreported — which is precisely the failure Andy asked to be prevented: *"one email per order,
 * not one combined digest."*
 *
 * Leaving it null is not a workaround for the constraint. This notification is about an order, on
 * a day, for a child; it is not about a group, and putting it in a group-keyed uniqueness domain
 * is a category error. The group is one join away through `order_id` for anyone who wants it.
 *
 * ## It cannot fail the delivery
 *
 * Andy: *"If the email fails, the order is still delivered — the kitchen's action must not depend
 * on Resend being up."* Every path here returns an outcome and the function never throws: the
 * `catch` at the bottom is total. The caller runs it after the commit and ignores the result.
 */
/**
 * ## Two deliberate departures from the other `_shared` senders
 *
 * Both exist so this module can be **imported and run** by `delivery-notice.test.ts`, rather than
 * read as text the way `order-confirmation.test.ts` has to read its own. That difference is worth
 * the two lines: the assertions Andy asked for — *"a second delivered transition sends nothing"*,
 * *"a failed send still leaves a visible row"* — are about behaviour, and scanning source proves
 * neither. It also means this is the first Edge Function module in the repo under a typechecker at
 * all; there is no `deno check` in CI.
 *
 *   1. **The client is described structurally**, not imported from `jsr:@supabase/supabase-js@2`.
 *      A `jsr:` specifier is unresolvable outside Deno, and the real `SupabaseClient` type is far
 *      wider than anything used here. Naming the two methods this file calls is more honest about
 *      the dependency and lets a test supply exactly that much.
 *   2. **`Deno.env` is reached through `globalThis`** rather than assumed to be ambient, so the
 *      absence of the global is a value this code already handles (it falls to the
 *      `email_provider_not_configured` branch) instead of a name TypeScript cannot see.
 */
type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (column: string) => QueryBuilder;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
  insert: (row: Record<string, unknown>) => Promise<{ error: { code: string } | null }>;
  update: (patch: Record<string, unknown>) => QueryBuilder;
  then: (resolve: (value: { data: Record<string, unknown>[] | null }) => unknown) => unknown;
};

/** Only what this file calls. See the note above. */
export interface DeliveryNoticeClient {
  from: (table: string) => QueryBuilder;
}

const env = (key: string): string => {
  const runtime = (globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } })
    .Deno;
  return runtime?.env.get(key) ?? '';
};

export const TEMPLATE_ORDER_DELIVERED = 'order_delivered';

export type DeliveryNoticeOutcome = 'sent' | 'already_sent' | 'suppressed' | 'failed';

export interface DeliveryNoticeInput {
  orderId: string;
}

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `14:05:00` → `2:05 pm`. Returns '' for anything unparseable rather than inventing a time. */
export function formatBreakTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return '';
  const h = Number(match[1]);
  const m = match[2];
  if (!Number.isInteger(h) || h < 0 || h > 23) return '';
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${suffix}`;
}

/**
 * The delivery time, in the school's own zone.
 *
 * **Never the server's.** An Edge Function runs wherever it runs, and a parent in Mohali told
 * their child ate at *"3:27 am"* has been given a wrong fact rather than a missing one (§5.21).
 * Falls back to omitting the time entirely if the zone is unusable — the sentence reads perfectly
 * well without it, and a wrong time is worse than no time.
 */
export function formatDeliveredAt(deliveredAt: unknown, timeZone: unknown): string {
  if (typeof deliveredAt !== 'string' || deliveredAt === '') return '';
  const when = new Date(deliveredAt);
  if (Number.isNaN(when.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...(typeof timeZone === 'string' && timeZone !== '' ? { timeZone } : {}),
    }).format(when);
  } catch {
    // An unknown IANA zone throws rather than falling back, so this is the branch that stops a
    // bad `platform_config.timezone` from costing the whole email.
    return '';
  }
}

export async function sendDeliveryNotice(
  admin: DeliveryNoticeClient,
  input: DeliveryNoticeInput,
): Promise<DeliveryNoticeOutcome> {
  try {
    if (!input.orderId) return 'failed';

    /*
     * `E21-93`'s rule, applied from the start rather than retrofitted: **the only exits allowed
     * before the claim are the ones that cannot be recorded at all.** The row is keyed on an
     * order and a user, so an order that does not exist has nothing to key on. Everything after
     * the claim goes through `finish()`.
     */
    const { data: order } = await admin
      .from('order')
      .select(
        'id, order_ref, service_date, delivered_at, customer_user_id, recipient_id, ' +
          'school_id, break_time_id, correlation_id',
      )
      .eq('id', input.orderId)
      .maybeSingle();
    if (!order) {
      console.error('delivery-notice: no such order');
      return 'failed';
    }

    const apiKey = env('RESEND_API_KEY');
    const from = env('ORDER_EMAIL_FROM');

    // THE CLAIM. Before the provider call, before the reads that render the body, and before any
    // path that can return — so "we never tried" is a state this table can express.
    const claim = await admin.from('notification_delivery').insert({
      user_id: order.customer_user_id,
      channel: 'email',
      template_code: TEMPLATE_ORDER_DELIVERED,
      order_id: order.id,
      // NOT the group — see the note at the top of this file. `E21-100`.
      order_group_id: null,
      status: 'queued',
      provider: apiKey ? 'resend' : null,
      correlation_id: order.correlation_id ?? null,
    });

    if (claim.error) {
      // The second transition to delivered, or a retried request. Not an error.
      if (claim.error.code === '23505') return 'already_sent';
      console.error('delivery-notice: could not claim the send', claim.error.code);
      return 'failed';
    }

    const finish = async (status: string, extra: Record<string, unknown> = {}) => {
      await admin
        .from('notification_delivery')
        .update({ status, ...extra })
        .eq('order_id', order.id)
        .eq('template_code', TEMPLATE_ORDER_DELIVERED)
        .eq('channel', 'email');
    };

    const { data: user } = await admin
      .from('app_user')
      .select('id, email, first_name')
      .eq('id', order.customer_user_id)
      .maybeSingle();

    // Nullable by design — an Apple private-relay opt-out leaves it null (`0018`). Not a failure:
    // a customer we cannot email, recorded as such.
    const address = typeof user?.email === 'string' ? user.email.trim() : '';
    if (address === '') {
      await finish('suppressed', { suppressed_reason: 'no_email_on_account' });
      return 'suppressed';
    }

    if (!apiKey || !from) {
      console.error(
        'delivery-notice: RESEND_API_KEY / ORDER_EMAIL_FROM are not set — food HAS been ' +
          'delivered and the parent has NOT been told. Configuration fault, not a provider outage.',
      );
      await finish('suppressed', { suppressed_reason: 'email_provider_not_configured' });
      return 'suppressed';
    }

    // ------------------------------------------------------------------ what the email says
    const { data: recipient } = await admin
      .from('recipient')
      .select('first_name, is_self')
      .eq('id', order.recipient_id)
      .maybeSingle();

    const { data: lines } = await admin
      .from('order_line')
      .select('line_no, quantity, dish_name_snapshot')
      .eq('order_id', order.id)
      .order('line_no');

    const { data: school } = await admin
      .from('school')
      .select('name')
      .eq('id', order.school_id)
      .maybeSingle();

    /*
     * The zone comes from `platform_config`, not from the school, and that is the schema's rule
     * rather than a convenience: `0001` says in terms *"timezone — platform and kitchen only. A
     * school does not get its own."* Reading a `school.time_zone` would have been a column that
     * does not exist, and the select would have failed the whole email rather than the time.
     */
    const { data: platform } = await admin
      .from('platform_config')
      .select('timezone')
      .maybeSingle();

    const { data: breakTime } = order.break_time_id
      ? await admin
          .from('break_time')
          .select('label, starts_at, ends_at')
          .eq('id', order.break_time_id)
          .maybeSingle()
      : { data: null };

    const greeting =
      typeof user?.first_name === 'string' && user.first_name.trim() !== ''
        ? `Hi ${esc(user.first_name.trim())},`
        : 'Hi,';

    /*
     * Whose lunch it was. `is_self` is an adult ordering for themselves — "your lunch", not their
     * own first name back at them, which reads as a form letter addressed to a stranger.
     */
    const childName =
      typeof recipient?.first_name === 'string' ? recipient.first_name.trim() : '';
    const who = recipient?.is_self === true || childName === '' ? 'Your' : `${esc(childName)}’s`;

    /*
     * **The items, and no prices.** Andy: *"No prices needed."* This is a delivery receipt, not an
     * invoice — the invoice already exists and carries the money. Quantities are shown because
     * "2 × Idli Sambar" is how a parent checks the right food arrived, which is the entire job of
     * this email.
     */
    const items = (lines ?? [])
      .map((l: Record<string, unknown>): string => {
        const name = String(l.dish_name_snapshot ?? '').trim();
        if (name === '') return '';
        const qty = Number(l.quantity ?? 1);
        return `<li style="margin:0 0 4px">${qty > 1 ? `${qty} × ` : ''}${esc(name)}</li>`;
      })
      .filter((l: string) => l !== '')
      .join('');
    const itemsBlock = items
      ? `<ul style="margin:0 0 16px;padding-left:20px">${items}</ul>`
      : '';

    const breakLabel = typeof breakTime?.label === 'string' ? breakTime.label.trim() : '';
    const window = [formatBreakTime(breakTime?.starts_at), formatBreakTime(breakTime?.ends_at)]
      .filter((t) => t !== '')
      .join('–');
    const breakPhrase = breakLabel
      ? `at <strong>${esc(breakLabel)}</strong>${window ? ` (${esc(window)})` : ''}`
      : '';

    const schoolName = typeof school?.name === 'string' ? school.name.trim() : '';
    const schoolPhrase = schoolName ? ` at ${esc(schoolName)}` : '';

    const at = formatDeliveredAt(order.delivered_at, platform?.timezone);
    const atPhrase = at ? ` at <strong>${esc(at)}</strong>` : '';

    const orderRef = String(order.order_ref ?? '');
    const served = String(order.service_date ?? '');

    const html =
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
      `font-size:16px;line-height:1.5;color:#141a16;max-width:560px">` +
      `<p style="margin:0 0 16px">${greeting}</p>` +
      `<p style="margin:0 0 16px">${who} lunch was delivered${schoolPhrase}${atPhrase}` +
      `${breakPhrase ? `, ${breakPhrase}` : ''}.</p>` +
      itemsBlock +
      `<p style="margin:0 0 16px">` +
      `${served ? `For <strong>${esc(served)}</strong>. ` : ''}` +
      `${orderRef ? `Order <strong>${esc(orderRef)}</strong>.` : ''}</p>` +
      `<p style="margin:0">If something does not look right, reply to this email and we will ` +
      `sort it out.</p></div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [address],
        // No name in the subject line. Subjects are the part of an email most likely to be read
        // over a shoulder, quoted in a support ticket, or shown on a lock screen.
        subject: orderRef ? `Lunch delivered — order ${orderRef}` : 'Lunch delivered',
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`delivery-notice: resend ${response.status}: ${body.slice(0, 200)}`);
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
    // `String(thrown)` and nothing else. A thrown PostgREST error can quote a row, and a row here
    // holds a child's first name.
    console.error('delivery-notice: threw', String(thrown));
    return 'failed';
  }
}
