# The clickable prototype

`docs/ux-spec.md` says what every screen is and what states it can be in. This is that spec you
can tap. It exists so the expensive decisions get made in minutes rather than in React Native.

```bash
node docs/prototype/build.mjs
open docs/prototype/graybag-prototype.html
```

The build produces **one self-contained file** — brand assets and all 82 real dish photographs
inlined as `data:` URIs. Put it on a phone, turn the network off, it still works.

## What is real and what is not

| | |
|---|---|
| **Real** | The brand, from `Graybag_Design Package`. The dish names and photographs, from the legacy catalogue (`tools/mirror-dish-images`). The GST split. The error codes. The screen and state inventory |
| **Not real** | Prices (plausible, not the live price list). Schools and children (fixtures). Nothing talks to Supabase |

Three dishes have no photograph — a permanent 403 at source, being re-shot under `E16-29`. They
render as the brand pattern tile, which is the state the real app needs anyway, so it is shown
rather than hidden.

## Reaching a state deliberately

The left rail forces any state: loading, empty, error, offline, unpublished, price changed,
payment pending, no allergen consent, can't-reach-backend, largest text size. That is the point —
the states that are never designed are the ones you can only reach by breaking something.

**Deep links.** The URL hash carries screen and flags, so a review comment can point at the exact
thing it is about:

```
#menu                          the menu
#menu,signedin,bigtext         the menu at the largest accessibility text size
#cart,signedin,cart            a filled cart
#cart,signedin,cart,cutoff:closed   …after the cutoff passed
#menu,unpublished              a school with no published menu
#home,cantconnect              the backend is unreachable  ← not the same screen as the one above
```

The last two are the distinction that cost us three hours, so it is worth tapping both.

## Where it deliberately differs from the reference PNGs

`ux-spec.md` §4 has the full table with reasons. In short: no password field (we have none), no
map/address screen (we deliver to a child at a school at a break time), no fake discount, no
distance in km, and allergens surfaced everywhere — the reference shows them nowhere.

## Two things it demonstrates rather than describes

- **11 screens → 8** (`ux-spec` §6.1.1). Welcome merged into Choose school; Checkout review
  merged into the cart. Both cut screens are still in the rail under "Cut from the flow" so the
  merge can be compared against what it replaced.
- **The AX5 fallback** (`ux-spec` §3.5). The two-column grid becomes a single column past the
  threshold. Toggling it found a real defect — the allergen badge occluding the veg mark at 96 pt —
  which is the sort of thing that never shows up in a screenshot review at default text size.

## Not committed

`graybag-prototype.html` is generated and gitignored: it is 4 MB of inlined binaries, and the
repo has already paid once for putting binaries in history. `prototype.src.html` and `build.mjs`
are the sources. Rebuild in seconds.
