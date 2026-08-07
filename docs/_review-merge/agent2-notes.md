# Agent 2 notes — motion-system.md + design-tokens.md review fixes

Owned files: `docs/motion-system.md`, `docs/design-tokens.md`. All contrast ratios below were
recomputed from the source hexes using the WCAG 2.1 relative-luminance formula before writing.

## Findings fixed

- **Finding #3 (review §2.4) → `motion-system.md` M09.** M09 previously applied its 8-second
  timeout-and-retry to "Place Order, Pay, Cancel Order, Save Recipient". Edited so the
  timeout-and-retry applies to **Place Order, Cancel Order and Save Recipient only**, and added
  an explicit **Pay exclusion**: Pay follows `order-lifecycle.md` §13 `payment_pending` (202) —
  poll `GET /checkout/:group/status`, show an unbounded waiting state, no success screen, **no
  8-second retry**. Rationale recorded inline (UPI collect can sit pending ~30 min per `[OL-03]`;
  a retry manufactures the §10.6b double debit that `[OL-05]` says the schema cannot record).
  Also updated M09's "Allowed on" line to point at the Pay exclusion. Implements `E13-20`.

- **Finding #5 (review §3.1) → `design-tokens.md` §2.3.** The prescribed contrast fix named the
  wrong token. Corrected to `forest-700 #0c3b2d` on `primary-600 #009646` = **3.25:1** (passes
  the 3:1 bar), and added the note that `forest-600 #104c3a` on `primary-600` is only **2.57:1**
  and still fails, so the substitution must go all the way to `forest-700`.
  - Recomputed: `forest-600 #104c3a` on `primary-600 #009646` = **2.5750** → 2.57 (FAIL).
  - Recomputed: `forest-700 #0c3b2d` on `primary-600 #009646` = **3.2463** → 3.25 (PASS 3:1).
  - Matters because `E13-14` is an `owner:andy` validation resting on this worked example.
  Implements `E13-16`.

- **Finding #5 tail (review §3.1) → `design-tokens.md` §2.7 and §2.8.** Three ratios rounded the
  wrong way; corrected so `E13-13` will assert the right numbers:
  - `danger-700 #b42318` on white: 6.63 → **6.57** (recomputed 6.5743).
  - `neutral-800 #262a26` on white: 14.56 → **14.57** (recomputed 14.5673).
  - `neutral-900 #141714` on white: 18.06 → **18.07** (recomputed 18.0660).

- **Finding #6 (review §3.2) → `design-tokens.md` §2.9.** Five failing semantic-role pairs.
  Recomputed each:
  - (a) `text.tertiary neutral-500` on `bg.surfaceMuted neutral-100` = **4.2280** → 4.23 (FAIL 4.5).
  - (b) `text.tertiary neutral-500` on `bg.canvas neutral-50` = **4.4969** → 4.50 (at bar).
  - (c) `text.danger danger-600` on `danger-50` fill = **4.4441** → 4.44 (FAIL 4.5).
  - (d) `border.default neutral-400` on `bg.surface neutral-0` = **2.2807** → 2.28 (FAIL 3.0).
  - (e) `text.onBrand neutral-0` (white) on `bg.surfaceBrand primary-600` = **3.8525** → 3.85
    (FAIL 4.5 for body). (`border.strong neutral-500` on `neutral-0` = **4.7876** → 4.79, PASS.)
  - **Fixed unambiguously (per the doc's own description):** reassigned input/card outlines from
    `border.default` to `border.strong`. `border.strong` was already described as "Outlined
    control that must meet 3:1" (4.79). Rewrote both notes: `border.default` is now
    "decorative-weight outlines only" and explicitly states neutral-400 is 2.28:1 and does not
    meet 1.4.11; `border.strong` is now flagged as the correct token for input/card outlines.
    This resolves case (d).
  - **Flagged as pending `[DS-06]` (brand-visible — did not guess which end moves):** added ⚠
    notes to `text.tertiary` (cases a/b), `text.danger` (case c, with the interim recommendation
    to use `danger-700` on `danger-50`), and `text.onBrand` (case e — noted the role map has no
    legal body-text colour for `surfaceBrand`; body text on `surfaceBrand` is forbidden until
    `[DS-06]`). Implements the doc-side of `E13-17`.

- **Finding #24 (review §5.1) → `motion-system.md` M01.** Removed "the quantity stepper" from
  M01's "Allowed on" list. It correctly remains in "Not on" (a ~28pt stepper button, under the
  32pt floor per `design-tokens.md` §4.1). Implements `E13-18`.

- **Finding #25 (review §5.2) → `motion-system.md` §7 rule 6 and §9 gate 2.** Added M04's
  container-height animation as a documented **third** exception to the transform/opacity-only
  rule in both the §7 rule and the §9 lint gate, consistent with M04's own text and §10.
  Implements `E13-19`.

## Backlog tasks completed by these doc fixes

- **`E13-16`** — fully done as a doc fix. §2.3 now names `forest-700` with the correct 3.25:1.
- **`E13-18`** — fully done as a doc fix. Stepper removed from M01 "Allowed on".
- **`E13-19`** — fully done as a doc fix. M04 exempted in §7 rule 6 and §9 gate 2.
- **`E13-20`** — done as a doc fix at the spec level (M09 Pay exclusion). The implementing code
  (the Pay control wiring to §13 `payment_pending` polling, and the `E13-11`/`E13-13` lint/tests)
  is separate build work; the motion spec no longer prescribes the harmful 8s retry on Pay.
- **`E13-17`** — **partly done.** The one unambiguous change (input/card outlines → `border.strong`,
  case d) is applied. The remaining four failing pairs (a, b, c, e) are brand-visible and are
  flagged in-doc as pending **`[DS-06]`**. `E13-17` cannot fully close until `[DS-06]` is decided.
- **`E13-13`** — not owned here, but its assertions will now match the corrected numbers
  (6.57 / 14.57 / 18.07 and the §2.3 forest-700 pair). Note: if `E13-13` walks the §2.9 role map
  as written, it must exclude the `[DS-06]`-flagged pairs (or treat body-on-surfaceBrand as
  forbidden) until `[DS-06]` resolves, or it will fail on (a), (c), (e). This is the intended
  loud-failure behaviour, but the "declared list of legitimate pairs" in §9 item 1 should not
  list those pairs until the decision lands.

## [DS-06] recommendation

`[DS-06]` asks which end of each failing contrast pair moves — darken the ink, lighten the
surface, or forbid the pairing. Recommendation, pair by pair:

- **(a/b) `text.tertiary` (`neutral-500`) placeholder/tertiary text.** Recommend **darken the
  ink one step to `neutral-600 #5b615b`** (6.35 on white; ~5.9 on `neutral-100`, comfortably
  past 4.5). `neutral-500` was chosen (§2.7) as "the darkest grey that still reads as
  placeholder", but that judgement was made against white only, not against the `neutral-100`
  input fill the same file assigns — on that fill it is 4.23 and fails. Darkening the ink is the
  smallest brand-visible change (placeholder text is not identity colour) and fixes both a and b.
  Alternative, if the visual "placeholder-greyness" must be preserved: lighten the input fill
  from `neutral-100` toward `neutral-50`/white so `neutral-500` clears 4.5 — but that erases the
  input's fill distinction, so I do not recommend it.

- **(c) `text.danger` on `danger-50` banner fill.** Recommend **darken the ink to `danger-700
  #b42318`** (6.57 on white, ~6.1 on `danger-50`) for error *text sitting on the banner fill*,
  keeping `danger-600` for error text/markers on white. This is a within-danger-ramp move, not a
  brand-hue move, and I have already written the interim recommendation into the §2.9
  `text.danger` note.

- **(d) input/card outlines — already fixed** by reassigning to `border.strong` (4.79). No
  `[DS-06]` decision needed; flagged here only for completeness.

- **(e) white body text on `bg.surfaceBrand primary-600`.** Recommend **darken the surface to
  `primary-700 #007e3b`** wherever body text sits on a green field (white on primary-700 = 5.19,
  passes), and keep `primary-600` only for *large text and control boundaries* (white on it =
  3.85, which passes the 3:1 large-text / non-text bar). This aligns with the existing 500-rule
  logic in §2.1 ("`primary-700` for anything carrying body text or white text"). Net: forbid
  body text on `surfaceBrand` as currently defined; either introduce a `bg.surfaceBrandStrong =
  primary-700` role for text-bearing green fields, or push such fields to `primary-700`.

## Proposed learnings

- **Ratios were quoted in the spec but never recomputed.** §2.3's "3.25:1" was correct in value
  but attached to the wrong token (`forest-600` instead of `forest-700`), and three ramp ratios
  rounded the wrong way. The doc even claims (§9) "computed while writing it" — but the §2.3
  substitution pair and three ramp entries were not re-derived. Lesson: any contrast number in a
  spec must be reproduced by the same formula the CI test (`E13-13`) will use, at the time of
  writing, and the *pair* (both hexes) must be stated so a reviewer can recompute.

- **The §2.9 role map was checked against white only, not against the fills the same file
  assigns.** §2.7 justified `neutral-500` as a placeholder colour against white, then §2.9
  paired it with a `neutral-100` input fill (4.23) and a `neutral-50` canvas (4.50). Same class
  of miss for `text.danger` on `danger-50` and white-on-`primary-600`. Lesson: a semantic role
  map must be validated against every background role it is actually composed with in the same
  document, not against a single reference background — which is exactly what `E13-13`'s "walk
  the role map plus declared pairs" is for, and why that test must include the real fills.

- **The doc half-knew the border case.** `border.strong` existed and was labelled "must meet
  3:1", yet inputs were assigned `border.default` (2.28). A correct role existed and the wrong
  one was wired up — worth a note that having the right token is not the same as using it.

## Could not resolve → open question

- **`[DS-06]` (brand-visible contrast choice)** — four of the five §2.9 pairs (a, b, c, e)
  require a brand-visible decision on which end moves. I have flagged each in-doc and given a
  per-pair recommendation above, but the actual choice is Andy's (brand-visible) and belongs in
  `docs/open-questions.md` under `[DS-06]`. I did **not** edit `open-questions.md` (outside my
  two owned files) — this note is the hand-off for whoever merges the open-questions writeup.
