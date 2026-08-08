/**
 * Radius tokens (E13-01). Specified by `docs/design-tokens.md` §5.
 *
 * The logo is rounded, the typeface is rounded, and the mocks are pill-heavy. Generous
 * radii are on-brand here in a way they would not be elsewhere — and the brand document
 * makes it a rule rather than an inference: *"Rounded corners are a key part of GrayBag's
 * visual identity… All graphic elements — including containers, image frames, and
 * backgrounds — should use soft, rounded edges."* The page's single ✗ example is a
 * square-cornered rectangle.
 *
 * It gives no numbers, so the scale below is this repo's (`E13-15` established that the
 * brand specifies no radius values). What the brand did change is `none` — see below,
 * and decision `S15`.
 */

export const radius = {
  /**
   * **Only where there is no visible corner to round**: an image or fill that bleeds off
   * every edge of the viewport, a divider, the interior of a table cell.
   *
   * A container, an image frame or a background **with a visible corner is never
   * `none`**. A hero image whose bottom edge lands inside the layout is an image frame
   * and gets `lg`.
   */
  none: 0,
  /** Tag, allergen pill, badge dot. */
  xs: 4,
  /** Small control, inner element of a card. */
  sm: 8,
  /** List row, image thumbnail, segmented control. */
  md: 12,
  /** Card, image inside a card, banner. */
  lg: 16,
  /** Bottom sheet top corners, dialog, hero card. */
  xl: 24,
  /** Marketing feature panel. */
  '2xl': 32,
  /**
   * Button, chip, avatar, input, badge, FAB. This is the strongest single carrier of the
   * brand's personality in the UI and it is consistent across all nine mocks.
   */
  full: 9999,
} as const;

/**
 * **Radius never exceeds half the shorter side.** A 32-tall element cannot have `xl`; it
 * gets `full` or `md`. Returns the largest legal token value for a given height.
 */
export function clampRadius(value: number, shorterSide: number): number {
  const half = shorterSide / 2;
  return value > half ? half : value;
}

/**
 * **Nested radius = outer radius − padding.** Concentric corners, not parallel ones.
 *
 * A `lg` (16) card with `space[4]` (16) padding holds a `none` image; with `space[2]` (8)
 * padding it holds an `sm` (8) image. Getting this wrong is the difference between a card
 * that looks drawn and one that looks assembled, and it is invisible in a spec and
 * obvious on a screen.
 */
export function nestedRadius(outer: number, padding: number): number {
  const inner = outer - padding;
  return inner < 0 ? 0 : inner;
}

export type RadiusToken = keyof typeof radius;
