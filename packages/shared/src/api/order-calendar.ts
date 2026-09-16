/**
 * Which days a parent may order for, and why not when they may not. `E05-52`.
 *
 * ## Why this is its own file now
 *
 * It lived in `meal-packs.ts`, which was wrong and only became visible when that module was
 * rewritten: **nothing here has anything to do with packs.** It is the cart's day picker — the
 * control `E05-58` added after a parent could not order at all — and it is read by
 * `useOrderableDays`, which the cart uses whether or not the parent has ever heard of a pack.
 *
 * Deleting the pack planner nearly took it with it. Moved rather than restored in place, so the
 * next person reading `meal-packs.ts` does not have to work out why a calendar is in it.
 *
 * The server is authoritative in both directions: `orderable_calendar` is advisory and this
 * reflects it, while `create_checkout` is what actually refuses a day (`cutoff_passed`,
 * `not_a_service_day`). A day this says is orderable may still be refused a second later, and the
 * refusal is the truth.
 */
import { ApiError, invokeFunction } from './client.js';

export interface OrderableDay {
  serviceDate: string;
  cutoffAt: string;
  isOrderable: boolean;
  /** Why not, when it is not. `cutoff_passed`, `not_a_service_day`, and whatever the server adds. */
  reason: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function fetchOrderableDays(input: {
  schoolId: string;
  from: string;
  to: string;
}): Promise<OrderableDay[]> {
  const data = await invokeFunction<Record<string, unknown>>(
    `order-calendar?school=${encodeURIComponent(input.schoolId)}` +
      `&from=${encodeURIComponent(input.from)}&to=${encodeURIComponent(input.to)}`,
    undefined,
    'GET',
  );
  const days = Array.isArray(data.days) ? data.days : [];
  return days.map((row) => {
    if (!isRecord(row)) throw new ApiError('A calendar day was not an object.');
    return {
      serviceDate: String(row.serviceDate ?? ''),
      cutoffAt: String(row.cutoffAt ?? ''),
      isOrderable: row.isOrderable === true,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  });
}
