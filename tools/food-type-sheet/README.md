# The veg / egg / non-veg marking sheet

`food-type-catalogue.csv` — **79 rows, one per distinct dish name, with `food_type` empty.**
Regenerate with `node tools/food-type-sheet/build-sheet.mjs`.

## For whoever fills it in

Open it in Excel or Google Sheets. Fill the **`food_type`** column only. Three permitted values,
lower case, exactly as written:

| Value | Means |
|---|---|
| `veg` | No egg, no meat, no fish. Nothing derived from them |
| `egg` | Contains egg, but no meat and no fish |
| `non_veg` | Contains meat, fish or seafood |

**Leave it blank if you are not certain.** A blank reads as *"not stated"* everywhere in the
product and never as *"veg"* — a blank costs a parent an unanswered question, and a wrong `veg`
costs them a dish they would not have ordered. Use `kitchen_notes` to say what you would need to
check.

Nothing is pre-filled, including the dishes with "egg" in the name. That is deliberate: a sheet
that arrives half-answered gets skimmed, and this is the one field nobody may infer.

### The other columns are context — do not edit them

| Column | What it is for |
|---|---|
| `duplicate_rows` | This name appears on two dish records. Usually the same dish on two menus at two prices. **If the two are genuinely different foods with different marks, say so in `kitchen_notes`** |
| `has_photo` | Whether we hold a photograph. Two dishes have none and are being re-shot (`E16-29`) |
| `legacy_dish_ids` | Our internal ids, so the answer maps back to the right records |

## Why this is being asked

`dish.food_type` is null on every dish in the system. The source Excel never had the column, so
the importer cannot fill it — it emits a `food_type_absent` notice on every run instead
(`DM-17`).

That was tolerable while the mark was decoration. It stopped being decoration when the public
website committed to it in writing:

> Every dish carries a veg, egg or non-veg mark, and your school's menu contains only what you
> have agreed to.

A parent will filter on this and a school will rely on it, so the value has to come from the
kitchen. Six of the 79 names carry two records each; four of those six are the same dish at two
prices on two menus, and two are indistinguishable in the export (`docs/bubble-recon-findings.md`
§9) — which is why the sheet is keyed by **name**, the thing the kitchen actually recognises.

## When it comes back

The filled sheet is an input to the schema change that makes `food_type` **required with no
default** — not the other way round. The column cannot be made `not null` while 79 dishes are
unmarked, so the sequence is: sheet returned → values loaded → constraint added. Blank rows stay
blank and stay legal to hold; what becomes illegal is creating a *new* dish without a mark.

**Nothing is loaded automatically.** The importer for this is not written, deliberately — it
belongs with the schema change, and both wait on Andy's ruling about when they sit relative to
`E06`.
