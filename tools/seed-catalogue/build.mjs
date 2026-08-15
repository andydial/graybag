#!/usr/bin/env node
/**
 * seed-catalogue — turn the real Bubble catalogue into seed SQL. `E16-48`.
 *
 * Andy's reason for this existing, in his words: "Real school names, real dish names and real
 * prices change how every screen reads, and I've been judging this app against four fixture
 * dishes for days." A menu of Paneer Wrap / Veg Sandwich / Fruit Bowl / Juice tells you nothing
 * about how a 48-item menu in eight categories scrolls, how "Tomato, Cucumber Cheese Sandwich In
 * Brown Bread" wraps in a card built for "Paneer Wrap", or whether ₹40–₹139 leaves the price
 * column ragged.
 *
 * ## Where the data comes from, and what was left behind
 *
 * Source: `Legacy-Application/Legacy-DB/*.csv`, exported by Andy on 2026-08-11. The catalogue
 * tables only — **no `User`, no `Child`, no `Order`, no `Dish_In_Order`.** Those are real data
 * about minors and do not go near staging.
 *
 * `data/` holds the copy this script reads, and it is **not** a straight copy of the export:
 *
 * - **`contact-email` (All-Schools) and `owner-email` (Kitchens) are dropped**, not blanked.
 *   Business contact addresses, so tier A rather than regulated — but there is no seed that needs
 *   them, and `E02-30` was precisely the defect of school contact columns being readable by
 *   anyone holding the anon key. A column that is never imported cannot be exposed.
 * - **Mojibake is repaired.** The export is double-encoded: UTF-8 bytes decoded as cp1252 and
 *   re-encoded, so every en-dash arrives as `â€“`. Fixed here rather than in SQL, because a seed
 *   file full of `â€“` would be copied forward by the next person who needs an example.
 * - `Creator` is dropped: it holds `(App admin)` / `(deleted thing)` and identifies nobody.
 *
 * ## Ids are derived, not allocated
 *
 * Every row's UUID is `md5(kind + ':' + bubbleId)` shaped as a v4-looking UUID. Deterministic, so
 * local, CI and staging agree on what `d5f2…` is; stable, so re-running updates rather than
 * duplicating; and reversible in the sense that `legacy_bubble_id` is carried on the row, so a
 * support question about a legacy order can still be traced. `on conflict do nothing` throughout.
 *
 * ## What this script refuses to invent
 *
 * - **`food_type` stays null.** `[DM-17]` is open and says so: veg / non-veg / egg is not in the
 *   source, and in the Indian market guessing it is a serious trust failure, not a cosmetic gap.
 *   The ingredients list would let you infer most of them; inferring is exactly what must not
 *   happen. An admin fills these in before launch.
 * - **`calories_kcal` stays null wherever the source gives a range.** Every one of the 85 does
 *   ("310-340"), and a midpoint is a number nobody measured. The raw text is preserved in
 *   `nutrition->>'calories_text'`, which is what that jsonb column is for.
 * - **Allergens are not derived from ingredients.** Tier S adjacency: a dish wrongly marked
 *   nut-free is the worst bug this product can have. `dish_allergen` is left for the admin.
 *
 * Usage: node tools/seed-catalogue/build.mjs   → writes supabase/seeds/catalogue.sql
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const DATA = join(HERE, 'data');
const OUT = join(REPO, 'supabase', 'seeds', 'catalogue.sql');

/** Minimal RFC-4180 reader. The export quotes every field and embeds commas and newlines. */
function readCsv(name) {
  const text = readFileSync(join(DATA, `${name}.csv`), 'utf8');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((v) => v !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Deterministic id. Same input, same UUID, on every machine and in every environment. */
function idOf(kind, key) {
  const h = createHash('md5').update(`${kind}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

/** `Sky Bites - Amity` → `sky-bites-amity`, for the `code` columns the schema wants. */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
const dishes = readCsv('All-Dishes');
const items = readCsv('All-Menu-Items');
const menus = readCsv('All-Menus');
const schools = readCsv('All-Schools');
const kitchens = readCsv('Kitchens');
const breaks = readCsv('Break-Timing');
const schoolMenus = readCsv('School-Menu');

const notes = [];

/**
 * **Six dishes appear twice in the export**, and the schema is right to reject that:
 * `uq_dish_kitchen_name` is `(kitchen_id, lower(name))`, because a dish is kitchen-owned and
 * "Cold Coffee" made by Sky Bites is one thing however many menus price it.
 *
 * The pairs are the same dish entered twice, years apart, and they are **not** identical: one
 * carries marketing copy and no ingredients, the other a plain sentence and a full ingredients
 * list. Merging is therefore not a formality, so the rules are explicit:
 *
 * - **Canonical is the row the live Amity menu prices.** That is the copy a parent is reading in
 *   production today, so it is the one with a claim to being current.
 * - **A blank field is filled from the twin.** Losing an ingredients list to a merge would be a
 *   real regression, and there is no conflict in taking a value where the canonical has none.
 * - **A genuine disagreement is preserved, never resolved.** The pairs disagree on calories —
 *   "160" against "250–350" for the same drink — and picking one would publish a number nobody
 *   measured, which is the same failure as inventing `food_type`. Both strings are kept in
 *   `nutrition`, `calories_kcal` stays null, and the conflict is reported for an admin to settle.
 *
 * Every legacy dish id maps to the surviving row, so both menus' items resolve.
 */
function mergeDuplicates(rows, liveDishNames) {
  const byName = new Map();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }
  const canonical = [];
  const alias = new Map();   // legacy dish id -> canonical dish id
  const conflicts = [];
  for (const [, group] of byName) {
    if (group.length === 1) {
      canonical.push(group[0]);
      alias.set(group[0]['unique id'], group[0]['unique id']);
      continue;
    }
    // The row the live menu prices wins; failing that, the fuller description.
    const sorted = [...group].sort((x, y) => {
      const live = (r) => (liveDishNames.has(r['unique id']) ? 0 : 1);
      return live(x) - live(y) || y.description.length - x.description.length;
    });
    const [keep, ...rest] = sorted;
    const merged = { ...keep };
    for (const other of rest) {
      for (const field of ['description', 'Ingredients', 'nutritional_info', 'photo', 'Category']) {
        if (!merged[field] && other[field]) merged[field] = other[field];
      }
      const a = keep['Calorie Count'];
      const b = other['Calorie Count'];
      if (a && b && a !== b) {
        conflicts.push({ dish: keep.name, values: [a, b] });
        merged.calorieConflict = b;
      } else if (!merged['Calorie Count'] && b) {
        merged['Calorie Count'] = b;
      }
      alias.set(other['unique id'], keep['unique id']);
    }
    alias.set(keep['unique id'], keep['unique id']);
    canonical.push(merged);
  }
  return { canonical, alias, conflicts };
}

// ---------------------------------------------------------------------------
// Decisions taken here, each recorded in the emitted file
// ---------------------------------------------------------------------------

/**
 * **Mohali only** (`M2`, non-negotiable #7). "Demo School" sits in Chandigarh and is a Bubble test
 * row; seeding it would put a second city in a build that must not grow place-of-supply logic.
 */
const MOHALI = schools.filter((s) => !/^demo/i.test(s.name));
notes.push(`excluded ${schools.length - MOHALI.length} school(s) outside Mohali: Demo School (Chandigarh)`);

/**
 * **Legacy publication flags are not carried over, and this is the one real judgement call here.**
 *
 * Taken literally the export publishes nothing: `Sky Bites - Amity` carries all 48 priced, active
 * items but its menu `status` is `draft`, while `School Menu - May 2026` has `status = 'active'`
 * and all 36 of its items have a blank `is_active`. Amity is the school actually taking orders
 * today, so Bubble plainly does not gate visibility on `status` — the live gate is
 * `School-Menu.is_current`. Copying a flag whose meaning differs between the two systems would
 * seed a build where every school shows an empty menu, which is `§5.21`'s exact failure and would
 * waste the trip to the phone this seed exists for.
 *
 * So both menus are seeded `active`, and every priced item is seeded. Flagged, not hidden — see
 * FINDINGS in the report.
 */
const USED_MENUS = new Set(items.map((i) => i.menu));
notes.push(`published ${USED_MENUS.size} menus regardless of legacy status (see header note)`);

/** Ids priced by the menu that is actually live today (the one Amity eats from). */
const LIVE_MENU = 'Sky Bites - Amity';
const liveDishIds = new Set(
  items.filter((i) => i.menu === LIVE_MENU).map((i) => {
    const d = dishes.find((x) => x.name === i.dish);
    return d ? d['unique id'] : null;
  }),
);

const merged = mergeDuplicates(dishes, liveDishIds);
const dishAlias = merged.alias;
const uniqueDishes = merged.canonical;
if (dishes.length !== uniqueDishes.length) {
  notes.push(
    `merged ${dishes.length - uniqueDishes.length} duplicate dish rows (uq_dish_kitchen_name); ` +
      `${merged.conflicts.length} had conflicting calorie text, preserved not resolved`,
  );
}
merged.conflicts.forEach((c) => notes.push(`calorie conflict: ${c.dish} = ${c.values.join(' vs ')}`));

const kitchen = kitchens[0];
const KITCHEN_ID = idOf('kitchen', kitchen['unique id']);
const CITY_ID = idOf('city', 'mohali');

const categories = [...new Set(uniqueDishes.map((d) => d.Category).filter(Boolean))].sort();

const out = [];
const w = (s = '') => out.push(s);

w('-- =============================================================================');
w('-- catalogue.sql — the REAL Sky Bites catalogue, generated. E16-48.');
w('-- =============================================================================');
w('--');
w('-- GENERATED BY tools/seed-catalogue/build.mjs FROM tools/seed-catalogue/data/*.csv.');
w('-- Do not hand-edit: the next run overwrites it. Change the CSVs or the generator.');
w('--');
w('-- Source: the Bubble catalogue export of 2026-08-11 — dishes, prices, menus, schools,');
w('-- kitchens and break times. NO User, Child, Order or Dish_In_Order: that is real data');
w('-- about minors and does not go near staging. School and kitchen contact emails were');
w('-- dropped at import rather than blanked (see the generator header).');
w('--');
w('-- Idempotent: every insert is `on conflict do nothing` and every id is derived from the');
w('-- legacy Bubble id, so re-running changes nothing and all environments agree on ids.');
w('--');
w('-- Three things this file deliberately does NOT contain, because they would be invented:');
w('--   * `food_type` (veg / non-veg / egg) — [DM-17] is open; guessing it in this market is a');
w('--     trust failure, not a cosmetic gap. Admin fills it before launch.');
w('--   * `calories_kcal` — the source gives ranges ("310-340"); the text is kept in');
w('--     `nutrition->>\'calories_text\'` and the integer left null rather than made up.');
w('--   * `dish_allergen` — never derived from an ingredients list. Tier S.');
w('--');
notes.forEach((n) => w(`-- Note: ${n}.`));
w('-- All money is integer paise (non-negotiable #3). Legacy prices are whole rupees and are');
w('-- GST-EXCLUSIVE (docs/mvp-scope.md): 5% is added at checkout, not baked in here.');
w('');
w('begin;');
w('');

// city ------------------------------------------------------------------
w('-- Mohali. One city, one state, flat 5% GST as CGST 2.5% + SGST 2.5% (M2, R11).');
w('insert into city (id, code, name, state_name, gst_state_code, country_code, timezone) values');
w(`  ('${CITY_ID}', 'mohali', 'SAS Nagar (Mohali)', 'Punjab', '03', 'IN', 'Asia/Kolkata')`);
w('on conflict (id) do nothing;');
w('');

// kitchen ---------------------------------------------------------------
w('-- The one real kitchen. Contact columns are left null: the export had an owner email and');
w('-- it was dropped at import rather than carried into a table anon can reach columns of.');
w('insert into kitchen (id, code, name, city_id, address_line1, legacy_bubble_id) values');
w(
  `  ('${KITCHEN_ID}', '${slug(kitchen.name)}', ${q(kitchen.name)}, '${CITY_ID}', ${q(kitchen.address)}, ${q(kitchen['unique id'])})`,
);
w('on conflict (id) do nothing;');
w('');

// schools ---------------------------------------------------------------
/** `Oct 16, 2025 1:00 am` -> `2025-10-16`. Returns null rather than guessing on anything else. */
function bubbleDate(text) {
  const m = /(\w{3}) (\d{1,2}), (\d{4})/.exec(text ?? '');
  if (m === null) return null;
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const month = months.indexOf(m[1]) + 1;
  if (month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * **`onboarded_at` is the switch that makes a school visible at all**, and leaving it null is
 * how this seed first landed on staging showing nothing: `anon_school_onboarded` reads
 * `is_active and onboarded_at is not null and offboarded_at is null`, so three perfectly good
 * schools with 84 priced dishes behind them were invisible to every signed-out visitor — the
 * §5.21 failure exactly, a configuration gap that renders as an empty app.
 *
 * The date is the school's own menu-assignment start, not `now()`: these schools were onboarded
 * on real days and Bubble recorded them, so the seed uses the real one where it has it.
 */
const onboardedOn = new Map(
  schoolMenus
    .filter((a) => bubbleDate(a.start_date) !== null)
    .map((a) => [a.school, bubbleDate(a.start_date)]),
);

w(`-- ${MOHALI.length} real schools. Demo School (Chandigarh) is excluded: v1 is Mohali only.`);
w('-- `onboarded_at` is set from the real menu-assignment date: without it the anon policy hides');
w('-- the school entirely and the app renders an empty picker (ux-spec §5.21).');
w('insert into school (id, code, name, city_id, kitchen_id, institution_type, address_line1,');
w('                     onboarded_at, legacy_bubble_id) values');
w(
  MOHALI.map((s) => {
    const type = s.isCollege === 'yes' ? 'college' : 'school';
    const onboarded = onboardedOn.get(s.name);
    return `  ('${idOf('school', s['unique id'])}', '${slug(s.name)}', ${q(s.name)}, '${CITY_ID}', '${KITCHEN_ID}', '${type}', ${q(s.address)}, ${onboarded === undefined ? 'now()' : q(onboarded)}, ${q(s['unique id'])})`;
  }).join(',\n'),
);
/**
 * The one insert that updates rather than doing nothing.
 *
 * A re-run must be able to *correct* visibility: the first application of this seed left
 * `onboarded_at` null and every school was invisible, and `do nothing` would have made the fix
 * unapplyable without hand-written SQL. `coalesce` keeps a date somebody set deliberately.
 *
 * Deliberately narrow: only the two columns that decide whether the school is reachable. Content
 * columns are never overwritten — an admin who has filled in `food_type` on 79 dishes must not
 * have that erased by a re-seed, which is why `dish` stays `do nothing`.
 */
w('on conflict (id) do update set');
w('  onboarded_at = coalesce(school.onboarded_at, excluded.onboarded_at),');
w('  is_active    = true,');
w('  updated_at   = now();');
w('');

// break times -----------------------------------------------------------
const schoolByName = new Map(MOHALI.map((s) => [s.name, s]));
const usableBreaks = breaks.filter((b) => schoolByName.has(b.School));
if (usableBreaks.length > 0) {
  w('-- Break times, exactly as exported. Only Amity has any in the source; the other schools');
  w('-- get none rather than a plausible invention — an unresolved break renders as "confirmed');
  w('-- with the kitchen" (ux-spec §5.4) rather than as a time nobody agreed to.');
  w('insert into break_time (id, school_id, code, label, starts_at, ends_at, sort_order, legacy_option_value) values');
  w(
    usableBreaks
      .map((b, i) => {
        const t = (s) => {
          const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
          if (m === null) return null;
          let h = Number(m[1]) % 12;
          if (/pm/i.test(m[3])) h += 12;
          return `${String(h).padStart(2, '0')}:${m[2]}:00`;
        };
        return `  ('${idOf('break', b['unique id'])}', '${idOf('school', schoolByName.get(b.School)['unique id'])}', 'break-${b['break-id']}', ${q(b['break-time'])}, ${q(t(b.break_start))}, ${q(t(b.break_end))}, ${(i + 1) * 10}, ${q(b['break-time'])})`;
      })
      .join(',\n'),
  );
  w('on conflict (id) do nothing;');
  w('');
}

// categories ------------------------------------------------------------
w(`-- ${categories.length} real categories, in the order the menu screen groups by.`);
w('insert into dish_category (id, code, display_name, sort_order) values');
w(
  categories
    .map((c, i) => `  ('${idOf('category', c)}', '${slug(c)}', ${q(c)}, ${(i + 1) * 10})`)
    .join(',\n'),
);
w('on conflict (id) do nothing;');
w('');

// assets ----------------------------------------------------------------
/**
 * **No `asset` rows here, deliberately.**
 *
 * `tools/upload-dish-images` (`E16-43`) uploads the mirrored photos and writes the `asset` rows
 * and `dish.image_asset_id` itself, under a `dishes/` key prefix that only it knows. This seed
 * emitted its own rows on the first pass, with paths lacking that prefix, and every one of them
 * 404'd — two writers for one relationship, which is the same class as the two sources of truth
 * for the session (`E03-26`). The uploader wins because it is the one that knows what actually
 * reached the bucket.
 *
 * Run it after this seed: `node tools/upload-dish-images/upload.mjs --project-ref <ref>`.
 */

// dishes ----------------------------------------------------------------
w(`-- ${uniqueDishes.length} real dishes. food_type null by design ([DM-17]); calories kept as text in`);
w('-- `nutrition` because the source gives ranges and a midpoint would be a number nobody measured.');
// `image_asset_id` is absent for the reason above: upload-dish-images owns it.
w('insert into dish (id, kitchen_id, name, description, ingredients_text, calories_kcal,');
w('                  nutrition, category_id, food_type, legacy_bubble_id) values');
w(
  uniqueDishes
    .map((d) => {
      const nutrition = {};
      if (d['Calorie Count']) nutrition.calories_text = d['Calorie Count'];
      // The twin's figure, kept because the two disagree and neither is ours to discard.
      if (d.calorieConflict) nutrition.calories_text_conflicting = d.calorieConflict;
      if (d.nutritional_info) nutrition.notes = d.nutritional_info;
      const nut = Object.keys(nutrition).length > 0 ? `${q(JSON.stringify(nutrition))}::jsonb` : 'null';
      return `  ('${idOf('dish', d['unique id'])}', '${KITCHEN_ID}', ${q(d.name)}, ${q(d.description)}, ${q(d.Ingredients)}, null, ${nut}, '${idOf('category', d.Category)}', null, ${q(d['unique id'])})`;
    })
    .join(',\n'),
);
w('on conflict (id) do nothing;');
w('');

// menus -----------------------------------------------------------------
const usedMenus = menus.filter((m) => USED_MENUS.has(m.name));
w(`-- ${usedMenus.length} menus that actually carry items. Seeded 'active' regardless of the`);
w("-- legacy `status`: see the generator header — Bubble gates visibility on School-Menu.is_current,");
w('-- not on this column, and copying it literally would seed every school an empty menu.');
w('insert into menu (id, kitchen_id, name, status, version, published_at, legacy_bubble_id) values');
w(
  usedMenus
    .map(
      (m) =>
        `  ('${idOf('menu', m['unique id'])}', '${KITCHEN_ID}', ${q(m.name)}, 'active', ${Number(m.version) || 1}, now(), ${q(m['unique id'])})`,
    )
    .join(',\n'),
);
w('on conflict (id) do nothing;');
w('');

// menu items ------------------------------------------------------------
const menuByName = new Map(usedMenus.map((m) => [m.name, m]));
const dishByName = new Map(dishes.map((d) => [d.name, d]));
/** Legacy dish id -> the row that survived the merge. */
const canonicalDishId = (legacyId) => dishAlias.get(legacyId) ?? legacyId;
const pricedRaw = items.filter(
  (i) => i.price !== '' && menuByName.has(i.menu) && dishByName.has(i.dish),
);

/**
 * **One dish may appear once per menu** — `menu_item_menu_dish_unique`.
 *
 * The Amity menu lists "Tomato, Cucumber Cheese Sandwich In Brown Bread" twice, at ₹99 both
 * times: two rows in Bubble for one line a parent reads, and they see it duplicated today.
 * Collapsing it is a fix, not a loss.
 *
 * **But only while the prices agree.** Two prices for one dish on one menu is a question about
 * what the kitchen charges, and picking the first would be answering it by accident — so that
 * throws and the seed stops rather than publishing a number nobody chose.
 */
const seenPair = new Map();
const priced = [];
for (const i of pricedRaw) {
  const key = `${i.menu}::${canonicalDishId(dishByName.get(i.dish)['unique id'])}`;
  const previous = seenPair.get(key);
  if (previous === undefined) {
    seenPair.set(key, i);
    priced.push(i);
  } else if (previous.price !== i.price) {
    throw new Error(
      `"${i.dish}" is priced twice on "${i.menu}" and the prices disagree ` +
        `(₹${previous.price} vs ₹${i.price}). Someone has to say which is right — not this script.`,
    );
  } else {
    notes.push(`collapsed a duplicate menu line: "${i.dish}" on "${i.menu}" (both ₹${i.price})`);
  }
}
const dropped = items.length - priced.length - (pricedRaw.length - priced.length);
if (dropped > 0) notes.push(`${dropped} menu item(s) skipped: no price, or dish/menu missing`);

w(`-- ${priced.length} real prices. Whole rupees in the source; x100 into integer paise here.`);
w('-- GST-EXCLUSIVE — 5% is added at checkout, exactly as the Bubble cart does.');
w('--');
w('-- SEEDED INACTIVE — `E16-53`. This is not a style choice and it is not optional.');
w('--');
w('-- `0059`\'s `assert_dish_is_marked` refuses any ACTIVE menu_item whose dish has no');
w('-- `food_type`, and this file ships every dish unmarked because `[DM-17]` is open and the');
w('-- generator will not invent a fact about food. Both are right. Together they meant this');
w('-- seed could not be applied to a fresh database AT ALL — it died on the first row, so a');
w('-- rebuilt staging, a new environment and E01-17\'s restore drill all failed at the seed.');
w('--');
w('-- `is_active = false` satisfies both: the rows exist and are priced, and nothing unmarked');
w('-- is OFFERED to a parent, which is precisely what the guard is for. Marking the dishes is');
w('-- what activates them — see the note this file prints at the end.');
// menu_item is the one Bubble-derived table with no `legacy_bubble_id` column of its own. Its
// id is derived from the legacy id, so the provenance is recoverable without it.
w('insert into menu_item (id, menu_id, dish_id, price_paise, sort_order, is_active) values');
w(
  priced
    .map((i, n) => {
      const rupees = Number(i.price);
      if (!Number.isInteger(rupees)) throw new Error(`price is not whole rupees: ${i.dish} = ${i.price}`);
      return `  ('${idOf('menuitem', i['unique id'])}', '${idOf('menu', menuByName.get(i.menu)['unique id'])}', '${idOf('dish', canonicalDishId(dishByName.get(i.dish)['unique id']))}', ${rupees * 100}, ${(n + 1) * 10}, false)`;
    })
    .join(',\n'),
);
w('on conflict (id) do nothing;');
w('');
w('-- How to finish, once the dishes carry a food type (`E16-52`):');
w('--');
w('--   update menu_item mi set is_active = true');
w('--     from dish d where d.id = mi.dish_id and d.food_type is not null;');
w('--');
w('-- It is deliberately NOT run here. Activating is the moment a dish becomes visible to a');
w('-- parent, and that should be a thing somebody does on purpose after checking the marks —');
w('-- not a side effect of seeding. The statement is idempotent and safe to re-run.');
w('');

// assignments -----------------------------------------------------------
const assignments = schoolMenus.filter(
  (a) => schoolByName.has(a.school) && menuByName.has(a.menu),
);
w('-- Which school eats from which menu. Straight from School-Menu, which is the flag Bubble');
w('-- actually gates on.');
w('insert into menu_assignment (id, school_id, menu_id, valid_from, valid_to) values');
w(
  assignments
    .map((a) => {
      const date = bubbleDate(a.start_date) ?? '2026-01-01';
      return `  ('${idOf('assignment', a['unique id'])}', '${idOf('school', schoolByName.get(a.school)['unique id'])}', '${idOf('menu', menuByName.get(a.menu)['unique id'])}', '${date}', null)`;
    })
    .join(',\n'),
);
w('on conflict (id) do nothing;');
w('');

w('-- Cutoff. Without a kitchen_config row the cutoff functions have nothing to read and every');
w('-- service date reads as closed, which looks exactly like a bug (ux-spec §5.21 N2).');
w(`insert into kitchen_config (kitchen_id, order_cutoff_time) values ('${KITCHEN_ID}', '21:00:00')`);
w('on conflict (kitchen_id) do nothing;');
w('');
w('insert into school_config (school_id, default_delivery_mode, allow_classroom_delivery) values');
w(
  MOHALI.map(
    (s) => `  ('${idOf('school', s['unique id'])}', 'classroom', true)`,
  ).join(',\n'),
);
w('on conflict (school_id) do nothing;');
w('');
/**
 * Retire the synthetic fixtures that were seeded before the real catalogue existed.
 *
 * **Deactivated by explicit id, never deleted, and never with an unqualified predicate.**
 * `E05-21` was an unqualified DELETE that took out every real order on staging; the lesson is
 * that a maintenance statement names its rows. These three schools are also referenced by the
 * test order placed in `E05-16`, so deleting them would either fail on a foreign key or destroy
 * the only end-to-end order we have. Hiding them from the picker is all that is wanted: Alpha
 * Public School sitting next to Amity International School is exactly the confusion this seed
 * exists to remove.
 *
 * Reversible in one statement if the synthetic set is ever wanted back.
 */
w('-- Hide the synthetic schools now that real ones exist. By id, never a bare update (E05-21),');
w('-- and deactivated rather than deleted so the E05-16 test order keeps its references.');
w('update school set is_active = false, updated_at = now() where id in (');
w("  '50000000-0000-0000-0000-000000000001',  -- Alpha Public School");
w("  '50000000-0000-0000-0000-000000000002',  -- Bravo International");
w("  '50000000-0000-0000-0000-000000000003'   -- Cedar Valley");
w(');');
w('');
w('-- Same for their menus, so no assignment can resolve to a fixture dish.');
w("update menu set status = 'retired' where id in (");
w("  'e0000000-0000-0000-0000-000000000001',");
w("  'e0000000-0000-0000-0000-000000000002',");
w("  'e0000000-0000-0000-0000-000000000003'");
w(');');
w('');
w('commit;');
w('');

writeFileSync(OUT, out.join('\n'), 'utf8');

console.log(`catalogue.sql written — ${OUT}`);
console.log(
  `  ${MOHALI.length} schools · ${categories.length} categories · ${uniqueDishes.length} dishes · ` +
    `${usedMenus.length} menus · ${priced.length} prices · ${assignments.length} assignments`,
);
notes.forEach((n) => console.log(`  note: ${n}`));
