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
 *
 * ## The one read here goes through `guardian_link`
 *
 * `fetchRecipients` reads a table directly, which reads are allowed to do (`A4`). It reads
 * **`guardian_link`**, not `recipient`, and that is `D10`: `guardian_link` is the only path
 * from a user to a child. `recipient.created_by_user_id` exists for audit and its own column
 * comment says it must never decide anything — the legacy model had two parallel
 * parent-to-child links, so there were two answers to "may this user see this child" and they
 * could disagree.
 *
 * Everything this returns is tier P personal data about a minor (§13.3, non-negotiable #4):
 * first name, last name, class, section and school. **None of it may be logged, sent to
 * Sentry or put in analytics.** That is why nothing in this file has a `console` call and why
 * the failures below carry an index rather than a name.
 */
import { currentUser } from './auth.js';
import { runQuery, invokeFunction } from './client.js';

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

/** A child the signed-in adult may reach, as the "Your children" screen needs them. */
export interface ApiRecipient {
  id: string;
  firstName: string;
  lastName: string | null;
  classLabel: string | null;
  sectionLabel: string | null;
  schoolId: string;
  /** Empty when the school row is unreadable, never a reason to hide the child. */
  schoolName: string;
  /** From the link, not the child: a co-guardian may be able to see but not to edit. */
  canOrder: boolean;
  canManage: boolean;
}

/** Raised when the backend returns a children list that is not the agreed shape. */
export class RecipientPayloadError extends Error {
  constructor(detail: string) {
    super(`The children list is not usable: ${detail}`);
    this.name = 'RecipientPayloadError';
  }
}

/**
 * Exactly what may leave `guardian_link` and its embedded `recipient`. Exported so the test
 * can assert it.
 *
 * **The column list is the redaction**, exactly as it is in `schools.ts`. A policy filters
 * rows, never columns, so nothing in the database stops a `select('*')` here from returning
 * `allergy_note` — tier S, health data about a minor — to a screen that only wanted to draw
 * a name and a class. `recipient_allergen` and `allergy_note` are read by the screen that
 * has a reason to (`E05-05`'s warning), not by this one.
 *
 * `created_by_user_id` is absent for the same reason it is absent from every policy: naming
 * it here would put a second parent-to-child link in front of the app, which is the defect
 * `D10` exists to prevent.
 */
export const RECIPIENT_COLUMNS =
  'can_order,can_manage,' +
  'recipient:recipient_id(id,first_name,last_name,class_label,section_label,is_active,' +
  'school:school_id(id,name))';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const textOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/**
 * The children the signed-in adult may reach, ordered by first name.
 *
 * Reads `guardian_link` filtered to this user's own live links — `D10`. Two details are
 * load-bearing:
 *
 * **`user_id` is filtered even though a policy exists.** `guardian_link_read_self` is not the
 * only SELECT policy on that table: `guardian_link_read_co_guardian` also admits the *other*
 * guardians' links to a child this user can reach ([AZ-05]). Without the filter a child with
 * two parents would appear twice in this list, once per link.
 *
 * **`revoked_at is null` is filtered server-side.** Links are revoked, never deleted, because
 * the audit trail matters — so a parent whose access was removed still has the row and would
 * still see the child. The embedded `recipient` comes back `null` for them (the recipient
 * policy runs `auth_can_reach_recipient`, which requires a live link), and a row with no
 * readable child is skipped rather than being reported as a malformed payload: an
 * authorization outcome is not a bad response.
 *
 * An empty list is a legitimate answer — a parent who has not added a child yet, and a
 * signed-out one — and renders as an empty state, not an error.
 */
export async function fetchRecipients(): Promise<ApiRecipient[]> {
  // No session, no query to build. Returned empty rather than thrown because "you have no
  // children yet" is what a signed-out parent should see on this screen; `AR7` is explicit
  // that nothing in the app is a wall, and RLS would answer with nothing anyway.
  const user = await currentUser();
  if (user === null) return [];

  const rows = await runQuery<unknown>((t) =>
    t
      .from('guardian_link')
      .select(RECIPIENT_COLUMNS)
      .eq('user_id', user.userId)
      .is('revoked_at', null),
  );

  const children: ApiRecipient[] = [];
  rows.forEach((row, i) => {
    if (!isRecord(row)) throw new RecipientPayloadError(`link ${i} is not an object`);

    const child = row.recipient;
    // A link whose child is unreadable is a policy outcome, not a broken payload.
    if (!isRecord(child)) return;

    if (typeof child.id !== 'string' || typeof child.first_name !== 'string') {
      // The index, never the name (§13.3 / non-negotiable #4). A payload error carrying a
      // child's name is a child's name in a crash report.
      throw new RecipientPayloadError(`child at ${i} has no id or first name`);
    }
    // Deactivating a child is how a parent stops ordering for them without deleting the
    // order history. They are not on this list.
    if (child.is_active === false) return;

    const school = isRecord(child.school) ? child.school : null;

    children.push({
      id: child.id,
      firstName: child.first_name,
      lastName: textOrNull(child.last_name),
      classLabel: textOrNull(child.class_label),
      sectionLabel: textOrNull(child.section_label),
      schoolId: school !== null && typeof school.id === 'string' ? school.id : '',
      schoolName: school !== null && typeof school.name === 'string' ? school.name : '',
      // Absent means no. A link that did not say `can_manage` must not open the edit path.
      canOrder: row.can_order === true,
      canManage: row.can_manage === true,
    });
  });

  // Sorted here rather than in the query: PostgREST's `order` on an embedded resource orders
  // *within* the embed, not the parent rows, so asking the database for this would silently
  // return them in insertion order. `localeCompare` because the audience types Indian names
  // in both scripts.
  return children.sort((a, b) => a.firstName.localeCompare(b.firstName));
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

/**
 * The declared allergens of one recipient — `E05-31`.
 *
 * ## Why this is its own call, and narrow
 *
 * `recipient_allergen` is **tier S: special-category health data about a minor** (§13.3), and
 * it is the most sensitive table in the system. `fetchRecipients` deliberately does not return
 * it — the column list there is the redaction, and pulling every child's health record on app
 * start to warn about a dish nobody has opened would be exactly the over-collection the
 * classification exists to prevent.
 *
 * So it is read **one recipient at a time, when there is a reason to** — the reason being that
 * this is the person the order is for, and the app is about to check dishes against them.
 *
 * ## Why it had to exist at all
 *
 * Without it `OrderTarget.allergenIds` was permanently `null`, which meant **no allergen
 * warning could fire anywhere in the app**. Menu drew no flags, and Dish detail said "we can't
 * check this against their allergies" for every dish and every child — honest, and useless.
 * `docs/ux-spec.md` F5 is the only §6 divergence with a safety consequence, which is why this
 * came before the rest.
 *
 * ## What it returns, and what it must never do
 *
 * Allergen **ids** only. Not `severity`, not `note` — `allergy_note` is free text a parent
 * typed about their child and nothing on the ordering path needs it; the kitchen reads it
 * through the fulfilment policy, not through here.
 *
 * **Nothing here logs.** An error carries the recipient id, and an id about a child stays out
 * of logs, Sentry and analytics (non-negotiable #4). The caller gets an empty result and the
 * screens say they cannot check — which is the honest answer and the one they already draw.
 */
export async function fetchRecipientAllergens(recipientId: string): Promise<string[]> {
  const user = await currentUser();
  // Signed out there is no policy that admits this read, and asking anyway would be a request
  // we know will return nothing.
  if (user === null) return [];

  const rows = await runQuery<unknown>((t) =>
    t.from('recipient_allergen').select('allergen_id').eq('recipient_id', recipientId),
  );

  const ids: string[] = [];
  rows.forEach((row) => {
    if (!isRecord(row)) return;
    if (typeof row.allergen_id === 'string') ids.push(row.allergen_id);
  });
  return ids;
}
