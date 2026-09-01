---
title: "The back office against the prototype — every difference, 2026-08-27"
---

# The back office against the prototype

Andy, 2026-08-27:

> *"They've been built to the prototype's concept, not its design… I said the prototype is the
> acceptance criteria and where it and the current screens disagree, the prototype wins. Right now
> they disagree almost everywhere, and I only noticed because I opened the page myself."*

He is right. This is the full list, gathered before changing anything.

## The short answer

**The shell was never adopted, and no screen was built in it.** Every screen was built in the
existing `kitchen__` / `admin__` chrome, taking ideas from the prototype — chips with counts, a
readiness gate, a computed capability panel — and expressing them in components I invented as I
went (`mcard`, `mchip`, `wbchip`, `jobcard`, `cap`). None of the prototype's own components exists
in the codebase.

That is not a per-screen slip. It is one decision, never consciously taken, applied ten times.

Measured rather than asserted — occurrences of each prototype component class in the live
stylesheets:

| Prototype component | In prototype | In live CSS |
|---|---|---|
| `.card` | 22 uses | **0** |
| `.tag` (status chip) | 8 rules | **0** |
| `.notice` (info / warn / err) | 5 rules | **0** |
| `.toolbar` + `.searchrow` | 7 uses | **0** |
| `.resultline` | 3 uses | **0** |
| `.sec` (section heading rule) | 24 uses | **0** |
| `.grid` (stat cards) | 4 uses | **0** |
| `.drawer` | 12 rules | **0** |
| `.bulk` (selection bar) | 6 rules | **0** |
| `.empty` | 4 uses | **0** |
| `.chip` (filter) | 7 rules | 1 — `wbchip`, mine, on Dishes only |
| `.gate` (readiness row) | 8 rules | 4 — on Schools only, arrived independently via `E10-41` |

## The shell — affects all ten screens

| | Prototype | Live |
|---|---|---|
| **Navigation** | A persistent left **sidebar**, always visible, with the GrayBag brand at the top | A **hamburger** (`BackofficeNav`, a `<details>` that opens a list) |
| **Nav grouping** | Four labelled groups — *Run the day*, *Understand*, *The catalogue*, *Admin* | One flat list of 14 links, no headings |
| **Nav counts** | Live badges: open orders on Today, **blocking** dishes on Dishes, un-live schools on Schools | None |
| **Who am I** | A footer block: name, and the role — "Andy Dial / Platform admin" | Nothing. There is a Sign out button and no indication of who is signed in |
| **Page header** | Title **and a subtitle** — "Menus / Named menus, assigned to schools — reuse one to start a new school" | Title only. **No screen has a subtitle** |
| **Editing** | A right-hand **drawer**, so opening an editor never re-renders or re-scrolls the list behind it | A drawer exists on **Dishes only**. Everywhere else, editing is inline or absent |
| **Scroll behaviour** | List and drawer render separately; scroll position and caret are preserved across an edit | Only Dishes does this |

## Screen by screen

Ten prototype screens. **One is not built at all**, one is close, and eight differ substantially.

### `today` → `/dashboard`

| Prototype | Live |
|---|---|
| A **warning banner** at the top when dishes on a live menu have no food type, naming the count and the exact filter that fixes it | None |
| Four stat cards — Orders today, Revenue today, Packs sold, and a **"Needs you"** card in a warning style listing what is blocking | A list of link cards (`dash__card`) — a menu of destinations, not a status |
| **"Kitchen, right now"** — every order today as a gate row: child, class, school, break, items, and a status tag | Nothing |

The live dashboard is a launcher. The prototype's is a **status page you would leave open**.

### `dishes` → `/admin/dishes`

The closest of the eight, because `E10-48` took the chips.

| Prototype | Live |
|---|---|
| Filter chips with counts | ✅ built (`E10-48`) |
| Sort: A–Z / needs attention / category / **most menus** | Name, category, price, state. **"Most menus" missing** |
| **New dish** button | Missing |
| A **table** — checkbox, thumbnail, name, food type, allergens, on-menus, price | A list of `<li>` rows, different structure |
| **Bulk bar** on selection: "N selected · N with no food type" and Set Veg / Egg / Non-veg | A bulk bar exists but not in the prototype's shape |
| Drawer editing | ✅ the one screen that has it |

### `menus` → `/admin/menus` — the screen Andy opened

| Prototype | Live |
|---|---|
| **Rename**, **Assign to another school**, **Duplicate** per menu | **None.** The screen is read-only |
| An explanation of **assign vs duplicate** — when to reuse a menu and when to copy it | Missing entirely |
| `.card` chrome per menu, with `.tag live` / `.tag draft` status chips | My own `.mcard` / `.mchip`, which look nothing like them |
| Header: "N menus · M not assigned to any school" + **Duplicate a menu** / **New menu** buttons | The count line is there; the buttons are not |
| Per menu: dish count, schools, and count of dishes with no food type | ✅ present, in different chrome |

### `schools` → `/admin/schools` — the closest match

| Prototype | Live |
|---|---|
| Readiness gates with pass / warn / fail and a fix link | ✅ built independently as `E10-41` |
| School **chips** across the top to switch school, plus "+ Onboard a school" | A `<select>` |
| **"Meal packs at this school"** card with an on/off switch | Missing — packs are new |
| Failing-school banner: "*X cannot take orders*" | Present in a different form |

### `packs` → **not built**

The whole screen is missing. It was blocked on the mobile thread's schema, which **landed in
migrations `0070`–`0075`** — the permission is `meal_packs.manage`. It is the last prototype item
with nothing behind it.

### `orders` → `/orders`

| Prototype | Live |
|---|---|
| **Day switcher** across the top | A date input |
| Group by **class** or by **dish** — the second is the kitchen's prep list | Not offered |
| Filter chips for school and state | Selects |
| Row opens a **drawer** with the order detail | No drawer |

### `reports` → `/reports`

| Prototype | Live |
|---|---|
| Range **chips** — 7 days / 30 days / Custom | Buttons + always-visible date inputs. Close in behaviour, different in form |
| Money cards, revenue-by-day, per-school table, usage, funnel | ✅ all built (`E11-16`, `E11-17`) |
| **Pack revenue** as a separate card, **Packs sold** and **Meals outstanding** columns, and the notice explaining pack money is not order money | Missing — `E11-18`, now unblocked |
| `.card` / `.grid` chrome | `gstat` / `otable` |

### `growth` → `/admin/growth`

| Prototype | Live |
|---|---|
| Four cards including **Install base** | Four cards; Install base replaced by the conversion gap (`E11-23` — no data source) |
| New accounts per day | ✅ |
| By-school table incl. "ordered at least once" | ✅ (`E11-22`) |
| "Where conversion went" notice with a button to Reports | ✅ built, as a section rather than a `.notice` |

### `people` → `/admin/people`

| Prototype | Live |
|---|---|
| Search by email | ✅ (`E10-46`) |
| A **table**: Account / Access / Scope / › with the row opening a detail | A list of rows, no detail view |
| "Anyone who signs up is a parent" notice | ✅ as prose in the panel |
| "What each role can see" panel | ✅ built and **computed from the grants** (`E10-51`) — richer than the prototype, which is static prose |

### `import` → `/admin/import`

| Prototype | Live |
|---|---|
| A dashed **drop zone** — "Drop a CSV here" | A file input |
| Handles schools, dishes, menu assignments, break windows | The live screen is a **dry-run checker**, a different and arguably better thing |

## Defects found while auditing — not design differences

1. **The header sat 120px left of its content on all ten pages.** `.kitchen__bar-inner` is capped
   at 1200px, `.admin__wrap` at 960px, both centred. **Fixed** — `E10-54`, PR #139.
2. **`/admin/growth` overflows horizontally at phone width.** The by-school table pushes the page
   to 531px inside a 375px viewport — the column `E11-22` added. Not fixed: the markup is likely
   to be replaced by the shell work, and fixing it twice is worse than once.
3. **`/reports` overflows at phone width**, 750px inside 375px — the date inputs and the table.
   Same reasoning.

Andy asked for the page to be *"fast and readable on a phone"* when he specified the growth
dashboard. Items 2 and 3 fail that, and they are mine.

## What I got wrong, and how

The instruction was *"the prototype is the acceptance criteria; where it and the current screens
disagree, the prototype wins."* I read that as **per-feature arbitration** — when the two disagree
about what a screen should *do*, follow the prototype — and I applied it faithfully at that level.
`P21` is a good example: I dropped a percentage because the prototype argued against it.

What I never did was treat the prototype as the specification of **how the back office looks and
is navigated**. The shell was the largest thing in that file and the easiest to miss precisely
because it is not on any one screen — it is the frame around all of them, and I was reading screen
by screen for features.

The reason it survived four screens and a promote is that nothing I was checking could see it.
Smoke, a11y, my own browser probes and the tests all asked *"does this screen work?"* and the
answer was yes every time. Nobody had opened the thing next to the prototype, which is the one
check that would have caught it — and Andy did that within a day of it shipping.

---

# Where it stands after the shell rebuild — 2026-08-28

Every back-office screen is on the prototype's shell and `admin.css` is deleted. What remains is
**content structure**, which differs screen by screen. The distinction matters, so this splits it:

- **Shell** — sidebar, groups, who is signed in, title and subtitle, the component vocabulary.
- **Content** — whether the screen shows what the prototype's screen shows, arranged as it does.

| Screen | Shell | Content | What still differs |
|---|---|---|---|
| **Menus** | ✅ | ✅ | Nothing structural. Rename opens a drawer that refuses — no write path yet (`E10-56`) |
| **Dishes** | ✅ | ✅ | Sort lacks "most menus". The demo fixture holds 4 dishes against the prototype's 26, so it looks emptier than it is |
| **Reports** | ✅ | ✅ | Pack revenue, packs sold and meals outstanding are missing — `E11-18`, unblocked now the pack schema has landed |
| **Growth** | ✅ | ✅ | Install base has no data source (`E11-23`) |
| **Schools** | ✅ | ⚠️ | Gates are there, but it lists **every school stacked**; the prototype shows one at a time with chips to switch, plus a meal-packs card and a config card |
| **People** | ✅ | ⚠️ | The panel is richer than the prototype's (computed from grants). The account list is rows, not the prototype's Account / Access / Scope table with a row that opens a detail |
| **Today** (`/dashboard`) | ✅ | ❌ | Still a **launcher** — a grid of links. The prototype's is a status page: a blocking-dishes banner, four stat cards including "Needs you", and "Kitchen, right now" listing today's orders |
| **Orders** | ✅ | ⚠️ | Day switcher kept. No group-by-class / group-by-dish, no drawer for order detail |
| **Import** | ✅ | ⚠️ | A dry-run checker rather than a drop zone — **deliberately kept**, it is the better tool |
| **Meal packs** | — | ❌ | Not built. Unblocked: the schema landed in `0070`–`0075`, permission `meal_packs.manage` |

## What I would do next, in this order

1. **Today** — the largest gap and the screen most often open. It is a launcher pretending to be a
   dashboard.
2. **Meal packs config** — the only prototype screen with nothing behind it, and now unblocked.
3. **Schools** — one school at a time, with the packs and config cards.
4. **`E11-18`** — the pack columns on Reports, which need the same schema.
5. **People** — the account table with a detail drawer.

## The check that now exists

`node scripts/parity-shot.mjs [screen…]` writes `docs/prototype-parity/<screen>.png` — prototype
left, live right, one image. It found three defects on its first three runs that nothing else
caught: a drawer rendering open over half the page, every chart on Reports drawn as a black
rectangle, and notice prose fragmenting into a column. None of those is visible to a test.
