/**
 * Elevation, z-index, opacity and borders (E13-01). Specified by
 * `docs/design-tokens.md` §6 and §7.
 *
 * The mocks are almost flat: cards are distinguished by **fill** (`neutral[100]` on
 * `neutral[0]`), not by shadow. That is kept, and it is also the cheapest thing to render
 * on a mid-range Android, where overlapping shadows are a measurable cost.
 *
 * **A shadow means "this floats above the page".** It is never decoration. An element
 * that does not overlap other content has no shadow.
 */

export const elevation = {
  /** **Default.** Cards, rows, sections — differentiated by fill. */
  0: { web: 'none', ios: null, android: 0 },
  /** Header or bottom bar, **only once content has scrolled beneath it**. */
  1: {
    web: '0 1px 2px rgba(20,23,20,0.06)',
    ios: { shadowColor: '#141714', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    android: 1,
  },
  /** Bottom sheet — the shadow points up. */
  2: {
    web: '0 -2px 16px rgba(20,23,20,0.12)',
    ios: { shadowColor: '#141714', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -2 } },
    android: 8,
  },
  /** Toast, dropdown, tooltip. */
  3: {
    web: '0 8px 24px rgba(20,23,20,0.16)',
    ios: { shadowColor: '#141714', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
    android: 16,
  },
} as const;

/**
 * Dialogs sit at `elevation[2]`'s depth but their shadow points down rather than up, so
 * they carry their own web value rather than reusing the sheet's.
 */
export const dialogShadow = '0 4px 24px rgba(20,23,20,0.12)' as const;

/**
 * On React Native, `elevation[1]`+ must set **both** the iOS `shadow*` props and the
 * Android `elevation` prop. Android below API 28 ignores `shadowColor`, so the shade is
 * chosen to look right as the platform's default black.
 */
export const zIndex = {
  content: 0,
  stickyHeader: 10,
  tabBar: 20,
  scrim: 30,
  sheet: 40,
  dialog: 50,
  toast: 60,
} as const;

/**
 * There is exactly one opacity token, and it belongs to `M01` of the motion system.
 *
 * **Disabled states use the disabled colour tokens, never an opacity.** Dimming text with
 * opacity silently destroys its contrast ratio, and it is invisible in review because the
 * token it resolves to still looks correct in the source.
 */
export const opacity = { pressed: 0.92 } as const;

/** Border widths. Nothing is 3. */
export const borderWidth = { hairline: 1, default: 1, emphasis: 2 } as const;

/**
 * Focus indicator: 2px solid `focus.ring`, 2px offset, with a 1px `neutral[0]` inner ring
 * so it stays visible on both light and green surfaces.
 *
 * **`outline: none` without a replacement is a CI failure** (`E13-10`). Mobile shows it
 * for keyboard and switch-control users, not on touch.
 */
export const focusRing = { width: 2, offset: 2, innerWidth: 1 } as const;

/**
 * Icons. Recommended set: **Lucide** (ISC licence, first-class React and React Native
 * packages, a consistent 24px/2px grid) — it matches the outline style already in the
 * mocks, and the bottom tab bar's active state is a fill rather than a different icon.
 *
 * Every icon not accompanied by a visible label carries an accessibility label, and an
 * icon that conveys state carries the state in the label ("Cart, 2 items") rather than in
 * its colour (§2.10).
 */
export const icon = {
  size: { sm: 16, md: 20, /** Default, and the only size in the tab bar. */ lg: 24, xl: 32 },
  stroke: { default: 1.75, large: 2 },
} as const;

export type ElevationToken = keyof typeof elevation;
export type ZIndexToken = keyof typeof zIndex;
