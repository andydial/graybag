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
  /**
   * `E15-21`. Every screen, so a parent's path reads in sequence rather than as milestones —
   * "reached checkout and turned back" is a *shape*, and it is invisible if only the funnel's
   * corners are recorded.
   */
  'screen_viewed',
  // The controls where somebody can stall or give up.
  'add_to_cart_tapped',
  'remove_from_cart_tapped',
  'break_time_selected',
  'place_order_tapped',
  'payment_sheet_closed',
  'add_child_submitted',
  /**
   * `E21` meal packs. Three taps, and **not one of them carries an amount, a meals count, an
   * offer id, a child or a dish** — see `docs/decisions-27aug.md` `D4`. `pack_plan_confirmed` was
   * the tempting one, because how many days a parent plans at once is a genuinely useful product
   * number; but a plan is a set of children and dates, and that count sits one join from *which
   * child eats on which days*, which is the food profile s.9(3) forbids building. Revenue lives
   * in the ledger, which does not leave the country.
   */
  'pack_offer_opened',
  'pack_purchase_started',
  'pack_plan_confirmed',
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

  // --- `E15-21` ---
  screen_viewed: ['screen'],
  /**
   * Counts, never dishes. `dish_name` and `dish_id` are in `FORBIDDEN_KEYS`, and this is the
   * event that would most naturally carry one — "which dish did they add" is the obvious
   * product question and is exactly the per-child food profile s.9(3) forbids building. The
   * cart belongs to a child; the parent is only the account holder.
   */
  add_to_cart_tapped: ['line_count'],
  remove_from_cart_tapped: ['line_count'],
  /** No break id and no school: whether a choice was made is the stall signal, not which. */
  break_time_selected: [],
  place_order_tapped: ['line_count'],
  /** The other half of `payment_started`. `outcome` is where turning back becomes visible. */
  payment_sheet_closed: ['outcome'],
  /** Nothing, for the same reason `child_added` carries nothing. */
  add_child_submitted: [],

  // --- `E21` meal packs. All three carry the common set and nothing else. ---
  pack_offer_opened: [],
  pack_purchase_started: [],
  pack_plan_confirmed: [],
};

/**
 * **Allowed VALUES for the enumerated properties. `E15-21`.**
 *
 * Until now `checkEvent` validated property *keys* and let any value through, which was
 * survivable while every property was a number or a bool. `screen` changes that: it is a
 * string, and a screen name is exactly where a child's name reaches an analytics vendor —
 * `screen: "Aarav's orders"` passes a key check perfectly.
 *
 * So enumerated properties are checked against a closed vocabulary. Anything else is refused,
 * which also catches the subtler version: a screen name built by interpolation rather than
 * chosen from a list.
 */
export const ENUM_VALUES: Record<string, readonly string[]> = {
  screen: [
    'home', 'menu', 'school_picker', 'dish_detail', 'cart', 'orders', 'order_detail',
    'account', 'children', 'add_child', 'sign_in', 'sign_in_code', 'support', 'policy',
    'policy_gate', 'delete_account', 'payment_waiting', 'order_placed', 'update_required',
    'cant_connect',
    // `E21`. Emitted by the navigator like any other route — including for the refusal state,
    // because a parent who reaches `packs` with the gate off still viewed a screen, and that one
    // is worth counting: it means a stale link is in circulation. `pack_detail` joins this list
    // when that screen exists; a name here with no emitter reads on the dashboard as a screen
    // nobody visited.
    'packs', 'my_packs', 'pack_plan', 'plan_day', 'pack_detail',
  ],
  method: ['google', 'apple', 'email_otp'],
  reason: ['dismissed', 'expired', 'failed'],
  outcome: ['completed', 'dismissed', 'failed'],
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
  reason: 'unknown_event' | 'forbidden_property' | 'undeclared_property' | 'forbidden_value';
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

  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN.has(key.toLowerCase())) {
      rejections.push({ reason: 'forbidden_property', detail: key });
      continue;
    }
    if (!allowed.has(key)) {
      rejections.push({ reason: 'undeclared_property', detail: key });
      continue;
    }
    // A closed vocabulary where one exists — see `ENUM_VALUES`. The detail names the key, never
    // the offending value: a rejection message is a log line, and the value is the thing we are
    // refusing to let out.
    const vocabulary = ENUM_VALUES[key];
    if (vocabulary !== undefined && !vocabulary.includes(String(value))) {
      rejections.push({ reason: 'forbidden_value', detail: key });
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
