/**
 * How a parent reaches a person — `E20-39`.
 *
 * ## The address is never rendered
 *
 * Per Andy, 2026-08-11: keep the route, but **do not display the address**. A support address
 * printed on a screen in a shipped app is scraped, and the mailbox behind this one is a person's
 * rather than a rota's. So the address exists here, in one place, and reaches the screen only as
 * the target of a `mailto:` — the parent taps a button and their mail app opens with the
 * recipient already filled in, having never been shown it.
 *
 * `supportAddressIsNeverRendered` in `support.test.tsx` is what holds this: it fails if the
 * string appears in anything the screen draws.
 *
 * ## Why a constant and not configuration
 *
 * It is not a secret — it is on every email GrayBag sends — so there is nothing to protect by
 * moving it to an environment variable, and doing so would mean a build with the variable unset
 * ships a support screen whose button goes nowhere. A wrong address fails loudly at review; a
 * missing one fails silently in a parent's hands.
 */
export const SUPPORT_EMAIL = 'andy@graybag.com';

/**
 * The **published** grievance contact — `C17`, privacy policy §7A.
 *
 * Separate from `SUPPORT_EMAIL` because the DPDP Act requires a *named person* who answers
 * questions about personal data, and routing a data complaint into the general support inbox
 * is how a statutory deadline gets missed behind an order query. Vivek is that person.
 *
 * Unlike `SUPPORT_EMAIL` this address **is published** — it is in the privacy policy, which
 * the app renders in full. It is still not drawn on the Support screen, because a screen is
 * scraped more readily than a policy document and the compose button reaches him either way.
 */
export const GRIEVANCE_EMAIL = 'vivek@graybag.com';

/**
 * A `mailto:` with the subject pre-filled.
 *
 * The subject carries the reason, so an inbox with no ticketing system in front of it can still
 * be triaged by eye. Nothing identifying goes in it — not the parent's name, not a child's, not
 * an order id (non-negotiable #4). A subject line travels through mail servers in the clear.
 */
export function supportMailto(subject: string, to: string = SUPPORT_EMAIL): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}`;
}

/** The reasons the app composes a message for. Fixed strings, so the inbox can filter on them. */
export const SUPPORT_SUBJECTS = {
  general: 'GrayBag — support request',
  /** DPDP: questions or complaints about personal data go to the grievance officer. */
  grievance: 'GrayBag — data protection query',
  /** `E20-37`. Named so a deletion request cannot be missed in a general inbox. */
  deleteAccount: 'GrayBag — account deletion request',
  /** `E04-20`. With three schools live, this is the commonest thing a visitor needs to say. */
  schoolRequest: 'GrayBag — please add my school',
} as const;

/**
 * "My school is not listed" — `E04-20`.
 *
 * The typed search goes into the **body**, not the subject: a subject travels through mail
 * servers in the clear and a school name plus a parent's address is more than we need to put
 * there (non-negotiable #4). An empty query is the ordinary case — most visitors never search,
 * because with three schools live the whole list is visible at a glance — so the body prompts
 * for the name instead of pretending we captured one.
 */
export function schoolRequestMailto(query: string): string {
  const typed = query.trim();
  const body = typed
    ? `I was looking for: ${typed}\n\nMy school and city:\n`
    : 'My school and city:\n';
  return `${supportMailto(SUPPORT_SUBJECTS.schoolRequest)}&body=${encodeURIComponent(body)}`;
}
