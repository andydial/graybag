/**
 * Motion tokens (E13-12). Specified by `docs/motion-system.md` §2–§4 and §10.
 *
 * **This module exports `duration`, `ease`, `spring` and the reduce-motion catalogue, and
 * nothing else.** That is the whole design. The catalogue is closed (decision `S1`) and it
 * stays closed only if there is no third place to put a number: a `withTiming` with a
 * literal `180`, a `cubic-bezier` written inline, or a second spring all fail the build
 * (`E13-11`, §9 of the spec).
 *
 * Where this file and `docs/design-tokens.md` disagree about a duration or an easing
 * curve, **this one is right and the token document is a bug.** Motion tokens live here.
 *
 * Why the ceiling is 350ms and not 500ms, since it is the number people argue about: below
 * ~100ms a change reads as instantaneous and the user does not learn where the new thing
 * came from, which is the entire point of an entrance. Above ~350ms the motion stops being
 * a cue and becomes a wait, and the app gets described as slow even when it is fast. The
 * real constraint is that animation time is added *on top of* an already-long network wait
 * (P11) — a 400ms transition behind three seconds of loading is not elegance, it is 400ms
 * of extra nothing.
 */

/**
 * Four tokens. Three of them animate.
 *
 * **No other duration exists.** An exit is one step faster than its entrance — a sheet
 * enters at `slow` and leaves at `base`, a toast enters at `base` and leaves at `fast`.
 * Things arriving deserve to be understood; things leaving deserve to get out of the way.
 */
export const duration = {
  /** The reduce-motion substitute, and nothing else. */
  instant: 0,
  /** A state change on an element already on screen and staying there. */
  fast: 120,
  /** An element enters or leaves — sheet, toast, list item, tab indicator, cross-fade. */
  base: 200,
  /** A whole surface changes — screen push, shared element, a long-travel sheet. */
  slow: 320,
} as const;

/**
 * **Hard ceiling.** Nothing in the product animates for longer.
 *
 * Two named exemptions, and only two: the `M03` skeleton shimmer, which is a loop and has
 * no "duration" in this sense, and the `M06` spring, whose sub-pixel settle runs to
 * ~330ms — under the ceiling anyway, but it is a settle rather than a duration.
 */
export const DURATION_CEILING_MS = 350 as const;

/**
 * Stagger, for `M02`.
 *
 * Six items is 150ms of added latency, which is the most a list may cost. Item seven
 * onwards appears with the sixth rather than extending the tail — an eleventh item at
 * 300ms would be a third of the ceiling spent on nothing but arrival order.
 */
export const stagger = { stepMs: 30, maxElements: 6 } as const;

/**
 * Three curves, **named by role rather than by shape**, so that choosing one is a
 * mechanical question about the content rather than a matter of taste:
 *
 *   Is it on screen before AND after?  → standard
 *   Is it arriving?                    → enter
 *   Is it leaving?                     → exit
 *
 * That is also what stops a fourth curve appearing. A curve named `easeOutQuint` invites a
 * sibling; a curve named `enter` does not, because there is only one way to arrive.
 */
export const ease = {
  /** On screen before and after — moves, resizes, changes colour. **The default.** */
  standard: [0.2, 0, 0, 1],
  /** Arriving. Full speed immediately, decelerating into place. Never used for an exit. */
  enter: [0, 0, 0, 1],
  /** Leaving. Starts gently, accelerates away, and is not seen to stop. */
  exit: [0.4, 0, 1, 1],
  /**
   * Permitted in **exactly one place**: the `M03` shimmer sweep, because a loop with
   * easing visibly pulses. Anywhere else this is a lint failure.
   */
  linear: [0, 0, 1, 1],
} as const;

/** `cubic-bezier(…)` for the web build, generated rather than hand-written twice. */
export function cubicBezier(curve: readonly [number, number, number, number]): string {
  return `cubic-bezier(${curve.join(', ')})`;
}

/**
 * **Exactly one spring, allowed in exactly one place:** `M06`, the cart badge.
 *
 * ζ ≈ 0.67 — about 5.8% overshoot, one bounce, settled within ~330ms. It reads as a small
 * confident pop rather than as jelly.
 *
 * A spring is a fourth *kind* of motion: no fixed duration, it overshoots, and it composes
 * badly with the three curves. It is allowed once because adding to cart is the only
 * action whose confirmation appears somewhere other than where the user is looking, so it
 * has to attract the eye. **Everywhere else, attracting the eye is a bug.** Any
 * `withSpring` outside the cart-badge module fails the build (decision `S4`).
 */
export const spring = { pop: { damping: 24, stiffness: 320, mass: 1 } } as const;

/**
 * The fourteen catalogue entries. Closed set (`S1`) — an `M15` requires a line in
 * `docs/decisions.md` naming the genuinely new interaction, not a pull request.
 */
export const MOTION_PATTERNS = [
  'M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07',
  'M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14',
] as const;

export type MotionPattern = (typeof MOTION_PATTERNS)[number];

/**
 * §10's reduce-motion substitutions, as data rather than as prose.
 *
 * **A substitute is a different animation, not the absence of one.** That distinction is
 * the whole reason this table is in code: a component that silently drops a state change
 * under reduce motion is an accessibility bug, and it is invisible to every visual review,
 * because the reviewer has reduce motion off. `M02` still cross-fades. `M06` still changes
 * the count. `M09` Ending B still waits, unbounded, and still says so.
 *
 * `reduced: null` means the platform owns it and we must not reimplement — `M12` is
 * navigator and OS behaviour, and honouring reduce motion there is their job.
 *
 * `E13-12`'s test harness asserts, for every animated component, that rendering with
 * reduce motion on produces the substitute named here — not merely that nothing animates.
 */
export const reduceMotion: Record<MotionPattern, { readonly reduced: string | null }> = {
  M01: { reduced: 'Opacity change only; no scale' },
  M02: { reduced: 'Whole list cross-fades at fast; no translate, no stagger' },
  M03: { reduced: 'Static neutral-100 block; sweep stops' },
  M04: { reduced: 'Unchanged; height animation dropped' },
  M05: { reduced: 'No morph; sheet presents as M07-reduced, hero image cross-fades' },
  M06: { reduced: 'Count changes with M04 at fast; no scale, no spring' },
  M07: { reduced: 'Sheet and scrim cross-fade at base; no translate, no scale' },
  M08: { reduced: 'Gesture unchanged; indicator is a static glyph with an opacity pulse' },
  M09: {
    reduced:
      'Static filled track plus a text label. Ending B keeps its unbounded semantics — ' +
      'the label says "Waiting for your bank…" and does not time out',
  },
  M10: { reduced: 'Fade at fast; no height animation' },
  M11: { reduced: 'Indicator jumps; panel still cross-fades' },
  M12: { reduced: null },
  M13: { reduced: 'Fade only; no translate' },
  M14: { reduced: 'Gesture unchanged; row cross-fades and collapses instead of translating out' },
};

/**
 * Resolve a duration against the user's reduce-motion preference.
 *
 * The single entry point components use, so that "did we honour reduce motion here?" has
 * one answer per component rather than one per animated property. It returns `instant`
 * rather than skipping the animation, because a zero-duration transition still fires its
 * completion callback — and a component whose state advance hangs off that callback is
 * one of the ways reduce motion silently breaks a flow.
 */
export function resolveDuration(token: keyof typeof duration, reduceMotionOn: boolean): number {
  return reduceMotionOn ? duration.instant : duration[token];
}

export const motion = {
  duration,
  ease,
  spring,
  stagger,
  reduceMotion,
  DURATION_CEILING_MS,
} as const;
