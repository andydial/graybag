// "Somebody asked to be contacted" — `E12-16`.
//
// A school enquiry is the only lead capture the business has, and schools are the revenue. A row
// nobody looks at is not a lead; it is a lead we lost slowly.
//
// ## Best effort, always. It must never fail the request.
//
// `docs/enquiry-submission-contract.md` §6 is explicit: *"an enquiry lost because a mail provider
// had a bad minute is the worst outcome this endpoint can produce."* So every path here returns a
// word rather than throwing, the caller ignores the result, and the **row is already committed**
// before this is called. If Resend is down, the enquiry is still recorded and this logs why.
//
// That is the opposite trade from `order-confirmation`, which may suppress a send. Here the send
// is the less important half.
//
// ## What it deliberately does not contain
//
// The enquirer's phone number and their message are **not** in the notification body. They are in
// the row. An email is forwarded, quoted and left in inboxes; a row has RLS. The notice carries
// enough to decide whether to act now — who, which school, which city — and says where the rest
// is. If that turns out to be annoying in practice it is a deliberate thing to revisit, not an
// oversight.

export interface EnquiryNotice {
  id: string;
  name: string;
  role: string;
  school: string;
  city: string;
  email: string;
  /** True when the enquiry arrived without JavaScript — worth knowing, it is a connectivity signal. */
  noJs: boolean;
}

const ROLE_WORDS: Record<string, string> = {
  principal: 'Principal',
  vice_principal: 'Vice Principal',
  administrator: 'Administrator',
  canteen_manager: 'Canteen Manager',
  other: 'Other',
};

export function renderEnquiryText(e: EnquiryNotice): string {
  return [
    `${e.name} — ${ROLE_WORDS[e.role] ?? e.role}`,
    `${e.school}, ${e.city}`,
    '',
    `Reply to: ${e.email}`,
    '',
    'Their phone number and message are on the enquiry row, deliberately not in this email:',
    `  enquiry id ${e.id}`,
    '',
    e.noJs ? 'Sent without JavaScript — they may be on a poor connection.' : '',
  ].filter((line) => line !== '').join('\n');
}

/**
 * Send it. Returns a word describing what happened; never throws.
 *
 * @returns `sent` | `skipped` (no key or no recipient configured) | `failed`
 */
export async function sendEnquiryNotice(e: EnquiryNotice): Promise<string> {
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';
    /**
     * Its own variable first, because enquiries are sales and the person who answers them is not
     * necessarily the person who answers an order problem.
     *
     * But it falls back to `SUPPORT_ALERT_EMAIL`, which production already has set, and that
     * fallback is the point: the first deploy of this notice went out with only
     * `ENQUIRY_EMAIL_TO` and `ORDER_EMAIL_REPLY_TO` in the chain, neither of which existed on
     * prod — so a real enquiry was stored and **silently not announced**. A notification path
     * whose only recipient variable is one nobody has set is a notification path that does
     * nothing, and it fails exactly the way that is hardest to notice: quietly, and only in
     * production.
     *
     * Ordered most-specific to least, so setting `ENQUIRY_EMAIL_TO` still wins.
     */
    const to =
      Deno.env.get('ENQUIRY_EMAIL_TO') ??
      Deno.env.get('ORDER_EMAIL_REPLY_TO') ??
      Deno.env.get('SUPPORT_ALERT_EMAIL') ??
      '';

    if (!apiKey || !from || !to) {
      // A warning, not an error. The row is stored; nobody has lost anything except immediacy,
      // and the operator can still read `enquiry`.
      console.warn(
        `enquiry-notice: not sent for ${e.id} — ` +
          `${!apiKey ? 'RESEND_API_KEY ' : ''}${!from ? 'ORDER_EMAIL_FROM ' : ''}` +
          `${!to ? 'ENQUIRY_EMAIL_TO/ORDER_EMAIL_REPLY_TO/SUPPORT_ALERT_EMAIL ' : ''}` +
          `unset. The enquiry IS stored.`,
      );
      return 'skipped';
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        // Replying to the notification writes to the person who asked, which is the only thing
        // anybody wants to do with it. `from` stays on the verified sending domain because
        // deliverability depends on it — the same split `order-confirmation` documents.
        reply_to: e.email,
        // The school and city are in the subject on purpose: this arrives on a phone, and
        // "GrayBag enquiry" alone would need opening to be triaged.
        subject: `GrayBag enquiry — ${e.school}, ${e.city}`,
        text: renderEnquiryText(e),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `enquiry-notice: resend ${response.status} for ${e.id}: ${body.slice(0, 200)}. ` +
          `The enquiry IS stored.`,
      );
      return 'failed';
    }
    return 'sent';
  } catch (cause) {
    // Including a network failure. The row is already committed; this is the half that may fail.
    console.error(`enquiry-notice: threw for ${e.id}: ${String(cause).slice(0, 200)}. The enquiry IS stored.`);
    return 'failed';
  }
}
