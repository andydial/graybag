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

- [ ] `E13-01` (mvp) Design tokens: colour, type scale, spacing, radius, elevation — shared between mobile and web
- [ ] `E13-02` (mvp) Apply the font decision from `E19-03` / `E00-16` (licence check happens in phase 0/1, not here)
- [ ] `E13-03` (mvp) Component library: buttons, inputs, cards, sheets, tabs, list rows, empty states, error states
- [x] `E13-04` (risk:medium) (mvp) **Motion spec** — duration scale (120/200/320ms), three easing curves, nothing over 350ms
- [x] `E13-05` (mvp) Motion catalogue: staggered list entry, shared-element dish card -> detail, cart badge spring, skeleton shimmer, cross-fade state change, physics pull-to-refresh and swipe
- [x] `E13-06` (mvp) Rules of restraint documented: motion communicates, never decorates; never blocks input; honours OS reduce-motion
- [x] `E13-07` (mvp) Skeleton screens for every loading state — no spinners (feels faster on slow networks)
- [ ] `E13-08` (mvp) Accessibility pass: contrast, tap target sizes, dynamic type, screen reader labels
- [ ] `E13-10` Automated accessibility **testing** in CI for both app and web — not a one-time design review
- [ ] `E13-09` (owner:andy) (mvp) Review the motion spec with Andy once, before app UI work starts
- [ ] `E13-11` (risk:medium) (mvp) **Lint rules that keep both systems closed** — fail the build on any colour literal, `fontSize`, `borderRadius` or raw spacing number outside `packages/shared/src/design/`; any numeric literal passed to `withTiming` / `transition-duration`; any `cubic-bezier` or `Easing.bezier` outside `motion.ts`; any `withSpring` outside the cart-badge module; `transition: all`; and animating any property other than `transform` / `opacity` outside the two files implementing `M10` and `M14`. Without this, both documents decay into suggestions
- [ ] `E13-12` (mvp) `packages/shared/src/design/motion.ts` exporting `duration`, `ease` and `spring` and nothing else, plus the **reduce-motion test harness** — every animated component gets a test that renders with reduce-motion on and asserts the §10 substitute, not merely that "nothing animates". A component that silently drops a state change under reduce motion is an accessibility bug no visual review catches
- [ ] `E13-13` (mvp) **Contrast assertion in CI** — walk the `docs/design-tokens.md` §2.9 semantic role map plus a declared list of legitimate foreground/background pairs, compute the WCAG 2.1 ratio, assert the stated minimum. A brand refresh that lightens a green then fails the build instead of shipping
- [ ] `E13-14` (owner:andy) (mvp) **`DS-01` — approve the "500 rule"**: `#00af52` stays the identity colour but functional green moves to `primary-700 #007e3b` for fills and text. White on `#00af52` is 2.90:1 and fails every WCAG bar, so the mocks cannot ship as drawn. This changes what every button, price and field label looks like. Options and the recommendation are in `docs/open-questions.md`; the consequences are worked through in `docs/design-tokens.md` §2.1
- [ ] `E13-15` (mvp) **Reconcile `docs/design-tokens.md` against `00_Graybag_Brand Guidelines.pdf`** — 21.8 MB, never read (over the file-read limit, no rasteriser runnable in the overnight sandbox). If it specifies tints, tonal steps, a type scale or usage rules, the brand document wins. The token file is provisional until this is done. `DS-05`

Added by Q15 (`docs/overnight-review.md` §3.1, §3.2, §2.4, §5.1, §5.2). The first two are corrections to numbers `E13-13` will assert and `E13-14` asks Andy to approve, so they land **before** either.

- [x] `E13-16` (risk:high) (mvp) **Correct `docs/design-tokens.md` §2.3's mock-02 fix — the substitution it prescribes does not work.** `forest-600 #104c3a` on `primary-600 #009646` is **2.57:1**, not the 3.25:1 claimed, and still fails the 3:1 control-boundary bar. The 3.25:1 figure belongs to **`forest-700 #0c3b2d`**. Fix the token, add a `text.onBrandField`-style role for a control on a brand field, and correct three ratios that round the wrong way (`danger-700` 6.57 not 6.63, `neutral-800` 14.57 not 14.56, `neutral-900` 18.07 not 18.06). `E13-14` currently asks Andy to approve a worked example that is wrong
- [ ] `E13-17` (risk:high) (mvp) **Resolve the five semantic-role pairs that fail the bar `E13-13` will assert.** Walking `docs/design-tokens.md` §2.9: `text.tertiary` on `bg.surfaceMuted` **4.23** (placeholder text inside an input — the role's commonest use); `text.tertiary` on `bg.canvas` **4.50**, exactly at the bar; `text.danger` on the `danger-50` banner fill §2.8 pairs it with **4.44**; `border.default` on `bg.surface` **2.28** against the 3:1 a control boundary needs, and §2.9 assigns it to *"input and card outlines"*; `text.onBrand` on `bg.surfaceBrand` **3.85**, where the role map has no legal body-text colour at all for a surface described as carrying controls. None of this is fixed by approving `DS-01`. Options and a recommendation are `[DS-06]`
- [ ] `E13-20` (risk:high) (mvp) **`M09`'s 8-second timeout-and-retry must not apply to Pay.** `docs/motion-system.md` `M09` reverts the button and offers a retry after 8s; `docs/order-lifecycle.md` §13 says `payment_pending` shows an unbounded waiting state, and `docs/payments-design.md` §3.3 says a UPI collect sits pending for minutes. A retry affordance at 8 seconds manufactures §10.6b's genuine double capture — *"this **will** happen"* — which `[OL-05]` says the schema cannot currently record. Pay (and Place Order where it opens the Razorpay sheet) uses the waiting state and `GET /checkout/:group/status`; `M09`'s timeout stays for Cancel Order and Save Recipient
- [x] `E13-18` (mvp) Correct `M01`'s allow/deny lists — it permits press feedback on *"the quantity stepper"* and then excludes *"anything under 32pt visually — a 28pt stepper button"*. `docs/design-tokens.md` §4.1 confirms the stepper draws at ~28pt; the deny list is the correct one
- [x] `E13-19` (mvp) Reconcile `M04`'s container-height animation with §7 rule 6 and the §9 lint gate, which fail the build on animating anything but `transform`/`opacity` outside the two files implementing `M10` and `M14`. `M04` is the third height animation and is not exempted, so `E13-11` as specified would fail every implementation of the catalogue's most-used pattern. Either exempt `M04` or drop the height animation
