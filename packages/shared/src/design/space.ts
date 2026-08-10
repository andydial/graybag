/**
 * Spacing, touch targets and breakpoints (E13-01). Specified by
 * `docs/design-tokens.md` §4.
 *
 * 4-point base. The scale is deliberately short — **every gap in the product is one of
 * these**, and a scale with a value for every eventuality is not a scale.
 */

export const space = {
  0: 0,
  px: 1,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * Layout rules, so the scale is applied consistently rather than merely available. A
 * scale without these is a palette of numbers and produces the same drift as no scale
 * at all.
 */
export const layout = {
  /** Screen gutter, mobile. */
  gutter: space[4],
  /** Screen gutter, ≥768. */
  gutterWide: space[6],
  /** Web container max width. */
  containerMaxWidth: 1200,
  containerGutter: space[8],
  /** Between unrelated sections. */
  sectionGap: space[6],
  /** Between related blocks. */
  blockGap: space[3],
  /** Within a block — label to field. */
  fieldGap: space[2],
  cardPadding: space[4],
  /** Plus the safe-area inset at the bottom. */
  sheetPadding: space[5],
  /** Gives a 48+ row against `bodySm`. */
  listRowPaddingY: space[3],
  /** Menu, 2-up. */
  gridGutter: space[3],
  /**
   * Space above a sticky CTA. The scroll container gets matching bottom padding so the
   * last item is never hidden behind it — the failure this exists to prevent is silent
   * and only shows up at the end of a long list.
   */
  stickyCtaGap: space[4],
} as const;

/**
 * **48 × 48 minimum, everywhere, on both platforms** — the stricter of iOS's 44 and
 * Android's 48dp, taken once rather than per-platform.
 *
 * Visual size and target size are separate concerns, and the quantity stepper is the
 * standard case where they differ: the `−`/`+` circles draw at roughly 28pt in mocks 07
 * and 09, and the *visual* circle stays at 28 while the **touch area is extended to 48
 * with `hitSlop`**. Same for the favourite heart and the notification bell.
 */
export const touchTarget = {
  min: 48,
  /** Minimum gap between adjacent targets. */
  minGap: space[2],
  /**
   * The stepper, heart, bell and **checkbox** draw at this and are hit-slopped — or, in the
   * checkbox's case, wrapped in a `min`-height row — out to `min`.
   *
   * The checkbox joined the list in `E05-01` rather than getting a size of its own: it is
   * the same case the other three are, a small visual affordance inside a full-size target,
   * and a fourteenth number would say it was a different one.
   */
  visualSmall: 28,
} as const;

/** Web only. The mobile app has one width class and does not use these. */
export const breakpoint = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;

export const spacing = { space, layout, touchTarget, breakpoint } as const;

export type SpaceToken = keyof typeof space;
