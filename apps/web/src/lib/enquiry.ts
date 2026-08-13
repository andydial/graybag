/**
 * The enquiry form's rules (`E12-02`), as pure functions.
 *
 * This is the whole of what the public site knows about an enquiry: what the fields are, what
 * counts as valid, and what shape goes over the wire. It is deliberately free of DOM, of
 * `fetch`, and of anything Astro — so the same functions validate on the client, are asserted by
 * `enquiry.test.ts`, and describe exactly what `enquiry-submit` must re-check server-side.
 *
 * **Client validation is courtesy, never the guard.** Every rule here is restated in
 * `docs/enquiry-submission-contract.md` for the Edge Function to enforce, on the same reasoning
 * as `ux-spec.md` R7 gives for the order cutoff: the client is a convenience and the server is
 * the authority. A form that only validates in the browser is a form with no validation.
 *
 * ## What this is not
 *
 * There is no child data here and nothing in tier P or S. The person filling this in is an
 * adult acting in a professional capacity, and their name, work email and phone are ordinary
 * personal data. That is why this module may hold a `name` field at all, and it is worth saying
 * out loud so nobody later reasons by analogy from `R6` and concludes the opposite.
 */

/**
 * Who fills this form in.
 *
 * A closed list rather than free text because the answer changes what we say back — a principal
 * and a canteen manager need different first conversations — and because "Principal", "principal"
 * and "The Principal" are the same person and should not be three rows. `other` keeps it honest
 * for the school whose structure we did not guess.
 */
export const ROLES = [
  { value: 'principal', label: 'Principal' },
  { value: 'vice_principal', label: 'Vice principal / Head of school' },
  { value: 'administrator', label: 'Administrator / Head of administration' },
  { value: 'canteen_manager', label: 'Canteen or mess manager' },
  { value: 'management', label: 'Trustee / Management' },
  { value: 'other', label: 'Something else' },
] as const;

export type Role = (typeof ROLES)[number]['value'];

const ROLE_VALUES: ReadonlySet<string> = new Set(ROLES.map((r) => r.value));

export interface EnquiryInput {
  readonly name: string;
  readonly role: string;
  readonly school: string;
  readonly city: string;
  readonly email: string;
  readonly phone: string;
  readonly message: string;
}

export interface EnquiryPayload {
  readonly name: string;
  readonly role: Role;
  readonly school: string;
  readonly city: string;
  readonly email: string;
  readonly phone: string;
  readonly message: string | null;
}

/** Field name -> the message shown under that field. Empty means the form is valid. */
export type EnquiryErrors = Partial<Record<keyof EnquiryInput, string>>;

export const EMPTY_ENQUIRY: EnquiryInput = {
  name: '',
  role: '',
  school: '',
  city: 'Mohali',
  email: '',
  phone: '',
  message: '',
};

/**
 * Field limits. Generous, because the cost of a rejected genuine enquiry is far higher than the
 * cost of storing a long school name, and because a limit a real person can hit is a bug.
 */
export const LIMITS = {
  name: { min: 2, max: 80 },
  school: { min: 2, max: 120 },
  city: { min: 2, max: 60 },
  email: { max: 254 },
  message: { max: 2000 },
} as const;

/** Collapse internal runs of whitespace and trim. Paste from a PDF arrives full of them. */
export function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Is this plausibly an email address?
 *
 * Deliberately loose. The only authority on whether an address exists is a message arriving at
 * it, so a strict pattern buys nothing and costs the occasional real address — the RFC permits
 * far more than any regex people write for this. What is checked is the shape that catches the
 * genuine mistakes: a missing `@`, a missing dot in the domain, spaces, and a trailing comma
 * from a copy-paste.
 */
export function looksLikeEmail(value: string): boolean {
  if (value.length > LIMITS.email.max) return false;
  return /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(value);
}

/**
 * Normalise an Indian mobile number to `+91XXXXXXXXXX`, or return null if it is not one.
 *
 * Accepts what people actually type: `98765 43210`, `+91 98765-43210`, `09876543210`,
 * `0091 9876543210`. Indian mobile numbers are ten digits beginning 6, 7, 8 or 9.
 *
 * The legacy `Interest_Submission.phone` was a Bubble **number** field, which is how the legacy
 * `mobile` column lost its leading zeros and its `+91` (`U1` records the same damage). Storing
 * this as normalised text is the fix, and the normalisation belongs here rather than in six
 * places downstream.
 */
export function normalisePhone(value: string): string | null {
  const digits = value.replace(/[\s\-().]/g, '');
  const bare = digits
    .replace(/^\+91/, '')
    .replace(/^0091/, '')
    .replace(/^91(?=\d{10}$)/, '')
    .replace(/^0/, '');
  if (!/^[6-9]\d{9}$/.test(bare)) return null;
  return `+91${bare}`;
}

/**
 * Validate an enquiry. Returns one message per bad field, none if it is good.
 *
 * Messages say what to do, not what went wrong — "Enter a 10-digit Indian mobile number" rather
 * than "Invalid phone". A validation message is the only writing on this page that a visitor
 * reads while already mildly annoyed.
 */
export function validateEnquiry(input: EnquiryInput): EnquiryErrors {
  const errors: EnquiryErrors = {};

  const name = tidy(input.name);
  if (!name) errors.name = 'Please tell us your name.';
  else if (name.length < LIMITS.name.min) errors.name = 'That looks too short to be a name.';
  else if (name.length > LIMITS.name.max) errors.name = `Please keep this under ${LIMITS.name.max} characters.`;

  if (!input.role) errors.role = 'Please choose the option closest to your role.';
  else if (!ROLE_VALUES.has(input.role)) errors.role = 'Please choose one of the listed roles.';

  const school = tidy(input.school);
  if (!school) errors.school = 'Please tell us which school.';
  else if (school.length < LIMITS.school.min) errors.school = 'That looks too short to be a school name.';
  else if (school.length > LIMITS.school.max) errors.school = `Please keep this under ${LIMITS.school.max} characters.`;

  const city = tidy(input.city);
  if (!city) errors.city = 'Please tell us the city.';
  else if (city.length < LIMITS.city.min) errors.city = 'That looks too short to be a city.';
  else if (city.length > LIMITS.city.max) errors.city = `Please keep this under ${LIMITS.city.max} characters.`;

  const email = tidy(input.email).toLowerCase();
  if (!email) errors.email = 'Please give us an email address we can reply to.';
  else if (!looksLikeEmail(email)) errors.email = 'That does not look like an email address.';

  const phone = input.phone.trim();
  if (!phone) errors.phone = 'Please give us a phone number.';
  else if (!normalisePhone(phone)) errors.phone = 'Enter a 10-digit Indian mobile number.';

  if (input.message.trim().length > LIMITS.message.max) {
    errors.message = `Please keep this under ${LIMITS.message.max} characters.`;
  }

  return errors;
}

export function isValid(errors: EnquiryErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Turn a validated form into the body `enquiry-submit` receives.
 *
 * Throws rather than returning a partial payload if the input does not validate: a caller that
 * skipped validation is a bug, and the useful moment to find it is here rather than as a
 * constraint violation in Postgres.
 *
 * An absent message is `null`, not `''` — "they wrote nothing" and "they wrote an empty string"
 * are the same fact and should not be two states in the database.
 */
export function toPayload(input: EnquiryInput): EnquiryPayload {
  const errors = validateEnquiry(input);
  if (!isValid(errors)) {
    throw new Error(`Cannot build a payload from an invalid enquiry: ${Object.keys(errors).join(', ')}`);
  }
  const phone = normalisePhone(input.phone);
  if (!phone) throw new Error('unreachable: phone validated but did not normalise');

  const message = tidy(input.message);

  return {
    name: tidy(input.name),
    role: input.role as Role,
    school: tidy(input.school),
    city: tidy(input.city),
    email: tidy(input.email).toLowerCase(),
    phone,
    message: message === '' ? null : message,
  };
}

/**
 * The name of the honeypot field, and the minimum time a genuine submission takes.
 *
 * **No captcha, deliberately.** Every captcha worth the name is third-party JavaScript, and the
 * performance budget for this site is zero third-party requests — on the reasoning of `P11`,
 * that the binding constraint is a patchy Indian mobile connection. A captcha would also be the
 * one thing on the page that can lock a real principal out of talking to us.
 *
 * So: a field no human sees and no human fills, plus a floor on how fast the form can be
 * completed. Both are re-checked server-side, because both are trivially bypassed by anyone who
 * reads the HTML — which is fine. They are not a security control; they stop the undirected
 * form-spam bots that make up essentially all of the volume, and they cost a genuine visitor
 * nothing.
 */
export const HONEYPOT_FIELD = 'website';
export const MIN_FILL_MS = 3000;

export function looksAutomated(honeypot: string, elapsedMs: number): boolean {
  if (honeypot.trim() !== '') return true;
  return elapsedMs < MIN_FILL_MS;
}
