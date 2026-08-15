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
