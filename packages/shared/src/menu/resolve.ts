import { isWithin, isoWeekday } from './dates.js';
import type {
  MenuAssignment,
  MenuItem,
  MenuItemPriceOverride,
  ServiceDate,
} from './types.js';

/**
 * The three "which one applies today" questions (`E04-02`, `E04-03`).
 *
 * All three are pure functions over rows the caller already has. None of them fetch, and
 * none of them know Supabase exists — that is the `api/` module's job (`A4`), and keeping
 * this layer pure is what lets the importer, the app and a future Edge Function share one
 * implementation of rules that must not diverge.
 */

export class AmbiguousAssignmentError extends Error {
  constructor(schoolId: string, date: ServiceDate, count: number) {
    super(
      `School ${schoolId} has ${count} live menu assignments on ${date}. The database ` +
        `forbids this (menu_assignment_no_overlap, an exclusion constraint over ` +
        `school_id + daterange where revoked_at is null), so reaching here means the rows ` +
        `did not come from that table — a stale cache, a hand-built fixture, or a query ` +
        `that forgot the revoked_at filter.`,
    );
    this.name = 'AmbiguousAssignmentError';
  }
}

/**
 * Which menu a school sees on a date — `D4`'s single answer.
 *
 * The legacy model had three competing paths (`School.menu`, `Kitchen.default_menu`,
 * `School_Menu`) and therefore three possible answers that could disagree. `D4` replaced
 * them with one table, and the schema's exclusion constraint makes overlap structurally
 * impossible rather than merely discouraged.
 *
 * **This function throws rather than picking when it finds overlap.** Returning the first
 * match would paper over a broken invariant with a plausible-looking menu, and the symptom
 * downstream would be a parent seeing the wrong prices — traceable to nothing. The database
 * cannot produce this state; if we are in it, something upstream is wrong and silence is the
 * wrong response.
 */
export function resolveMenuIdForSchool(
  assignments: readonly MenuAssignment[],
  schoolId: string,
  date: ServiceDate,
): string | null {
  const live = assignments.filter(
    (a) =>
      a.schoolId === schoolId &&
      a.revokedAt === null &&
      isWithin(date, a.validFrom, a.validTo),
  );

  if (live.length > 1) throw new AmbiguousAssignmentError(schoolId, date, live.length);
  return live[0]?.menuId ?? null;
}

/**
 * Is this item orderable on this date?
 *
 * `available_days` is ISO weekdays and the column is named for what it means — the legacy
 * option set was called `unavailable_days` and used as *available* days, which `E02-14`
 * corrected. An inactive item is never available regardless of the day.
 */
export function isAvailableOn(item: MenuItem, date: ServiceDate): boolean {
  if (!item.isActive) return false;
  return item.availableDays.includes(isoWeekday(date));
}

/**
 * The price of an item at a school on a date, in integer paise, GST-exclusive.
 *
 * Resolution order is `menu_item_price_override` → `menu_item.price_paise`, which is the
 * order the schema comment fixes and `D5` puts in the config chain. Exactly one override can
 * apply — the table has an exclusion constraint over `(school_id, menu_item_id, daterange)`
 * — so finding several means the same thing it means for assignments, and gets the same
 * treatment rather than a silent pick.
 *
 * **What this function deliberately does not do is snapshot.** The resolved price is written
 * onto the order line at checkout and never re-derived (`D5`, `L7`), so a later price change
 * cannot rewrite history. Calling this at *read* time to display a historical order would be
 * the bug; it is for pricing what is about to be ordered.
 */
export function resolvePricePaise(
  item: MenuItem,
  overrides: readonly MenuItemPriceOverride[],
  schoolId: string,
  date: ServiceDate,
): number {
  const applicable = overrides.filter(
    (o) =>
      o.menuItemId === item.id &&
      o.schoolId === schoolId &&
      isWithin(date, o.validFrom, o.validTo),
  );

  if (applicable.length > 1) {
    throw new AmbiguousAssignmentError(
      `${schoolId}/menu_item:${item.id}`,
      date,
      applicable.length,
    );
  }

  return applicable[0]?.pricePaise ?? item.pricePaise;
}
