/**
 * Type tokens (E13-01). Specified by `docs/design-tokens.md` §3.
 *
 * The scale is **derived from the brand's four-level hierarchy**, not merely checked
 * against it (decision `S12`). `00_Graybag_Brand Guidelines.pdf` specifies:
 *
 *   Main Heading  Semi Bold  48–32 pt
 *   Heading       Semi Bold  32–28 pt
 *   Subheading    Medium     24–20 pt
 *   Body          Regular    16–12 pt
 *
 * Those are bands. Mobile lives at the bottom of each — a 48pt heading on a 360dp
 * Android is a marketing artefact, not a screen title — so the ladder is 32 / 28 / 24 /
 * 20 with body at 16–12. Every entry sits inside a band at the band's weight, and
 * `type.test.ts` asserts that rather than trusting it.
 *
 * **There is no Bold in the product** (decision `S13`). The brand's hierarchy uses Semi
 * Bold for both heading levels and Medium for subheadings; Bold appears in the specimen
 * and in none of the four levels. The bundle is still three weights, so `E19-03`'s
 * licence question is the same size — only the filenames differ.
 */

/**
 * The family, and the fact that it is not settled.
 *
 * The VAG Rounded Next licence has never been checked (`E19-03`, `owner:andy`) and a bad
 * answer changes every screen. Two consequences, both already taken: bundle three weights
 * rather than ten, which narrows the question to something buyable or refusable; and name
 * the substitute now rather than in a panic (`DS-02`).
 */
export const font = {
  /** Body. */
  regular: { family: 'VAG Rounded Next', fallback: 'Nunito', weight: 400 },
  /** Subheading. */
  medium: { family: 'VAG Rounded Next', fallback: 'Nunito', weight: 500 },
  /** Main Heading and Heading. */
  semibold: { family: 'VAG Rounded Next', fallback: 'Nunito', weight: 600 },
} as const;

/**
 * Runtime stack while a webfont loads, and on the app's first cold start.
 *
 * Web uses `font-display: swap` with a metric-adjusted fallback (`size-adjust`) so the
 * swap does not reflow. Mobile bundles the three weights and never fetches a font at
 * runtime — the constraint is network (P11).
 */
export const fontStack =
  '"VAG Rounded Next", Nunito, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif' as const;

/**
 * The scale, mobile-first, in points/CSS pixels. Line heights are all even so they land
 * on the 4-point grid.
 *
 * `label` and `button` carry weight 600 although they sit in the Body band, where the
 * brand says Regular. They are not editorial text — they are UI chrome at 13 and 16
 * points, small type needs mass to read at a glance on a mid-range phone in daylight, and
 * the brand hierarchy has no row for a button. It is the one place this scale extends the
 * brand rather than following it, and it extends it only into a case the brand does not
 * cover.
 */
export const scale = {
  /** Marketing hero, one per page. Main Heading band, at its floor. */
  display: { size: 32, lineHeight: 38, weight: 600, tracking: -0.02 },
  /** Screen title on a scrolled-away large header. Heading band, at its floor. */
  h1: { size: 28, lineHeight: 34, weight: 600, tracking: -0.015 },
  /** "welcome back", "Made Specially for your Child". Subheading band, at its ceiling. */
  h2: { size: 24, lineHeight: 30, weight: 500, tracking: -0.01 },
  /** Section heading, sheet title, dish name. Subheading band, at its floor. */
  h3: { size: 20, lineHeight: 26, weight: 500, tracking: -0.005 },
  /**
   * Long-form copy — policies, T&Cs. Same size as `body`, looser leading: the
   * distinction was always leading rather than size, and 17 sat in the brand's
   * unspecified 20–16 gap.
   */
  bodyLg: { size: 16, lineHeight: 26, weight: 400, tracking: 0 },
  body: { size: 16, lineHeight: 24, weight: 400, tracking: 0 },
  bodyStrong: { size: 16, lineHeight: 24, weight: 500, tracking: 0 },
  /** Dense lists, table cells. */
  bodySm: { size: 14, lineHeight: 20, weight: 400, tracking: 0 },
  /** Field labels, button labels at small size. */
  label: { size: 13, lineHeight: 16, weight: 600, tracking: 0.01 },
  button: { size: 16, lineHeight: 20, weight: 600, tracking: 0.01 },
  /** Metadata, helper text, timestamps. */
  caption: { size: 12, lineHeight: 16, weight: 400, tracking: 0.01 },
  /**
   * The only uppercase style — "Our Food" (mock 06). Was 12→11 and moved back to 12 by
   * `E13-15`: below the brand's floor, and below this system's own stated floor, which
   * §3.2 had asserted one line above an 11pt token. The `+0.08em` tracking is not
   * decoration; uppercase at 12pt without it is unreadable.
   */
  overline: { size: 12, lineHeight: 16, weight: 600, tracking: 0.08 },
} as const;

/**
 * **12 is the floor.** Nothing in the product is smaller, including legal text and table
 * cells. The audience is parents, largely 30–50, and the mocks' 11–12pt greys were
 * already at the limit. Asserted in `type.test.ts`.
 */
export const MIN_FONT_SIZE = 12 as const;

/** The brand's bands, kept here so the test asserts against the source rather than a copy. */
export const brandTypeBands = {
  mainHeading: { min: 32, max: 48, weight: 600 },
  heading: { min: 28, max: 32, weight: 600 },
  subheading: { min: 20, max: 24, weight: 500 },
  body: { min: 12, max: 16, weight: 400 },
} as const;

/**
 * Dynamic type. Text scales with the OS setting, and it is capped — an uncapped 200% on a
 * two-line button label destroys the layout on a 360dp Android.
 *
 * Every container holding scaling text is height-flexible; nothing is a fixed-height box
 * with text in it. Web uses `rem` throughout with a 16px root and never sets a `px` font
 * size.
 */
export const maxFontSizeMultiplier = {
  bodyLg: 1.6,
  body: 1.6,
  bodyStrong: 1.6,
  bodySm: 1.6,
  caption: 1.6,
  display: 1.3,
  h1: 1.3,
  h2: 1.3,
  h3: 1.3,
  button: 1.3,
  label: 1.3,
  overline: 1.3,
  tabBarLabel: 1.2,
} as const;

/**
 * **All money renders with tabular figures.** `fontVariant: ['tabular-nums']` on RN,
 * `font-variant-numeric: tabular-nums` on web.
 *
 * A cart where `Rs. 249` and `Rs. 1,199` do not align in a column looks broken, and this
 * is the money-facing product. Money is integer paise everywhere in the code
 * (non-negotiable #3); a single shared formatter turns paise into a display string, and
 * neither its output nor a currency symbol is ever hand-assembled in a component.
 */
export const tabularNums = true as const;

export const typography = {
  font,
  fontStack,
  scale,
  maxFontSizeMultiplier,
  tabularNums,
} as const;

export type TypeScale = typeof scale;
export type TypeToken = keyof TypeScale;
