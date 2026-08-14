/**
 * Calendar dates in the kitchen's timezone. `E05-49`.
 *
 * # The bug this exists to stop
 *
 * `defaultServiceDate()` computed "tomorrow" as `new Date(Date.now() + 24h).toISOString()`. UTC —
 * so **between 00:00 and 05:30 IST it returned today**, because IST is +05:30 and the UTC day had
 * not yet rolled over. The cutoff for a given day is 00:00 that morning (`D5`, `C5`), so today is
 * never orderable: a parent opening the app at 5am was offered a day they could not order for,
 * and the refusal arrived at the end of the cart rather than the start.
 *
 * Proved at 05:24 IST by the web thread, which had the same defect in its own code.
 *
 * # Why every function here takes the instant
 *
 * A function that calls `new Date()` itself is **only testable at whatever time the suite happens
 * to run**. The 00:00–05:30 IST window is five and a half hours out of twenty-four, so a test
 * written against `Date.now()` passes 77% of the time and fails nightly builds in one timezone —
 * which is indistinguishable from flakiness and gets retried rather than read.
 *
 * Taking `now` as an argument is what makes the broken case provable: the test names 05:24 IST and
 * asserts the answer, at any hour, on any machine. That is the whole lesson, and it applies to
 * every date helper anyone adds beside these.
 *
 * # Arithmetic, not a timezone database
 *
 * IST is a fixed +05:30 with no daylight saving and has never been anything else, so the shift is
 * addition. That matters on device: Hermes' `Intl` is a thin platform shim on Android and its
 * `timeZone` support is not something to bet a cutoff on.
 */

/** IST is UTC+05:30, always. */
const IST_OFFSET_MINUTES = 330;

/** Today's calendar date in India, `YYYY-MM-DD`. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * The date a cart line defaults to: **tomorrow in India**, never today.
 *
 * Today is never orderable under the default configuration — the cutoff is 00:00 that morning —
 * so offering it puts every first-time visitor in front of a refusal. `E05-30`'s calendar read
 * replaces this with the real next orderable day, including holidays and per-kitchen cutoffs;
 * until then this is the honest floor rather than a guess.
 */
export function defaultServiceDateInIndia(now: Date = new Date()): string {
  const istNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return new Date(istNow.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
