# Decisions — 17 August 2026

An unattended run. Andy asleep; the instruction was to decide, record here, and keep going.

---

## D-17A — service days set to Mon–Sat on all three schools

Andy's decision, stated and applied: *"Every dish is already Mon–Sat, so ordering for Sunday is a
bug not a feature."*

`school_config.service_days = [1,2,3,4,5,6]` on Amity, Paragon and Gem, written through
`admin-school` as Andy's own signed-in session rather than by SQL — the config path has an audit
trigger that reads `updated_by_user_id`, and a direct UPDATE would have left the change
unattributed.

All three previously read `null`, which inherits the platform default of all seven days. That is
the `check:launch` warning cleared.

---

## D-17B — food types are proposed, never written

*"Prepare, don't decide."* `scripts/propose-food-types.mjs` writes two files and touches nothing.

The classifier is deliberately **asymmetric**, because the errors are not symmetric. A dish marked
`veg` that contains egg is a broken promise to a parent; a dish left unmarked is merely unfinished.
So:

- evidence of egg or meat is taken at face value → high confidence;
- **absence of evidence is not evidence of absence** — 11 production dishes have no ingredient list
  at all, and the module *refuses to guess* rather than reading "Lemonade" as obviously vegetarian.
  Their `food_type` cell is blank, and a blank is "no opinion" to the importer, so applying the
  file leaves them exactly as they are;
- ingredients that are *usually* but not *always* vegetarian — **mayonnaise** above all, where
  eggless is the Indian default and egg mayo genuinely exists — are proposed `veg` and marked low
  with the reason attached.

79 unmarked: **37 confident veg, 9 egg, 22 veg-worth-a-glance, 11 no proposal.** The 9 egg dishes
were checked by hand against the source and all 9 genuinely contain egg — no false positives, which
is the direction that would matter.

The CSV carries only `name`, `kitchen_code`, `category` and `food_type`. The importer compares only
the fields a file actually carries, so applying it **cannot** change a description or a price. The
dry run confirms it: 68 changes, every one of them `changing: foodType`.

---

## D-17C — allergen suggestions are offered, never applied

`/admin/allergens`. All 79 production dishes are in `MI1`'s **third** state: no tags, and nobody
has declared there are none. `0006` is explicit that this is *unknown* and must be warned about —
and on any screen that only counts tags it looks exactly like "contains nothing".

Three decisions worth keeping:

**The guesses are not pre-applied.** Boxes start at what the database holds; the suggestion sits
beside them, drawn dashed rather than filled, with the ingredient words that triggered it. Accepting
is a click and saving is another. A machine-generated allergy tag that arrives pre-ticked is one
distracted Save away from becoming a fact nobody chose.

**"Contains none" is a button, not an empty save.** Saving a dish with nothing ticked would clear
the tags and leave it in the same unknown state — a save that appears to work and changes nothing
that matters. `allergens_declared_none` is written explicitly, and the server **refuses** tags and
`declaredNone` together rather than picking between two opposite claims.

**The rules under-report, and the banner says so.** Keyword matching over ingredient text cannot
know that a bread contains unlisted milk powder or that a kitchen fries in shared oil. Presenting
an accepted suggestion as a finished dish would be the real failure here, so nothing on the screen
ever says a dish is complete.

Verified against production: both writes land, all three rails fire (opposite claims, unknown code,
unknown dish id), and every row was restored — `dish_allergen` is back to 0 and no dish carries a
declaration. **The tagging itself is Andy's**, exactly as the food types are.

---

## D-17D — the Apply button runs the CLI's code, and the browser's plan is never trusted

`admin-import` imports `parse`, `validate`, `plan` and the four `apply*` functions from
`tools/bulk-import/src/` directly. `E10-29` made that possible by splitting `connect.mjs` out of
`db.mjs`; every remaining function takes its client as an argument, so the same code runs from a
laptop, a browser and Deno.

Checked the assumption before building on it: a throwaway function importing `plan.mjs` from
outside `supabase/functions/` deployed and ran. Then deleted.

The browser posts the **file**. A client-supplied plan would be an arbitrary write request wearing
the shape of an audit trail, so the server recomputes and applies its own, and the page shows the
server's report rather than the one already on screen.

---

## D-17E — images go through a function because storage is default-deny, and that is correct

`storage.objects` has **no policies at all**, so a browser cannot write to the `dish-images`
bucket. Opening that up would mean a broad policy on a **public** bucket; routing the bytes through
`admin-dish-image` keeps the `dish.edit` check, the `asset` row and `dish.image_asset_id` in one
place. A direct upload leaves an orphaned object on any failure after the PUT — referenced by
nothing, and therefore cleaned up by nothing.

The browser resizes to 1280px first. A 4 MB phone photo on a menu is the easiest way to make that
menu unusable on the connections this product is built for.

---

## D-17F — there is no paid order on production, and that is the finding

Andy asked me to verify the kitchen path against "the one on production now". There are two orders
and **neither is paid**:

| service date | status | |
|---|---|---|
| 2026-08-19 | `cancelled` | created 12:50 UTC, cancelled two minutes later |
| 2026-08-20 | `pending_payment` | created 15:36 UTC, still pending |

**The `payment` table is empty.** No payment row was ever written on production, so the checkout
reached `pending_payment` and stopped. Either the Razorpay sheet was never completed, or nothing
came back from it.

The board and the packing sheet were verified to correctly show **nothing** for 20 August — a
`pending_payment` order must not reach the kitchen (`L5`), and unpaid food must not be cooked. That
is the right behaviour and it is confirmed on production.

**I did not fabricate a paid order on production.** Marking one paid by hand would put revenue in
the ledger that nobody paid, on the system that issues invoices.

So the full path — badges and mark-delivered — was proved on **staging**, where paid orders and
recorded allergies exist, through the real board as Andy's own signed-in session:

- allergy badges render on the board and the packing sheet (`Tara Bajwa MILK`,
  `Dhruv Ahluwalia GLUTEN`);
- the **Delivered button** on the board moves a paid order to `delivered` and writes
  `paid -> delivered | actor=kitchen | user=<Andy>`.

One thing that cost twenty minutes and is worth writing down: the board has a **ten-second undo
window**. A click queues the change and flushes when the window closes, so reading the database six
seconds later shows the old status and looks exactly like a broken button. It was working the whole
time.

---

## D-17G — egg, peanut and sesame added; and why egg needed adding twice over

`0064`. `0063` seeded the four codes that happened to be sitting in `supabase/seed.sql` — a list a
fixture carried, not one anybody chose.

**Egg is the one that mattered.** Nine production dishes visibly contain egg and there was no code
to tag them with: `admin-dish` would have refused `egg` as unknown, correctly and uselessly.

`dish.food_type = 'egg'` and `allergen.code = 'egg'` are **different facts and both are needed**:

- `food_type` is a dietary classification of the whole dish — the thing an Indian menu filters on,
  read by a family deciding whether the dish is for them at all;
- `allergen` is a safety fact about an ingredient, and the half a specific child's record is
  matched against.

A cake made with egg is `food_type: 'veg'` and carries the egg allergen. Collapsing the two would
mean either mislabelling cakes as egg dishes or leaving egg-allergic children nothing to match on.

**Peanut is its own code, not a kind of tree nut.** A peanut is a legume; a great many people are
allergic to one and not the other. `tree_nut` on a groundnut sauce tells a peanut-allergic family
nothing while alarming a family that only avoids cashews.

### The bug adding egg exposed

The guesser matched **substrings**, and `"veggies"` contains `"egg"`. Every vegetable dish in the
catalogue would have been suggested as containing egg — on the screen whose entire job is to be
trusted about allergens. A test caught it; a menu would not have. Short and collision-prone words
now match whole-word only, and `nut` is cancelled on "peanut"/"groundnut".

---

## D-17H — allergens: the data is v1, the matching is not

Andy's correction. The scope doc read "allergen blocking warnings (tags still import)", which was
being read as *allergens are deferred*. The split is:

**In v1** — a parent recording their child's allergies (`E05-01`), the kitchen tagging dishes
(`E10-33`), and the kitchen *seeing* those allergens on the board and the packing sheet (`E09-33`).
`E09-33` and `E10-33` were added to the MVP list on this instruction; both markdown tags and
`check-mvp.mjs` updated together, since the script asserts the two agree and rewrites neither.

**Fast-follow** — the automatic match: the cart warning, the menu filter, the blocking
(`E05-25`, `E05-31`).

`check:launch` said an untagged dish means "a menu shows no warning", which implied the automatic
warning exists. Reworded, and the reasoning inverted to the one that actually holds: **because the
matching is deferred, the tags are the entire mechanism.** A kitchen hand reads the badge and acts
on it — that is a person doing the matching, and on day one it is the only thing doing it. That
makes an untagged dish a bigger problem in v1 than it would be with matching switched on, not a
smaller one.

---

## D-17I — six dishes are marked veg and contain egg; I reported it and did not change it

Found by the final `check:launch`. All 79 dishes are now marked — 76 `veg`, 3 `egg` — and six of
the `veg` ones name egg in their own ingredient list:

| Dish | Ingredients |
|---|---|
| **Boiled Eggs (3 pcs)** | **Eggs, salt** |
| Scrambled Egg w Toast | Eggs, milk, butter, bread |
| Boiled Egg Mix In Brown Wheat Multigrain Sub Sandwich | Boiled Egg, Cucumber, … |
| French Toast with Choco Syrup | Bread, eggs, milk, sugar |
| Pancakes w Honey | Flour, milk, eggs, sugar, honey |
| Chocolate Muffin | Flour, cocoa powder, milk, eggs |

`review/food-types.csv` proposed **`egg` at high confidence for every one of them**, so whatever
was applied overrode the proposal rather than missing it.

**I did not change them.** Food type is Andy's data and he said so explicitly; a wrong veg marking
is the worst error this product can make and that cuts both ways — me silently relabelling six
dishes on production would be the same class of act. So it is reported, precisely, and left.

What I did add is the check that catches it. The unmarked-dish blocker could never have: the dish
*is* marked, the count is complete, the report goes green. `check:launch` now runs the same
classifier that generates the proposal CSV and reports **high-confidence contradictions only** — a
mayonnaise caveat or a dish with no ingredient list never appears, so what is left is a direct
disagreement between the label and the ingredients. Only the misleading direction blocks; a dish
marked `egg` whose list reads vegetarian is over-cautious, and over-cautious is not a blocker.

The three arguable ones are arguable in one direction only. Indian bakeries label *eggless*
explicitly precisely because egg-containing baked goods are not vegetarian to the people checking.
"Boiled Eggs (3 pcs)" is not arguable at all.

---

## D-17J — still no captured payment on production

`payment` now has one row, `status = created`, `captured_at` null. All three orders are
`cancelled`. So the checkout reaches Razorpay and the order is created, and nothing comes back —
the same shape as yesterday, one step further along. There is still no paid order and therefore
nothing on the kitchen board.

---

## D-17K — 77 dish photos on production, through the app's own upload path

`E16-55`. Production had zero dish images and the parent-facing menu rendered every dish blank —
a visible downgrade from the app parents use today.

**Matching is by `legacy_bubble_id`, and it cannot be wrong.** All 79 production dishes carry one
and every manifest entry carries the same Bubble id, so this is an exact join, not a name match.
`matchDishes` is reused from `upload.mjs` rather than reimplemented; it takes the id outright and
only ever falls back to an exact — never fuzzy — name where no id exists. None did.

Proven rather than asserted: after the run, every dish's stored `asset.checksum_sha256` was
compared against the manifest entry **for that dish's own legacy id**. 77 matched, 0 mismatched.
A contact sheet of all 79 name-and-photo pairs was rendered and read; every photo suits its dish.

### Through the Edge Function, not around it

`upload.mjs` already existed and would have done this in one command — but it writes to Storage
and `asset` itself with the service role, which since `E10-24` is a **second write path** into the
same three places. So `upload-via-api.mjs` drives `admin-dish-image`, the same function
`/admin/menus` calls: same `dish.edit` check under a real operator session, same allowlist, same
ceiling, same orphan cleanup. It writes to no table. `upload.mjs` is marked superseded rather than
deleted — it carries the history and the tests.

Checksums are verified against the manifest **before** anything uploads, and one mismatch aborts
the whole run. The manifest is the only auditable record that these bytes came off the legacy CDN.

### The photos are 120 pixels tall, and that is the ceiling

Every one of the 82. Fetching the original URL with no size parameter returns 180×120, and
`?w=1200` returns identical bytes — there is no larger original, and the Bubble export is CSVs of
URLs rather than binaries. So "resized" is a no-op here: `prepareDishImage` downscales only above
1280px, and re-encoding a thumbnail would lose quality for nothing. They are uploaded unmodified.

This reaches parity with the current app, because these are the images it shows. It will still
look soft on a modern phone. **That is a re-shoot decision, not a code one.**

### What has no photo

Two dishes: **Aloo Channa Chat (White And Black Channa)** and **Brown Wheat Pasta With Mushroom
And Pesto Cream Sauce**. Both 403 permanently at the legacy CDN and were never mirrored.

The README said three. Only two reach production: the legacy catalogue holds two records for the
Tomato/Cucumber sandwich under different ids, one mirror failed and one succeeded, and the dish
that was imported carries the id that succeeded. The id join resolved that; a name match would
have had two candidates and had to guess.

### Five pairs share a photo, legitimately

Choco Muffin / Chocolate Muffin, Hot Choco Milk / Hot Chocolate Chocolate, Mango Shake / Mango
Shake (Seasonal), Rajma Rice / Rajma With Rice Or Prantha, Strawberry Shake / Strawberry Shake
(Seasonal). Each matched its own id; both legacy records simply pointed at the same file. They
look like duplicate dishes in the catalogue, which is worth a look but is not an image problem.

---

# The back-office UX review — 17/18 August

Andy, away overnight: review and redesign every back-office and kitchen screen plus the marketing
home page. Decide, record, keep going.

## D-17L — the admin screens had no working type scale at all

Before designing anything: **14 `var(--gb-…)` names used across every back-office stylesheet do
not exist.** `--gb-text-muted`, `--gb-font-size-sm`, `--gb-font-weight-semibold`,
`--gb-font-size-base`, `--gb-font-bold` and nine more. The real names are `--gb-text-secondary`,
`--gb-font-size-body-sm`, `--gb-font-weight-body-strong`.

An undefined custom property does not error. The declaration is dropped and the element keeps what
it inherited, so the page renders — just not as written. The effect on `/admin/menus` was that
**every line of every dish rendered at the same size, the same weight and the same colour**, which
is precisely how it looked and precisely what makes it unscannable. "Everything is the same
weight" was not a layout problem. It was that the type scale had never once been applied.

Nothing could have caught it: not lint, not the build, not the a11y gate — inherited black on
white passes contrast — and the page looks plausible, just flat. So
`scripts/check-css-tokens.mjs` now fails on any `var(--gb-…)` that names a token which does not
exist, and it is in `npm run smoke`.

**A fallback is treated as a failure too.** `var(--gb-font-size-xs, 0.75rem)` works, which is
worse: it looks deliberate, it hides the typo permanently, and the value stops tracking the design
system. Two of the fourteen were that shape and both were mine.

Fixing the names alone took the page from 17,213px to 14,539px and gave it a hierarchy. That is
the floor the redesign starts from, not the redesign.

## D-17M — `/admin/menus` is a workbench, not a list

**What the screen is for.** Nobody opens it to browse. They open it because *one* dish is wrong and
they know its name. Reach it, change one field, confirm, leave. Every decision below serves that.

**A row is one line.** Photo, name, category, food type, allergen state, and every menu it is on
with the price there. 79 dishes went from **17,213px to 6,013px** — 13 rows visible at once instead
of 4. Scrolling became orientation instead of search.

**Editing is a drawer, not an inline `<details>`.** A panel over the list physically cannot move
the list, which is the whole reason for it. Saving repaints one row and leaves the drawer open with
a confirmation; nothing re-renders, nothing re-sorts, nothing touches scroll. Measured rather than
asserted: open at scrollY 2400 with the row at viewport y=1139, save, and both are still 2400 and
1139.

**No body-scroll lock.** The usual `overflow: hidden` on `<body>` while a panel is open takes the
scrollbar away, re-lays out the page and *moves it* — the one thing this screen promises not to do.
`overscroll-behavior: contain` on the drawer achieves the same containment and cannot move anything.

**Search ranks rather than filters.** Name-prefix beats name-substring beats category beats menu
beats ingredient, and every term must match so a second word narrows. Typing "pan" puts *Pancakes*
first, ahead of seven *Paneer* dishes it also matches — an alphabetical filter would have buried it.
Ingredients are searchable because some dishes are remembered as "the one with paneer".

**Filters are states, not taxonomies**, and each carries its count: "Not checked (79)",
"Missing (2)", "On no menu (0)". The work left is visible without clicking. The query lives in the
URL, so a filtered view survives a reload and can be sent to somebody.

**Only what changed is sent.** Posting the whole form made the server report ten fields as saved
after a no-op — a confirmation that is wrong is worse than none — and `0001` §14 bumps
`school_menu_version` on any `dish` update, **expiring every client's cached menu**. Paying that
because somebody opened a drawer and pressed Save is a real cost on the connections this product is
built for. An unchanged save now makes no request at all.

**Two bugs found by looking at it.** The drawer and the bulk bar both rendered on first paint:
`[hidden]` is `display: none` only at UA specificity, and any class rule setting `display: flex`
silently beats it. The drawer was covering the price column it exists to edit.

## D-17N — `/admin/schools` is a readiness checklist, not a create form

**What the screen is for.** Answering "can a parent at this school order lunch, and if not, what is
missing?" — daily. Creating a school happens perhaps three times a year, and it led the page.

**A checklist, not a status.** The old screen showed one label, **"Open to parents"**, derived from
`onboarded_at` and `is_active` alone. A school could carry it with no menu, no break windows and no
service days. Five gates now, each saying what is *actually true* rather than passing silently —
"Sky Bites - Amity — 47 of 47 orderable", "Morning break 10:40–11:15 · Second break 11:15–11:40" —
and each failing gate carries the link to the screen that fixes it.

That is the guided sequence Andy asked for, and it is deliberately **not** a wizard: it works
identically for a school created ten minutes ago and one that has been live a month and just lost
its menu. A wizard only helps the first.

**`missing` blocks, `warning` informs.** A menu that starts next term is a blocking gate in a
warning state — not wrong, not yet — and counting it as a blocker made a correctly configured school
read as broken. Service days and the report contact are gaps that never block: you can order
without them.

**Schools that need work sort first.** The opposite of alphabetical, because the screen exists to
show what needs doing.

## D-17O — admin controls are not kitchen controls

`.kitchen__btn` is **56px tall** — its own comment says "bigger than the 48 floor. Wet hands, in a
hurry." Correct for a tablet on a steel bench; wrong for an admin screen driven with a mouse, where
it turned the nav into a row of lozenges and a small inline action into a **circle with the label
spilling out of it**, which is how I noticed.

Overridden inside the admin shell rather than changed at source, so the kitchen keeps its 56px.
This is the first concrete instance of Andy's "the kitchen screens are a different problem" — the
two had been sharing one control vocabulary and it fitted neither.

## D-17P — motion on the home page, and the failure mode it must not have

Andy: *"it's bland in places… motion should support the content, not decorate it."*

The **hero was already strong** — real product, real dish photography, a clear proposition — so it
is untouched and deliberately does not animate: it is above the fold and must be there on the
first frame. What was bland was everything below it, and the worst of it was the "For your school"
section, where the argument occupied the left half and the right half was **empty white**.

Four devices, each doing a job:

| | |
|---|---|
| **Reveal on scroll** | gives a 6,500px page a rhythm; each section arrives as a unit rather than being a wall that was always there |
| **The process rail** | a line joining the four numbered steps, only at the width where they sit in a row — the copy asserts a sequence and the layout did not |
| **The ledger** | *2* things your school does, *7* things we do — drawn, in the half of the section that was empty. Both numbers are counted from the lists beside them, never asserted |
| **The card lift** | tells you a card is a thing rather than a paragraph in a box |

No parallax, nothing autoplays, nothing loops, and nothing moves that a person is trying to read.

**The failure mode that mattered more than the animation.** Hiding content until an observer says
otherwise means any failure of that observer leaves the copy invisible — on the page that sells the
product. Three defences: the hiding rule applies only under `html.js`, which the script itself adds
(scripting off ⇒ nothing is ever hidden); anything already on screen at load is revealed
immediately without waiting to be observed; and a **three-second timeout reveals everything
regardless**. I caught a real instance of this in a screenshot — a section mid-reveal with its text
washed out — which is exactly what a permanently stuck section would look like.

**Reduced motion is off, not gentler.** Verified by emulating it rather than trusting the branch:
with `prefers-reduced-motion: reduce` every transition reports `0s` and the step animation reports
`none`; without it, `0.32s` and `gb-pop`. Content is fully opaque in both.

**Cost:** home page JS **1,034 B gzipped** against a 10,000 budget, no library, no third-party
request. CSS 13,123 of 18,000. First load 229 kB of 400 kB.
