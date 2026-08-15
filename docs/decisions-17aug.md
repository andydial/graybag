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
