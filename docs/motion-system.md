---
title: Motion system
status: specification — no code exists yet
produced_by: Q05
implements: E13-04, E13-05, E13-06, E13-07
source: ../Legacy-Application-backup/Graybag_Design Package — 06_App UI (not in this repo; see docs/decisions.md)
companion: docs/design-tokens.md
review: E13-09 (owner:andy) — Andy reviews this once before app UI work starts
---

> ## What this document is
>
> A **closed catalogue of fourteen motions**, `M01`–`M14`. Every animation in the mobile app,
> the marketing site and the back-office web comes from this list. A new screen implements from
> it; it does not invent.
>
> Adding `M15` requires an entry in `docs/decisions.md` saying which genuinely new kind of
> interaction appeared and why nothing here covered it. A reviewer should reject bespoke
> animation in a pull request the way they would reject a hard-coded hex.
>
> This is the difference between an app that feels fluid and an app that feels like a flying
> bird. Fluidity is not more motion; it is the *same* motion everywhere, so the user stops
> noticing it and starts trusting it.

# GrayBag — motion system

---

## §1 The three things motion has to survive here

Everything below follows from these, so they are stated first.

1. **The network is the constraint, not the CPU** (P11). The audience is private schools in
   tier-1 Indian cities on mid-range Androids over unreliable connections. Animation time is
   added *on top of* an already-long wait. A 400ms transition is not elegant when the data
   behind it took 3 seconds; it is 400ms of extra nothing. This is why the ceiling is 350ms and
   why the loading story is skeletons rather than spinners.
2. **The app moves money and feeds children.** Delight is not the goal. A parent placing a
   Rs. 249 order at 11pm before a midnight cutoff wants certainty. Motion earns its place by
   making state legible, never by being charming.
3. **A kitchen tablet is a work tool.** The back office runs on a tablet in a hot kitchen with
   someone in a hurry. Motion there is a tax on time. §7 restricts it hard.

---

## §2 The duration scale

Four tokens. Three of them animate.

| Token | Value | What it is for |
|---|---|---|
| `duration.instant` | 0ms | The reduce-motion substitute, and nothing else |
| `duration.fast` | **120ms** | A state change on an element that is already on screen and stays there — press, colour, opacity, a checkbox, an exit |
| `duration.base` | **200ms** | An element enters or leaves — sheet, toast, list item, tab indicator, cross-fade |
| `duration.slow` | **320ms** | A whole surface changes — screen push, shared element, a sheet with a long travel |

**Hard ceiling: 350ms.** Nothing in the product animates for longer. There are exactly two
exemptions and both are named: the `M03` skeleton shimmer (a loop, which has no "duration" in
this sense) and the `M06` spring (§4), whose sub-pixel settle runs to ~330ms.

Two derived rules:

- **An exit is one step faster than its entrance.** A sheet enters at `slow` and leaves at
  `base`; a toast enters at `base` and leaves at `fast`. Things arriving deserve to be
  understood; things leaving deserve to get out of the way.
- **Stagger step is 30ms, for a maximum of 6 elements.** Six items is 150ms of added latency,
  which is the most a list may cost. Item seven onwards appears with the sixth.

**No other duration exists.** A `withTiming` with a literal `180` fails the build (§9).

### §2.1 Why 350ms and not 500ms

Below ~100ms a change reads as instantaneous and the user does not learn where the new thing
came from — which is the entire point of the entrance. Above ~350ms the motion stops being a
cue and becomes a wait, and the app is described as "slow" even when it is fast. The band from
120 to 320 is where a transition is perceptible, informative, and free. Most Material and HIG
guidance lands in the same place; the difference here is that the ceiling is enforced by lint
rather than by taste.

---

## §3 The three easing curves

Named by role, not by shape, so that choosing one is a question about the content rather than
about aesthetics.

| Token | Bezier | Use it when |
|---|---|---|
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | The element is on screen before and after. It moves, resizes, or changes colour. **This is the default and most motion uses it.** |
| `ease.enter` | `cubic-bezier(0, 0, 0, 1)` | The element is arriving. Full speed immediately, decelerating into place. Never used for an exit |
| `ease.exit` | `cubic-bezier(0.4, 0, 1, 1)` | The element is leaving. Starts gently, accelerates away, and is not seen to stop |

`linear` is permitted in exactly one place: the `M03` shimmer sweep, because a loop with easing
visibly pulses.

Choosing is mechanical:

```
Is it on screen before AND after?  → ease.standard
Is it arriving?                    → ease.enter
Is it leaving?                     → ease.exit
```

---

## §4 The one spring

A spring is not an easing curve — it has no fixed duration, it overshoots, and it composes
badly with the other three. So there is exactly **one spring in the system and exactly one
place it is allowed**: `M06`, the cart badge.

```
spring.pop = { damping: 24, stiffness: 320, mass: 1 }
```

Which is ζ ≈ 0.67 — about **5.8% overshoot**, one bounce, settled within ~330ms. It reads as a
small confident pop, not as jelly.

**Any `withSpring` outside the cart badge module fails the build** (§9). If a second spring is
ever genuinely needed, it is a new catalogue entry and a decision-log line, not a copy-paste.

Note the deliberate asymmetry with `E13-04`, which asked for three easing curves. Three curves
is what §3 delivers. The spring is a fourth *kind* of motion, allowed once, under a name that
makes its single use site obvious. Recorded as `S4` in `docs/decisions.md`.

---

## §5 Direct manipulation

Three patterns (`M07` drag-to-dismiss, `M08` pull-to-refresh, `M14` swipe-to-act) follow the
finger. For these:

- **There is no duration while the finger is down.** The element tracks the gesture 1:1. The
  duration scale applies only to the release.
- **Release is velocity-projected**, not a fixed animation: a fast flick completes sooner than
  a slow drag, because the user has already told the system how urgent it is. The projection is
  capped so that no release, however slow, exceeds 350ms.
- **Resistance is rubber-banded past the threshold** — the element keeps moving but at a
  decreasing fraction of the finger, so the limit is felt rather than hit.
- **A gesture is always reversible mid-flight.** Dragging a sheet halfway down and back up
  cancels; there is no point of no return that is not visibly signalled first.

---

## §6 The catalogue

Fourteen entries. Each states what it does, the tokens it uses, where it is allowed, where it
is **not**, and what it degrades to under reduce-motion.

---

### `M01` — Press feedback

**What.** On press-in, the element scales to `0.97` and drops to `opacity 0.92`. On press-out
or cancel, it returns. `duration.fast` (120ms), `ease.standard`, both directions.

**Allowed on.** Every tappable element that has a visible surface: buttons, cards, list rows,
chips, the tab bar.

**Not on.** Inline text links (they get a colour change instead, `M04` at `fast`). Anything
under 32pt visually — a 28pt stepper button scaling to 0.97 is invisible and just costs frames;
those get the colour change too.

**Reduce motion.** Scale is dropped, opacity change is kept.

**Why it exists.** It answers *did my touch register*, on a connection where the real answer
may be three seconds away. This is the single most important motion in the app.

---

### `M02` — Staggered list entry

**What.** Items fade `0 → 1` and translate `Y +8 → 0`. `duration.base` (200ms), `ease.enter`,
staggered `30ms` apart for the first six items; everything after appears with the sixth.

**Allowed on.** The menu grid, order history, the dependents list, the cart on first paint,
the kitchen packing list. Once, on mount.

**Not on.**
- Re-renders. A list that has already appeared never re-staggers.
- Scroll. Items entering the viewport do not animate — this is the difference between a list
  that feels fast and one that feels like it is dealing cards.
- Pagination. An appended page cross-fades in as a block (`M04`), no stagger.
- Search results as the user types. Those are `M04`.
- Any list that re-sorts or re-filters in place.

**Reduce motion.** No translate, no stagger; the list cross-fades in as one block at `fast`.

---

### `M03` — Skeleton shimmer

**What.** The loading state for **every** first-load in the product. No spinners anywhere
(`E13-07`). A `neutral-100` block with a `neutral-0` highlight band swept left to right over
`1200ms`, `linear`, with a `400ms` pause between sweeps.

The contrast between base and highlight is deliberately tiny (~1.13:1). A high-contrast
shimmer reads as a broken image rather than as loading.

**The geometry rule.** A skeleton's boxes must match the real content's boxes exactly — same
radius, same heights, same gutters — so that nothing shifts position when the data lands. A
skeleton that reflows on swap is worse than a spinner, because it moves the thing the user was
about to tap.

**Allowed on.** Every screen's first load. Enumerated in §8.

**Not on.**
- Refreshing content that is already visible. That is `M08`, and the content stays put.
- An action in progress. That is `M09`.
- Anything that will finish in under ~150ms from cache — flashing a skeleton for one frame is
  worse than showing nothing.

**Performance.** Shimmer only the viewport plus one row. A shimmer on fifty off-screen
placeholders is a real cost on a mid-range Android.

**Reduce motion.** The sweep stops. The skeleton is a static `neutral-100` block.

---

### `M04` — Cross-fade state change

**What.** The default answer to "this region now shows something else". Outgoing fades out over
`fast` (120ms) with `ease.exit`; incoming fades in over `base` (200ms) with `ease.enter`;
the two overlap by 60ms so the region is never empty. If the container's height changes, it
animates over `base` with `ease.standard`.

**Allowed on.** Skeleton → content. Empty → populated. Error → content. Tab panel switch.
Search results updating. A total recalculating. A button label changing. An icon changing state.

**Not on.** Anything where the user needs to see *where* the new thing came from — that is
`M02`, `M05` or `M07`.

**Reduce motion.** Unchanged. A cross-fade is already the reduce-motion-safe primitive; only
the height animation is dropped.

---

### `M05` — Shared element: dish card → dish detail

**What.** The dish **image, and only the image**, morphs from its position in the menu grid to
its hero position in the detail sheet. `duration.slow` (320ms), `ease.standard`. Everything
else on the sheet — name, price, toppings, the Add to Cart button — fades and rises in behind
it at `base` with `ease.enter`, no stagger. Dismissing reverses at `base` with `ease.exit`.

**Allowed in exactly one place: the dish card ↔ dish detail transition, both directions.**
Nowhere else in the product, on any surface.

**Why only there.** A shared element is the most expensive and most fragile motion available —
it needs both layouts measured, both images resolved, and it breaks visibly when either
assumption fails. It earns that cost once, on the app's core action, and reads as showing off
anywhere else. This restriction is the single most likely thing to be argued with later; the
argument should be had in `docs/decisions.md`, not in a component.

**The degradation rule, which is mandatory.** If the source image has not loaded, or the source
card is off-screen (a deep link, a reorder, a push notification), **skip the shared element and
present the sheet with `M07`.** The transition must degrade instantly; it must never wait for
an image, and it must never stall.

**Reduce motion.** No morph. The sheet presents with `M07`'s reduce-motion form and the hero
image cross-fades.

---

### `M06` — Cart badge spring

**What.** When a line is added to the cart, the badge on the tab bar scales `1 → 1.28 → 1`
using `spring.pop` (§4). The count itself cross-fades (`M04`, `fast`) at the peak of the
overshoot, so the number changes when the badge is largest.

**Allowed in exactly one place: the cart badge, on a user-initiated add.**

**Not on.** Cart hydration at app launch. Quantity changes made *inside* the cart screen, where
the user is already looking at the number. Removals.

**Why it exists, and why it is the only spring.** Adding to cart is the one action in the
product whose confirmation appears somewhere other than where the user is looking — the finger
is on a dish card at the bottom of the screen, the badge is in the tab bar. It needs to attract
the eye, and a spring attracts the eye. Everywhere else, attracting the eye is a bug.

**Reduce motion.** No scale. The count changes with `M04` at `fast`.

**Haptics.** `Haptics.selectionAsync()` fires with the add. This and `M14`'s arm threshold are
the only two haptics in the product.

---

### `M07` — Bottom sheet and dialog

**What.** The sheet translates `+100% → 0` over `slow` (320ms) with `ease.enter`; the scrim
fades to `bg.scrim` (48%) over `base` with `ease.standard`. Dismiss is `base` with `ease.exit`,
scrim `fast`. Drag-to-dismiss follows §5.

A dialog (centre-anchored, used only for a destructive confirm) scales `0.96 → 1` and fades in
over `base` with `ease.enter`.

**Allowed on.** Dish detail, break-time picker, date picker, allergen warning, cancel-order
confirm, filters, the school/recipient picker.

**Not on.** Anything with more than one screen of content — that is a pushed screen (`M12`).
**Sheets never stack.** Opening a second sheet dismisses the first; a sheet on a sheet is a
navigation model, not a motion.

**Interactivity.** The sheet accepts touches from the first frame of its entrance. See §7 rule
2 — motion never gates input.

**Reduce motion.** No translate. The sheet and the scrim cross-fade in at `base`.

---

### `M08` — Pull to refresh

**What.** Direct manipulation (§5). The content follows the finger 1:1 to `56pt`, then
rubber-bands to a maximum of `80pt`. Released above the threshold, it snaps to 56 over `base`
with `ease.standard` and the indicator runs. On completion, the indicator collapses over `base`
with `ease.exit` and **the content does not move**.

**The rule that matters.** **The list is never replaced by skeletons on a refresh.** Content
that vanishes on a pull is the single most reliable way to make a user on a bad connection
believe the app has lost their data. New data swaps in with `M04`; the scroll position is
preserved; if nothing changed, nothing moves.

**Allowed on.** The menu, order history, the kitchen order queue, the admin dashboard.

**Not on.** The cart. Forms. Anything holding unsaved state.

**Reduce motion.** The gesture is unchanged (it is the user's own motion). The indicator's own
rotation is replaced by a static glyph with an opacity pulse at `base`.

---

### `M09` — In-flight action feedback

**What.** For a write that goes to the network and that the user must not repeat — Place Order,
Cancel Order, Save Recipient, and (with the timeout caveat below) Pay. The button's label
cross-fades (`M04`) to an **indeterminate progress track inside the same pill**. The button
keeps its exact size and position. It is disabled but not removed and not dimmed to
invisibility.

**Not a rotating spinner, and never full-screen.** A modal blocking spinner over the whole app
is forbidden. The only thing that is busy is the control the user pressed.

**Timeout.** If the call has not returned in 8 seconds, the button reverts to its label and an
inline `M10` error appears with a retry. The user is never left holding a button that is
spinning forever. **This 8-second timeout-and-retry applies to Place Order, Cancel Order and
Save Recipient only.**

**Pay is explicitly excluded from the timeout-and-retry.** A retry button at 8 seconds on Pay
manufactures a double charge: a UPI collect can sit `pending` for up to ~30 minutes
(`[OL-03]`), and if the customer taps retry and then pays another way, attempt 1 may still
succeed — two real debits for one cart (`order-lifecycle.md` §10.6b), which `[OL-05]` says the
schema cannot currently record, so it cannot even be reconciled and refunded. Pay therefore
follows `order-lifecycle.md` §13's `payment_pending` (202) behaviour instead: the control shows
the same in-flight track with **no timeout**, the app polls `GET /checkout/:group/status`, and
it presents an **unbounded waiting state** — never a success screen, never an 8-second retry.
The waiting state resolves only when the poll returns a terminal status, or when the checkout's
own TTL expires server-side (`[OL-03]`). This implements `E13-20`.

**Allowed on.** Exactly the writes above, and their equivalents in the back office. **Pay uses
`M09`'s in-flight track but not its timeout — see the Pay exclusion above.**

**Not on.** Add to cart, quantity change, favourite, and every other optimistic action. Those
apply instantly and reconcile in the background (`E14-08`) — see §7 rule 8.

**Reduce motion.** The indeterminate track becomes a static filled track with the label
"Placing order…".

---

### `M10` — Inline error and validation

**What.** The message expands from height `0 → auto` and `opacity 0 → 1` over `base` with
`ease.enter`. It collapses at `fast` with `ease.exit`. Content below it moves with the same
timing, not separately.

**There is no shake.** A shake costs ~300ms, moves the thing the user is trying to read, and
reads as scolding. The colour, the icon and the words carry the message.

**Allowed on.** Field validation, a failed write, a cutoff-passed notice, an allergen conflict
that is informational rather than blocking.

**Not on.** Anything that must interrupt — an allergen conflict that blocks the add is a sheet
(`M07`), because the user has to make a decision.

**Accessibility.** Every inline error is announced (`accessibilityLiveRegion="polite"` /
`aria-live="polite"`) and is associated with its field. The animation is cosmetic; the
announcement is the actual mechanism.

**Reduce motion.** No height animation. The message appears with a `fast` fade.

---

### `M11` — Tab and segment indicator

**What.** The indicator **travels**; it does not fade out in one place and in at another. The
menu-category underline slides over `base` with `ease.standard`. The bottom tab bar animates
icon colour and fill over `base`, and the label weight is not animated (animating a font weight
is a reflow). The panel beneath swaps with `M04`.

**Allowed on.** The bottom tab bar, menu category tabs ("All / Featured / Top of Week /
Pure-Veg", mock 06), the admin table's segmented controls, the save-address selector (mock 08).

**Not on.** Anything with more than about five segments, where the travel becomes a distraction
rather than a cue.

**Reduce motion.** The indicator jumps; the panel still cross-fades.

---

### `M12` — Screen push and pop

**What.** **The platform default.** iOS horizontal push with the interactive back-swipe intact;
Android's own forward/back transition, including predictive back. Capped at `slow` (320ms) where
the navigator allows it to be configured.

**The rule.** **Do not replace platform navigation transitions with a bespoke one.** The user's
muscle memory and the OS gesture are worth more than any custom transition, and a custom
transition on Android breaks predictive back — which is a real regression, not a stylistic one.

**Allowed on.** All stack navigation.

**Not on.** Nothing to add — there is no variant.

**Reduce motion.** Handled by the OS and by the navigator's reduce-motion support; both
platforms substitute a cross-fade. Do not reimplement this.

---

### `M13` — Toast

**What.** Enters from the bottom, above the tab bar and above the safe area: `translateY +16 → 0`
and `opacity 0 → 1` over `base` with `ease.enter`. Auto-dismisses after **4s**, or **6s** if it
carries an action (Undo), at `fast` with `ease.exit`. One at a time — a second toast replaces
the first with `M04` rather than queueing or stacking.

**Allowed for.** Non-blocking confirmations ("Order cancelled"), recoverable errors with a
retry, and `M14`'s undo.

**Not for.** Anything requiring a decision (that is `M07`). Anything the user must not miss —
a toast is dismissible by time, so it can be missed by definition.

**Accessibility.** Announced politely. The auto-dismiss timer pauses while a screen reader has
focus inside it, and any toast with an action is reachable by the focus order before it
disappears.

**Reduce motion.** No translate; fade only.

---

### `M14` — Swipe to act on a list row

**What.** Direct manipulation (§5). The row follows the finger; the action background is
revealed behind it. Past **40% of the row width** the action arms: the background deepens to
its full colour and `Haptics.selectionAsync()` fires once. Released below the threshold, the
row snaps back over `base` with `ease.standard`. Released above, the row translates fully out
over `base` with `ease.exit`, then its height collapses to 0 over `base` with `ease.standard`,
and an `M13` toast offers Undo.

**Allowed on.** Cart lines (remove), the kitchen queue (mark delivered), admin lists (archive).

**Not on.** Order history. A swipe gesture on a paid financial record looks destructive even
when it is not, and the recovery cost of a mistake is a support conversation about money.

**Only one action per row, and only one direction.** No two-sided swipe menus, no reveal-then-
choose. If a row needs two actions, it needs a long-press menu, which is not in this catalogue
and would be `M15`.

**Reduce motion.** The gesture is unchanged. The out-translate is dropped: the row cross-fades
and collapses.

---

## §7 Rules of restraint

These are the part of the document that survives the longest. The catalogue will be amended;
these should not be.

1. **Motion communicates, or it does not ship.** Every animation must answer exactly one of
   four questions:
   - *Where did this come from?* — `M02`, `M05`, `M07`, `M13`
   - *What changed?* — `M04`, `M06`, `M10`, `M11`
   - *Did my touch register?* — `M01`, `M14`
   - *Is the system working?* — `M03`, `M08`, `M09`

   If a proposed animation answers none of them, it is decoration. Delete it.

2. **Motion never blocks input.** No animation gates a tap. A user who taps a card mid-
   transition gets the tap. Sheets are interactive from the first frame. There is no splash
   animation to sit through — the splash is a static composition that is on screen for exactly
   as long as the app takes to boot, and not one frame longer.

3. **Reduce motion is honoured everywhere, and it is never "turn animation off".**
   `AccessibilityInfo.isReduceMotionEnabled()` on mobile, `prefers-reduced-motion` on web, read
   once at the root and provided to every animated component. Each catalogue entry states its
   substitute above, and they are collected in §10. The principle: **motion that conveys state
   must still convey it.** A translate becomes a cross-fade; a shimmer becomes a static block;
   a spring becomes an instant change. Nothing becomes silence.

4. **Nothing runs longer than 350ms, and nothing loops** except `M03`'s shimmer and `M09`'s
   in-flight track.

5. **One motion at a time in one region.** Two things animating in the same place is noise. A
   screen has at most one entrance animation running. If a sheet is entering, the list behind
   it is not staggering.

6. **Animate `transform` and `opacity` only.** Never width, height, top, left, margin or
   padding — with exactly **three** documented exceptions: `M10`'s and `M14`'s height collapses
   (both short and confined to a single row), and `M04`'s container-height animation when a
   cross-faded region changes height (see `M04` and §10). On web the same rule applies and is
   what keeps everything off the layout thread.

7. **All animation runs on the UI thread.** Reanimated worklets. Never `Animated` with
   `useNativeDriver: false`. Never `setState` per frame. A dropped frame on the mid-range
   Android profile is a bug, and `E19-02` sets the number that CI enforces.

8. **Optimistic first, motion second.** Cart actions apply instantly and then animate; they
   never animate *while waiting* for the network. `M09` exists only for the small set of writes
   that genuinely cannot be optimistic because money moves. This is P11 and `E14-08` expressed
   as motion.

9. **No decorative loops, ever.** No pulsing buttons, no bouncing arrows, no confetti, no Lottie
   mascots, no animated illustration on the empty state, no parallax. The one celebratory moment
   in the mocks — "congratulations, your account is complete" — is a static composition and
   stays one.

10. **The catalogue is closed.** `M01`–`M14`. New screens implement from it. `M15` requires a
    line in `docs/decisions.md` naming the genuinely new interaction.

11. **Haptics are motion and obey the same restraint.** Exactly two: `M06`'s add-to-cart and
    `M14`'s arm threshold. Never on scroll, never on every tap, never on success.

12. **Nothing animates off-screen.** No animation runs while the screen is unfocused, the app is
    backgrounded, or the element is outside the viewport. This is a battery and a data rule as
    much as a performance one.

13. **Motion is not a substitute for speed.** If a screen needs a transition to feel acceptable,
    the screen is too slow. Fix the screen.

---

## §8 Where each pattern is allowed

Read across. **`—` means the pattern is not permitted on that surface at all.**

| | Mobile app | Marketing site (`E12`) | Admin / kitchen web (`E09`, `E10`) |
|---|---|---|---|
| `M01` Press feedback | ✓ all tappables | ✓ buttons, cards | ✓ buttons, rows |
| `M02` Staggered list entry | ✓ menu, orders, dependents, cart, packing list — **on mount only** | ✓ **restricted**: section fade+rise on first scroll into view, max 3 elements, **no stagger**, no parallax | — never. A table that animates in wastes an operator's time |
| `M03` Skeleton shimmer | ✓ every first load | ✓ above-the-fold image only | ✓ tables and cards, **static, no shimmer** |
| `M04` Cross-fade | ✓ | ✓ | ✓ |
| `M05` Shared element | ✓ **dish card ↔ dish detail only** | — | — |
| `M06` Cart badge spring | ✓ **cart badge only** | — | — |
| `M07` Sheet / dialog | ✓ | ✓ dialogs only (contact form) | ✓ confirms and side panels; **entrance at `base`, not `slow`** |
| `M08` Pull to refresh | ✓ menu, orders, kitchen queue | — | ✓ kitchen queue on tablet; desktop uses an explicit Refresh with `M09` |
| `M09` In-flight action | ✓ place order, pay, cancel, save | ✓ form submit | ✓ every write |
| `M10` Inline error | ✓ | ✓ | ✓ |
| `M11` Tab / segment indicator | ✓ | ✓ | ✓ |
| `M12` Screen push / pop | ✓ platform default | — (page loads) | — (routes cross-fade with `M04`) |
| `M13` Toast | ✓ | ✓ form confirmation | ✓ |
| `M14` Swipe to act | ✓ cart, kitchen queue, admin lists | — | ✓ tablet only; desktop uses a row action button |

**The back office is deliberately near-motionless.** Five patterns carry it: press feedback,
cross-fade, in-flight, inline error, tab indicator. A kitchen operator marking forty orders
delivered before a break should never wait for an animation, and a shimmer over a table of
numbers is actively harder to read than a plain "Loading".

**The marketing site's one indulgence** is a section fade-and-rise on scroll — `M02` without the
stagger, once per section, disabled entirely under `prefers-reduced-motion`. No parallax, no
scroll-jacking, no number counters. The current site (`GrayBag.com - website - homepage.pdf`)
has none of this and is not the reference for the rebuild; the design package is.

---

## §9 How the catalogue is enforced

A closed catalogue that lives only in a document reopens itself within three sprints. Three
mechanical gates — gate 1 and gate 3 are `E13-12`, gate 2 is `E13-11`:

1. **One motion module.** `packages/shared/src/design/motion.ts` exports `duration`, `ease`,
   `spring` and nothing else. Every animated component imports from it.
2. **Lint.** A rule fails the build on:
   - any numeric literal passed as a `withTiming` / `transition-duration` value,
   - any `Easing.bezier(...)` or `cubic-bezier(...)` literal outside `motion.ts`,
   - any `withSpring` outside the single cart-badge module,
   - `transition: all` on web,
   - animating any property other than `transform` / `opacity`, outside the three files
     implementing `M04`'s container-height animation, `M10` and `M14`.
3. **Reduce-motion tests.** Every animated component has a test that renders with reduce-motion
   on and asserts the substitute from §10 — not merely that "nothing animates". A component that
   silently drops a state change under reduce motion is an accessibility bug that no visual
   review will catch.

Plus the frame-budget gate from `E19-02` / `E14-07`, which is what stops the catalogue being
correct and slow at the same time.

---

## §10 Reduce-motion substitutions, collected

| Pattern | With reduce motion on |
|---|---|
| `M01` Press | Opacity change only; no scale |
| `M02` List entry | Whole list cross-fades at `fast`; no translate, no stagger |
| `M03` Skeleton | Static `neutral-100` block; sweep stops |
| `M04` Cross-fade | Unchanged; height animation dropped |
| `M05` Shared element | No morph; sheet presents as `M07`-reduced, hero image cross-fades |
| `M06` Cart badge | Count changes with `M04` at `fast`; no scale, no spring |
| `M07` Sheet / dialog | Sheet and scrim cross-fade at `base`; no translate, no scale |
| `M08` Pull to refresh | Gesture unchanged; indicator is a static glyph with an opacity pulse |
| `M09` In-flight | Static filled track plus a text label |
| `M10` Inline error | Fade at `fast`; no height animation |
| `M11` Tab indicator | Indicator jumps; panel still cross-fades |
| `M12` Push / pop | OS and navigator handle it — do not reimplement |
| `M13` Toast | Fade only; no translate |
| `M14` Swipe | Gesture unchanged; row cross-fades and collapses instead of translating out |

---

## §11 Skeletons, screen by screen (`E13-07`)

Every first load. No spinners. Each skeleton's geometry must match the real content exactly
(§`M03`).

| Screen | Skeleton |
|---|---|
| Home | Delivery card block; promo card block; "Top of Week" — 3 image tiles with two text lines each |
| Menu | Category tab row (static); 4 grid tiles, each an image box + two text lines |
| Dish detail sheet | Hero image box; title line; price line; two option rows. Add-to-Cart is real and disabled |
| Cart | 2 line rows: thumbnail + two text lines + stepper block. Totals block: 4 right-aligned bars |
| Checkout | Recipient row; break-time row; totals block |
| Order history | 5 rows: date line, status pill, amount bar |
| Order detail | Status block; 3 line rows; totals block |
| Profile / dependents | Avatar circle + 2 lines; 3 dependent rows |
| Kitchen queue | Table header (real) + 8 rows of bars |
| Admin dashboard | 4 stat cards, each a label line + a number bar |
| School report page | Title block + table skeleton |

Two cases are **not** skeletons: an empty state (a real composition with an illustration and an
action) and an error state (a real message with a retry). A skeleton that never resolves because
the request failed is the worst loading state there is; every skeleton has a timeout that turns
it into an error state.

---

## §12 What is deliberately absent

Listed so that their absence reads as a decision rather than an oversight.

| Not in the system | Why |
|---|---|
| Splash animation | Rule 2. The splash is static and lasts exactly as long as the boot |
| Confetti / celebration | Rule 9. "Congratulations" is a static screen in the mocks and stays one |
| Lottie / Rive | No runtime animation player is added. It is a dependency, a bundle cost, and an invitation to break rule 9 |
| Parallax, scroll-jacking, number counters | Rule 9, §8 |
| Shake on error | `M10`. It scolds and it moves the text being read |
| Full-screen blocking spinner | `M09` |
| Skeleton on refresh | `M08`. Content that disappears on a pull reads as data loss |
| Custom navigation transitions | `M12`. Breaks Android predictive back |
| Long-press reveal menus | Would be `M15`. `M14` allows one action per row |
| Animated tab bar labels | Animating font weight is a reflow |
| Dark-mode transition | There is no dark mode in v1 — `[DS-03]` |

---

## §13 Open questions

None of the motion system's own choices are blocked. Two adjacent questions affect it and are
tracked in `docs/open-questions.md`:

| Q | Effect on this document |
|---|---|
| `E19-02` — the mid-range Android performance spike | Sets the frame budget in §9 and validates `M05`, the only pattern that could fail it. **`M05` is provisional until that spike runs**; if a shared element cannot hold 60fps on the target profile, it is deleted and dish detail becomes a plain `M07` sheet |
| `[DS-01]` — the primary-green contrast fix | Changes the colour of `M01`'s pressed states and `M09`'s progress track, not their timing |

`E13-09` (`owner:andy`) is Andy reviewing this document once, before app UI work starts. The
one thing worth his time is §6 `M05` and §7 rule 9 — how much personality the app is allowed to
have. Everything else here is engineering.
