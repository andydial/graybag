/**
 * Design tokens (E13-01) — one set of named values shared by `apps/mobile` and
 * `apps/web`. Written before any UI code exists so that the first component built
 * consumes tokens rather than literals.
 *
 * **Nothing in the codebase may contain a colour literal, a font size, a spacing value or
 * a radius that is not from this directory.** That is a lint rule (`E13-11`), not a
 * convention — the same discipline as the `api/` module rule (A4) and for the same
 * reason: a literal is how a system stops being a system.
 *
 * **One source, two outputs, no third** (decision `S8`). `apps/mobile` imports these
 * objects and feeds them to a single theme provider; `apps/web` generates CSS custom
 * properties from the same modules at build time. A Figma file, if one appears, is
 * downstream of this directory, not upstream of it.
 *
 * Motion tokens are **not** here. They live in `motion.ts` (`E13-12`) and are specified
 * by `docs/motion-system.md`, which wins over `docs/design-tokens.md` wherever the two
 * disagree about a duration or an easing curve.
 *
 * The specification: `docs/design-tokens.md`. Where this code and that document
 * disagree, one of them is a bug and neither is automatically right — but the ratios in
 * §9.1 are asserted in CI (`E13-13`), so for colour the test settles it.
 */

export { color, logoOnColor, primary, forest, amber, lime, neutral, danger, scrim } from './color.js';
export type { ColorRamps } from './color.js';

export { semantic, bg, text, border, action, nav, badge, focus, status } from './semantic.js';
export type { SemanticRoles } from './semantic.js';

export {
  typography,
  font,
  fontStack,
  scale,
  brandTypeBands,
  maxFontSizeMultiplier,
  tabularNums,
  MIN_FONT_SIZE,
} from './type.js';
export type { TypeScale, TypeToken } from './type.js';

export { spacing, space, layout, touchTarget, breakpoint } from './space.js';
export type { SpaceToken } from './space.js';

export { radius, clampRadius, nestedRadius } from './radius.js';
export type { RadiusToken } from './radius.js';

export {
  elevation,
  dialogShadow,
  zIndex,
  opacity,
  borderWidth,
  focusRing,
  icon,
} from './elevation.js';
export type { ElevationToken, ZIndexToken } from './elevation.js';
