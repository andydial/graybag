/**
 * Adding a child, and moving one to another school — `E05-01`, `E05-02`, `E20-02`.
 *
 * Writes, so they go through an Edge Function (`A4`, non-negotiable #1). Nothing here
 * decides anything: the server validates the school, enforces the consent rule, writes the
 * `guardian_link` and refuses a school change while undelivered orders exist. This module
 * owns the shape of the request and the translation of a refusal into something a screen
 * can act on.
 *
 * ## Consent is a field on this call, not a separate one
 *
 * `create_recipient` writes the child, the guardian link and the consent record in one
 * transaction, so there is deliberately **no way to express "add the child now and record
 * the consent afterwards"** from here. A client that could would eventually do it — a
 * network failure between two requests is all it takes — and the result is a child in the
 * database whose details nobody agreed to us holding.
 *
 * ## Two consents, because they are two questions
 *
 * `consentGranted` covers the required purpose: first name, class and section, so the right
 * food reaches the right child. `allergenConsent` covers health data about a minor and is
 * **optional** — a parent may use GrayBag without telling us about allergies and simply get
 * no warnings (`C12`, `C5`).
 *
 * Sending allergy details without `allergenConsent` is refused by the server rather than
 * being silently dropped, and this module does not paper over that: a parent who typed
 * "peanut allergy" and had it quietly discarded would believe the kitchen knows.
 */
import { invokeFunction } from './client.js';

export interface NewRecipient {
  firstName: string;
  lastName?: string | null;
  schoolId: string;
  classLabel?: string | null;
  sectionLabel?: string | null;
  /** The required purpose (`child_meal_service`). Without it the server refuses. */
  consentGranted: boolean;
  /** The optional, separate health-data purpose (`child_allergen_info`). */
  allergenConsent?: boolean;
  allergenIds?: string[];
  allergyNote?: string | null;
  /** Recorded on the consent row. Screen and app version only — never the child (§11.5). */
  screen?: string;
  appVersion?: string;
}

export interface CreatedRecipient {
  recipientId: string;
  firstName: string;
  schoolId: string;
  /** The exact wording consented to, so a later change of notice does not rewrite history. */
  noticeVersionId: string;
}

export interface SchoolChange {
  recipientId: string;
  schoolId: string;
  classLabel?: string | null;
  sectionLabel?: string | null;
}

export interface SchoolChangeResult {
  recipientId: string;
  schoolId: string;
  /** False when the parent chose the school the child is already at — not an error (`E05-02`). */
  changedSchool: boolean;
  fromSchoolId: string;
}

/**
 * Add a child.
 *
 * Allergy details are only sent when `allergenConsent` is true. That is not a second
 * enforcement of the server's rule — the server still refuses the inconsistent combination,
 * and must — it is that a client which held the details back from the *request* leaves
 * nothing to be dropped.
 */
export async function createRecipient(input: NewRecipient): Promise<CreatedRecipient> {
  const allergenConsent = input.allergenConsent === true;

  const data = await invokeFunction<Record<string, unknown>>('recipients', {
    first_name: input.firstName,
    last_name: input.lastName ?? null,
    school_id: input.schoolId,
    class_label: input.classLabel ?? null,
    section_label: input.sectionLabel ?? null,
    consent_granted: input.consentGranted === true,
    allergen_consent: allergenConsent,
    allergen_ids: allergenConsent ? (input.allergenIds ?? []) : [],
    allergy_note: allergenConsent ? (input.allergyNote ?? null) : null,
    screen: input.screen ?? 'add-child',
    app_version: input.appVersion ?? 'unknown',
  });

  return {
    recipientId: String(data.recipient_id ?? ''),
    firstName: String(data.first_name ?? ''),
    schoolId: String(data.school_id ?? ''),
    noticeVersionId: String(data.notice_version_id ?? ''),
  };
}

/**
 * Move a child to another school, or correct their class.
 *
 * The id is in the path rather than the body, so there is no request that names two
 * different children and leaves it ambiguous which one the server used.
 *
 * Throws `ApiError` with `code = 'future_orders_exist'` when the child still has orders that
 * have not been delivered. That is not a failure to handle quietly: those lunches were
 * bought against the old school's kitchen and menu, and the parent has to cancel those days
 * first (`D19`).
 */
export async function changeRecipientSchool(input: SchoolChange): Promise<SchoolChangeResult> {
  const data = await invokeFunction<Record<string, unknown>>(
    `recipients/${input.recipientId}`,
    {
      school_id: input.schoolId,
      class_label: input.classLabel ?? null,
      section_label: input.sectionLabel ?? null,
    },
    'PATCH',
  );

  return {
    recipientId: String(data.recipient_id ?? ''),
    schoolId: String(data.school_id ?? ''),
    changedSchool: data.changed_school === true,
    fromSchoolId: String(data.from_school_id ?? ''),
  };
}
