#!/usr/bin/env node
/**
 * Propose a `food_type` for every unmarked dish, for a human to review — `E10-32`.
 *
 *     set -a; . ~/.graybag-secrets/prod.env; set +a
 *     node scripts/propose-food-types.mjs
 *
 * **Writes nothing to the database.** It emits two files and exits:
 *
 *   * `review/food-types.csv`  — the proposal, in the importer's own dish format, so applying it
 *                                is one command and no editing beyond the cells you disagree with
 *   * `review/food-types.md`   — the same thing to read, grouped by how much attention it needs
 *
 * ## The shape of the CSV is deliberate
 *
 * Only `name`, `kitchen_code`, `category` and `food_type` are emitted. The importer compares only
 * the fields a file actually carries, so a file without `description` or `calories_kcal` cannot
 * change them — the apply can move `food_type` and nothing else. The advisory columns
 * (`confidence`, `why`) are ignored by the importer and are there for the person reading it.
 *
 * A dish this module refuses to guess at gets a **blank** `food_type`, which the importer reads as
 * "no opinion" and leaves alone. Applying the file without touching it is therefore safe: it marks
 * what is defensible and skips what is not.
 *
 * ## Why it does not simply write them
 *
 * Andy's instruction, and it is the right one: a wrong veg marking is the worst error this product
 * can make. This produces a recommendation with its evidence attached; a person applies it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HIGH, LOW, proposeFoodType, summarise } from './lib/food-type.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'review');

const url = process.env.SUPABASE_PROD_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PROD_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'Set SUPABASE_PROD_URL and SUPABASE_PROD_SERVICE_ROLE_KEY.\n' +
      '  set -a; . ~/.graybag-secrets/prod.env; set +a',
  );
  process.exit(2);
}

const rest = async (path) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    console.error(`reading ${path}: ${response.status} ${await response.text()}`);
    process.exit(2);
  }
  return response.json();
};

const [dishes, kitchens, categories] = await Promise.all([
  rest('dish?select=id,name,ingredients_text,description,food_type,is_active,kitchen_id,category_id&order=name'),
  rest('kitchen?select=id,code'),
  rest('dish_category?select=id,code'),
]);

const kitchenCode = new Map(kitchens.map((k) => [k.id, k.code]));
const categoryCode = new Map(categories.map((c) => [c.id, c.code]));

const rows = dishes.map((d) => {
  const proposal = proposeFoodType({
    name: d.name,
    ingredientsText: d.ingredients_text,
    description: d.description,
  });
  return {
    ...proposal,
    name: d.name,
    kitchenCode: kitchenCode.get(d.kitchen_id) ?? '',
    categoryCode: categoryCode.get(d.category_id) ?? '',
    current: d.food_type,
    isActive: d.is_active !== false,
    ingredients: d.ingredients_text ?? '',
  };
});

// Already marked dishes are carried through with their stored value, not the proposal. Re-deciding
// a value a human already set is exactly the behaviour that would make this file unsafe to apply.
const unmarked = rows.filter((r) => r.current === null);

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const header = ['name', 'kitchen_code', 'category', 'food_type', 'confidence', 'why', 'ingredients'];
const csv = [
  header.join(','),
  ...unmarked.map((r) =>
    [r.name, r.kitchenCode, r.categoryCode, r.foodType ?? '', r.confidence, r.why, r.ingredients]
      .map(csvCell)
      .join(','),
  ),
].join('\n');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'food-types.csv'), `${csv}\n`);

// ------------------------------------------------------------------------- the readable version

const s = summarise(unmarked);
const group = (predicate) => unmarked.filter(predicate);

const table = (list) =>
  list.length === 0
    ? '_None._\n'
    : ['| Dish | Proposed | Why |', '|---|---|---|']
        .concat(
          list.map((r) => `| ${r.name} | \`${r.foodType ?? '—'}\` | ${r.why} |`),
        )
        .join('\n') + '\n';

const md = `# Proposed food types — review before applying

**Generated, not decided.** ${s.total} unmarked dishes on production. Nothing has been written.

| | Count |
|---|---|
| Confident **veg** | ${s.vegHigh} |
| Confident **egg** | ${group((r) => r.foodType === 'egg' && r.confidence === HIGH).length} |
| **Needs you** | ${s.needsYou} |
| — of those, no proposal at all | ${s.unknown} |

## Applying it

\`\`\`bash
set -a; . ~/.graybag-secrets/prod.env; set +a
node tools/bulk-import/src/cli.mjs --dishes review/food-types.csv          # dry run
node tools/bulk-import/src/cli.mjs --dishes review/food-types.csv --apply
\`\`\`

The file carries **only** \`name\`, \`kitchen_code\`, \`category\` and \`food_type\`, so applying it
can change the food type and nothing else. Rows with a blank \`food_type\` are left untouched —
edit those cells or leave them, either is safe.

---

## 1. Egg — ${group((r) => r.foodType === 'egg').length} dishes

These name egg in the dish or its ingredients. **Check this list first**: an egg dish marked veg is
the failure that matters.

${table(group((r) => r.foodType === 'egg'))}

## 2. Needs a decision — ${s.unknown} dishes with no ingredient list

The name reads as vegetarian in most cases, and that is not enough. **No proposal is made**; the
\`food_type\` cell is blank and applying the file leaves these exactly as they are.

${table(group((r) => r.foodType === null))}

## 3. Proposed veg, worth a glance — ${s.vegLow} dishes

Vegetarian on the evidence, with an ingredient that is *usually* but not *always* vegetarian.

${table(group((r) => r.foodType === 'veg' && r.confidence === LOW))}

## 4. Proposed veg, confident — ${s.vegHigh} dishes

No egg or meat in the name or the ingredient list.

${table(group((r) => r.foodType === 'veg' && r.confidence === HIGH))}
`;

writeFileSync(join(OUT_DIR, 'food-types.md'), md);

console.log(`${dishes.length} dishes, ${unmarked.length} unmarked.`);
console.log(`  confident veg   ${s.vegHigh}`);
console.log(`  confident egg   ${group((r) => r.foodType === 'egg' && r.confidence === HIGH).length}`);
console.log(`  needs you       ${s.needsYou}  (${s.unknown} with no proposal at all)`);
console.log(`\nreview/food-types.csv and review/food-types.md written. Nothing was written to the database.`);
if (s.unknown > 0 || s.vegLow > 0) {
  console.log("\nRead sections 1 and 2 of the .md before applying.");
}
