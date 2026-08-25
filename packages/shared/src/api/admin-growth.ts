/**
 * The three reads behind the growth report — `E11-08`.
 *
 * ## The column lists are the privacy control
 *
 * `recipient_read_admin` grants a platform admin every column on every child. This module selects
 * **three** of them, none of which identifies anybody, and the types have nowhere to put a name.
 * Non-negotiable #4 is not "do not display a child's name" — it is do not put it where it can be
 * displayed, logged or exported by accident, and the narrowest possible `select` is how that is
 * enforced at the boundary rather than in a template.
 *
 * The same reasoning as `REPORT_ORDER_COLUMNS` in `admin-reports.ts`, which is why that screen
 * could not show a child if somebody tried.
 *
 * ## Everything is scoped by RLS, not here
 *
 * All three need `users.view` at platform scope. A caller without it gets empty arrays rather than
 * an error, which is the same ambiguity `/reports` has and is handled the same way: the screen says
 * both possibilities rather than picking one.
 */
import { runQuery } from './client.js';

/**
 * No name, no phone. **The email is read**, and only for one purpose — `E11-15`.
 *
 * Andy: *"Where I need to act on an individual — a parent stuck with no children — show me their
 * email address and nothing about the child."* That is the whole justification: an address is
 * what makes a stuck parent actionable, and it is the only personal field on this screen.
 *
 * It is still never shown beside anything about a child, because the screen has nothing about a
 * child to show — `GROWTH_CHILD_COLUMNS` is an id, a school and a timestamp.
 */
export const GROWTH_USER_COLUMNS = 'id,email,created_at';

/** No name, no class, no section — see the header. */
export const GROWTH_CHILD_COLUMNS = 'id,school_id,created_at';

export const GROWTH_LINK_COLUMNS = 'user_id,recipient_id';

/**
 * What the funnel needs from an order — `E11-15`.
 *
 * `customer_user_id` so a parent can be counted once, `placed_at` so "first" and "in the last
 * seven days" mean something, `status` so an unpaid order is not a conversion, and the total for
 * revenue. **No recipient, class or section** — the same rule as every other report here.
 */
export const GROWTH_ORDER_COLUMNS = 'customer_user_id,placed_at,status,total_paise,school_id';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface GrowthOrder {
  customerUserId: string;
  placedAt: string;
  status: string;
  totalPaise: number;
  schoolId: string;
}

export interface GrowthData {
  users: { id: string; email: string | null; createdAt: string }[];
  children: { id: string; schoolId: string; createdAt: string }[];
  links: { userId: string; recipientId: string }[];
  orders: GrowthOrder[];
}

export async function fetchGrowth(): Promise<GrowthData> {
  const [userRows, childRows, linkRows, orderRows] = await Promise.all([
    // Soft-deleted accounts are excluded: somebody who deleted their account is not a registration
    // we still have. `deleted_at` is the DPDP erasure marker (§13.4).
    runQuery<unknown>((t) => t.from('app_user').select(GROWTH_USER_COLUMNS).is('deleted_at', null)),
    runQuery<unknown>((t) => t.from('recipient').select(GROWTH_CHILD_COLUMNS).is('deleted_at', null)),
    // `revoked_at` rather than a delete — links are revoked and kept (`0001`), and a revoked
    // guardian is no longer a family at that school.
    runQuery<unknown>((t) => t.from('guardian_link').select(GROWTH_LINK_COLUMNS).is('revoked_at', null)),
    // Orders, for the conversion half of the funnel. Scoped by `order_read_backoffice`, so this
    // needs `orders.view` as well as `users.view` — both are checked by RLS, not here.
    runQuery<unknown>((t) => t.from('order').select(GROWTH_ORDER_COLUMNS)),
  ]);

  return {
    users: userRows.filter(isRecord).map((r) => ({
      id: str(r.id),
      email: str(r.email) === '' ? null : str(r.email),
      createdAt: str(r.created_at),
    })),
    children: childRows.filter(isRecord).map((r) => ({
      id: str(r.id),
      schoolId: str(r.school_id),
      createdAt: str(r.created_at),
    })),
    links: linkRows.filter(isRecord).map((r) => ({
      userId: str(r.user_id),
      recipientId: str(r.recipient_id),
    })),
    orders: orderRows.filter(isRecord).map((r) => ({
      customerUserId: str(r.customer_user_id),
      placedAt: str(r.placed_at),
      status: str(r.status),
      totalPaise: typeof r.total_paise === 'number' ? r.total_paise : 0,
      schoolId: str(r.school_id),
    })),
  };
}
