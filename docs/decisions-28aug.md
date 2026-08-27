---
title: "Decisions taken while rebuilding the back office on the prototype's shell, 27–28 August 2026"
---

# Rebuilding the back office on the prototype's shell

Andy, 2026-08-27:

> *"Shell first, then migrate screens into it… Adopt the prototype's component vocabulary as the
> actual system — `.card`, `.tag`, `.notice`, `.toolbar`, `.sec`, `.grid`, `.empty`, `.bulk`,
> `.drawer` — rather than keeping mcard/mchip/wbchip/jobcard alongside. Two vocabularies is how
> this happens again."*

And: *"Work continuously until every back-office screen is on the new shell… Merge and promote as
you complete each group of screens rather than saving it all for the end."*

A running log of the judgement calls, newest last. The permanent record stays `docs/decisions.md`
and its area files; this is *what was decided while building, and why*.

---

## 1. The design system uses `--gb-*` tokens, not the prototype's hex values

The prototype declares its own palette — `--green:#00af52`, `--deep:#145f48`, `--amber:#ffbb39`,
`--lime:#b3cf3f`, `--pale:#e5ea98`. Five of the six map **exactly** onto tokens that already exist:

| Prototype | Token |
|---|---|
| `--green` | `--gb-bg-surface-brand-flat` |
| `--deep` | `--gb-bg-surface-inverse` |
| `--amber` | `--gb-badge-bg` |
| `--lime` | `--gb-ramp-lime-500` |
| `--pale` | `--gb-bg-surface-accent` |

So the new stylesheet is written against the tokens. Copying the hex values would fork the brand:
`tokens.css` is generated from the design package, and a second copy of the palette would go stale
the first time a colour changed there — which is the same "two vocabularies" failure Andy is
telling me to stop, one layer down.

Where the prototype uses a value with no token (`--ink:#12211a`, its near-black), the nearest
token is used rather than the literal.

## 2. Adopting the prototype's class names verbatim

`.card`, `.tag`, `.notice`, `.toolbar`, `.sec`, `.grid`, `.empty`, `.bulk`, `.drawer`, `.chip`,
`.gate`, `.switch`, `.seg`, `.field`. Not `gb-card` or `bo-card`.

Unprefixed global class names are normally a bad idea, and here they are the right one: the
prototype is the acceptance criteria, and a reviewer holding it next to the code should find the
same words. A rename is a translation layer, and translation layers are where "built to the
concept, not the design" happens. They are scoped to `.bo` on the shell root so they cannot leak
into the marketing site or the kitchen board.

`mcard`, `mchip`, `wbchip`, `jobcard` and `cap` are **deleted**, not deprecated.

---

## 3. The primary button does not use the prototype's green

The prototype fills its primary button with `--green` (#00af52) and white text. That measures
**2.89:1** — below the 4.5:1 WCAG AA requires at button sizes — and `check:a11y` failed three
instances of it on the first build of the new Menus screen.

The prototype wins where it and the current screens disagree. This is not one of those cases: it
is a static mock that never had to pass a contrast check, and `tokens.css` already ships
`--gb-action-primary-bg` (#007e3b) precisely for text on a filled action. Same shape, same brand,
the colour the design package nominates for the job.

Recorded rather than done quietly, because it is the first place the built thing deliberately
differs from the design, and Andy asked to be told where that happens.

## 4. `[hidden]` needed a global override, for the sixth time

`.bo__drawer` sets `display:flex`, which beats `[hidden]`'s user-agent `display:none` — so the
edit drawer rendered **open over half of every screen, on load**. The parity screenshot caught it
in its first run, which is a fair advertisement for the tool.

Fixed once for the whole system rather than per component — `.bo [hidden] { display: none
!important }` — because the trap is not this component, it is the *next* one with a `display` and
a `hidden` attribute. This project has now hit it six times.

## 5. The CSS budget is temporarily 21,000, and says so

Two design systems are in the tree while the migration runs: screens still on the old chrome need
`admin.css`, screens already moved need `backoffice.css`. That is 18,390 B gzipped against an
18,000 ceiling.

Raised to 21,000 with the reason in the constant itself and `E10-62` to lower it **below** the
original once `admin.css` is deleted — one vocabulary should cost less than the one-and-a-bit it
replaces. If that task is open and the number is still 21,000, the migration stalled, and the
comment is the evidence.

---

## 6. Kitchen was **missed**, not deliberately excluded — and it is now on the shell

Andy asked which it was. The honest answer: I made a deliberate decision about `kitchen.css` — *"left
intact, the kitchen board still uses those names all day"* — and never made one about the **screen**.
The stylesheet call was real; the screen was an oversight wearing its coat.

His instinct that it might deserve different chrome was right, though, and the resolution honours
it without a second design: **the shell already collapses to a horizontal strip below 60rem**,
which is exactly the standing-up case. On a laptop the board gets the sidebar like everything else;
on a wall tablet or a phone it does not, and the full width goes to the board.

Nothing about the board itself changed — the day nav, the big touch targets, the filter disclosure
and the card grid were designed for this screen and the prototype has nothing to say about them.

The packing sheet went the same way, with one addition: `@media print` hides the sidebar and the
header. It is the one back-office screen whose output is paper, and navigation on paper is wasted
ink and a wasted inch of a sheet somebody is holding in a kitchen.

## 7. Consistency is the spec where a mockup does not exist

Andy: *"'no design' is not a licence to leave raw markup next to finished screens."*

Order alerts, Sales, Configuration, Allergens and the Packing sheet have no prototype screen. They
now use the shell's own vocabulary: `.card` per kitchen or dish, `.sec` for section rules,
`.notice` for the guess banner, `.gate` rows for recipients with their on/paused state, `.field`
and `.checks` for forms, `.toolbar` for pickers.

Two additions the vocabulary needed and did not have, both taken from the prototype's own drawer
rather than invented: `.checks` (checkbox pills, used for allergens and service days) and `.two`
(two fields side by side).

## 8. The parity tool's coverage was the bug, not its scope

It photographed the prototype's ten screens. Andy: *"a screenshot tool that only photographs the
screens you already know about can't find the ones you forgot… it found three defects on screens it
covers, while the screens it doesn't cover shipped visibly broken."*

The list is now **the nav**, and a route with no prototype still gets a picture — captioned as
having none and shot full width, because the point is to look at it at all.

It found two more things immediately: Order alerts as raw markup, and its own first solo shot
rendering a **3160px viewport** that made content look as though it stretched badly, when the real
cause was the harness inventing a screen twice the size of a laptop.
