import type { IsoWeekday, ServiceDate } from './types.js';

/**
 * Date arithmetic for service dates, done on the `YYYY-MM-DD` string.
 *
 * **No `Date` object is constructed from a service date anywhere in this module, and that is
 * the point.** `new Date('2026-08-09')` parses as midnight *UTC*, so `getDay()` returns the
 * weekday in the runner's local zone — which for a device in IST is the same day, and for a
 * CI runner in UTC−5 is the day before. A menu that is unavailable on Sundays would then be
 * orderable on Sunday for some users and not others, and the test would pass in London.
 *
 * `G9` recorded exactly this class of bug for the financial year. This is the same bug in the
 * same codebase, one table over, so it is prevented structurally rather than remembered.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidServiceDateError extends Error {
  constructor(value: string) {
    super(
      `Not a service date: ${JSON.stringify(value)}. Expected YYYY-MM-DD — a calendar date ` +
        `in the platform timezone, never an ISO instant and never a Date.`,
    );
    this.name = 'InvalidServiceDateError';
  }
}

/** Parse and validate, or throw. Rejects impossible dates like 2026-02-30. */
export function parseServiceDate(value: ServiceDate): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(value);
  if (!match) throw new InvalidServiceDateError(value);

  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);

  // Round-tripping through UTC is safe *here* because we immediately compare the parts
  // back: we are validating the calendar, not deriving a local weekday from an instant.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new InvalidServiceDateError(value);
  }

  return { y, m, d };
}

export function isServiceDate(value: string): value is ServiceDate {
  try {
    parseServiceDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * ISO weekday, 1 = Monday … 7 = Sunday.
 *
 * Sakamoto's algorithm rather than a `Date`, so the answer is a property of the calendar
 * date and of nothing else — not the runner's zone, not the time of day, not whether the
 * process happens to have `TZ` set.
 */
export function isoWeekday(date: ServiceDate): IsoWeekday {
  const { y, m, d } = parseServiceDate(date);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  // 0 = Sunday from Sakamoto; shift so Monday is 1 and Sunday is 7.
  const sunday0 = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + (t[m - 1] ?? 0) + d) % 7;
  return (sunday0 === 0 ? 7 : sunday0) as IsoWeekday;
}

/**
 * Is `date` inside `[validFrom, validTo)`?
 *
 * **`validTo` is exclusive**, matching `menu_assignment` and `menu_item_price_override` in
 * the schema, where the exclusion constraints are written with `'[)'` ranges. Getting this
 * backwards gives a one-day overlap that the database would reject on insert but that this
 * code would happily *read* — so a row that could never exist would still be selected, which
 * is the confusing direction.
 *
 * Lexicographic comparison is exact for zero-padded `YYYY-MM-DD`, which is why the format is
 * fixed rather than merely conventional.
 */
export function isWithin(
  date: ServiceDate,
  validFrom: ServiceDate,
  validTo: ServiceDate | null,
): boolean {
  parseServiceDate(date);
  parseServiceDate(validFrom);
  if (validTo !== null) parseServiceDate(validTo);

  if (date < validFrom) return false;
  return validTo === null || date < validTo;
}
