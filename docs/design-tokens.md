---
title: Design tokens
status: reconciled against the brand guidelines (E13-15, 2026-08-09) — no code exists yet
produced_by: Q05
specifies: E13-01 (the code is still to be written) and the contrast half of E13-08
source: ../Legacy-Application/Graybag_Design Package — 00_Graybag_Brand Guidelines.pdf, 02_Colour Palette, 00_Assests/Font, 05_Pattern, 06_App UI (not in this repo; see docs/decisions.md)
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
> **`00_Graybag_Brand Guidelines.pdf` has now been read in full** (`E13-15`, 2026-08-09) and
> this file is reconciled against it. The brand document raised the stakes on one point rather
> than settling it: its Colour Usage Guide assigns `#00AF52` to **"Buttons & CTAs in UI"** in as
> many words. The 500 rule is therefore a **documented deviation from the brand guideline**, not
> merely a correction of the mocks — and that is precisely what `[DS-01]` / `E13-14` asks Andy
> to approve. Everything else the brand document specifies has been adopted; what changed is
> listed in §0.

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

## §0 What the brand-guidelines reconciliation changed (`E13-15`, 2026-08-09)

The rule going in was: **where the brand document specifies something, it wins.** It specifies
a type hierarchy, per-colour UI usage rules, and a geometry rule. It specifies **no tints, no
tonal steps, no neutral ramp, no spacing or radius numbers and no contrast analysis** — so
§2.2–§2.8's ramps, §4, §5 and §6 stand on this file's own authority, which is what `DS-05` was
waiting to learn.

| # | The brand document says | This file said | Now |
|---|---|---|---|
| 1 | Headings are **Semi Bold**, subheadings **Medium**, body **Regular** | `display`/`h1`/`h2` at **700 Bold**, `h3` at 600 | Weights follow the brand: 600 / 600 / 500 / 500. **Bold 700 is dropped from the bundle**; the three weights are Regular 400, Medium 500, SemiBold 600 (§3.1) |
| 2 | Body copy is **16–12 pt**; subheadings **24–20 pt** | `h3` 18, `bodyLg` 17, `overline` 11 | 18 and 17 fell in the brand's 20–16 gap and 11 below its floor. `h3` → 20, `bodyLg` → 16 with looser leading, `overline` → 12 (§3.2). This also removes a self-contradiction: §3.2 already said "12 is the floor" and then set `overline` to 11 |
| 3 | `#00AF52` is for **"Buttons & CTAs in UI"** | Buttons are `primary-700` (§2.1) | **Unresolved on purpose.** The conflict is now with the brand guideline itself, not just the mocks, and it is escalated in `[DS-01]` / `E13-14`. Nothing changes here until Andy rules |
| 4 | `#145F48` is for **text on yellow/light backgrounds** and **secondary UI (tabs, toggles, footers)** | `forest-500` was a dark-surface colour only | Adopted as a role — §2.11, and `nav.*` in §2.9 |
| 5 | `#E5EA98` is for **light UI surfaces (cards, containers)**, **soft separators**, **table/chart backgrounds** | `lime-200` was "pale highlight surface, illustration ground" | Adopted — `bg.surfaceAccent` and `border.accent` (§2.9, §2.11) |
| 6 | `#FFBB39` is for **UI highlights (notifications, badges)**; `#B3CF3F` for **decorative UI micro-interactions** | Amber was "highlight band"; lime "category tag" | Adopted, with the §2.10 teeth: a badge that carries meaning carries a number or a word, never colour alone (§2.11) |
| 7 | **All containers, image frames and backgrounds use rounded edges** — the square-cornered rectangle is the explicit ✗ | `radius-none` was allowed on full-bleed images and table cells | `radius-none` is restricted to elements that have no visible corner (§5) |
| 8 | The **monochrome** pattern is the variant for "App screens and digital layouts" | §1 listed six colourways with no in-app rule | The full-colour pattern is packaging and marketing only; in-product it is monochrome (§1) |
| 9 | Five logo-on-colour pairings | §2.6 | **Confirmed exactly** — no change |
| 10 | The five hexes | §1 | **Confirmed exactly**, including RGB and CMYK — no change |

---

## §1 What the source package actually contains

| Path in `Graybag_Design Package` | What it gives us |
|---|---|
| `00_Graybag_Brand Guidelines.pdf` | 40 pages. Brand essence, logo system, the five colours with RGB/CMYK, the **Colour Usage Guide** (§2.11), **Typography** and **Hierarchy** (§3), **Shapes & Geometry** (§5), and the pattern's two variants |
| `02_Colour Palette/` | Five hexes, as folder-named files: primary `#00af52`; secondary `#145f48`, `#ffbb39`; accent `#b3cf3f`, `#e5ea98` |
| `02_Colour Palette/Colour Palette_Guideline.png` | Five **approved logo-on-colour pairings** — see §2.6 |
| `00_Assests/Font/` | VAG Rounded Next, ten weights: Thin, ExtraLight, Light, Regular, Medium, SemiBold, Bold, Heavy, Black, ExtraBlack. The guidelines show eight of them; only three are bundled (§3.1) |
| `01_Graybag_Logo/` | Wordmark and icon, in full colour / white / black, transparent and filled |
| `05_Pattern/` | A tone-on-tone vegetable pattern in six colourways (Green, Dark Green, Yellow, Grey, Dark Grey, Colourful) |
| `06_App UI/*.png` | Nine screens: splash, onboarding, sign-in, account-complete, home, menu, dish detail sheet, location, cart |

The brand's official colour names, for talking to a designer: `#00AF52` **Fresh Lunch Green**,
`#FFBB39` **Sunlit Snack Yellow**, `#145F48` **Deep Tiffin Green**, `#B3CF3F` **Citrus Zest
Green**, `#E5EA98` **Light Lemon Mist**. The token names below are functional and stay
functional — a ramp step cannot be called "Fresh Lunch Green" when there are ten of them.

**The pattern has two variants and they are not interchangeable.** Full-colour is for
packaging, delivery bags, posters, social and presentation covers. **Monochrome is the variant
the brand document assigns to "App screens and digital layouts"** — so in the product, the
pattern is monochrome, tone-on-tone, and behind nothing that has to be read.

**What the package does not contain, and which this file therefore has to invent:** a
neutral/grey ramp, tonal steps around any brand hue, semantic roles (error, warning, disabled,
focus), a spacing scale, a radius scale, elevation, and any contrast analysis. The brand
document was read in full for `E13-15` and specifies none of them; those parts of this file are
its own, and are marked as proposals where the choice was not forced. The **type scale is no
longer** in that list — the brand specifies a hierarchy, and §3.2 is derived from it.

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

**This rule contradicts the brand guideline in writing, and that has to be said out loud.** The
Colour Usage Guide lists, under `#00AF52`: "Buttons & CTAs in UI". The 500 rule says the button
fill is `primary-700`. Both cannot hold. The reason to propose breaking the brand rule rather
than the accessibility one is that the brand document contains no contrast analysis at all — it
was written for packaging, presentations and social, where "Buttons & CTAs in UI" is one line
among nine and nothing on the page had to survive WCAG 1.4.3. The reason it is **not** settled
here is that it is Andy's brand, the change is visible on every screen, and `E13-15`'s mandate
was to reconcile, not to overrule. See `[DS-01]`, `E13-14`.

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

The brand document goes further than this file originally did: it assigns Deep Tiffin Green to
**"Text on yellow/light backgrounds"** and **"Secondary UI elements (tabs, toggles, footers)"**,
and calls it suitable for headings. That is adopted — `forest-500` is the ink for the tab bar,
switches and the web footer (§2.11), not a grey. It measures 7.61:1 on `neutral-0` and 7.15:1 on
`neutral-50`, so it clears AAA on both app surfaces and needs no darker step to be legal.

| Token | Hex | On white | White on it | Role |
|---|---|---|---|---|
| `forest-100` | `#dee9e5` | — | — | Muted surface, table header |
| `forest-200` | `#b9cfc8` | — | — | Divider on a forest surface |
| **`forest-500`** | **`#145f48`** | 7.61 ✓✓ | 7.61 ✓✓ | Dark surface, secondary text emphasis, header band (mock 05), **active tab / toggle / footer ink** |
| `forest-600` | `#104c3a` | — | 9.92 ✓✓ | Secondary button on a green field (mock 02 "Get Started") |
| `forest-700` | `#0c3b2d` | — | 12.51 ✓✓ | Pressed state, deepest brand surface |
| `forest-800` | `#092b20` | — | — | Illustration shadow |

Mock 02 puts a `#145f48` button on a `#00af52` field: **2.63:1**, below the 3:1 a control
boundary needs. `forest-700 #0c3b2d` on `primary-600 #009646` is **3.25:1** and passes. Note
`forest-600 #104c3a` on `primary-600` is only **2.57:1** and still fails the 3:1 bar, so the
substitution must go all the way to `forest-700`. That single pair of substitutions is the
whole fix for that screen.

### §2.4 Secondary — amber

| Token | Hex | On white | Neutral-900 on it | Role |
|---|---|---|---|---|
| `amber-100` | `#fff3db` | — | — | Warning banner fill, allergen-notice surface |
| `amber-200` | `#ffe4b0` | — | — | Warning banner border |
| `amber-300` | `#ffcf74` | — | — | Illustration |
| **`amber-500`** | **`#ffbb39`** | 1.69 ✗ | 10.68 ✓✓ | **Identity/fill only (§2.1).** Highlight band, pattern colourway, **notification and badge fill** |
| `amber-700` | `#8f6920` | 4.99 ✓ | — | Warning **text** and warning icon |
| `amber-800` | `#73541a` | 6.97 ✓ | — | Warning text on an `amber-100` surface |

`forest-500` on `amber-500` is **4.50:1** and is the one text-on-amber pair that passes. Use
it for the rare case where copy must sit on the brand amber. The brand document's own line for
this colour is "Text on yellow/light backgrounds" under `#145F48` — the same pair, arrived at
from the other side.

The brand document assigns amber to **"UI highlights (notifications, badges)"**, which is
adopted. Two constraints come with it and neither is optional. First, `amber-500` on `neutral-0`
is **1.69:1**, so a badge is a *shape with content in it*, never an outline — its own edge is
invisible. Second, §2.10 applies with full force: a bare amber dot that means "something needs
attention" conveys meaning by colour alone. A badge carries a number, a glyph or an
accessibility label. `neutral-900` on `amber-500` is 10.68:1, so the count is easy to read.

### §2.5 Accent — lime

Accents are surfaces and graphic fills. **Neither lime ever colours text.**

| Token | Hex | Neutral-900 on it | `forest-500` on it | Role |
|---|---|---|---|---|
| `lime-200` | `#e5ea98` | 14.24 ✓✓ | 6.00 ✓✓ | Pale highlight surface, empty-state illustration ground, **light UI surface (card, container), soft separator, table/chart ground** |
| `lime-500` | `#b3cf3f` | 10.25 ✓✓ | 4.32 ✓³ | Accent fill, pattern colourway, category tag, **decorative micro-interaction** |

The brand document is more specific about `#E5EA98` than this file was — "Light UI surfaces
(cards, containers)", "Soft separators in digital layouts", "Table or chart backgrounds". Those
are adopted as `bg.surfaceAccent` and `border.accent` (§2.9). Three numbers govern their use:

- `lime-200` on `neutral-0` is **1.27:1** and on `neutral-50` **1.19:1**. A lime card is
  distinguished by *fill*, faintly, and it is never the sole boundary of anything interactive.
  A tappable card on a lime ground still needs `border.strong` or a control inside it.
- Text on it is fine: `neutral-900` 14.24, `neutral-700` 8.09, `neutral-600` 5.01 — all pass AA.
- **`primary-700` on `lime-200` is 4.09:1 and fails AA.** So a link, a price or any
  `text.link`/`text.price` inside a lime surface must use `forest-500` (6.00) instead. This is
  the only trap the new surface introduces and the §9 contrast test asserts it.

`#B3CF3F`'s brand line is "Decorative UI micro-interactions" and "Subtle accents… tiny details,
not large blocks" — which is the same instruction as "never colours text", stated for area
rather than for legibility. It agrees with `M01`–`M14`: lime is what a micro-interaction may
tint, and a micro-interaction is small.

### §2.6 The approved logo-on-colour pairings

`Colour Palette_Guideline.png` fixes five and only five lockup treatments, and the brand
guidelines reproduce the same five on their own page — **confirmed identical under `E13-15`**.
These are brand rules, not accessibility rules, and they are not negotiable:

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
| `neutral-800` | `#262a26` | 14.57 ✓✓ | Headings |
| `neutral-900` | `#141714` | 18.07 ✓✓ | Primary text |

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
| `danger-700` | `#b42318` | 6.57 ✓ | 6.57 ✓ | Pressed destructive |

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
| `bg.surfaceAccent` | `lime-200` | **Brand-assigned (§2.11):** light UI surface — card, container, table/chart ground. 1.27:1 against `neutral-0`, so it is a fill and never a boundary. `text.link` and `text.price` are illegal on it (4.09) — use `forest-500` |
| `bg.scrim` | `rgba(20, 23, 20, 0.48)` | Behind sheets and dialogs |
| `text.primary` | `neutral-900` | |
| `text.secondary` | `neutral-600` | |
| `text.tertiary` | `neutral-500` | Placeholder, timestamps. **⚠ [DS-06]:** on `bg.surfaceMuted` (`neutral-100`) this is **4.23:1** and on `bg.canvas` (`neutral-50`) **4.50:1** — placeholder text inside an input field is the first case and **fails AA (4.5)**. The choice (darken the ink, lighten the muted surface, or accept large-text-only) is brand-visible and pending `[DS-06]` |
| `text.disabled` | `neutral-400` | |
| `text.onBrand` | `neutral-0` | White, and only on `primary-700`+ or `forest-500`+. **⚠ [DS-06]:** white on `bg.surfaceBrand` (`primary-600`) is **3.85:1** — legal for large text (≥18.66px bold / 24px) but **fails AA (4.5) for body text**, and `bg.surfaceBrand` is `primary-600` by definition. The role map therefore has **no legal body-text colour for that surface**; body text on `surfaceBrand` is forbidden until `[DS-06]` resolves (darken the surface to `primary-700`, or restrict `surfaceBrand` to large text / controls only) |
| `text.link` | `primary-700` | Always also underlined or in a pressable shape |
| `text.price` | `primary-700` | Tabular figures — §3.5 |
| `text.danger` | `danger-600` | On `neutral-0`/`neutral-50` this passes (4.83). **⚠ [DS-06]:** on a `danger-50` error-banner fill (§2.8) it is **4.44:1** and **fails AA (4.5)**; use `danger-700` (6.57) for text on `danger-50`, pending `[DS-06]` |
| `text.warning` | `amber-700` | |
| `border.subtle` | `neutral-300` | Decorative dividers |
| `border.default` | `neutral-400` | Decorative-weight outlines only. **`neutral-400` on `neutral-0` is 2.28:1 and does NOT meet the 3:1 UI-boundary bar (WCAG 1.4.11).** An input or card outline that is the *only* thing marking a control boundary must use `border.strong`, not this token |
| `border.strong` | `neutral-500` | Outlined control that must meet 3:1 (4.79 on `neutral-0`). **This is the correct token for input and card outlines** — the boundary of a UI component that carries no other visible affordance |
| `border.brand` | `primary-600` | Selected / active outline |
| `border.accent` | `lime-200` | **Brand-assigned (§2.11):** "soft separator in digital layouts". Decorative only — it is 1.27:1 on white and can never be the boundary of a control |
| `border.danger` | `danger-600` | |
| `action.primaryBg` | `primary-700` | |
| `action.primaryBgPressed` | `primary-800` | |
| `action.primaryFg` | `neutral-0` | |
| `action.secondaryBg` | `primary-100` | Tonal button, the mock-08 "Change" pill |
| `action.secondaryFg` | `primary-900` | |
| `action.destructiveBg` | `danger-600` | |
| `action.disabledBg` | `neutral-200` | |
| `action.disabledFg` | `neutral-400` | |
| `nav.itemActive` | `forest-500` | **Brand-assigned (§2.11):** active tab, active toggle track, footer ink. 7.61 on `neutral-0`, 7.15 on `neutral-50` |
| `nav.itemInactive` | `neutral-500` | Inactive tab. 4.79 on `neutral-0` — passes, and stays a grey so the active state is the only coloured one |
| `badge.bg` | `amber-500` | **Brand-assigned (§2.11):** notification and badge fill. Content-bearing shape only — see §2.4 |
| `badge.fg` | `neutral-900` | 10.68 on `amber-500` |
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

### §2.11 The brand's Colour Usage Guide, mapped to tokens

The guidelines' Colour Usage Guide gives nine to ten uses per colour, most of them about
packaging, presentations and social. Only the **UI** lines bind this file; the rest are recorded
so nobody has to re-open the PDF to check whether a use was covered.

| Brand colour | The UI lines, verbatim | Token |
|---|---|---|
| `#00AF52` Fresh Lunch Green | "Buttons & CTAs in UI"; "Highlighted icons and illustrations" | **Contested — `[DS-01]`.** This file says `action.primaryBg` = `primary-700` (§2.1). Icons and illustrations that carry nothing legible are `primary-500` and always were |
| `#FFBB39` Sunlit Snack Yellow | "UI highlights (notifications, badges)"; "Icons that require emphasis" | `badge.bg` / `badge.fg` (§2.9). Content-bearing shapes only — §2.4 |
| `#145F48` Deep Tiffin Green | "Text on yellow/light backgrounds"; "Secondary UI elements (tabs, toggles, footers)"; "Highlight bars and overlays" | `nav.itemActive`, `bg.surfaceInverse`, and the text colour on `amber-500` (4.50) and `lime-200` (6.00) |
| `#B3CF3F` Citrus Zest Green | "Decorative UI micro-interactions"; "Subtle accents… tiny details, not large blocks" | `lime-500` as a graphic fill only. Never ink, never a large block, never a control |
| `#E5EA98` Light Lemon Mist | "Light UI surfaces (cards, containers)"; "Soft separators in digital layouts"; "Table or chart backgrounds" | `bg.surfaceAccent`, `border.accent` (§2.9) |

Non-UI lines, recorded and out of scope for the product: primary logo colour, packaging fronts
and edges, key brand backgrounds, hero and title slides, section dividers and chapter titles,
social template headers, stickers/labels/seals, ingredient tags, presentation callouts,
background shapes behind product photos, infographic emphasis and outlines, shadows and depth
elements, backgrounds behind the white monochrome logo, minimal packaging sections, and
backgrounds for illustrations.

**Two of the brand's own lines are load-bearing for accessibility and are worth keeping in
view.** "Text on yellow/light backgrounds" is `#145F48` — the brand already knows nothing else
in the palette is legible there. And `#B3CF3F` is confined to "tiny details, not large blocks",
which is the same instruction §2.5 arrives at from contrast. Where the brand and WCAG agree,
they agree completely; the single place they collide is `[DS-01]`.

---

## §3 Type

### §3.1 The family, and the fact that it is not settled

**VAG Rounded Next.** Ten weights are in the package; the guidelines display eight. **The licence
has not been checked** (`E19-03`, `owner:andy`) and a bad answer changes every screen. Two things
follow:

- **Use three weights, not ten.** That narrows the licence question to "may we embed three
  weights in a mobile app and serve them as webfonts", which is a much easier thing to buy or
  to be refused, and it keeps the mobile bundle small — the real constraint is network (P11).
- **Name the substitute now, not in a panic.** Recommended: **Nunito** (SIL OFL) — a rounded
  geometric sans, the closest freely-licensed match to VAG Rounded's rounded terminals on an
  upright skeleton, with the full weight range and good hinting at small sizes. Alternatives
  considered and rejected in `[DS-02]`.

**Which three changed under `E13-15`.** This file had picked Regular / SemiBold / **Bold**. The
brand's Hierarchy page uses Semi Bold for both heading levels, **Medium** for subheadings and
Regular for body — Bold appears nowhere in it. The bundle follows the hierarchy:

| Token | VAG Rounded Next | Nunito fallback | Weight | Brand hierarchy level |
|---|---|---|---|---|
| `font.regular` | Regular | Nunito Regular | 400 | Body |
| `font.medium` | Medium | Nunito Medium | 500 | Subheading |
| `font.semibold` | SemiBold | Nunito SemiBold | 600 | Main Heading, Heading |

**There is no Bold in the product.** A component asking for 700 is a bug, and it is one the
no-literals lint rule (`E13-11`) catches, because weights come from these tokens. The bundle
count is unchanged at three, so `E19-03`'s licence question is unchanged in size — only in which
three files it names, which matters if the answer is "yes, for a fee per weight".

Runtime stack while a webfont loads, and on the app's first cold start:

```
"VAG Rounded Next", Nunito, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif
```

Web uses `font-display: swap` with a metric-adjusted fallback (`size-adjust`) so the swap does
not reflow. Mobile bundles the three weights; it never fetches a font at runtime.

English only (P10) — no Devanagari coverage is required, which removes the main reason the
rounded-sans field is thin.

### §3.2 The scale

The brand document specifies four levels, as ranges, in points:

| Brand level | Weight | Range |
|---|---|---|
| Main Heading | Semi Bold | 48–32 pt |
| Heading | Semi Bold | 32–28 pt |
| Subheading | Medium | 24–20 pt |
| Body | Regular | 16–12 pt |

Those are the bands. Mobile lives at the bottom of each of them — a 48pt heading on a 360dp
Android is a marketing artefact, not a screen title. The scale below is mobile-first, in
points/CSS pixels, and **every entry sits inside a brand band at the brand's weight**. Line
heights are all even numbers so they land on the 4-point grid.

| Token | Size | Line height | Weight | Tracking | Brand band | Used for |
|---|---|---|---|---|---|---|
| `display` | 32 | 38 | 600 | −0.02em | Main Heading (floor) | Marketing hero, one per page |
| `h1` | 28 | 34 | 600 | −0.015em | Heading (floor) | Screen title on a scrolled-away large header |
| `h2` | 24 | 30 | 500 | −0.01em | Subheading (ceiling) | "welcome back", "Made Specially for your Child" |
| `h3` | 20 | 26 | 500 | −0.005em | Subheading (floor) | Section heading, sheet title, dish name |
| `bodyLg` | 16 | 26 | 400 | 0 | Body (ceiling) | Long-form copy — policies, T&Cs |
| `body` | 16 | 24 | 400 | 0 | Body (ceiling) | Default |
| `bodyStrong` | 16 | 24 | 500 | 0 | Body | Emphasis inside body |
| `bodySm` | 14 | 20 | 400 | 0 | Body | Dense lists, table cells |
| `label` | 13 | 16 | 600 | +0.01em | Body | Field labels, button labels ≤ small size |
| `button` | 16 | 20 | 600 | +0.01em | Body (ceiling) | Default button label |
| `caption` | 12 | 16 | 400 | +0.01em | Body (floor) | Metadata, helper text, timestamps |
| `overline` | 12 | 16 | 600 | +0.08em | Body (floor) | Uppercase eyebrow — "Our Food" (mock 06) |

**What `E13-15` changed here, and why each one had to move:**

- **`h3` 18 → 20 and `bodyLg` 17 → 16.** The brand leaves a gap between 20 and 16 — nothing is
  specified there — and both styles were sitting in it. `h3` moves to the floor of Subheading,
  `bodyLg` to the ceiling of Body. `bodyLg` keeps its 26 line height, so it is still visibly
  looser than `body` for long-form reading; the distinction was always leading, not size.
- **`h2` 22 → 24.** 22 was already legal (inside 24–20) but left `h2` and `h3` two points apart
  once `h3` rose to 20, which is not a hierarchy anyone can see. Taking `h2` to the band ceiling
  gives a clean 32 / 28 / 24 / 20 ladder, all four inside brand bands.
- **`overline` 11 → 12.** Below the brand's floor, and below **this file's own stated floor** —
  §3.2 has said "12 is the floor" since it was written, with an 11pt token directly above the
  sentence. Reading the brand document found a contradiction that was already here.
- **Weights 700 → 600 / 500.** The brand's headings are Semi Bold and its subheadings Medium.
  There is no Bold (§3.1).

`label` and `button` stay at **600** although they sit in the Body band, where the brand says
Regular. They are not editorial text — they are UI chrome at 13 and 16 points, and small type
needs mass to read at a glance on a mid-range phone in daylight. The brand hierarchy is a
document-typography spec; it has no row for "button". This is the one place §3.2 extends the
brand rather than following it, and it extends it only into a case the brand does not cover.

**12 is the floor, and now nothing violates it.** Nothing in the product is smaller, including
legal text and table cells. The audience is parents, largely 30–50; the mocks' 11–12pt greys
were already at the limit.

### §3.3 The brand's lowercase habit

The wordmark, the onboarding headline ("education meets convenience") and the sign-in headline
("welcome back") are all set lowercase. That is a **brand voice device for marketing-register
headlines only**. Functional UI — button labels, field labels, screen titles, error messages,
anything a screen reader announces as an instruction — uses sentence case. Lowercase is allowed
on `display` and `h2` in onboarding and marketing, nowhere else.

The brand guidelines confirm this: their Hierarchy page sets both heading levels lowercase
("graybag") and the subheading lowercase ("education meets convenience"), while the Body sample
is sentence case — "At graybag, we ensure nutritious, fresh meals prepared daily for your
child." The habit is a headline device in the brand's own examples, not a global rule.

`overline` is the only uppercase style, and it carries `+0.08em` tracking because uppercase at
12pt without tracking is unreadable. One clarification, because the two rules look like they
collide: the guidelines' Incorrect Usage page forbids **"Don't Use Uppercase"** — that is about
the *logotype*, which is always `graybag` lowercase. It says nothing about UI text, and
`overline` is not a lockup.

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

**The brand document makes this a rule rather than an inference.** Its Shapes & Geometry page:
"Rounded corners are a key part of GrayBag's visual identity… **All graphic elements — including
containers, image frames, and backgrounds — should use soft, rounded edges** to maintain
consistency with the logo's geometry." The page's single ✗ example is a square-cornered
rectangle. It gives no numbers, so the scale below stands unchanged — but it narrows
`radius-none`, which this file had allowed on full-bleed images and table cells.

| Token | Value | Used for |
|---|---|---|
| `radius-none` | 0 | **Only where there is no visible corner to round** — an image or fill that bleeds off every edge of the viewport, a divider, the interior of a table cell. **A container, an image frame or a background with a visible corner is never `radius-none`** (brand: Shapes & Geometry). A hero image with its bottom edge inside the layout is an image frame: it gets `radius-lg` |
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
   shipping. (`E13-13`) Three pairs added by `E13-15` belong in that list as **expected
   failures that must stay forbidden**, because each is a combination a component could
   plausibly reach for: `text.link`/`text.price` on `bg.surfaceAccent` (4.09), `border.accent`
   as a control boundary (1.27), and `badge.bg` as an outline on `neutral-0` (1.69).
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
| `DS-05` | `00_Graybag_Brand Guidelines.pdf` has never been read (§1). If it specifies tints, tonal steps or a type scale, what wins? | **Closed 2026-08-09 by `E13-15`.** Read in full. It specifies a type hierarchy, per-colour UI usage rules and a geometry rule — all adopted (§0). It specifies **no** tints, tonal steps, neutral ramp, spacing, radius numbers or contrast analysis, so those parts of this file stand on their own authority. One conflict survives and is `DS-01`, not `DS-05` |

**This file is no longer provisional.** `DS-05` was the caveat sitting under all of it; the one
thing still outstanding is `DS-01`, and `DS-01` is now a larger question than it was — it is a
deviation from a written brand rule (§2.1, §2.11) rather than only from the mocks.

The decisions this file makes, rather than defers, are recorded as `S6`–`S8`, `S11` and
`S12`–`S15` in `docs/decisions.md`.
