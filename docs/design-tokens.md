---
title: Design tokens
status: specification — no code exists yet
produced_by: Q05
implements: E13-01 (and the contrast half of E13-08)
source: Legacy-Application/Graybag_Design Package — 02_Colour Palette, 00_Assests/Font, 05_Pattern, 06_App UI
companion: docs/motion-system.md
---

> ## Read this first
>
> **The brand palette as supplied does not pass WCAG AA for text or controls.** White text on
> `#00af52` measures **2.90:1** — it fails AA for normal text (4.5:1), fails AA for large text
> (3:1), and fails the 3:1 non-text-contrast rule for a control boundary. Every primary button
> in `06_App UI` uses exactly that pair, as does every price, every field label and the
> "Delivery to School" card.
>
> This document does **not** change the brand. `#00af52` stays the identity colour. It adds a
> tonal ramp around it and one rule — **§2.1, "the 500 rule"** — that puts functional green one
> or two steps darker than identity green. The mocks stay recognisable; they become legible.
>
> This needs Andy's eye once, because it changes what every button looks like:
> **`[DS-01]`** in `docs/open-questions.md`, task `E13-14`.

# GrayBag — design tokens

Colour, type, spacing, radius, elevation and the rest, as one set of named values shared by
`apps/mobile` and `apps/web`. Written before any UI code exists so that the first component
built consumes tokens rather than literals.

**Nothing in the codebase may contain a colour literal, a font size, a spacing value or a
radius that is not from this file.** That is a lint rule (`E13-11`), not a convention — the
same discipline as the `api/` module rule (A4) and for the same reason: a literal is how a
system stops being a system.

**Where this file and `docs/motion-system.md` disagree about a duration or an easing curve,
the motion system is right and this file is a bug.** Motion tokens live there, not here.

---

## §1 What the source package actually contains

| Path in `Graybag_Design Package` | What it gives us |
|---|---|
| `02_Colour Palette/` | Five hexes, as folder-named files: primary `#00af52`; secondary `#145f48`, `#ffbb39`; accent `#b3cf3f`, `#e5ea98` |
| `02_Colour Palette/Colour Palette_Guideline.png` | Five **approved logo-on-colour pairings** — see §2.6 |
| `00_Assests/Font/` | VAG Rounded Next, ten weights: Thin, ExtraLight, Light, Regular, Medium, SemiBold, Bold, Heavy, Black, ExtraBlack |
| `01_Graybag_Logo/` | Wordmark and icon, in full colour / white / black, transparent and filled |
| `05_Pattern/` | A tone-on-tone vegetable pattern in six colourways (Green, Dark Green, Yellow, Grey, Dark Grey, Colourful) |
| `06_App UI/*.png` | Nine screens: splash, onboarding, sign-in, account-complete, home, menu, dish detail sheet, location, cart |

**What it does not contain, and which this file therefore has to invent:** a neutral/grey
ramp, tonal steps around any brand hue, semantic roles (error, warning, disabled, focus), a
type scale, a spacing scale, a radius scale, elevation, and any contrast analysis. Those are
proposals, marked as such where the choice was not forced.

**`00_Graybag_Brand Guidelines.pdf` could not be read** — it exceeds the 20MB file-read limit
and no PDF rasteriser was available in this sandbox. If it specifies a type scale, tints or
tonal steps, this file must be reconciled against it. That check is `E13-15`.

---

## §2 Colour

### §2.1 The 500 rule

> **`primary-500 #00af52`, `amber-500 #ffbb39`, `lime-500 #b3cf3f` and `lime-200 #e5ea98` are
> identity colours, not ink.** They appear in the logo, the pattern, illustration, and
> full-bleed brand fields that carry no text and no controls. **Nothing legible sits on them,
> and they never colour text, icons, borders or focus rings.**
>
> Every *functional* use of a brand hue is one or more steps darker: `primary-600` for a
> boundary or a large-text surface, `primary-700` for anything carrying body text or white
> text, `amber-700` for warning text, `forest-600` for a control on a green field.

Two consequences worth stating plainly, because they contradict the mocks:

- The primary button fill is **`primary-700 #007e3b`** (white on it: 5.19:1), not `#00af52`.
- The price, the field label, the "Featured" tab and the "Sign Up" link are **`primary-700`**,
  not `#00af52`.

The splash screen (`01.png`) is the one screen that may keep a full `primary-500` field,
because the only thing on it is the logotype, and logotypes are exempt from WCAG 1.4.3. The
moment a control lands on that field — `02.png` — the field becomes `primary-600 #009646`.

### §2.2 Primary — nutritious green

Shades are a straight multiply of the brand hex, so the hue is preserved exactly; tints are a
white mix.

| Token | Hex | On white | White on it | Role |
|---|---|---|---|---|
| `primary-50` | `#f0faf5` | — | — | Tinted surface, selected list row |
| `primary-100` | `#dbf4e7` | — | — | Success/selected chip fill, "Change" pill (mock 08) |
| `primary-200` | `#b3e7cb` | — | — | Illustration, chart fill |
| `primary-300` | `#73d3a0` | — | — | Illustration only |
| `primary-400` | `#38c178` | — | — | Illustration only |
| **`primary-500`** | **`#00af52`** | 2.90 ✗ | 2.90 ✗ | **Identity only — logo, pattern, brand field. Never ink (§2.1)** |
| `primary-600` | `#009646` | 3.85 ✓³ | 3.85 ✓³ | Control boundary, icon, brand field that carries controls |
| **`primary-700`** | **`#007e3b`** | **5.19 ✓** | **5.19 ✓** | **Primary button fill, link, price, emphasis text, focus ring** |
| `primary-800` | `#006630` | 7.14 ✓✓ | 7.14 ✓✓ | Pressed state of a `primary-700` fill |
| `primary-900` | `#004d24` | 10.06 ✓✓ | — | Text on a `primary-100` surface |

✓ = passes AA (4.5:1) for normal text. ✓³ = passes only the 3:1 bar (large text ≥18.66px bold
/ 24px, and non-text UI boundaries). ✓✓ = passes AAA (7:1). ✗ = fails everything.

### §2.3 Secondary — forest

`#145f48` is *not* a step on the primary ramp. It is a distinctly cooler, bluer green and it is
the palette's workhorse for dark surfaces, because unlike the primary it is legible with white
straight out of the box.

| Token | Hex | On white | White on it | Role |
|---|---|---|---|---|
| `forest-100` | `#dee9e5` | — | — | Muted surface, table header |
| `forest-200` | `#b9cfc8` | — | — | Divider on a forest surface |
| **`forest-500`** | **`#145f48`** | 7.61 ✓✓ | 7.61 ✓✓ | Dark surface, secondary text emphasis, header band (mock 05) |
| `forest-600` | `#104c3a` | — | 9.92 ✓✓ | Secondary button on a green field (mock 02 "Get Started") |
| `forest-700` | `#0c3b2d` | — | 12.51 ✓✓ | Pressed state, deepest brand surface |
| `forest-800` | `#092b20` | — | — | Illustration shadow |

Mock 02 puts a `#145f48` button on a `#00af52` field: **2.63:1**, below the 3:1 a control
boundary needs. `forest-600` on `primary-600` is **3.25:1** and passes. That single pair of
substitutions is the whole fix for that screen.

### §2.4 Secondary — amber

| Token | Hex | On white | Neutral-900 on it | Role |
|---|---|---|---|---|
| `amber-100` | `#fff3db` | — | — | Warning banner fill, allergen-notice surface |
| `amber-200` | `#ffe4b0` | — | — | Warning banner border |
| `amber-300` | `#ffcf74` | — | — | Illustration |
| **`amber-500`** | **`#ffbb39`** | 1.69 ✗ | 10.68 ✓✓ | **Identity/fill only (§2.1).** Highlight band, pattern colourway |
| `amber-700` | `#8f6920` | 4.99 ✓ | — | Warning **text** and warning icon |
| `amber-800` | `#73541a` | 6.97 ✓ | — | Warning text on an `amber-100` surface |

`forest-500` on `amber-500` is **4.50:1** and is the one text-on-amber pair that passes. Use
it for the rare case where copy must sit on the brand amber.

### §2.5 Accent — lime

Accents are surfaces and graphic fills. **Neither lime ever colours text.**

| Token | Hex | Neutral-900 on it | `forest-500` on it | Role |
|---|---|---|---|---|
| `lime-200` | `#e5ea98` | 14.24 ✓✓ | 6.00 ✓✓ | Pale highlight surface, empty-state illustration ground |
| `lime-500` | `#b3cf3f` | 10.25 ✓✓ | 4.32 ✓³ | Accent fill, pattern colourway, category tag |

### §2.6 The approved logo-on-colour pairings

`Colour Palette_Guideline.png` fixes five and only five lockup treatments. These are brand
rules, not accessibility rules, and they are not negotiable:

| Field | Logo colour |
|---|---|
| `primary-500 #00af52` | White |
| `lime-500 #b3cf3f` | `forest-500 #145f48` |
| `forest-500 #145f48` | `lime-500 #b3cf3f` |
| `amber-500 #ffbb39` | White |
| `lime-200 #e5ea98` | `forest-500 #145f48` |

Any other field colour takes the full-colour logo on white, or the white logo, per
`01_Graybag_Logo/`. **The logo is never recoloured to a tonal step** — no `primary-700` logo.

### §2.7 Neutrals

Not in the source package. Proposed: a **very slightly green-tinted grey** — green channel one
or two steps above red and blue. It reads as neutral next to anything, but sits down beside the
brand green instead of fighting it. (A pure `#808080`-family grey next to a saturated green
reads faintly magenta.) The tint is small enough that nobody will call it green.

| Token | Hex | On white | Role |
|---|---|---|---|
| `neutral-0` | `#ffffff` | — | Card surface, sheet surface, page background |
| `neutral-50` | `#f7f8f7` | — | App background behind cards |
| `neutral-100` | `#f0f1f0` | — | Input fill, image placeholder, skeleton base |
| `neutral-200` | `#e4e6e4` | — | Hairline on a tinted surface, skeleton edge |
| `neutral-300` | `#d2d5d2` | 1.48 | Divider, input border (decorative weight) |
| `neutral-400` | `#a8ada8` | 2.28 | **Disabled** text and icons only — exempt from contrast rules |
| `neutral-500` | `#6e746e` | 4.79 ✓ | Placeholder text, tertiary text, inactive tab icon |
| `neutral-600` | `#5b615b` | 6.35 ✓✓ | Secondary text — captions, metadata, helper text |
| `neutral-700` | `#3d423d` | 10.27 ✓✓ | Body text on a tinted surface |
| `neutral-800` | `#262a26` | 14.56 ✓✓ | Headings |
| `neutral-900` | `#141714` | 18.06 ✓✓ | Primary text |

The mocks use `#b0b0b0`-ish placeholders (roughly 2.4:1). `neutral-500` is the darkest grey
that still reads as "placeholder"; anything lighter fails, and a placeholder is content.

### §2.8 Semantic — error

The package has no red. `06_App UI` uses the iOS system red for the favourite heart and the
notification dot, which is a stand-in rather than a decision.

| Token | Hex | On white | White on it | Role |
|---|---|---|---|---|
| `danger-50` | `#fef3f2` | — | — | Error banner fill |
| `danger-200` | `#fecdca` | — | — | Error banner border |
| **`danger-600`** | **`#d92d20`** | 4.83 ✓ | 4.83 ✓ | Error text, destructive button fill, required-field marker |
| `danger-700` | `#b42318` | 6.63 ✓ | 6.63 ✓ | Pressed destructive |

`#d92d20` is deliberately chosen to pass 4.5:1 in **both** directions, so one token covers
error text on white and a white label on a destructive button.

### §2.9 Semantic roles

The component layer references **only** this table. It never reaches for a ramp step directly.
This is what makes a dark theme a new mapping file rather than a rewrite (`[DS-03]`).

| Role token | Value | Notes |
|---|---|---|
| `bg.canvas` | `neutral-50` | The app background |
| `bg.surface` | `neutral-0` | Cards, sheets, rows |
| `bg.surfaceMuted` | `neutral-100` | Inputs, image placeholders, skeletons |
| `bg.surfaceBrand` | `primary-600` | A green field that carries controls |
| `bg.surfaceBrandFlat` | `primary-500` | A green field that carries **only** the logo |
| `bg.surfaceInverse` | `forest-500` | Dark band (mock 05's "2.5 km" strip) |
| `bg.scrim` | `rgba(20, 23, 20, 0.48)` | Behind sheets and dialogs |
| `text.primary` | `neutral-900` | |
| `text.secondary` | `neutral-600` | |
| `text.tertiary` | `neutral-500` | Placeholder, timestamps |
| `text.disabled` | `neutral-400` | |
| `text.onBrand` | `neutral-0` | White, and only on `primary-700`+ or `forest-500`+ |
| `text.link` | `primary-700` | Always also underlined or in a pressable shape |
| `text.price` | `primary-700` | Tabular figures — §3.5 |
| `text.danger` | `danger-600` | |
| `text.warning` | `amber-700` | |
| `border.subtle` | `neutral-300` | Decorative dividers |
| `border.default` | `neutral-400` | Input and card outlines |
| `border.strong` | `neutral-500` | Outlined control that must meet 3:1 |
| `border.brand` | `primary-600` | Selected / active outline |
| `border.danger` | `danger-600` | |
| `action.primaryBg` | `primary-700` | |
| `action.primaryBgPressed` | `primary-800` | |
| `action.primaryFg` | `neutral-0` | |
| `action.secondaryBg` | `primary-100` | Tonal button, the mock-08 "Change" pill |
| `action.secondaryFg` | `primary-900` | |
| `action.destructiveBg` | `danger-600` | |
| `action.disabledBg` | `neutral-200` | |
| `action.disabledFg` | `neutral-400` | |
| `focus.ring` | `primary-700` | 2px, 2px offset, plus a 1px `neutral-0` inner ring |
| `status.success` | `primary-700` | |
| `status.warning` | `amber-700` | |
| `status.danger` | `danger-600` | |
| `status.info` | `forest-500` | **No blue is introduced.** Informational = forest |

### §2.10 Colour never carries meaning alone

Non-negotiable, and it has two specific teeth in this product:

1. **Green means "good/price" and red means "error"** — the single worst pair for deuteranopia,
   which is ~6% of Indian men. Every status must also carry an icon and a word. A green tick, a
   red cross, the literal text "Cancelled".
2. **Veg / non-veg markers (`DM-17`) are a statutory symbol, not a brand element.** If GrayBag
   must display the FSSAI green-circle / brown-triangle mark, it is displayed in the prescribed
   colours and the prescribed geometry, and is *not* re-tinted to `primary-500` or `lime-500`.
   Whether an e-commerce food operator must show it at the point of ordering is a legal
   question, raised in `docs/open-questions.md`.

---

## §3 Type

### §3.1 The family, and the fact that it is not settled

**VAG Rounded Next.** Ten weights are in the package. **The licence has not been checked**
(`E19-03`, `owner:andy`) and a bad answer changes every screen. Two things follow:

- **Use three weights, not ten.** That narrows the licence question to "may we embed three
  weights in a mobile app and serve them as webfonts", which is a much easier thing to buy or
  to be refused, and it keeps the mobile bundle small — the real constraint is network (P11).
- **Name the substitute now, not in a panic.** Recommended: **Nunito** (SIL OFL) — a rounded
  geometric sans, the closest freely-licensed match to VAG Rounded's rounded terminals on an
  upright skeleton, with the full weight range and good hinting at small sizes. Alternatives
  considered and rejected in `[DS-02]`.

| Token | VAG Rounded Next | Nunito fallback | Weight |
|---|---|---|---|
| `font.regular` | Regular | Nunito Regular | 400 |
| `font.semibold` | SemiBold | Nunito SemiBold | 600 |
| `font.bold` | Bold | Nunito Bold | 700 |

Runtime stack while a webfont loads, and on the app's first cold start:

```
"VAG Rounded Next", Nunito, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif
```

Web uses `font-display: swap` with a metric-adjusted fallback (`size-adjust`) so the swap does
not reflow. Mobile bundles the three weights; it never fetches a font at runtime.

English only (P10) — no Devanagari coverage is required, which removes the main reason the
rounded-sans field is thin.

### §3.2 The scale

Mobile-first, in points/CSS pixels. Line heights are all even numbers so they land on the
4-point grid.

| Token | Size | Line height | Weight | Tracking | Used for |
|---|---|---|---|---|---|
| `display` | 32 | 38 | 700 | −0.02em | Marketing hero, one per page |
| `h1` | 28 | 34 | 700 | −0.015em | Screen title on a scrolled-away large header |
| `h2` | 22 | 28 | 700 | −0.01em | "welcome back", "Made Specially for your Child" |
| `h3` | 18 | 24 | 600 | −0.005em | Section heading, sheet title, dish name |
| `bodyLg` | 17 | 26 | 400 | 0 | Long-form copy — policies, T&Cs |
| `body` | 16 | 24 | 400 | 0 | Default |
| `bodyStrong` | 16 | 24 | 600 | 0 | Emphasis inside body |
| `bodySm` | 14 | 20 | 400 | 0 | Dense lists, table cells |
| `label` | 13 | 16 | 600 | +0.01em | Field labels, button labels ≤ small size |
| `button` | 16 | 20 | 600 | +0.01em | Default button label |
| `caption` | 12 | 16 | 400 | +0.01em | Metadata, helper text, timestamps |
| `overline` | 11 | 14 | 600 | +0.08em | Uppercase eyebrow — "Our Food" (mock 06) |

**12 is the floor.** Nothing in the product is smaller, including legal text and table cells.
The audience is parents, largely 30–50; the mocks' 11–12pt greys are already at the limit.

### §3.3 The brand's lowercase habit

The wordmark, the onboarding headline ("education meets convenience") and the sign-in headline
("welcome back") are all set lowercase. That is a **brand voice device for marketing-register
headlines only**. Functional UI — button labels, field labels, screen titles, error messages,
anything a screen reader announces as an instruction — uses sentence case. Lowercase is allowed
on `display` and `h2` in onboarding and marketing, nowhere else.

`overline` is the only uppercase style, and it carries `+0.08em` tracking because uppercase at
11pt without tracking is unreadable.

### §3.4 Dynamic type

Text scales with the OS setting. It is capped, because an uncapped 200% on a two-line button
label destroys the layout on a 360dp Android.

| Style group | `maxFontSizeMultiplier` |
|---|---|
| `bodyLg`, `body`, `bodySm`, `caption` | 1.6 |
| `h1`–`h3`, `display` | 1.3 |
| `button`, `label`, `overline` | 1.3 |
| Tab bar labels | 1.2 |

Every container that holds scaling text is height-flexible; nothing is a fixed-height box with
text in it. Web uses `rem` throughout with a `16px` root and never sets a `px` font size.

### §3.5 Numerals

**All money renders with tabular figures.** `fontVariant: ['tabular-nums']` on RN,
`font-variant-numeric: tabular-nums` on web. A cart where `Rs. 249` and `Rs. 1,199` do not
align in a column looks broken, and this is the money-facing product.

Money is integer paise everywhere in the code (non-negotiable #3); a single shared formatter
turns paise into a display string. Neither the formatter's output nor a currency symbol is ever
hand-assembled in a component.

---

## §4 Spacing

4-point base. The scale is deliberately short — every gap in the product is one of these.

| Token | Value |
|---|---|
| `space-0` | 0 |
| `space-px` | 1 |
| `space-0.5` | 2 |
| `space-1` | 4 |
| `space-2` | 8 |
| `space-3` | 12 |
| `space-4` | 16 |
| `space-5` | 20 |
| `space-6` | 24 |
| `space-8` | 32 |
| `space-10` | 40 |
| `space-12` | 48 |
| `space-16` | 64 |

Layout rules, so the scale is applied consistently rather than merely available:

| Rule | Value |
|---|---|
| Screen gutter, mobile | `space-4` (16) |
| Screen gutter, ≥768 | `space-6` (24) |
| Web container max width | 1200, gutters `space-8` |
| Between unrelated sections | `space-6` (24) |
| Between related blocks | `space-3` (12) |
| Within a block (label → field) | `space-2` (8) |
| Card padding | `space-4` (16) |
| Sheet padding | `space-5` (20), plus the safe-area inset at the bottom |
| List row vertical padding | `space-3` (12), giving a 48+ row |
| Grid gutter (menu, 2-up) | `space-3` (12) |
| Space above a sticky CTA | `space-4`, and the scroll container gets matching bottom padding so the last item is never hidden behind it |

### §4.1 Touch targets

**48 × 48 minimum**, everywhere, on both platforms — the stricter of iOS's 44 and Android's
48dp, taken once rather than per-platform. Minimum 8pt between adjacent targets.

The mocks' quantity stepper (`−` / `+`, mock 07 and 09) draws at roughly 28pt. The *visual*
circle stays at 28; the **touch area is extended to 48 with `hitSlop`**. Visual size and target
size are separate concerns and this is the standard case where they differ. Same for the
favourite heart and the notification bell.

Breakpoints (web only): `sm 480`, `md 768`, `lg 1024`, `xl 1280`.

---

## §5 Radius

The logo is rounded, the typeface is rounded, and the mocks are pill-heavy. Generous radii are
on-brand here in a way they would not be elsewhere.

| Token | Value | Used for |
|---|---|---|
| `radius-none` | 0 | Full-bleed images, table cells |
| `radius-xs` | 4 | Tag, allergen pill, badge dot |
| `radius-sm` | 8 | Small control, inner element of a card |
| `radius-md` | 12 | List row, image thumbnail, segmented control |
| `radius-lg` | 16 | Card, image inside a card, banner |
| `radius-xl` | 24 | Bottom sheet top corners, dialog, hero card |
| `radius-2xl` | 32 | Marketing feature panel |
| `radius-full` | 9999 | Button, chip, avatar, input, badge, FAB |

Two rules:

- **Radius never exceeds half the shorter side.** A 32-tall element cannot have `radius-xl`;
  it gets `radius-full` or `radius-md`.
- **Nested radius = outer radius − padding.** A `radius-lg` (16) card with `space-4` (16)
  padding holds a `radius-none` image; with `space-2` (8) padding it holds a `radius-sm` (8)
  image. Concentric corners, not parallel ones.

Buttons and inputs are `radius-full`. That is the strongest single carrier of the brand's
personality in the UI and it is consistent across all nine mocks.

---

## §6 Elevation

The mocks are almost flat: cards are distinguished by **fill** (`neutral-100` on `neutral-0`),
not by shadow. Keep that. It is also the cheapest thing to render on a mid-range Android, where
overlapping shadows are a measurable cost.

| Token | Shadow | Used for |
|---|---|---|
| `elevation-0` | none | **Default.** Cards, rows, sections — differentiated by fill |
| `elevation-1` | `0 1px 2px rgba(20,23,20,0.06)` | Header or bottom bar, **only once content has scrolled beneath it** |
| `elevation-2` | `0 -2px 16px rgba(20,23,20,0.12)` | Bottom sheet (shadow points up), dialog (`0 4px 24px`) |
| `elevation-3` | `0 8px 24px rgba(20,23,20,0.16)` | Toast, dropdown, tooltip |

**A shadow means "this floats above the page".** It is never decoration. An element that does
not overlap other content has no shadow.

On React Native, `elevation-1`+ must set both the iOS `shadow*` props and the Android
`elevation` prop; Android below API 28 ignores `shadowColor`, so the shade is chosen to look
right as the platform's default black.

Z-index: `content 0`, `stickyHeader 10`, `tabBar 20`, `scrim 30`, `sheet 40`, `dialog 50`,
`toast 60`.

Opacity: there is exactly one opacity token, `opacity-pressed 0.92` (§M01 of the motion
system). **Disabled states use the disabled colour tokens, never an opacity** — dimming text
with opacity silently destroys its contrast ratio and is invisible in review.

---

## §7 Borders and icons

Border widths: `border-hairline 1`, `border-default 1`, `border-emphasis 2` (selected state and
focus ring). Nothing is 3.

Focus indicator: `2px solid primary-700`, `2px` offset, with a `1px neutral-0` inner ring so it
stays visible on both light and green surfaces. **`outline: none` without a replacement is a CI
failure** (`E13-10`). Mobile shows it for keyboard and switch-control users, not on touch.

Icons: sizes `16 / 20 / 24 / 32`; 24 is the default and the only size in the tab bar. Stroke
`1.75` at 20–24, `2` at 32. Recommended set: **Lucide** (ISC licence, first-class React and
React Native packages, a consistent 24px/2px grid) — it matches the outline style already in
the mocks, and the bottom tab bar's active state is a fill, not a different icon.

Every icon that is not accompanied by a visible label carries an accessibility label. An icon
that conveys state carries the state in the label ("Cart, 2 items"), not in its colour.

---

## §8 Where the tokens live

```
packages/shared/src/design/
  color.ts        ramps (§2.2–§2.8) — no component imports this
  semantic.ts     the §2.9 role map — this is what components import
  type.ts         family, weights, scale, dynamic-type caps
  space.ts        spacing, touch targets, breakpoints
  radius.ts
  elevation.ts
  index.ts
```

`docs/motion-system.md`'s tokens sit alongside as `motion.ts` and are the subject of their own
lint rule.

Consumption:

- **`apps/mobile`** imports the objects directly and feeds them to a single `theme` provider.
- **`apps/web`** generates CSS custom properties from the same modules at build time, so there
  is one source and no hand-copied hex.

**One source, two outputs, no third.** A Figma file, if one appears, is downstream of this
directory, not upstream of it.

---

## §9 Testing the tokens

Three things are asserted in CI, because all three fail silently otherwise:

1. **Contrast.** A unit test walks the §2.9 role map plus a declared list of legitimate
   foreground/background pairs, computes the WCAG 2.1 ratio, and asserts the minimum stated in
   this file. A future brand refresh that lightens a green then fails the build instead of
   shipping. (`E13-13`)
2. **No literals.** A lint rule fails on any hex, `rgb(`, `rgba(`, numeric `fontSize`, numeric
   `borderRadius` or raw spacing number outside `packages/shared/src/design/`. (`E13-11`)
3. **Axe / Lighthouse accessibility budgets** on both the app and the web build, as gates, not
   as a one-off review. (`E13-10`, `E12-08`)

All the ratios quoted in this document are WCAG 2.1 relative-luminance calculations against
the stated background, computed while writing it. They are reproducible by the test in (1);
if the test disagrees with a number here, the test is right and this file is a bug.

---

## §10 Open questions

Full options and reasoning are in `docs/open-questions.md`. Summarised:

| Q | Question | Written here as |
|---|---|---|
| `DS-01` | The brand green fails contrast as a button fill. Darken functional green to `primary-700`, or keep `#00af52` and use dark text on buttons? | Darken — the 500 rule (§2.1). **Needs Andy's eye once** |
| `DS-02` | If the VAG Rounded Next licence (`E19-03`) says no, which typeface? | Nunito |
| `DS-03` | Dark mode in v1? | No — light only, but every colour is named by role (§2.9) so it stays a mapping file |
| `DS-04` | Must the FSSAI veg / non-veg mark be displayed at the point of ordering? | Tokens reserve the statutory colours; the mark is not brand-tinted (§2.10) |
