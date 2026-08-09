# Menu importer (prototype) — `Q08`

Parses a GrayBag menu spreadsheet into validated JSON, splits the `Allergens` column into
structured tags, and reports **every** row that fails validation.

This is a prototype whose job is to **prove the file format** before `E04-04` (the real
importer, with a preview-and-apply diff) is built. It does not talk to a database, and it
never writes anything except the JSON file you ask for.

```bash
node tools/menu-import/src/cli.mjs "path/to/GrayBag_School_Menu 1 1.xlsx"
node tools/menu-import/src/cli.mjs menu.xlsx --json out/menu.json
node tools/menu-import/src/cli.mjs menu.xlsx --sheet "Term 1" --allow-new-categories

node tools/menu-import/demo.mjs        # run it against a synthetic sample sheet
node --test tools/menu-import/test/    # the test suite
```

Exit codes: `0` every row passed, `1` at least one row failed validation, `2` the file
could not be read at all.

---

## ⚠ The source file is missing

`.../GrayBag_School_Menu 1 1.xlsx` **is not in this repository, and never was.** The
legacy design package itself also lives outside git now, at
`../Legacy-Application-backup/` (see `docs/decisions.md`). The only thing under its
`Legacy-DB/` is `gray-bag-23660.bubble`, which is the
Bubble *application definition* — it contains the page and workflow structure, not the dish
rows. `grep`ing it for allergen data returns only the terms-and-conditions text.

Everything here is therefore built against the column list documented in
`planning/backlog/E04-menu-domain.md`:

```
Item No. | Menu Item | Description | Ingredients | Calories | Portion/Weight |
Allergens | Category | Category - ORIG | Price
```

and tested against a **synthetic** sample sheet (`test/sample-menu.mjs`) whose dish names,
prices and allergens are invented. Headers are matched by alias rather than by position
precisely because the real file may not match this list exactly.

**This is what blocks `[DM-13]`** — the allergen seed list cannot be frozen from invented
data. When the real workbook appears, run:

```bash
node tools/menu-import/src/cli.mjs "GrayBag_School_Menu 1 1.xlsx" --json out/menu.json
```

and read the `allergen_report` block. See `[MI-01]` in `docs/open-questions.md`.

---

## What it produces

```jsonc
{
  "meta":            { /* counts; accepted + rejected + skipped == rows_below_header */ },
  "columns":         { "mapped": {...}, "dropped": [...], "unrecognised": [...] },
  "file_issues":     [ /* unknown columns, missing optional columns, [DM-17] */ ],
  "dishes":          [ /* accepted rows, in `dish` table shape */ ],
  "rejected":        [ /* every failed row, with per-field errors */ ],
  "warnings":        [ /* accepted rows that need a human's eye */ ],
  "skipped":         [ /* blank rows */ ],
  "allergen_report": { /* the [DM-13] deliverable */ }
}
```

Each accepted dish maps onto `docs/data-model.md` §6.1:

| JSON field | `dish` column | Note |
|---|---|---|
| `name`, `description`, `ingredients_text`, `portion_text` | same | whitespace-collapsed |
| `calories_kcal` | `calories_kcal` | integer or `null` — never a guess |
| `category_code` | resolved to `category_id` at load | `Category - ORIG` is dropped (E04-05) |
| `price_paise` | `menu_item.price_paise` | integer paise, always |
| `allergens[]` | `dish_allergen` | `{code, presence}` |
| `food_type` | `food_type` | always `null` — see `[DM-17]` |
| `price_is_tax_inclusive` | `platform_config` | always `null` — see `[DM-20]` |

Price is on `menu_item`, not `dish` (§6.1), so the importer emits `price_paise` per row and
`E04-04` decides which menu it lands on.

---

## The rules it follows

**1. Nothing is silently dropped.** Every row below the header is either a dish, a
rejection, or a counted blank. The test suite asserts
`accepted + rejected + skipped == rows_below_header`. Unrecognised *columns* are reported
too, so a "Notes" column someone added is visible rather than invisible.

**2. Nothing is guessed — and what fails a row versus what merely warns is decided by
whether being wrong could hurt someone.**

| Situation | Outcome | Why |
|---|---|---|
| Allergen text that maps to no seeded code | **row rejected** | An unwarned allergy. `[DM-13]` |
| A real allergen with no code yet (e.g. shellfish) | **row rejected** | Same, and it names the gap |
| Blank allergen cell | warning, imported with no tags | Blank means *unknown*, not *none* |
| Calories unparseable, or a range like "300-400" | warning, stored `null` | §6.1 says null rather than guessed |
| Price unparseable, zero, negative, sub-paisa | **row rejected** | Money |
| Category not in the seed list | **row rejected** (`--allow-new-categories` downgrades) | `dish.category_id` is `NOT NULL` |
| Duplicate name or item no. | **row rejected** | `unique (kitchen_id, lower(name))` |

**3. Blank is not "none".** The single most consequential rule in the file. A kitchen that
left the cell empty has told us nothing; recording that as "no allergens" is how a warning
fails to appear. `allergens_declared_none` is `true` only when the cell explicitly says so.

**4. Money is integer paise, parsed decimally.** `"₹1,20,500.05"` becomes `12050005` by
integer arithmetic, never `parseFloat(x) * 100` (which gives `17998.999999999996` for
`179.99`). Numeric cells arrive as IEEE doubles and are rounded to the nearest paisa, but a
value more than a rounding error away from a whole paisa is rejected rather than rounded.

---

## Allergen parsing

The `Allergens` cell is split on `, ; | / &` and the word "and", after stripping a leading
`Contains:` / `Allergens -` prefix. Each fragment is matched against a synonym table
(`src/allergens.mjs`), which includes the vocabulary a kitchen actually writes — `paneer`,
`maida`, `til`, `kaju`, `sarson` — not just the textbook names.

**`may contain` is sticky.** `"Contains milk, may contain traces of peanut, tree nut"`
reads as milk=`contains`, peanut=`may_contain`, tree_nut=`may_contain`, because that is how
the person writing it meant it. An explicit `contains` switches it back. If a cell names the
same allergen both ways, `contains` wins and the conflict is warned.

Three outcomes per fragment, and the difference between the last two matters:

- **mapped** — one of the twelve codes in `docs/data-model.md` §3.3.
- **uncoded** — a genuine allergen with no code in the seed list (`shellfish` → mollusc,
  `coconut`, `lupin`, `corn`, `buckwheat`, `kiwi`, `mushroom`). Reported as
  *"this allergen exists and has nowhere to go"*, which is an answer to `[DM-13]`.
- **unmapped** — text nobody can interpret. Either a synonym to add here, or a typo in the
  spreadsheet.

Two judgement calls worth knowing about, both flagged in `docs/open-questions.md`:

- **Oats map to `gluten`.** Botanically gluten-free, routinely cross-contaminated in
  milling. The conservative reading over-warns; the alternative under-warns. `[MI-02]`
- **Coconut is left uncoded, not mapped to `tree_nut`.** The US FDA calls it a tree nut;
  the EU and FSSAI do not. Resolving that quietly is not the importer's call. `[MI-02]`
- **Molluscs are not folded into `crustacean`.** They are a separate declarable class and
  the seed list has no code for them, so `shellfish` fails the row instead of being
  mislabelled as a prawn allergy. `[MI-02]`

---

## Why no dependencies

The repo has no `node_modules` and no lockfile, and this tool needs to run for a
non-developer with `node` and nothing else. So `.xlsx` reading is implemented here:
`src/zip.mjs` (ZIP over `node:zlib`) and `src/xlsx.mjs` (the subset of SpreadsheetML Excel
actually emits — shared strings, inline strings, sparse cells). Roughly 300 lines against
the ~1.5 MB `xlsx` package, and it means the importer cannot be broken by a transitive
dependency update on a machine with no network.

Not supported, and it throws with a clear message rather than misreading: ZIP64,
encrypted archives, `.xls` (the pre-2007 binary format) and `.csv`. Styles are not read, so
**dates are not interpreted** — a date cell arrives as its raw serial number. No column in
this format is a date; if one is ever added, that is the thing to fix first.

## Layout

| File | |
|---|---|
| `src/cli.mjs` | argument parsing, file IO, exit codes |
| `src/import.mjs` | orchestration and per-row validation |
| `src/allergens.mjs` | the synonym table and the cell splitter |
| `src/money.mjs` | price → integer paise |
| `src/fields.mjs` | category, calories, text, available days |
| `src/columns.mjs` | header detection and alias matching |
| `src/xlsx.mjs`, `src/zip.mjs` | the file format |
| `src/report.mjs` | the plain-text report |
| `test/sample-menu.mjs` | **synthetic** sample data, one of every failure mode |
| `test/make-workbook.mjs` | writes a real `.xlsx` in memory, so tests exercise the ZIP path |

## Diffing against what is already stored (`E04-04`)

Validation on its own answers "is this sheet importable". It does not answer the question that
matters before a write: **what would change.**

```sh
# 1. Validate. Unchanged from Q08.
node tools/menu-import/src/cli.mjs menu.xlsx

# 2. Plan. Needs a snapshot of the dishes currently stored for the kitchen,
#    as a JSON array. Produces a diff and writes it for review.
node tools/menu-import/src/cli.mjs menu.xlsx \
  --against snapshot.json --plan out/plan.json

# 3. Same, treating dishes absent from the sheet as retired. OFF by default.
node tools/menu-import/src/cli.mjs menu.xlsx \
  --against snapshot.json --deactivate-missing
```

Exit codes: `0` clean, `1` rows failed validation **or** the plan has blockers, `2` the file
could not be read.

**The CLI never writes to the database.** It produces a plan a human reads. Applying it is a
separate act (`src/apply.mjs`), and apply re-checks a SHA-256 of the workbook — if the file has
changed since the plan was reviewed it refuses, because the change you approved is not the
change the file would now make (`MI8`).

### What the plan protects you from

| Guard | Why |
|---|---|
| Absence does **not** retire a dish unless asked | A kitchen sending the ten dishes that changed is the ordinary case; treating that as "delete the rest" empties the menu (`MI9`) |
| Deactivating >25% of a live menu blocks | Almost always a partial export. `--force` if it is genuinely a retirement (`MI10`) |
| A plan that changes nothing blocks | "No changes" and "I read the wrong tab" look identical from outside (`MI10`) |
| Allergen changes print first, in full | `MI2`'s question — could being wrong hurt someone — decides what an operator must not scroll past (`MI13`) |
| Deactivations run last | A crash mid-apply then leaves too many dishes, not too few. Nobody notices an absence until the orders do not arrive (`MI11`) |
| One failed row does not stop the rest | The receipt becomes a to-do list instead of a mystery (`MI11`) |

### The snapshot format

A JSON array of the kitchen's dishes. Only the compared fields matter:

```json
[
  { "id": "uuid", "name": "Veg Sandwich", "price_paise": 6000,
    "category_code": "sandwich", "allergens": [{ "code": "milk" }],
    "allergens_declared_none": false, "available_days": [1,2,3,4,5],
    "is_active": true }
]
```

Dishes are matched on `lower(name)`, which is `uq_dish_kitchen_name` in the schema — not on
`Item No.`, which is a spreadsheet ordinal that renumbers whenever somebody sorts the sheet.
