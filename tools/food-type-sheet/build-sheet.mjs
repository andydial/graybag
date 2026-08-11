#!/usr/bin/env node
/**
 * Build the veg / egg / non-veg marking sheet for the kitchen (`DM-17`).
 *
 *     node tools/food-type-sheet/build-sheet.mjs
 *
 * ## Why this exists
 *
 * `dish.food_type` is `null` on every dish in the system. The source Excel has no such column,
 * so the importer cannot fill it and emits a `food_type_absent` notice on every run — see
 * `DM-17` and `docs/legacy-bubble-schema.md`. Nobody has ever written the value down.
 *
 * That was a latent gap while the mark was decoration. It stopped being decoration when the
 * public site committed to it in writing: *"Every dish carries a veg, egg or non-veg mark, and
 * your school's menu contains only what you have agreed to."* A parent will filter on it and a
 * school will rely on it, so it has to come from the kitchen rather than from anyone's guess.
 *
 * This emits the round-trip artefact: one row per distinct dish name, an **empty** `food_type`
 * column, and enough context for whoever fills it in to know which dish is meant.
 *
 * ## Nothing here is pre-filled, deliberately
 *
 * Eight of the 79 names contain "egg" or "omelette" and it is tempting to fill those in. Not
 * done: an anchored sheet gets skimmed rather than checked, and the whole point of asking the
 * kitchen is that this is the one field nobody may infer. A wrong `veg` on a dish containing egg
 * is precisely the trust failure `DM-17` describes.
 *
 * ## Name, not id
 *
 * The legacy system references dishes **by name** rather than by id (`docs/bubble-recon-findings.md`
 * §9), so name is the key the kitchen actually recognises. Six names carry two rows each; those
 * are flagged in the sheet so the kitchen can say if a pair genuinely differs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MANIFEST = join(ROOT, 'tools', 'mirror-dish-images', 'manifest.json');
const OUT = join(HERE, 'food-type-catalogue.csv');

/**
 * The catalogue, from the dish-image manifest.
 *
 * That manifest is the only committed record of the legacy dish list — the export CSVs stay
 * outside the repository because their siblings contain children's personal data (`RH4`,
 * non-negotiable #5). It carries every one of the 85 dish records, including the three whose
 * photograph 403s, so no dish is dropped from the sheet for want of a picture.
 */
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** dish name -> the records carrying it, in manifest order. */
const byName = new Map();
for (const entry of manifest.images) {
  if (!byName.has(entry.dish)) byName.set(entry.dish, []);
  byName.get(entry.dish).push(entry);
}

const csvCell = (value) => {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [...byName.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, entries]) => ({
    dish_name: name,
    // The column the kitchen fills. Empty on purpose — see the header comment.
    food_type: '',
    kitchen_notes: '',
    // Context, so a filler can tell two similar dishes apart and we can map the answer back.
    duplicate_rows: entries.length > 1 ? entries.length : '',
    has_photo: entries.some((e) => e.status === 'ok') ? 'yes' : 'no',
    legacy_dish_ids: entries.map((e) => e.id).join(' | '),
  }));

const HEADERS = ['dish_name', 'food_type', 'kitchen_notes', 'duplicate_rows', 'has_photo', 'legacy_dish_ids'];

writeFileSync(
  OUT,
  [HEADERS.join(','), ...rows.map((r) => HEADERS.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n',
  'utf8',
);

const duplicates = rows.filter((r) => r.duplicate_rows !== '');
const noPhoto = rows.filter((r) => r.has_photo === 'no');

console.log(`Wrote ${OUT}`);
console.log(`  ${rows.length} distinct dish names across ${manifest.images.length} catalogue records`);
console.log(`  ${duplicates.length} names carry two rows: ${duplicates.map((r) => r.dish_name).join('; ')}`);
console.log(`  ${noPhoto.length} without a working photograph: ${noPhoto.map((r) => r.dish_name).join('; ')}`);
console.log(`  food_type is empty on every row, by design`);
