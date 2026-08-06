---
id: E13
title: Design System & Motion System
phase: 2
risk: medium
status: not-started
depends_on: []
summary: Written before any UI code exists. The motion catalogue is what produces "fluid" instead of "flying bird".
---

## Context

Source: `Graybag_Design Package` — VAG Rounded Next font family, primary `#00af52`, secondary `#145f48` / `#ffbb39`, accent `#b3cf3f` / `#e5ea98`, pattern assets, and the 06_App UI mocks.

The motion system is a **closed catalogue**. New screens implement from it; it is only amended when a genuinely new kind of interaction appears, and that is a deliberate joint decision.

## Tasks

- [ ] `E13-01` Design tokens: colour, type scale, spacing, radius, elevation — shared between mobile and web
- [ ] `E13-02` Apply the font decision from `E19-03` / `E00-16` (licence check happens in phase 0/1, not here)
- [ ] `E13-03` Component library: buttons, inputs, cards, sheets, tabs, list rows, empty states, error states
- [x] `E13-04` (risk:medium) **Motion spec** — duration scale (120/200/320ms), three easing curves, nothing over 350ms
- [x] `E13-05` Motion catalogue: staggered list entry, shared-element dish card -> detail, cart badge spring, skeleton shimmer, cross-fade state change, physics pull-to-refresh and swipe
- [x] `E13-06` Rules of restraint documented: motion communicates, never decorates; never blocks input; honours OS reduce-motion
- [x] `E13-07` Skeleton screens for every loading state — no spinners (feels faster on slow networks)
- [ ] `E13-08` Accessibility pass: contrast, tap target sizes, dynamic type, screen reader labels
- [ ] `E13-10` Automated accessibility **testing** in CI for both app and web — not a one-time design review
- [ ] `E13-09` (owner:andy) Review the motion spec with Andy once, before app UI work starts
- [ ] `E13-11` (risk:medium) **Lint rules that keep both systems closed** — fail the build on any colour literal, `fontSize`, `borderRadius` or raw spacing number outside `packages/shared/src/design/`; any numeric literal passed to `withTiming` / `transition-duration`; any `cubic-bezier` or `Easing.bezier` outside `motion.ts`; any `withSpring` outside the cart-badge module; `transition: all`; and animating any property other than `transform` / `opacity` outside the two files implementing `M10` and `M14`. Without this, both documents decay into suggestions
- [ ] `E13-12` `packages/shared/src/design/motion.ts` exporting `duration`, `ease` and `spring` and nothing else, plus the **reduce-motion test harness** — every animated component gets a test that renders with reduce-motion on and asserts the §10 substitute, not merely that "nothing animates". A component that silently drops a state change under reduce motion is an accessibility bug no visual review catches
- [ ] `E13-13` **Contrast assertion in CI** — walk the `docs/design-tokens.md` §2.9 semantic role map plus a declared list of legitimate foreground/background pairs, compute the WCAG 2.1 ratio, assert the stated minimum. A brand refresh that lightens a green then fails the build instead of shipping
- [ ] `E13-14` (owner:andy) **`DS-01` — approve the "500 rule"**: `#00af52` stays the identity colour but functional green moves to `primary-700 #007e3b` for fills and text. White on `#00af52` is 2.90:1 and fails every WCAG bar, so the mocks cannot ship as drawn. This changes what every button, price and field label looks like. Options and the recommendation are in `docs/open-questions.md`; the consequences are worked through in `docs/design-tokens.md` §2.1
- [ ] `E13-15` **Reconcile `docs/design-tokens.md` against `00_Graybag_Brand Guidelines.pdf`** — 21.8 MB, never read (over the file-read limit, no rasteriser runnable in the overnight sandbox). If it specifies tints, tonal steps, a type scale or usage rules, the brand document wins. The token file is provisional until this is done. `DS-05`
