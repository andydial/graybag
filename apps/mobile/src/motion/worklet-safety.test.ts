import { design } from '@graybag/shared';

import { easingFor } from './easing';

/**
 * The other half of `E14-18`'s gate.
 *
 * ## What went wrong
 *
 * The first real iOS build aborted — `SIGABRT`, no message in the crash report — on the
 * first screen that mounted a `TextField`, because `TextField` renders `InlineError` and
 * `InlineError`'s `useAnimatedStyle` called two ordinary functions:
 *
 *     duration: resolveDuration(...)   // packages/shared/src/design/motion.ts
 *     easing:   easingFor(...)         // apps/mobile/src/motion/easing.ts
 *
 * `useAnimatedStyle` runs on the **UI runtime**. A plain function captured by a worklet is
 * serialized as a *remote function*; calling one synchronously there throws
 * `[Worklets] Tried to synchronously call a Remote Function`.
 *
 * ## Why it was invisible until a device
 *
 * `WorkletRuntime::callGuarded` wraps the call in a try/catch and reports the error to
 * LogBox — **inside `#ifndef NDEBUG`**. A release build compiles that guard out, so the
 * `jsi::JSError` leaves the frame callback as a C++ exception, nothing catches it, and the
 * process aborts. Development shows a red box; the build you hand somebody dies.
 *
 * ## Why this test and the lint rule are both needed
 *
 * Neither is sufficient.
 *
 * - **A behavioural test cannot reach it.** Under jest there is one runtime. The worklet is
 *   an ordinary closure, the "remote function" is the real function, and it works.
 * - **The lint rule** (`config/eslint-design-system.js`) bans calling anything from inside a
 *   worklet that is not on an allowlist — but an allowlist is only a claim.
 * - **This test checks the claim.** `__workletHash` is what the babel plugin stamps onto a
 *   function carrying a `'worklet'` directive, so its presence is direct evidence that the
 *   app's own build compiled it for the UI runtime. Remove the directive and this fails.
 *
 * The marker is asserted rather than the behaviour because the behaviour is unreachable
 * here — and an assertion that names the mechanism is better than one that pretends to test
 * an outcome it cannot observe.
 */

/** Every function the app calls from inside a worklet. Must match the lint allowlist. */
const CALLED_FROM_WORKLETS: [string, unknown][] = [
  ['resolveDuration', design.resolveDuration],
  ['easingFor', easingFor],
];

const markerOf = (fn: unknown) =>
  (fn as { __workletHash?: number }).__workletHash;

describe('functions called from worklets', () => {
  it('has something to check', () => {
    // A list that quietly emptied would pass every assertion below and check nothing —
    // the same failure mode as a pgTAP suite reporting zero tests.
    expect(CALLED_FROM_WORKLETS.length).toBeGreaterThan(0);
  });

  it.each(CALLED_FROM_WORKLETS)(
    '%s is compiled as a worklet, not captured as a remote function',
    (_name, fn) => {
      expect(typeof fn).toBe('function');
      expect(markerOf(fn)).toEqual(expect.any(Number));
    },
  );

  it('would notice if the marker stopped meaning anything', () => {
    // If the babel plugin ever stopped stamping `__workletHash`, every assertion above would
    // fail rather than silently pass — but a plain function must also NOT carry it, or the
    // check is vacuous.
    const plain = () => 1;
    expect(markerOf(plain)).toBeUndefined();
  });
});
