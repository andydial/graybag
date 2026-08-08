/**
 * WCAG 2.1 contrast, and the declared pair lists the CI test walks (E13-13). Specified by
 * `docs/design-tokens.md` §9 and §9.1.
 *
 * **The test cannot be a cross-product of inks against surfaces.** Walking one produces 78
 * "failures", almost all meaningless — white text on the white surface, a focus ring on
 * the dark band, `text.tertiary` on a green field no grey ink ever touches. A test that
 * flags those is a test somebody switches off, and then it protects nothing. So the pairs
 * are **declared**: anything not in `LEGAL_PAIRS` is not a legal combination, and adding a
 * row is a deliberate act with a ratio attached (decision `S19`).
 *
 * `FORBIDDEN_PAIRS` matters as much as the legal list. A test that only checks the legal
 * pairs never notices when somebody adds an illegal one, and every entry there is a
 * combination a component would plausibly reach for — the price token on a card, a border
 * called "default" used as a boundary, the ink the brand guidelines themselves recommend.
 *
 * **Comparisons are at full float precision with `>=`** (decision `S20`). Four ratios in
 * this system have been wrong because they were rounded to two places before being judged:
 * `forest[600]` on `primary[600]` (`E13-16`), then `forest[500]` on `amber[500]` at
 * 4.4994, `neutral[500]` on `neutral[50]` at 4.4969, and `primary[700]` on `primary[100]`
 * at 4.4734. Every one of them prints as a pass.
 */

import { action, badge, bg, border, focus, nav, text } from './semantic.js';
import { amber, forest, neutral } from './color.js';

/** The two bars WCAG 2.1 sets that this system uses. */
export const BAR = {
  /** 1.4.3 — normal-size text. */
  bodyText: 4.5,
  /**
   * 1.4.3 for large text (≥18.66px bold / 24px), and 1.4.11 for a non-text UI boundary.
   * The same number for two different reasons, which is why it has one name here.
   */
  largeTextOrBoundary: 3,
} as const;

function channelLuminance(component: number): number {
  const v = component / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) {
    throw new Error(`relativeLuminance expects #rrggbb, received ${JSON.stringify(hex)}`);
  }
  const body = match[1];
  const r = channelLuminance(parseInt(body.slice(0, 2), 16));
  const g = channelLuminance(parseInt(body.slice(2, 4), 16));
  const b = channelLuminance(parseInt(body.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio, 1..21. Order-independent, as the specification defines it.
 *
 * Returned at full precision on purpose. **Do not round before comparing** — round for
 * display only.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface Pair {
  /** `group.role`, for the failure message. */
  readonly fg: string;
  readonly fgValue: string;
  readonly bg: string;
  readonly bgValue: string;
  readonly bar: number;
  /** Why this pair exists, or — for a forbidden pair — why it is tempting. */
  readonly note: string;
}

const p = (
  fg: string,
  fgValue: string,
  bgName: string,
  bgValue: string,
  bar: number,
  note: string,
): Pair => ({ fg, fgValue, bg: bgName, bgValue, bar, note });

type Surface = readonly [name: string, value: string];

/** The light surfaces any ink may legitimately land on. */
const LIGHT_SURFACES: readonly Surface[] = [
  ['bg.canvas', bg.canvas],
  ['bg.surface', bg.surface],
  ['bg.surfaceMuted', bg.surfaceMuted],
  ['bg.surfaceAccent', bg.surfaceAccent],
];

/** The two untinted ones, for roles that take a substitute on a tinted fill. */
const PLAIN_SURFACES: readonly Surface[] = LIGHT_SURFACES.slice(0, 2);
/** Untinted plus the muted input fill. */
const PLAIN_AND_MUTED: readonly Surface[] = LIGHT_SURFACES.slice(0, 3);

const on = (
  fg: string,
  fgValue: string,
  bar: number,
  note: string,
  surfaces: readonly Surface[] = LIGHT_SURFACES,
): Pair[] => surfaces.map(([bgName, bgValue]) => p(fg, fgValue, bgName, bgValue, bar, note));

/**
 * §9.1's declared list. Each of these is asserted to **pass** its bar.
 *
 * A row removed from here is a combination that stops being checked, which is why the
 * count is asserted too — a silent shrink looks identical to a passing suite.
 */
export const LEGAL_PAIRS: readonly Pair[] = [
  ...on('text.primary', text.primary, BAR.bodyText, 'Body copy and headings, everywhere'),
  ...on('text.secondary', text.secondary, BAR.bodyText, 'Captions, metadata, helper text'),
  ...on('text.tertiary', text.tertiary, BAR.bodyText, 'Placeholder text and timestamps'),
  ...on('text.danger', text.danger, BAR.bodyText, 'Error text, including inside its own banner', [
    ...LIGHT_SURFACES,
    ['bg.surfaceDanger', bg.surfaceDanger],
  ]),
  ...on(
    'text.warning',
    text.warning,
    BAR.bodyText,
    'Warning text, including inside its own banner',
    [...LIGHT_SURFACES, ['bg.surfaceWarning', bg.surfaceWarning]],
  ),
  // Link and price take a substitute on the two tinted fills, so their base pairs stop at
  // the three untinted surfaces. The substitutes are the three rows after them.
  ...on('text.link', text.link, BAR.bodyText, 'Links on an untinted surface', PLAIN_AND_MUTED),
  ...on('text.price', text.price, BAR.bodyText, 'Prices — §3.5 tabular figures', PLAIN_AND_MUTED),
  p('text.onAccent', text.onAccent, 'bg.surfaceAccent', bg.surfaceAccent, BAR.bodyText,
    'Substitute for link/price on a lime card — primary[700] is 4.09 there'),
  p('text.onTonal', text.onTonal, 'action.secondaryBg', action.secondaryBg, BAR.bodyText,
    'Substitute for link/price on the tonal fill — primary[700] is 4.4734 there'),
  p('text.onAmber', text.onAmber, 'amber[500]', amber[500], BAR.bodyText,
    'The only legal ink on brand amber — forest[500] is 4.4994'),

  p('text.onBrand', text.onBrand, 'bg.surfaceBrandStrong', bg.surfaceBrandStrong, BAR.bodyText,
    'White on the green field that carries body text'),
  p('text.onBrand', text.onBrand, 'bg.surfaceInverse', bg.surfaceInverse, BAR.bodyText,
    'White on the forest band'),
  p('text.onBrand', text.onBrand, 'bg.surfaceBrand', bg.surfaceBrand, BAR.largeTextOrBoundary,
    'Large text and controls only — body text on this surface is forbidden below'),

  p('action.primaryFg', action.primaryFg, 'action.primaryBg', action.primaryBg, BAR.bodyText,
    'Primary button label'),
  p('action.primaryFg', action.primaryFg, 'action.primaryBgPressed', action.primaryBgPressed,
    BAR.bodyText, 'Primary button label, pressed'),
  p('action.secondaryFg', action.secondaryFg, 'action.secondaryBg', action.secondaryBg,
    BAR.bodyText, 'Tonal button label'),
  p('action.destructiveFg', action.destructiveFg, 'action.destructiveBg', action.destructiveBg,
    BAR.bodyText, 'Destructive button label'),

  ...on('nav.itemActive', nav.itemActive, BAR.bodyText,
    'Active tab, toggle track and footer ink', PLAIN_SURFACES),
  ...on('nav.itemInactive', nav.itemInactive, BAR.bodyText,
    'Inactive tab — a tab bar sits on the canvas as often as on a surface', PLAIN_SURFACES),
  p('badge.fg', badge.fg, 'badge.bg', badge.bg, BAR.bodyText,
    'The count inside a badge — a badge is a shape with content in it'),

  ...on('border.strong', border.strong, BAR.largeTextOrBoundary,
    'Input and card outlines — the boundary of a control with no other affordance',
    PLAIN_SURFACES),
  ...on('border.brand', border.brand, BAR.largeTextOrBoundary,
    'Selected / active outline', PLAIN_SURFACES),
  ...on('border.danger', border.danger, BAR.largeTextOrBoundary,
    'Outline of a field in an error state', PLAIN_SURFACES),
  ...on('focus.ring', focus.ring, BAR.largeTextOrBoundary,
    'Focus indicator — 2px, 2px offset, with a 1px white inner ring', PLAIN_AND_MUTED),
  p('forest[700]', forest[700], 'bg.surfaceBrand', bg.surfaceBrand, BAR.largeTextOrBoundary,
    'A control on a brand field — §2.3, and the substitution E13-16 corrected'),
];

/**
 * Asserted to **keep failing**. Every one is a combination a component would plausibly
 * reach for, and several have already been written down as correct at some point.
 */
export const FORBIDDEN_PAIRS: readonly Pair[] = [
  p('text.link', text.link, 'bg.surfaceAccent', bg.surfaceAccent, BAR.bodyText,
    'It is the link token and that is a card'),
  p('text.price', text.price, 'bg.surfaceAccent', bg.surfaceAccent, BAR.bodyText,
    'It is the price token and that is a card'),
  p('text.price', text.price, 'action.secondaryBg', action.secondaryBg, BAR.bodyText,
    'Prints as 4.47 and looks fine'),
  p('forest[500]', forest[500], 'amber[500]', amber[500], BAR.bodyText,
    'The brand guidelines recommend exactly this pair — 4.4994'),
  p('text.onBrand (body)', text.onBrand, 'bg.surfaceBrand', bg.surfaceBrand, BAR.bodyText,
    'surfaceBrand is named as the surface that carries things'),
  p('border.default', border.default, 'bg.surface', bg.surface, BAR.largeTextOrBoundary,
    'It is called "default"'),
  p('border.accent', border.accent, 'bg.surface', bg.surface, BAR.largeTextOrBoundary,
    'The brand calls it a separator'),
  p('badge.bg (as an outline)', badge.bg, 'bg.surface', bg.surface, BAR.largeTextOrBoundary,
    'A badge looks like it has an edge'),
  p('neutral[500] (as ink)', neutral[500], 'bg.surfaceMuted', bg.surfaceMuted, BAR.bodyText,
    'It passes on white, which is where it will be checked'),
];

/**
 * Roles exempt from contrast under WCAG 1.4.3, asserted **absent** from both lists so that
 * "it's disabled" never becomes an argument for a low ratio somewhere else.
 *
 * **Named by role, not by value, and that distinction is load-bearing.** `text.disabled`,
 * `action.disabledFg` and `border.default` are all `neutral[400]`; only the first two are
 * exempt. `border.default` is in `FORBIDDEN_PAIRS` precisely because it is *not* — it is a
 * decorative outline that a component will reach for as a control boundary. Matching on
 * the hex would have quietly exempted it, which is the same shape of mistake as choosing
 * an ink against white: the value looks identical and the role is not.
 */
export const EXEMPT_ROLES: readonly string[] = ['text.disabled', 'action.disabledFg'];

/** The values behind `EXEMPT_ROLES`, for callers that only have a colour in hand. */
export const EXEMPT_VALUES: readonly string[] = [text.disabled, action.disabledFg];
