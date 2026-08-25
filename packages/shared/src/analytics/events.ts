/**
 * The analytics contract, as code. `E15-17`.
 *
 * Andy: *"No child's identity or attributes may ever reach PostHog — not a name, class, section,
 * allergy, note, nor which dishes a specific child eats. Autocapture off; every event explicitly
 * declared."*
 *
 * ## Why this is an ALLOWLIST and not a filter
 *
 * `observability/scrub.ts` removes known-bad keys, which is right for a crash report: an error
 * payload is whatever the runtime hands you, so the best available move is to strip what you
 * recognise. Analytics is the opposite situation. **We author every event**, so anything not on
 * this list is a mistake rather than an unknown, and the safe default is to refuse it.
 *
 * The practical difference is the failure mode. A denylist fails *open* on a field nobody thought
 * of — `nickname`, `birthday`, `class_teacher` — and the first anyone knows is a child's name in
 * a third-party dashboard. An allowlist fails *closed*: the new property is dropped and the test
 * says so.
 *
 * ## The line this protects
 *
 * DPDP **s.9(3)** prohibits tracking and behavioural monitoring of children. The Data Principal
 * here is the parent, an adult, and the funnel measures their journey. The moment an event
 * carries a child's attribute, parent-analytics becomes behavioural monitoring of a child, and no
 * consent cures that. See `docs/posthog.md`.
 */

/** Every event that may be sent. Adding one here is the deliberate act; nothing else is sendable. */
export const ALLOWED_EVENTS = [
  'app_opened',
  'signin_started',
  'signin_completed',
  'child_added',
  'menu_browsed',
  'cart_started',
  'payment_started',
  'payment_completed',
  'payment_abandoned',
] as const;

export type AllowedEvent = (typeof ALLOWED_EVENTS)[number];

/**
 * Properties permitted on every event.
 *
 * `distinct_id` is the parent's `app_user.id` — an opaque uuid, never an email. Andy can join to
 * his own database when he needs to know who somebody is; PostHog does not need to be able to.
 */
export const COMMON_PROPERTIES = ['distinct_id', 'app_version', 'platform', 'app_env'] as const;

/**
 * Properties permitted per event, beyond the common set.
 *
 * **`child_added` is empty and that is the point.** It is the one event whose name invites a
 * property — which school, which class, how many children now — and every one of those is an
 * attribute of a child. The funnel question is only whether the step happened.
 */
export const EVENT_PROPERTIES: Record<AllowedEvent, readonly string[]> = {
  app_opened: ['is_first_open'],
  signin_started: ['method'],
  signin_completed: ['method'],
  child_added: [],
  menu_browsed: ['item_count'],
  cart_started: ['line_count'],
  payment_started: ['attempt_no', 'resumed'],
  /**
   * **No `attempt_no`, and the reason is worth recording.** It is emitted where settlement is
   * CONFIRMED — `checkout-status` answering `paid` — and that response does not carry the
   * attempt number. Sending a hardcoded `1` would be a lie in exactly the case the funnel cares
   * about: a parent who resumed. The retry count is answerable from `payment_started`, which
   * does know it.
   */
  payment_completed: [],
  payment_abandoned: ['reason'],
};

/**
 * Keys that must never appear anywhere — event property, person property, or breadcrumb.
 *
 * Redundant with the allowlist by design. The allowlist is the control; this is the alarm, and it
 * is what makes a violation *legible* in a test failure rather than showing up as a silently
 * dropped field. It also covers `identify()`, where the shape is not an event at all.
 */
export const FORBIDDEN_KEYS = [
  'first_name', 'firstname', 'last_name', 'lastname', 'full_name', 'fullname', 'name',
  'child_name', 'childname', 'recipient_name', 'recipient_name_snapshot', 'recipient_id',
  'class_label', 'classlabel', 'class_label_snapshot', 'section_label', 'sectionlabel',
  'section_label_snapshot', 'school_class_id', 'date_of_birth', 'dob', 'age',
  'allergy_note', 'allergynote', 'allergen_ids', 'allergen_codes', 'allergens',
  'recipient_allergen', 'dish_name', 'dish_name_snapshot', 'dish_id',
  'email', 'phone', 'phone_e164', 'note', 'notes', 'message',
] as const;

const FORBIDDEN = new Set<string>(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));

export interface EventRejection {
  reason: 'unknown_event' | 'forbidden_property' | 'undeclared_property';
  detail: string;
}

/**
 * Is this event sendable exactly as given?
 *
 * Returns the reasons rather than throwing. An analytics failure must never interrupt a parent —
 * the caller drops the event and carries on — but a silent drop with no explanation is how a
 * funnel quietly stops recording a step. The caller logs what came back.
 */
export function checkEvent(
  event: string,
  properties: Record<string, unknown> = {},
): EventRejection[] {
  const rejections: EventRejection[] = [];

  if (!(ALLOWED_EVENTS as readonly string[]).includes(event)) {
    return [{ reason: 'unknown_event', detail: event }];
  }

  const allowed = new Set<string>([
    ...COMMON_PROPERTIES,
    ...EVENT_PROPERTIES[event as AllowedEvent],
  ]);

  for (const key of Object.keys(properties)) {
    if (FORBIDDEN.has(key.toLowerCase())) {
      rejections.push({ reason: 'forbidden_property', detail: key });
    } else if (!allowed.has(key)) {
      rejections.push({ reason: 'undeclared_property', detail: key });
    }
  }

  return rejections;
}

/** Convenience for call sites and tests: nothing to report. */
export function isEventSafe(event: string, properties: Record<string, unknown> = {}): boolean {
  return checkEvent(event, properties).length === 0;
}

/**
 * The person profile, which is the sharper edge.
 *
 * An event property is attached to one event; a **person property is attached to every event that
 * identity ever sends, past and future**. A child's name set here once is a permanent label on a
 * profile. So `identify` takes an id and nothing else, and this exists to make that enforceable
 * rather than conventional.
 */
export function checkIdentify(
  distinctId: string,
  personProperties: Record<string, unknown> = {},
): EventRejection[] {
  const keys = Object.keys(personProperties);
  if (keys.length === 0) return [];
  return keys.map((key) => ({
    reason: FORBIDDEN.has(key.toLowerCase())
      ? ('forbidden_property' as const)
      : ('undeclared_property' as const),
    detail: key,
  }));
}
