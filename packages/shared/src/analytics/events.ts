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
  /**
   * `E15-24`. **Signup is a different question from sign-in and the app could not tell them
   * apart.** `U1` makes account creation implicit — the same `signInWithOtp` both creates and
   * resumes — so every new family was counted as a returning one, and "are new parents getting
   * through the door" was unanswerable from PostHog.
   *
   * `AuthUser.isNewAccount` is what distinguishes them; see `api/auth.ts` for how, and for the
   * error direction it prefers.
   */
  'signup_started',
  'signup_completed',
  'child_added',
  'menu_browsed',
  'cart_started',
  /**
   * `E15-24`. The order was refused, or could not be attempted, and why.
   *
   * The funnel could show parents arriving at the cart and not ordering, and could not show
   * **why** — so every drop-off looked like disinterest when some of it is a school with no
   * break windows and a day whose cutoff had passed. `reason` is a closed vocabulary; there is
   * no free text, because "why did it fail" is exactly where an error string carrying a child's
   * name would reach a vendor.
   */
  'order_blocked',
  /**
   * `E15-24`. Distinct from `payment_abandoned`, which is a parent turning back. This is the
   * provider or our own server refusing, and it carries the provider's error code so a run of
   * failures is diagnosable without asking a parent what they saw.
   */
  'payment_failed',
  /** `E15-24`. Which delivery day a parent chose, and how far ahead it was. */
  'delivery_date_selected',
  /**
   * `E15-24`. The basket at the moment checkout begins.
   *
   * Deliberately separate from `place_order_tapped`: the tap is a *gesture*, and the real data
   * shows it firing three and four times in a row as a parent presses a button that does not
   * appear to respond. This fires once, where `create_checkout` is actually called.
   */
  'checkout_started',
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
  signup_started: ['method'],
  signup_completed: ['method'],
  child_added: [],
  menu_browsed: ['item_count'],
  cart_started: ['line_count'],

  // --- `E15-24` ---
  /**
   * `school_id` is here, and it is worth saying why it is not a child attribute.
   *
   * A school is an **institution**, not a person: `0002`'s own comment says class labels and
   * break times are not personal data, and a school id is one step further out than either. What
   * `FORBIDDEN_KEYS` blocks is `school_class_id` — *which class*, which is an attribute of a
   * child. Which school an order is for is an attribute of the order.
   *
   * The line is worth holding precisely because it is close: `school_id` + `recipient_id` would
   * be a child's school, and `recipient_id` is forbidden. Andy asked for `school_id` explicitly
   * and it stays on the institution side of that line.
   */
  order_blocked: ['reason', 'school_id', 'days_until_delivery'],
  payment_failed: ['reason', 'razorpay_error_code', 'order_value_inr'],
  delivery_date_selected: ['days_until_delivery', 'is_next_school_day'],
  checkout_started: ['item_count', 'order_value_inr', 'child_count'],

  /**
   * `E15-24` adds the basket to both payment events.
   *
   * Until now these carried `app_env`, `app_version` and `platform` — so PostHog held a funnel
   * with **no revenue, no school and no basket size anywhere in it**, and "which schools are
   * converting" could not be asked at all.
   *
   * `order_value_inr` is whole **rupees**, not paise, and that is a deliberate narrowing rather
   * than a slip against non-negotiable #3. Money in the system is integer paise and stays that
   * way; this is a dashboard number produced by `rupeesFromPaise`, which rounds. The ledger
   * remains the only place revenue is authoritative — see `docs/posthog.md`.
   */
  payment_started: [
    'attempt_no',
    'resumed',
    'order_value_inr',
    'item_count',
    'school_id',
    'is_first_order',
    'days_until_delivery',
  ],
  /**
   * **Still no `attempt_no`, and the reason is unchanged.** It is emitted where settlement is
   * CONFIRMED — `checkout-status` answering `paid` — and that response does not carry the
   * attempt number. Sending a hardcoded `1` would be a lie in exactly the case the funnel cares
   * about: a parent who resumed. The retry count is answerable from `payment_started`, which
   * does know it.
   *
   * The basket properties `E15-24` adds *are* available here, because the caller is the cart
   * route, which still holds the cart and the school when the poll settles.
   */
  payment_completed: [
    'order_value_inr',
    'item_count',
    'school_id',
    'is_first_order',
    'days_until_delivery',
  ],
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
 * Vocabularies that differ **per event**, overriding `ENUM_VALUES` — `E15-24`.
 *
 * `reason` was a single global list because one event used it. Three do now, and they mean
 * different things: `payment_abandoned.reason` is why a parent turned back, `order_blocked.reason`
 * is why the order could not be attempted, and `payment_failed.reason` is who refused it. Unioning
 * them into one list would have made every value legal on every event — so `order_blocked` could
 * report `dismissed`, and the vocabulary would stop being a check on anything.
 *
 * Looked up before the global list, so an event without an entry here behaves exactly as before.
 */
export const EVENT_ENUM_VALUES: Partial<Record<AllowedEvent, Record<string, readonly string[]>>> = {
  /**
   * The five Andy named, and nothing else.
   *
   * `other` is the escape hatch and it is deliberately the only one: a `reason` built from an
   * error message is how a database hint — or a child's name inside one — reaches a vendor, so
   * anything unrecognised collapses to a constant rather than passing text through.
   */
  order_blocked: {
    reason: ['cutoff_passed', 'no_menu', 'school_closed', 'not_eligible', 'other'],
  },
  /**
   * Who refused, not what the parent was told. `provider_declined` is Razorpay saying no;
   * `server_refused` is our own `create_checkout`/`begin_payment`; `price_changed` is the one
   * refusal common enough to be worth naming on its own (it was every checkout on production
   * before `E05-52`).
   */
  payment_failed: {
    reason: ['provider_declined', 'server_refused', 'price_changed', 'cutoff_passed', 'other'],
  },
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
    //
    // Per-event first (`E15-24`), so `order_blocked.reason` and `payment_abandoned.reason` are
    // checked against their own lists rather than a union that would legalise both on both.
    const vocabulary =
      EVENT_ENUM_VALUES[event as AllowedEvent]?.[key] ?? ENUM_VALUES[key];
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
 * Paise → whole rupees, for a dashboard only — `E15-24`.
 *
 * **This is the one place money stops being integer paise, and it is not a breach of
 * non-negotiable #3.** That rule protects arithmetic: nothing that computes a price, a tax
 * component or a ledger entry may see a float, and none of them call this. Andy asked for
 * `order_value_inr`, and a funnel that reports revenue in paise is a funnel nobody reads.
 *
 * It returns an **integer**, not a float, so the value cannot be mistaken for a precise amount
 * and cannot accumulate representation error if somebody sums a column of them. Rounding is
 * half-up on the paise, so ₹72.46 reports as 72 and ₹72.50 as 73. The ledger remains the only
 * authoritative revenue figure — a PostHog total will disagree with it by up to fifty paise per
 * order, by construction.
 *
 * `null` in, `null` out: an unknown total must not report as ₹0, which is a number somebody
 * would average.
 */
export function rupeesFromPaise(paise: number | null | undefined): number | null {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return null;
  return Math.round(paise / 100);
}

/** IST is UTC+5:30 and India has no DST, so this is a constant rather than a lookup. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * Today's service date **in the kitchen's timezone** — `E15-24`.
 *
 * Computed by offsetting the instant, **not** through `Intl.DateTimeFormat` with a `timeZone`.
 * Hermes ships without full ICU unless it is explicitly enabled, and a `timeZone` option there
 * either throws or is silently ignored — the second being far worse, because it would return UTC
 * and quietly shift `days_until_delivery` by one for every order placed between midnight and
 * 05:30 IST. India has no DST, so a fixed offset is exact rather than an approximation.
 *
 * `toISOString().slice(0, 10)` after the shift, because the shifted value is being read as a
 * calendar label and not as an instant.
 */
export function serviceDateInIst(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Whole days from `today` to `serviceDate`, both `YYYY-MM-DD` — `E15-24`.
 *
 * `0` is same-day, `1` is tomorrow, negative is a day already past (which is a real answer: it is
 * what a cutoff refusal looks like). `null` when either side is not a date, because `0` would read
 * as "today" and is the one wrong answer that looks right.
 *
 * Parsed and differenced in **UTC**. Building `new Date('2026-09-10')` is UTC midnight but
 * `new Date(2026, 8, 10)` is *local* midnight, and mixing the two makes the difference wrong by a
 * day anywhere east of Greenwich — which is everywhere we operate. `shiftDate` in the kitchen
 * view carries the same warning after the same bug.
 */
export function daysUntil(serviceDate: string, today: string): number | null {
  const a = Date.parse(`${serviceDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
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

/**
 * Why an order cannot be placed right now, as one of `order_blocked`'s five reasons — `E15-24`.
 *
 * Andy: the funnel could show parents reaching the cart and not ordering, and could not show
 * **why** — so every drop-off read as disinterest when some of it is a school with no break
 * windows and a day whose cutoff has passed.
 *
 * Pure and ordered, because the order is the finding. A school with no menu **and** no break
 * windows is reported as `no_menu`: it is the one a parent hits first and the one we can act on,
 * and reporting the later cause would send somebody to fix break times on a school that has
 * nothing to sell. `null` means nothing is in the way.
 *
 * `not_eligible` is last of the real reasons deliberately — it means "this cart cannot use the
 * meal pack it is trying to", which is a *choice* a parent can undo, unlike the three above it.
 */
export interface OrderBlockState {
  /** The school's menu has no dishes at all. */
  hasMenu: boolean;
  /** `P19` — a school with no break windows cannot be ordered from. */
  hasBreakWindows: boolean;
  /** The calendar offers no orderable day, or the chosen day is not one of them. */
  dayOrderable: boolean;
  /** A pack meal is selected and this cart does not qualify for it. */
  packIneligible: boolean;
}

export type OrderBlockReason =
  | 'no_menu'
  | 'school_closed'
  | 'cutoff_passed'
  | 'not_eligible'
  | 'other';

export function orderBlockReason(state: OrderBlockState): OrderBlockReason | null {
  if (!state.hasMenu) return 'no_menu';
  if (!state.hasBreakWindows) return 'school_closed';
  if (!state.dayOrderable) return 'cutoff_passed';
  if (state.packIneligible) return 'not_eligible';
  return null;
}
