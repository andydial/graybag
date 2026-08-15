/**
 * The guard in front of crash reporting. `E15-xx`.
 *
 * Andy, 2026-08-16: *"assert no child's name, class, section or allergy can reach it. That guard
 * matters more than the reporting."* He is right, and the ordering is the point: an outage with
 * no crash reports is a bad night, whereas a child's name and allergies in a third-party error
 * tracker is a **reportable personal-data breach** under the DPDP Act, about a minor, in a
 * system whose entire compliance story is that this cannot happen (non-negotiable #4).
 *
 * So this module is written to be usable before any reporter exists, and no reporter may send
 * anything that has not been through it.
 *
 * ## What it removes, and why by KEY rather than by value
 *
 * Value-matching cannot work here. A child called "Sweep" and a dish called "Sweet corn" are
 * both just words, and no regular expression tells them apart — attempting it produces a filter
 * that misses real names and mangles innocent text. **The structure is what we know**: the
 * fields carrying a child's identity have known names, because our own schema chose them.
 *
 * `DENIED_KEYS` therefore lists the fields that carry tier P or tier S data — a child's name,
 * class, section, allergies — and anything under such a key is replaced wholesale, at any depth,
 * whatever its type. Adding a field to the schema without adding it here is the failure mode,
 * which is why `scrub.test.ts` asserts the list against the real column names.
 *
 * ## What it does match by value
 *
 * Only the two things that are unambiguous and that leak through free text: **email addresses
 * and Indian phone numbers**. A parent's email in a breadcrumb is not a child's data, but it is
 * still personal data with no business being in an error tracker.
 *
 * ## What it deliberately keeps
 *
 * Ids, order refs, status values, error codes, HTTP status, screen names, dish names, prices.
 * All of it is either non-personal or is the thing that makes a report worth having. A scrubber
 * that removes everything is indistinguishable from having no reporting, and it is the version
 * people quietly disable.
 */

/**
 * Field names whose *contents* are personal data about a child or a parent.
 *
 * Matched case-insensitively, and against the whole key, plus the snake/camel spellings we
 * actually use. `first_name` and `firstName` are the same field wearing two hats and both occur
 * in this codebase — the API layer speaks snake_case and the components speak camelCase.
 */
export const DENIED_KEYS: readonly string[] = [
  // Tier P — who the child is.
  'first_name', 'firstname', 'last_name', 'lastname', 'full_name', 'fullname', 'name',
  'recipient_name', 'recipientname', 'recipient_name_snapshot', 'child_name', 'childname',
  'class_label', 'classlabel', 'class_label_snapshot', 'section_label', 'sectionlabel',
  'section_label_snapshot', 'school_class_id',
  // Tier S — health data about a minor. §6.2 deletes these outright on erasure.
  'allergy_note', 'allergynote', 'allergen_ids', 'allergenids', 'allergen_codes',
  'allergen_codes_snapshot', 'allergens', 'recipient_allergen',
  // Contact details. Not a child's, still personal.
  'email', 'phone', 'phone_e164', 'phonee164', 'contact_email', 'contact_phone',
];

const DENIED = new Set(DENIED_KEYS.map((k) => k.toLowerCase()));

export const REDACTED = '[redacted]';

/** Deliberately conservative: an obvious address, not every RFC-legal one. */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Indian mobile numbers, with or without `+91`, spaces or hyphens. Bounded by non-digits so an
 * order total in paise or a 10-digit id is left alone.
 */
const PHONE_RE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

/** Redact addresses and phone numbers inside a free-text string. */
export function scrubText(value: string): string {
  return value.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, REDACTED);
}

/**
 * Recursively remove personal data from anything about to leave the device.
 *
 * Cycles are handled — an error object with a `cause` chain back to itself would otherwise hang
 * the reporter, and a crash reporter that hangs on a crash is worse than none.
 *
 * Depth is bounded for the same reason. Beyond the limit the value becomes `REDACTED` rather
 * than being dropped, so a truncated report still shows that something was there.
 */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 12) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => scrub(item, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return REDACTED;
    seen.add(value as object);

    // An Error is an object whose interesting parts are non-enumerable, so spreading it loses
    // exactly the message and stack the report exists for.
    if (value instanceof Error) {
      return {
        name: value.name,
        message: scrubText(value.message),
        stack: typeof value.stack === 'string' ? scrubText(value.stack) : undefined,
      };
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = DENIED.has(key.toLowerCase()) ? REDACTED : scrub(item, depth + 1, seen);
    }
    return out;
  }

  // Functions, symbols, bigints — nothing a report needs, and nothing worth guessing about.
  return REDACTED;
}
