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
- [ ] `E13-04` (risk:medium) **Motion spec** — duration scale (120/200/320ms), three easing curves, nothing over 350ms
- [ ] `E13-05` Motion catalogue: staggered list entry, shared-element dish card -> detail, cart badge spring, skeleton shimmer, cross-fade state change, physics pull-to-refresh and swipe
- [ ] `E13-06` Rules of restraint documented: motion communicates, never decorates; never blocks input; honours OS reduce-motion
- [ ] `E13-07` Skeleton screens for every loading state — no spinners (feels faster on slow networks)
- [ ] `E13-08` Accessibility pass: contrast, tap target sizes, dynamic type, screen reader labels
- [ ] `E13-10` Automated accessibility **testing** in CI for both app and web — not a one-time design review
- [ ] `E13-09` (owner:andy) Review the motion spec with Andy once, before app UI work starts
