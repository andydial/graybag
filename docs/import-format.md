---
title: Bulk import file format
status: Written 2026-08-15 for the 17 August data load. Andy prepares the files; nobody needs to
  be asked anything to do it.
tool: tools/bulk-import
---

# Import file format

Three files, any of which may be given on its own: **schools**, **dishes**, **menu**. CSV or
JSON — the tool picks by the file extension.

```bash
set -a; . ./.secrets.staging.env; set +a          # or prod.env, once it exists

# 1. See what would happen. Writes NOTHING.
node tools/bulk-import/src/cli.mjs \
  --schools schools.csv --dishes dishes.csv --menu menu.csv

# 2. Do it.
node tools/bulk-import/src/cli.mjs \
  --schools schools.csv --dishes dishes.csv --menu menu.csv --apply
```

**Without `--apply` nothing is ever written.** Run it as often as you like; it is a report.

Give all three files in one run when you can. The tool processes them in the order schools →
dishes → menus, and a menu row may refer to a dish being created in the same run.

---

## The rules that apply to every file

**Nothing is ever deleted.** A school, dish or menu item that is *absent* from your file is left
exactly as it is. To retire a dish, include it with `is_active` set to `false`.

**One live menu assignment per school at a time.** The database enforces this — a school cannot
have two menus covering the same day. If you are replacing a menu, set the old assignment's
`valid_to` before the new one's `valid_from`. An overlap is refused, not merged.

**A column you leave out means "no opinion".** If your dishes file has no `description` column,
no description is changed. This is different from a column that is *present and empty*, which
means "set this to nothing". If in doubt, leave the column out.

**You can run the same file twice.** Rows are matched on:

| File | Matched on |
|---|---|
| schools | `code` |
| dishes | `kitchen_code` + `name` (case-insensitive) |
| menu | `kitchen_code` + **`menu_name`**, then `dish_name` within it |

Re-running updates what is there and creates what is not. It never duplicates.

**Headings are forgiving.** `School Code`, `school code` and `school_code` are the same column.
Case, spaces and surrounding whitespace are all ignored.

**Excel's CSV is fine.** Commas inside quotes, newlines inside quotes, and the invisible
byte-order mark Excel adds are all handled.

### Things the import will NOT create

These are reference data and must exist first. If one is missing you get a message naming it and
listing what does exist:

- **cities** — matched on `city.code`
- **kitchens** — matched on `kitchen.code`
- **dish categories** — matched on `dish_category.code`
- **allergens** — matched on `allergen.code`

All four are matched on their **code**, never their display name. A display name is something
nobody types the same way twice — the city really is called `SAS Nagar (Mohali)` — and a mismatch
would read as "this city does not exist" on a row that is otherwise perfect. Every error message
lists the valid codes.

---

## 1. Schools — `schools.csv`

| Column | Required | Notes |
|---|---|---|
| `code` | **yes** | Lower-case letters, digits, `-` and `_`. This is the match key — keep it stable forever |
| `name` | **yes** | What parents see |
| `city_code` | **yes** | The city's **code**, not its name. `sas_nagar`, not `SAS Nagar (Mohali)` |
| `kitchen_code` | **yes** | Must already exist |
| `institution_type` | no | `school` (default) or `college` |
| `address_line1` | no | |
| `address_line2` | no | |
| `postcode` | no | |
| `contact_name` | no | |
| `contact_email` | no | Where the monthly report goes |
| `contact_phone` | no | |
| `service_days` | no | Which weekdays this school is served. Leave blank to inherit |
| `order_cutoff_time` | no | 24-hour `HH:MM`. Leave blank to inherit |
| `order_cutoff_days_before` | no | `0` is the same day. Leave blank to inherit |

```csv
code,name,city_code,kitchen_code,contact_name,contact_email,service_days,order_cutoff_time
amity,Amity International School,sas_nagar,mohali_central,Ritu Sharma,ritu@amity.example,"Mon,Tue,Wed,Thu,Fri",11:00
gem,Gem Public School,sas_nagar,mohali_central,,,"1,2,3,4,5",
paragon,Paragon Senior Secondary,sas_nagar,mohali_central,,,,
```

`city` is accepted as an alias for `city_code`, so a file that uses the shorter heading still
works.

A school created by import is marked as onboarded, which is what makes it appear in the app's
school picker.

---

## 2. Dishes — `dishes.csv`

| Column | Required | Notes |
|---|---|---|
| `name` | **yes** | Unique per kitchen. This is half the match key |
| `kitchen_code` | **yes** | Must already exist |
| `category` | **yes** | The category **code** — `quick_bites`, not `Quick Bites` |
| `food_type` | no | `veg`, `non_veg` or `egg`. **Fill this in** — see below |
| `description` | no | |
| `ingredients` | no | Free text |
| `calories_kcal` | no | Whole number |
| `portion` | no | Free text — "1 sandwich", "200 ml" |
| `allergens` | no | Allergen **codes**, separated by `;` or `,` |
| `is_active` | no | `false` retires a dish. Leave the column out entirely to change nothing |

```csv
name,kitchen_code,category,food_type,calories_kcal,portion,allergens
Veg Sandwich,mohali_central,quick_bites,veg,220,1 sandwich,milk
Paneer Wrap,mohali_central,main_meals,veg,340,1 wrap,milk
Chocolate Muffin,mohali_central,quick_bites,egg,290,1 muffin,"milk;gluten"
Fruit Bowl,mohali_central,quick_bites,veg,110,150 g,
```

**`category` takes the code, not the display name.** A dry run lists every valid code if you get
it wrong.

**`allergens` takes codes, not labels.** `tree_nut`, not "Tree Nuts". A code that matches nothing
is refused and the import stops — it is not a warning. An unmatched code means the allergy
warning never fires for that dish, silently, and that is the one mistake in this whole file that
could hurt a child. The message lists every valid code, so run a dry run and read it.

**`food_type` is optional but please fill it in.** The database allows it to be empty because the
old Bubble export had no such field. A dish with no veg/non-veg marking cannot be filtered by a
parent looking for exactly that, and in this market it is close to required. The dry run prints
`NO FOOD TYPE` beside every dish that is missing it.

---

## 3. Menus — `menu.csv`

One row **per dish per menu**. The menu itself and its assignment to a school are built from the
repeated columns, so you do not need a separate file for them.

| Column | Required | Notes |
|---|---|---|
| `menu_code` | **yes** | Groups the rows of one menu **within this file**. Repeated on every row |
| `menu_name` | no | The menu's name, and its **stored identity**. Defaults to `menu_code` |
| `kitchen_code` | **yes** | Must already exist |
| `dish_name` | **yes** | Must exist at that kitchen, or be in the dishes file of the same run |
| `price_paise` | **yes** | **Integer paise.** ₹45.00 is `4500` |
| `available_days` | no | Which weekdays this dish is on the menu. Defaults to Mon–Sat |
| `school_code` | no | Which school gets this menu. Repeat it on every row |
| `valid_from` | with `school_code` | `YYYY-MM-DD`, inclusive |
| `valid_to` | no | `YYYY-MM-DD`, **exclusive**. Blank means open-ended |
| `sort_order` | no | Whole number. Lower sorts first |

```csv
menu_code,menu_name,kitchen_code,dish_name,price_paise,available_days,school_code,valid_from,valid_to
term1_2026,Term 1 2026,mohali_central,Veg Sandwich,4500,"Mon,Tue,Wed,Thu,Fri",amity,2026-08-19,
term1_2026,Term 1 2026,mohali_central,Paneer Wrap,6000,"Mon,Wed,Fri",amity,2026-08-19,
term1_2026,Term 1 2026,mohali_central,Fruit Bowl,3000,,amity,2026-08-19,
```

Repeating `school_code`, `valid_from` and `valid_to` on every row is correct and expected — the
tool collapses them into **one** assignment.

To give the same menu to a second school, repeat the block with the other `school_code`.

### `menu_name` is the identity, `menu_code` only groups rows

A menu has no code column in the database — its **name** is the only stable handle. So a re-run
matches on `kitchen_code` + `menu_name`, and `menu_code` exists purely to tell the tool which
rows of your file belong to the same menu.

**Renaming a menu creates a second one.** If you import `Term 1 2026` and later change
`menu_name` to `Term 1`, you get two menus and the school ends up with two overlapping
assignments — which the database refuses, so the import stops with an exclusion-constraint error.
Pick the name once. Changing `menu_code` alone is harmless.

### `valid_to` is exclusive

If a menu's last serving day is **31 October**, write `2026-11-01`. Writing `2026-10-31` ends it
a day early. The tool refuses a `valid_to` that is not after `valid_from`.

---

## Weekdays and money — the two that bite

**Weekdays are 1–7 with Monday as 1.** Names work too, so all of these are the same:

```
1,2,3,4,5
Mon,Tue,Wed,Thu,Fri
monday;tuesday;wednesday;thursday;friday
```

`0` is refused. In some systems 0 is Sunday; here Sunday is **7**.

**Money is always integer paise.** No decimal point, no `₹`, no thousands separator.

| You mean | Write | Not |
|---|---|---|
| ₹45.00 | `4500` | `45`, `45.00`, `₹45` |
| ₹60.50 | `6050` | `60.5` |
| ₹120 | `12000` | `120`, `1,20,00` |

Anything ambiguous is refused with the correction spelled out. Nothing is rounded and nothing is
guessed, because a price wrong by a factor of a hundred is not a bug anyone notices in a dry run.

---

## Reading the dry run

```
SCHOOLS

  + create  amity                Amity International School  (sas_nagar, kitchen mohali_central)
  ~ update  gem                  Gem Public School
            changing: contactEmail, config.service_days
  = 1 school unchanged

DISHES

  + create  Paneer Wrap  (main_meals; veg; allergens: milk)
  + create  Fruit Bowl  (quick_bites; NO FOOD TYPE — veg/non-veg unset)

MENUS

  + create  menu term1_2026 — Term 1 2026 (kitchen mohali_main)
            3 dishes
            → amity, from 2026-08-19 open-ended

Dry run. 6 changes would be made. Nothing was written — re-run with --apply to make them.
```

`+ create` is new, `~ update` lists exactly which fields change, `=` is already correct.

### When it refuses

Two kinds of problem, reported separately because the fixes are different:

**Invalid rows** — something in the row is wrong.

```
2 rows in the menu file cannot be imported:

  row 7
    price_paise: price_paise is "45.00", which is not a whole number of paise. ₹45.00 is 4500, not 45 and not 45.00
  row 12
    valid_to: valid_to (2026-08-19) is not after valid_from (2026-08-19). valid_to is EXCLUSIVE — for a menu whose last day is 2026-08-19, write the day after
```

**Unresolved references** — the row is fine, but something it points at is missing.

```
1 row could not be planned — the row is fine, but something it refers to is missing:

  row 4  dish "Panner Wrap" does not exist at kitchen "mohali_central", and is not being created by
         this run. Import dishes before menus, or include the dish file in the same run
```

Either way **nothing is written**, including the rows that were fine. Fix and run again.

---

## If an apply fails part-way

You will see:

```
FAILED PART-WAY: creating school gem: duplicate key value violates unique constraint
```

Some writes will have landed. This is safe to recover from: **run the same command again.**
Every write is idempotent on the match key, so the second run updates what landed and creates
what did not. Run without `--apply` first to see what is left to do.

The reason it is not one transaction: PostgREST has no transaction spanning several requests.
Idempotency is what stands in for it, which is why the match keys matter and why `code` must
never change once you have used it.

---

## JSON instead of CSV

Same field names. Either a bare array or an object wrapping one:

```json
{
  "schools": [
    {
      "code": "amity",
      "name": "Amity International School",
      "city_code": "sas_nagar",
      "kitchen_code": "mohali_central",
      "service_days": "Mon,Tue,Wed,Thu,Fri"
    }
  ]
}
```

Numbers may be written as numbers rather than strings. `null` is treated as blank.

---

## 4. Break windows — the sixty-second job

**A school with no break window cannot be ordered from at all** (`P19`). As of 15 August that is
**Paragon and Gem** on production: neither can take a single order, and the app says so rather
than failing. Amity is the only school that can.

Two commands:

```bash
set -a; . ~/.graybag-secrets/prod.env; set +a

# 1. Write a file with every existing window, plus ready-to-fill rows for each school that has
#    none. The times are LEFT BLANK on purpose.
node tools/bulk-import/src/cli.mjs --export-breaks breaks.csv

# 2. Type the four times. Then:
node tools/bulk-import/src/cli.mjs --breaks breaks.csv            # dry run
node tools/bulk-import/src/cli.mjs --breaks breaks.csv --apply
```

The file comes out looking like this — you edit the four empty cells and nothing else:

```csv
school_code,code,label,starts_at,ends_at,sort_order,is_active
amity-international-school,break-1,10:40AM - 11:15AM,10:40,11:15,10,true
amity-international-school,break-2,11:15AM - 11:40AM,11:15,11:40,20,true
paragon-senior-secondary,,Morning break,,,10,true
paragon-senior-secondary,,Second break,,,20,true
gem-public-school,,Morning break,,,10,true
gem-public-school,,Second break,,,20,true
```

### Amity's windows, exactly as stored — the shape to copy

| Window | Starts | Ends |
|---|---|---|
| `break-1` | **10:40** | **11:15** |
| `break-2` | **11:15** | **11:40** |

Two windows, back to back, 35 and 25 minutes. `P20` records that on 2026-08-11 you ruled Gem and
Paragon use *the same two windows as Amity for now, provisional until each school confirms* — that
ruling reached staging via `0029` and **never reached production**, which is why they are shut
there. If it still stands, copy those four numbers across and you are done.

**The times are blank rather than pre-filled deliberately.** Copying another school's times would
publish a time nobody agreed to, which is exactly what `catalogue.sql` refused to do from the
legacy option set. The importer refuses a blank time, so the file cannot be applied until a human
has typed them.

### The labels

The template uses **Morning break** and **Second break** rather than copying Amity's, because
Amity's labels *are* their own time ranges — `"10:40AM - 11:15AM"` — and the picker shows the
label with the times underneath, so a parent reads the time twice. `check:launch` warns about it.
**Editing the label column on Amity's two rows in this same file fixes that too**, and costs
nothing extra.

### What it matches on

`school_code` + `code`. The `code` column round-trips: an exported row carries the stored code, so
re-importing an untouched file changes nothing. A template row leaves it blank and the importer
derives one from the label (`Morning break` → `morning-break`).

---

## Photos

Not handled here. Dish photography goes through `tools/upload-dish-images`, which matches files
to dishes by name and uploads to the `dish-images` bucket. Import the dishes first — the uploader
matches against dishes that already exist.
