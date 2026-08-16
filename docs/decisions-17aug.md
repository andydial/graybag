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
