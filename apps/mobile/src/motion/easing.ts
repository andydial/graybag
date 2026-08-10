import { Easing, type EasingFunctionFactory } from 'react-native-reanimated';
import { design } from '@graybag/shared';

const { ease } = design;

/**
 * The **one** place in the app that calls `Easing.bezier`.
 *
 * `packages/shared/src/design/motion.ts` owns the curves as data — four numbers per curve,
 * shared by mobile and web (`S8`, one source two outputs). It cannot own this conversion,
 * because turning those numbers into an easing *function* requires
 * `react-native-reanimated`, and `motion.ts` is imported by the web build too.
 *
 * So the curves need a second home on the native side, and this is it. It exists for exactly
 * the reason `S25` gives for `motion.ts` itself: **`S1`'s closed catalogue only holds if
 * there is no third place to put a curve.** Four components each calling `Easing.bezier`
 * would be four places, and the fourth would eventually be called with numbers rather than
 * with a token.
 *
 * `config/eslint-design-system.js` names this file as the native easing module and fails the
 * build on `Easing.bezier` anywhere else — the same shape as `CartBadge.tsx` holding the one
 * spring. A second easing module is a decision-log line, not an edit (`S32`).
 *
 * **This module adds no curve and cannot.** `easingFor` takes a key of `ease`, so a caller
 * cannot pass four numbers even by accident; the type is the gate and the lint rule is the
 * backstop.
 *
 * ## Why it is a worklet, and why the cache became a table (`S41`)
 *
 * This is called from inside `useAnimatedStyle`, which runs on the **UI runtime**. A plain
 * function captured by a worklet is serialized as a *remote function*, and calling one
 * synchronously on the UI runtime throws. In a debug build that is caught and reported to
 * LogBox; in a release build the try/catch is compiled out and the process aborts. It killed
 * the first iOS build on the first screen that mounted a `TextField`.
 *
 * The old shape was a lazily-filled `Map`. That cannot survive workletization: a worklet
 * captures its closure **by serialization**, a `Map` is not serializable, and even if it
 * were, writes made on the UI runtime would not be visible on the JS runtime — so the cache
 * would silently do nothing while looking like it worked.
 *
 * The table is therefore built **eagerly, once, on the JS runtime at module load**. Four
 * `Easing.bezier` calls is four sampling tables, built once at startup rather than per frame,
 * which is what the memoisation was for in the first place. `easingFor` is then a lookup,
 * and the object it captures is plain data holding four `{ factory }` records — each
 * `factory` is itself a worklet, which is what makes the whole thing serializable.
 */
export type EaseName = keyof typeof ease;

/**
 * Every curve, built once at module load on the JS runtime.
 *
 * `Easing.bezier` is **not** called inside the worklet. It could be — Reanimated's easing is
 * worklet-safe — but building a sampling table on the UI thread every frame is exactly the
 * cost `P11` says to care about, and doing it here means the UI runtime only ever reads.
 */
const CURVES: Readonly<Record<EaseName, EasingFunctionFactory>> = Object.freeze({
  standard: Easing.bezier(...ease.standard),
  enter: Easing.bezier(...ease.enter),
  exit: Easing.bezier(...ease.exit),
  linear: Easing.bezier(...ease.linear),
});

/**
 * The Reanimated easing function for a named curve.
 *
 * Safe to call from a worklet **and** from ordinary render code — the directive makes the
 * babel plugin emit both forms.
 */
export function easingFor(name: EaseName): EasingFunctionFactory {
  'worklet';
  return CURVES[name];
}

/** `ease.standard` — on screen before and after. The default. */
export const standard = () => easingFor('standard');
/** `ease.enter` — arriving. */
export const enter = () => easingFor('enter');
/** `ease.exit` — leaving. */
export const exit = () => easingFor('exit');
