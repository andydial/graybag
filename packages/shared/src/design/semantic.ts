/**
 * The semantic role map (E13-01). Specified by `docs/design-tokens.md` §2.9.
 *
 * **This is the only colour module a component may import.** Decision `S7`: components
 * reference roles (`bg.surface`, `text.price`, `action.primaryBg`), never ramp steps
 * (`primary[700]`). Two things depend on that discipline and neither survives without it
 * — a dark theme stays a second mapping file rather than a rewrite (`DS-03`), and the
 * contrast test in `E13-13` can walk the whole surface of the product's colour, because
 * a component reaching past this file into a ramp would escape it.
 *
 * Seven of these values moved one step darker under `E13-17`, and the reason is worth
 * carrying: **an ink is chosen against the darkest surface it may legitimately sit on,
 * never against white** (decision `S16`). `neutral[500]`, `danger[600]` and `amber[700]`
 * were each picked by measuring against `neutral[0]`, each passed there, and each failed
 * somewhere real — a placeholder's home is inside an input on `neutral[100]` (4.2280),
 * error text's home is the banner it exists to pair with (4.4441), warning text lands on
 * the muted fill (4.4057). That is one mistake made three times.
 *
 * Ratios in the comments below are WCAG 2.1 relative-luminance calculations against the
 * stated background. They are asserted in CI (`E13-13`) against the declared pair list in
 * §9.1 of the token document; **if the test disagrees with a comment here, the test is
 * right.** Comparisons there are at full float precision with `>=` — four ratios in this
 * system have been wrong because they were rounded to two places before being judged
 * (decision `S20`).
 */

import { amber, danger, forest, lime, neutral, primary, scrim } from './color.js';

/** Surfaces. */
export const bg = {
  /** The app background. */
  canvas: neutral[50],
  /** Cards, sheets, rows. */
  surface: neutral[0],
  /** Inputs, image placeholders, skeletons. */
  surfaceMuted: neutral[100],
  /**
   * A green field carrying **controls and large text only**. White on it is 3.85 — which
   * clears the 3:1 control-boundary and large-text bars and nothing else. Body text on
   * this surface is forbidden; use `surfaceBrandStrong`.
   */
  surfaceBrand: primary[600],
  /**
   * A green field carrying **body text**. White on it is 5.19. Added by `E13-17` because
   * the role map previously had no legal body-text colour for any green surface, which is
   * a hole rather than a tuning problem. Introduces no new colour — it is the same green
   * as `action.primaryBg`.
   */
  surfaceBrandStrong: primary[700],
  /** A green field carrying **only** the logo. Logotypes are exempt from WCAG 1.4.3. */
  surfaceBrandFlat: primary[500],
  /** Dark band — mock 05's "2.5 km" strip. */
  surfaceInverse: forest[500],
  /**
   * Brand-assigned (§2.11): light UI surface — card, container, table/chart ground.
   * 1.27:1 against `surface`, so it is a **fill and never a boundary**: a tappable card
   * on this ground still needs `border.strong` or a control inside it.
   */
  surfaceAccent: lime[200],
  /** Warning banner / allergen notice. */
  surfaceWarning: amber[100],
  /** Error banner. */
  surfaceDanger: danger[50],
  /** Behind sheets and dialogs. */
  scrim,
} as const;

/** Ink. */
export const text = {
  /** 14.24–18.07 across every surface it may land on. */
  primary: neutral[900],
  /**
   * Captions, metadata, helper text. Was `neutral[600]`; moved down by `E13-17` so
   * tertiary could take `neutral[600]` and the ladder keeps three visible steps.
   * 8.09–10.27.
   */
  secondary: neutral[700],
  /**
   * Placeholder, timestamps, inactive tab. Was `neutral[500]`, which is 4.2280 on
   * `bg.surfaceMuted` — the role's commonest home, inside an input — and 4.4969 on
   * `bg.canvas`. 5.01–6.35 on every surface it may legitimately land on.
   */
  tertiary: neutral[600],
  /**
   * Exempt from contrast rules under WCAG 1.4.3. **Not an excuse elsewhere:** §2.10
   * still applies, so a disabled state is never conveyed by dimness alone, and the
   * contrast test asserts this role is absent from both of its pair lists so that "it's
   * disabled" cannot be argued into a low ratio somewhere else.
   */
  disabled: neutral[400],
  /**
   * White, and only on `bg.surfaceBrandStrong` (5.19), `bg.surfaceInverse` (7.61) or
   * darker. **Not on `bg.surfaceBrand`** — 3.85 there is legal for large text and control
   * boundaries and illegal for body text.
   */
  onBrand: neutral[0],
  /** Always also underlined or in a pressable shape. See `onAccent` / `onTonal`. */
  link: primary[700],
  /** Tabular figures — §3.5. Same substitutions as `link`. */
  price: primary[700],
  /**
   * Substitute for `link` and `price` on `bg.surfaceAccent`: `primary[700]` is 4.09
   * there and fails. `forest[500]` is 6.00. A price is the most likely thing to be
   * dropped onto a tinted card, so this is the substitution most likely to be needed.
   */
  onAccent: forest[500],
  /**
   * Substitute for `link` and `price` on `action.secondaryBg`: `primary[700]` on
   * `primary[100]` is 4.4734, which prints as 4.47 and reads as a pass. 8.68.
   */
  onTonal: primary[900],
  /**
   * The only legal ink on brand amber (§2.4): 7.40. `forest[500]` — the pair the brand
   * guidelines themselves recommend under "Text on yellow/light backgrounds" — is
   * **4.4994** and misses AA by six ten-thousandths.
   */
  onAmber: forest[700],
  /**
   * Was `danger[600]`, which is 4.4441 on the banner fill it exists to pair with and
   * 4.27 on `bg.surfaceMuted`. 5.18–6.57 everywhere error text appears.
   */
  danger: danger[700],
  /** Was `amber[700]`, which is 4.4057 on `bg.surfaceMuted`. 5.50–6.97. */
  warning: amber[800],
} as const;

/** Boundaries. */
export const border = {
  /** Decorative dividers. */
  subtle: neutral[300],
  /**
   * **Decorative-weight outlines only, and this is enforced rather than advised.** 2.28
   * on `bg.surface`, against the 3:1 WCAG 1.4.11 needs. An input or card outline that is
   * the only thing marking a control boundary uses `strong`. `E13-13` asserts this as a
   * forbidden control boundary so the rule cannot decay into a code-review habit.
   */
  default: neutral[400],
  /**
   * The correct token for input and card outlines — the boundary of a component that
   * carries no other visible affordance. 4.79 on `bg.surface`, 4.4969 on `bg.canvas`,
   * both clear of the 3:1 bar.
   */
  strong: neutral[500],
  /** Selected / active outline. 3.85 on `bg.surface`. */
  brand: primary[600],
  /**
   * Brand-assigned (§2.11): "soft separator in digital layouts". **Decorative only** —
   * 1.27 on white, so it can never be the boundary of a control.
   */
  accent: lime[200],
  danger: danger[600],
} as const;

/** Actions. */
export const action = {
  primaryBg: primary[700],
  primaryBgPressed: primary[800],
  primaryFg: neutral[0],
  /** Tonal button — the mock-08 "Change" pill. */
  secondaryBg: primary[100],
  /**
   * 8.68 on `secondaryBg`. This was always right, which is why the tonal *button* was
   * never a failing pair and `text.price` on the same fill was: they had different inks
   * for the same background.
   */
  secondaryFg: primary[900],
  destructiveBg: danger[600],
  destructiveFg: neutral[0],
  disabledBg: neutral[200],
  disabledFg: neutral[400],
} as const;

/**
 * Navigation. Brand-assigned (§2.11) — the guidelines put `#145F48` on "Secondary UI
 * elements (tabs, toggles, footers)", which is why the active tab is forest rather than
 * the grey a token file would otherwise reach for.
 */
export const nav = {
  /** Active tab, active toggle track, footer ink. 7.61 on `surface`, 7.15 on `canvas`. */
  itemActive: forest[500],
  /**
   * Follows `text.tertiary` down (`E13-17`) — a tab bar sits on the canvas as often as on
   * a surface, and `neutral[500]` is 4.4969 there. Stays a grey so the active state is
   * the only coloured one.
   */
  itemInactive: neutral[600],
} as const;

/**
 * Badges. Brand-assigned (§2.11): "UI highlights (notifications, badges)".
 *
 * Two constraints, neither optional. `amber[500]` on white is 1.69, so a badge is a
 * **shape with content in it and never an outline** — its own edge is invisible. And
 * §2.10 applies with full force: a bare amber dot meaning "something needs attention"
 * conveys meaning by colour alone, so a badge carries a number, a glyph, or at minimum
 * an accessibility label.
 */
export const badge = { bg: amber[500], fg: neutral[900] } as const;

/** 2px, 2px offset, plus a 1px `neutral[0]` inner ring so it survives on green. */
export const focus = { ring: primary[700] } as const;

/**
 * Status. **No blue is introduced** — informational is forest.
 *
 * §2.10 is not optional here: green means good and red means error is the single worst
 * pair for deuteranopia, which is roughly 6% of Indian men. Every status carries an icon
 * and a word as well as a colour.
 */
export const status = {
  success: primary[700],
  warning: amber[800],
  danger: danger[700],
  info: forest[500],
} as const;

/**
 * The veg / egg / non-veg mark — `E21`, and the one part of the palette the brand package does
 * not supply, because the nine reference screens are a generic delivery template and none of
 * them has one.
 *
 * In India this is the **first thing** a parent looks at on a menu, and the convention is not
 * ours to reinterpret: a filled dot inside a square outline, green for vegetarian, amber-brown
 * for egg, dark red for non-vegetarian. Deviating would not read as design, it would read as a
 * mistake — or worse, be misread.
 *
 * These are darker than the brand ramp's mid steps on purpose: the mark is a small dot on a
 * photograph, so it needs contrast against food, not against white.
 */
export const foodType = {
  veg: primary[800],
  egg: amber[800],
  nonVeg: danger[700],
} as const;

export const semantic = { bg, text, border, action, nav, badge, focus, status, foodType } as const;

export type SemanticRoles = typeof semantic;
