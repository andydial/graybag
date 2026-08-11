/**
 * The break windows a parent picks from — `E05-30`, `P19`.
 *
 * ## Why this read decides whether a school can be ordered from at all
 *
 * `P19`, Andy 2026-08-11: the parent chooses the break at checkout from the school's **real**
 * windows, and a school with no windows **cannot be ordered from**. The previous behaviour —
 * "break time is confirmed with the kitchen" — described a manual step nobody can perform at
 * volume: orders arrive until midnight for the next day, and no one is agreeing a window per
 * order overnight.
 *
 * So an empty list is not an empty state. It is the answer "this school is not open for
 * ordering yet", and the caller is expected to say so rather than proceed without a window.
 *
 * Two of the three live schools were in exactly that position until `0029`. All three now have
 * windows: Gem and Paragon carry Amity's two as **provisional** rows (`P20`, Andy 2026-08-11),
 * to be confirmed per school at onboarding. The empty-list branch is therefore not dead code —
 * it is what any new school looks like between being onboarded and having its times agreed, and
 * it stays the answer for a school whose provisional windows are ever withdrawn.
 *
 * ## Readable signed out, by `0027`
 *
 * Deliberate, and the fourth widening of the anon surface. Without it a visitor could browse a
 * school we cannot serve, fill a cart, tap Place order, sign in — and only then be turned away.
 * Making someone identify themselves in order to be refused is the worst version of this.
 * Break times are not personal data; `0002`'s comment on the neighbouring policy says so.
 */
import { runQuery } from './client.js';

export interface BreakTime {
  id: string;
  /** What the parent reads — "Morning break". Never the raw time range. */
  label: string;
  /** `HH:MM:SS`, as Postgres `time` renders it. */
  startsAt: string;
  endsAt: string;
}

/** Raised when the backend returns break windows that are not the agreed shape. */
export class BreakTimePayloadError extends Error {
  constructor(detail: string) {
    super(`The break times are not usable: ${detail}`);
    this.name = 'BreakTimePayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Exactly what may leave `break_time`.
 *
 * Spelled out for the same reason `SCHOOL_COLUMNS` is. `legacy_option_value` is the one that
 * matters: its column comment says **never trust this value**, because the legacy option-set db
 * values contradict their labels — `10__00_am` renders as "10:40AM - 11:15AM". A field we have
 * documented as wrong must not reach a screen, and `0027` does not grant it either.
 */
export const BREAK_TIME_COLUMNS = 'id,label,starts_at,ends_at';

/**
 * The orderable break windows for a school, in the order they should be offered.
 *
 * **An empty array means the school cannot take orders.** It is not a loading state and not an
 * error — see the note above.
 */
export async function fetchBreakTimes(schoolId: string): Promise<BreakTime[]> {
  const rows = await runQuery<unknown>((t) =>
    t
      .from('break_time')
      .select(BREAK_TIME_COLUMNS)
      .eq('school_id', schoolId)
      // `is_active` is enforced by both policies too. Stated here so the intent survives a
      // policy being widened for a back-office surface later.
      .eq('is_active', true)
      .order('sort_order'),
  );

  return rows.map((row, i) => {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.label !== 'string' ||
      typeof row.starts_at !== 'string' ||
      typeof row.ends_at !== 'string'
    ) {
      throw new BreakTimePayloadError(`break time ${i} is missing a required field`);
    }
    return {
      id: row.id,
      label: row.label,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  });
}

/**
 * "10:40 – 11:15" from two `HH:MM:SS` values.
 *
 * Shown **under** the label, never instead of it (`P19`). Amity's labels used to hold the time
 * range itself, so the picker drew the same window twice in two formats; `0029` renamed them to
 * "Morning break" / "Second break" and this line is now the only place the time appears.
 *
 * 24-hour, because that is how a school timetable is written in India and because AM/PM on a
 * range doubles the characters for no gain. An unparseable value renders as itself rather than
 * as "Invalid Date" — the row is still selectable, and a mangled time is better than a mangled
 * error.
 */
export function formatBreakWindow(startsAt: string, endsAt: string): string {
  const hhmm = (t: string) => (/^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : t);
  return `${hhmm(startsAt)} – ${hhmm(endsAt)}`;
}
