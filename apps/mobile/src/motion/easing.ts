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
 */
export type EaseName = keyof typeof ease;

// `Easing.bezier` returns a *factory*, not a bare `(t: number) => number`. Naming the
// real type here rather than casting is what keeps the memoisation honest.
const cache = new Map<EaseName, EasingFunctionFactory>();

/**
 * The Reanimated easing function for a named curve.
 *
 * Memoised because `Easing.bezier` builds a sampling table, and a `useAnimatedStyle` callback
 * runs on every frame — constructing the curve inside it would allocate on the UI thread at
 * 60fps, which is the frame budget `P11` says is the thing we actually care about on a
 * mid-range Android.
 */
export function easingFor(name: EaseName): EasingFunctionFactory {
  const existing = cache.get(name);
  if (existing) return existing;

  const curve = ease[name];
  const built = Easing.bezier(curve[0], curve[1], curve[2], curve[3]);
  cache.set(name, built);
  return built;
}

/** `ease.standard` — on screen before and after. The default. */
export const standard = () => easingFor('standard');
/** `ease.enter` — arriving. */
export const enter = () => easingFor('enter');
/** `ease.exit` — leaving. */
export const exit = () => easingFor('exit');
