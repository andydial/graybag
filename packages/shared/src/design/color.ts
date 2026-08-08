/**
 * Colour ramps (E13-01). Specified by `docs/design-tokens.md` §2.2–§2.8.
 *
 * **No component imports this file.** Components import `semantic.ts`, which maps these
 * steps to roles. That indirection is decision `S7`, and it is what makes a future dark
 * mode a second mapping file rather than a rewrite (`DS-03`) — and what makes the
 * contrast test possible at all, because the test walks the role map and a component
 * reaching directly into a ramp would escape it.
 *
 * Five of these values are the brand, taken from `00_Graybag_Brand Guidelines.pdf` and
 * asserted against it in `color.test.ts`:
 *
 *   primary[500]  #00af52  Fresh Lunch Green
 *   amber[500]    #ffbb39  Sunlit Snack Yellow
 *   forest[500]   #145f48  Deep Tiffin Green
 *   lime[500]     #b3cf3f  Citrus Zest Green
 *   lime[200]     #e5ea98  Light Lemon Mist
 *
 * Everything else is this repo's invention. The brand document specifies no tints, no
 * tonal steps and no neutral ramp (`E13-15`), so the ramps below stand on their own
 * authority — they are not a transcription of anything and must not be treated as one.
 *
 * **The 500 rule (§2.1, decision `S6`).** `primary[500]`, `amber[500]`, `lime[500]` and
 * `lime[200]` are identity colours, not ink. White on `primary[500]` is 2.90:1, which
 * fails every WCAG bar including the 3:1 a control boundary needs. Functional green is
 * one or two steps darker. This is pending Andy's approval as `DS-01` / `E13-14`, and it
 * is a deviation from the brand guideline's own Colour Usage Guide, which assigns
 * `#00AF52` to "Buttons & CTAs in UI".
 */

/**
 * Primary — nutritious green. Shades are a straight multiply of the brand hex so the hue
 * is preserved exactly; tints are a white mix.
 */
export const primary = {
  50: '#f0faf5',
  100: '#dbf4e7',
  200: '#b3e7cb',
  300: '#73d3a0',
  400: '#38c178',
  /** Brand. Identity only — never ink (§2.1). */
  500: '#00af52',
  600: '#009646',
  700: '#007e3b',
  800: '#006630',
  900: '#004d24',
} as const;

/**
 * Secondary — forest. Not a step on the primary ramp: a distinctly cooler, bluer green,
 * and the palette's only brand hue that is legible with white straight out of the box
 * (7.61:1). The brand assigns it to text on light/yellow grounds and to secondary UI —
 * tabs, toggles, footers.
 */
export const forest = {
  100: '#dee9e5',
  200: '#b9cfc8',
  /** Brand. */
  500: '#145f48',
  600: '#104c3a',
  700: '#0c3b2d',
  800: '#092b20',
} as const;

/**
 * Secondary — amber.
 *
 * `700` is deliberately **not** a text token: it is 4.4057 on `neutral[100]` and fails
 * AA on the muted surface where warning text actually lands (`E13-17`). Warning ink is
 * `800`.
 */
export const amber = {
  100: '#fff3db',
  200: '#ffe4b0',
  300: '#ffcf74',
  /** Brand. Identity/fill only — 1.69:1 on white, so a badge is a shape with content in
   * it and never an outline. */
  500: '#ffbb39',
  700: '#8f6920',
  800: '#73541a',
} as const;

/**
 * Accent — lime. Surfaces and graphic fills. **Neither step ever colours text.**
 *
 * `200` is the brand's "light UI surface (cards, containers)" and "soft separator".
 * `500` is confined by the brand to "tiny details, not large blocks", which is the same
 * instruction §2.5 reaches from contrast.
 */
export const lime = {
  /** Brand. */
  200: '#e5ea98',
  /** Brand. */
  500: '#b3cf3f',
} as const;

/**
 * Neutrals. Not in the source package — proposed here as a very slightly green-tinted
 * grey, green channel one or two steps above red and blue. A pure `#808080`-family grey
 * next to a saturated green reads faintly magenta; this sits down beside the brand
 * instead of fighting it, and the tint is small enough that nobody will call it green.
 *
 * `500` is **not an ink token** (`E13-17`). It was chosen by measuring against white,
 * where it passes at 4.79, and it is 4.2280 on `100` — the muted surface a placeholder
 * actually sits on. It survives as `border.strong`, where the bar is 3:1.
 */
export const neutral = {
  0: '#ffffff',
  50: '#f7f8f7',
  100: '#f0f1f0',
  200: '#e4e6e4',
  300: '#d2d5d2',
  400: '#a8ada8',
  500: '#6e746e',
  600: '#5b615b',
  700: '#3d423d',
  800: '#262a26',
  900: '#141714',
} as const;

/**
 * Semantic — error. The package has no red; `06_App UI` uses the iOS system red as a
 * stand-in rather than a decision.
 *
 * `600` passes 4.5:1 in **both** directions on white, so one token covers a white label
 * on a destructive button and the button's own boundary. It is **not** the text token:
 * on the `danger[50]` banner it exists to pair with it is 4.4441 (`E13-17`).
 */
export const danger = {
  50: '#fef3f2',
  200: '#fecdca',
  600: '#d92d20',
  700: '#b42318',
} as const;

/** Behind sheets and dialogs. The only non-hex colour value in the system. */
export const scrim = 'rgba(20, 23, 20, 0.48)' as const;

/**
 * The five approved logo-on-colour pairings (§2.6), fixed by
 * `Colour Palette_Guideline.png` and reproduced identically in the brand guidelines.
 *
 * These are **brand rules, not accessibility rules, and they are not negotiable.** Any
 * field colour not listed here takes the full-colour logo on white, or the white logo.
 * The logo is never recoloured to a tonal step — there is no `primary[700]` logo.
 */
export const logoOnColor = {
  '#00af52': 'white',
  '#b3cf3f': '#145f48',
  '#145f48': '#b3cf3f',
  '#ffbb39': 'white',
  '#e5ea98': '#145f48',
} as const;

export const color = { primary, forest, amber, lime, neutral, danger, scrim } as const;

export type ColorRamps = typeof color;
