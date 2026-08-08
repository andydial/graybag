/**
 * JS-side cold start marker (E19-02).
 *
 * This measures only "how long from JS bundle evaluation to first render", which is the
 * part we control by shipping less JS. It is NOT cold start: it excludes process fork,
 * native init and the bundle load itself.
 *
 * The number that matters comes from `adb shell am start -W`, which reports TotalTime from
 * launcher tap to first frame. The runbook uses that. This exists so the two can be
 * compared — if TotalTime is 1800 ms and this says 90 ms, the cost is native/bundle, and
 * trimming JS will not help. That distinction is the whole point of measuring both.
 */
const JS_START = Date.now()

/** Milliseconds from JS bundle evaluation to now. Call during first render. */
export function msSinceJsStart(): number {
  return Date.now() - JS_START
}
