/**
 * `GET /order/calendar?school=<uuid>&from=<date>&to=<date>` — the handler's decisions, as
 * pure functions (`E05-08`).
 *
 * The Edge Function in `supabase/functions/order-calendar/` is a shell around this, for the
 * same reason `menu-version` is: everything that can be wrong lives where a test can reach
 * it, without Deno, without a database and without a deploy.
 *
 * **The client never recomputes a cutoff.** The wire carries `cutoffAt` as an instant and the
 * app compares it against its own clock to grey out a day. That split is the whole point:
 * §9.1's arithmetic exists once, in SQL (`compute_cutoff_at`), and a TypeScript copy that
 * drifted by an hour would be a whole-day error at the default midnight cutoff (`C5`) — the
 * app would grey out days the server would accept, or offer days it will refuse at the end of
 * checkout.
 *
 * **And the answer is advisory** (§9.2 E1). The authoritative refusal is `assert_cutoff_open`
 * inside the checkout transaction, against a snapshotted `cutoff_at` (`L6`). This endpoint is
 * a drawing aid; the response says so in a field, so a future client author does not read a
 * cached calendar as permission.
 */

import { isServiceDate } from '../menu/dates.js';
import type { ServiceDate } from '../menu/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The longest range one request may ask for.
 *
 * The default `max_advance_order_days` is 14, so a month is already more than any school's
 * horizon. The cap exists so a malformed or hostile caller cannot ask for ten years of days
 * and make the database generate them.
 */
export const CALENDAR_MAX_RANGE_DAYS = 62;

/** Seconds a client may reuse a calendar without re-asking. */
export const CALENDAR_MAX_AGE_SECONDS = 60;

export interface CalendarRequest {
  schoolId: string;
  from: ServiceDate;
  to: ServiceDate;
}

/** One day, as the database returns it. */
export interface CalendarRow {
  service_date: string;
  cutoff_at: string;
  is_orderable: boolean;
  reason: string | null;
}

export interface CalendarResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const json = (
  status: number,
  payload: unknown,
  extra: Record<string, string> = {},
): CalendarResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(payload),
});

/** Whole days between two service dates. Both are `YYYY-MM-DD`, so this is exact. */
function daysBetween(from: ServiceDate, to: ServiceDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Validate the query string. `null` means "reject with a 400".
 *
 * `isServiceDate` is reused rather than re-regexed: it already rejects `2026-02-30`, which a
 * pattern match would happily accept, and it already refuses a datetime — `2026-08-10T23:50Z`
 * would otherwise resolve to the previous day in IST (`G9`).
 */
export function parseCalendarRequest(
  rawSchool: string | null | undefined,
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
): CalendarRequest | null {
  const school = rawSchool?.trim() ?? '';
  if (!UUID_RE.test(school)) return null;

  const from = rawFrom?.trim() ?? '';
  const to = rawTo?.trim() ?? '';
  if (!isServiceDate(from) || !isServiceDate(to)) return null;

  const span = daysBetween(from, to);

  // Backwards is a client bug. The SQL answers it with no rows, which renders as an empty
  // month and leaves the caller wondering; refusing it means they find out.
  if (span < 0) return null;
  if (span + 1 > CALENDAR_MAX_RANGE_DAYS) return null;

  return { schoolId: school.toLowerCase(), from, to };
}

/**
 * Shape the response.
 *
 * @param rows what `orderable_calendar` returned. An empty array is a legitimate 200 — a
 *             school whose every day is past its cutoff has been asked and answered, and a
 *             404 there would say the school does not exist.
 */
export function orderCalendarResponse(
  rawSchool: string | null | undefined,
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
  rows: CalendarRow[],
): CalendarResponse {
  const request = parseCalendarRequest(rawSchool, rawFrom, rawTo);

  if (request === null) {
    return json(400, {
      error: 'school must be a uuid, and from/to must be YYYY-MM-DD with to on or after from',
      hint: `GET /order/calendar?school=<uuid>&from=<date>&to=<date> (max ${CALENDAR_MAX_RANGE_DAYS} days)`,
    });
  }

  return json(
    200,
    {
      // Stated on the wire, not only in a comment: §9.2 E1 makes this a drawing aid, and the
      // way that gets forgotten is a client author reading a cached calendar as permission.
      advisory: true,
      days: rows.map((row) => ({
        serviceDate: row.service_date,
        cutoffAt: row.cutoff_at,
        isOrderable: row.is_orderable,
        reason: row.reason,
      })),
    },
    {
      // `private`, never `public`: the answer depends on the school's config chain and, via
      // the cutoff, on when it was asked. A shared cache handing one school's calendar to
      // another is a bug that only appears once there is a CDN in front.
      'cache-control': `private, max-age=${CALENDAR_MAX_AGE_SECONDS}`,
    },
  );
}

/**
 * One calendar day as the CLIENT holds it.
 *
 * `CalendarRow` above is the database's snake_case shape; `api.fetchOrderableDays` maps it to
 * this one. Declared structurally rather than imported from `api/` so the ordering rules stay
 * free of a dependency on the transport — and so a caller with either shape can use them by
 * mapping once, rather than the rules learning about two.
 */
export interface OrderableDayView {
  serviceDate: string;
  isOrderable: boolean;
  reason: string | null;
}

/**
 * The day a cart should default to, and the days it may offer — `E05-52`.
 *
 * ## Why this is a rule and not a `find` at the call site
 *
 * "Never offer a day we are going to refuse" is one sentence and three screens: the cart's
 * default, the day picker, and the planner. Written at each of them it becomes three answers to
 * one question, and the one that drifts is discovered by a parent meeting a refusal — which is
 * exactly the failure `E05-55` documents and `E05-52` made unavoidable.
 *
 * ## The server's answer is the only answer
 *
 * There is deliberately no local weekday arithmetic here. `defaultServiceDateInIndia` guessed
 * "tomorrow in India" and was right until the school stopped serving Sundays; the calendar knows
 * about service days, cutoffs, the advance window and — when it grows them — holidays. A client
 * that recomputes any part of that will disagree with `assert_cutoff_open`, and the disagreement
 * always surfaces as a parent being refused after choosing.
 *
 * Returns `null` when the calendar offers nothing in range. `null` is not "today": a caller must
 * say it cannot offer a day rather than fall back to one the server will refuse.
 */
export function nextOrderableDate(days: readonly OrderableDayView[]): string | null {
  // `days` arrives ordered by the server. Sorting here would hide a server that stopped ordering
  // them, and the first orderable day is only meaningful if the order is real.
  const found = days.find((day) => day.isOrderable);
  return found === undefined ? null : found.serviceDate;
}

/**
 * The days a picker may OFFER — `E05-52`.
 *
 * Only orderable ones. An earlier version of this kept a closed-but-real day visible and
 * disabled, on the theory that seeing "tomorrow, closed" teaches a parent when to come back.
 * Andy's rule is stricter and he is right: *"non-service days and closed days are not offered —
 * not offered-then-refused."*
 *
 * The evidence is nine refused checkouts. The cart pinned a date the parent could not change, the
 * pinned date was closed, and the refusal blamed a dish — one parent pressed Place order five
 * times in 65 seconds. Every day this returns is a day the server will accept, so the picker
 * cannot be the thing that sets that trap again.
 *
 * The **reason** a day is missing still belongs on screen; it is just not a row you can tap.
 * `nextOrderableDate` returning `null` is how a caller knows to say so.
 */
export function offerableDays<T extends OrderableDayView>(days: readonly T[]): readonly T[] {
  return days.filter((day) => day.isOrderable);
}

