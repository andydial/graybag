/**
 * What the kitchen dashboard needs, and the seam it gets it through (`E09-04`, `E09-05`).
 *
 * ## Why a transport interface
 *
 * The two things this screen needs from the server do not exist yet: a `mark-delivered` Edge
 * Function, and back-office sign-in (`E12-06`). Both live in `supabase/`, which another thread
 * owns.
 *
 * Waiting would mean the screen — the part that has to be legible in a busy kitchen at 7am, and
 * the part only looking at it can settle — arrives last and gets the least attention. So the
 * transport is an interface with two implementations: one over fixtures, one over the real
 * server when it exists. Every state below is reachable today, and the swap is one line.
 *
 * This is the same shape `packages/shared/src/api/auth.ts` uses for `AuthTransport`, for the
 * same reason.
 *
 * ## What is deliberately not here
 *
 * No money. The kitchen dashboard shows what to cook and what has been handed over; it shows no
 * price, no total and no refund amount, because `orders.view_financials` is a **separate**
 * permission from `orders.view` (`E09-09`, `D3`) and a screen that renders a total it should not
 * have is a screen that leaks the moment somebody's grants change.
 */

/** The statuses the kitchen can see. `pending_payment` is absent by design — `L5`. */
export type KitchenStatus = 'paid' | 'preparing' | 'delivered' | 'cancelled';

/** What can be done to an order from this screen, and who may do it (`T8`, `T9`). */
export type KitchenAction = 'preparing' | 'delivered' | 'cancelled';

export interface KitchenOrderLine {
  dishId: string;
  dishName: string;
  quantity: number;
  /**
   * The parent's request for this line — "less spicy", "no coriander" (`ux-spec` §5.6.1).
   *
   * **Tier P.** Never logged, never to Sentry, never in a school report. It is also **never a
   * safety record**: the app routes allergy language out of this field and into the child's
   * profile, and nothing here may compute a warning from it or treat it as allergen data.
   *
   * It is rendered against its dish in both groupings, which is the condition the spec attaches
   * to the field existing at all — a note the kitchen never sees is a lie told to a parent at
   * the moment they were trying to be careful.
   */
  note: string | null;
}

/**
 * One order, as the kitchen sees it.
 *
 * `recipientName`, `classLabel` and `sectionLabel` are **tier P** — a member of staff hands food
 * to a named child and there is no version of that job that works without the name. Non-negotiable
 * #4 applies in full: never logged, never to Sentry, never in a school report, and never
 * persisted by this screen (see `MEMORY_ONLY` below).
 */
export interface KitchenOrder {
  id: string;
  orderRef: string;
  schoolId: string;
  schoolName: string;
  breakId: string | null;
  breakLabel: string | null;
  recipientName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  status: KitchenStatus;
  pickupCode: string | null;
  lines: KitchenOrderLine[];
  /**
   * Enumerated allergen codes for this child — `E09-33`.
   *
   * `[]` means none recorded and renders as "not provided"; `null` means not readable and renders
   * the same way, because from the kitchen's point of view both mean "you have not been told" and
   * neither may render as blank space (`ux-spec` §5.21).
   *
   * **Tier S.** Never logged, never exported, never written to disk — see `MEMORY_ONLY`.
   */
  allergenCodes: string[] | null;
}

export interface KitchenFilters {
  /** `YYYY-MM-DD`. Always present — a kitchen list without a date is a list of nothing. */
  serviceDate: string;
  schoolId: string | null;
  breakId: string | null;
  status: KitchenStatus | null;
}

/**
 * What this operator may do, as the server reports it (`E09-09`, `D3`).
 *
 * The back office uses **scoped grants, not a role enum**, precisely so
 * `orders.mark_delivered` can be held without `orders.refund`. The screen therefore asks rather
 * than infers: a kitchen porter who may hand food over is not a manager who may cancel an order
 * and trigger a refund, and drawing both sets of buttons for both people is how the split stops
 * meaning anything.
 *
 * **This is presentation only.** The server enforces every one of these regardless — hiding a
 * button is a courtesy to the person, not a control. `E09-09` is the enforcement task and it is
 * server-side.
 */
export interface KitchenPermissions {
  /** `orders.view` — without it there is no list at all, only an explanation. */
  viewOrders: boolean;
  /** `orders.mark_delivered` — the one-tap action. */
  markDelivered: boolean;
  /** `orders.cancel` — cancelling triggers a refund, so it is deliberately separate. */
  cancelOrders: boolean;
}

export interface KitchenDay {
  serviceDate: string;
  permissions: KitchenPermissions;
  orders: KitchenOrder[];
  /** Everything that could be filtered *to*, so the controls do not have to guess. */
  schools: { id: string; name: string }[];
  breaks: { id: string; label: string }[];
  /** When this data was read. Shown verbatim when offline — never "just now". */
  loadedAt: string;
}

/**
 * The seam.
 *
 * `updateStatus` takes a list of ids because the primary action is **bulk** — one tap marks a
 * whole class delivered (`E09-05`, `L8`) — and because a per-order call multiplied by thirty
 * children on kitchen wifi is the wrong shape.
 */
export interface KitchenTransport {
  load(filters: KitchenFilters): Promise<KitchenDay>;
  updateStatus(input: {
    orderIds: string[];
    to: KitchenAction;
    /** Required when `to` is `cancelled`; a cancellation without a reason loses *why*. */
    reasonCode?: string;
  }): Promise<{ updated: string[] }>;
}

/**
 * Cancellation reasons the kitchen may pick, from `reason_code` where `category = 'cancellation'`.
 *
 * Hard-coded here on purpose rather than fetched: it is a closed list, it changes with a
 * migration, and a dropdown that is empty because a lookup failed is a dropdown that stops
 * somebody cancelling an order they need to cancel. The server re-checks the code regardless.
 */
/**
 * The reasons a **kitchen** may give for cancelling, from `reason_code` where
 * `category = 'cancellation'`.
 *
 * `cutoff_missed` was here and has been removed, along with the other codes the table carries:
 * `payment_failed`, `checkout_expired`, `cutoff_missed` and `customer_cancelled` all describe a
 * payment or a customer action, recorded by the system from evidence. A kitchen operator
 * selecting one would be asserting something they cannot know, and it would be indistinguishable
 * afterwards from the system having observed it.
 */
export const CANCEL_REASONS = [
  { code: 'dish_unavailable', label: 'Dish unavailable' },
  { code: 'kitchen_closed', label: 'Kitchen closed' },
  { code: 'school_holiday', label: 'School holiday' },
] as const;

/**
 * This screen never writes tier-P data to disk.
 *
 * A kitchen tablet is shared, and "offline-readable" would otherwise mean today's children's
 * names sitting in localStorage on a device several people use. The parent-facing app avoids
 * exactly this — `ux-spec.md` §5.7.1 stores a `recipient_id` and never a name, because the store
 * is not encrypted.
 *
 * So the day is held in memory only. Offline therefore survives a dropped connection, which is
 * the case that actually happens in a kitchen, and does not survive a reload — and the true
 * fallback for that was already built: the printed CSV (`E09-11a`).
 */
export const MEMORY_ONLY = true;
