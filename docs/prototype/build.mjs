#!/usr/bin/env node
/**
 * Build the clickable GrayBag prototype into ONE self-contained HTML file.
 *
 *     node docs/prototype/build.mjs
 *
 * ## Why a build step for a prototype
 *
 * Andy needs a single file he can open on his phone, which means the dish photography has to
 * be inlined as `data:` URIs — a prototype that goes grey on patchy wifi is not a prototype of
 * anything. Inlining 82 images by hand is not something a person should be typing, so it
 * happens here.
 *
 * ## The photographs are the real ones
 *
 * Not stock. These are GrayBag's own dish photos, mirrored off the Bubble CDN by
 * `tools/mirror-dish-images/` (`E16-28`, decision `AR6`) and living **outside** the repository
 * at the `outDir` recorded in its `manifest.json`. The design has to be judged against food we
 * actually sell, because how those photographs sit in a card is most of what the card is.
 *
 * Three of the 85 return a permanent 403 at source and are being re-shot (`E16-29`). Any dish
 * whose file is missing falls back to a pattern-filled brand tile — which is exactly what the
 * real app must do for a dish with no photo, so the prototype shows that state honestly rather
 * than hiding it.
 *
 * ## This build reads binaries from outside the repo, and writes one file into it
 *
 * The manifest is committed; the bytes are not, and must not become committed by way of this
 * script. `graybag-prototype.html` is generated and is gitignored for the same reason the
 * mirror is — see `docs/prototype/README.md`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MANIFEST = join(ROOT, 'tools', 'mirror-dish-images', 'manifest.json');

if (!existsSync(MANIFEST)) {
  console.error(`No manifest at ${MANIFEST}. Run tools/mirror-dish-images first.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const outDir = manifest.outDir;

if (!existsSync(outDir)) {
  console.error(
    `The mirrored images are not at ${outDir}.\n` +
      `They live outside the repository by design. Re-run:\n` +
      `  node tools/mirror-dish-images/mirror.mjs --dishes <Dishes.csv> --out ${outDir}`,
  );
  process.exit(1);
}

/** `Rajma With Rice Or Prantha` → `rajma-with-rice-or-prantha`. The key the HTML uses. */
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[(),/&]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const images = {};
const missing = [];
let bytes = 0;

for (const entry of manifest.images) {
  if (entry.status !== 'ok' || !entry.file) {
    missing.push(entry.dish);
    continue;
  }
  const path = join(outDir, entry.file);
  if (!existsSync(path)) {
    missing.push(entry.dish);
    continue;
  }
  const buf = readFileSync(path);
  const mime = entry.contentType || (/\.png$/i.test(entry.file) ? 'image/png' : 'image/jpeg');
  // Later duplicates lose: the manifest has a few repeated dish names across schools.
  const key = slug(entry.dish);
  if (images[key]) continue;
  images[key] = `data:${mime};base64,${buf.toString('base64')}`;
  bytes += buf.length;
}

/**
 * The brand assets, from the design package. Inlined for the same reason the dishes are: one
 * file that works with the network off. The package lives beside the repo, not in it, so a
 * missing package degrades to a drawn fallback rather than failing the build.
 */
const PACKAGE = join(
  ROOT,
  '..',
  'Legacy-Application',
  'Graybag_Design Package',
);

const asset = (relative, mime) => {
  const path = join(PACKAGE, relative);
  if (!existsSync(path)) {
    console.log(`  (no ${relative} — the prototype falls back to its drawn mark)`);
    return '';
  }
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
};

/**
 * Which variant goes where, because getting this wrong is invisible rather than broken:
 *
 * `Logo/Graybag_Logo_Transparent.png` is the full lockup **in green**, so on a green fill it
 * disappears. Green screens take the white lockup from `Black&White/`. And the patterns are
 * coloured shapes on *transparent*, not on a background — so `Pattern_Green` over a green fill
 * is green-on-green and vanishes. Over green we use the **dark green** pattern, which is what
 * gives reference screens 01 and 02 their tone-on-tone texture.
 */
const brand = {
  logoWhite:   asset('01_Graybag_Logo/Black&White/Graybag_Logo_White_Transparent.png', 'image/png'),
  logoGreen:   asset('01_Graybag_Logo/Logo/Graybag_Logo_Transparent.png', 'image/png'),
  iconWhite:   asset('01_Graybag_Logo/Icons/Graybag_Icon Filled_White.png', 'image/png'),
  iconGreen:   asset('01_Graybag_Logo/Icons/Graybag_Icon Filled_Nutritious Green.png', 'image/png'),
  patternDark: asset('05_Pattern/Pattern_Dark Green.png', 'image/png'),  // over green fills
  patternGreen:asset('05_Pattern/Pattern_Green.png', 'image/png'),        // over white/pale fills
};

const template = readFileSync(join(HERE, 'prototype.src.html'), 'utf8');
if (!template.includes('/*__IMAGES__*/')) {
  console.error('prototype.src.html has no /*__IMAGES__*/ marker — nothing to inject into.');
  process.exit(1);
}

const payload =
  `const DISH_IMAGES = ${JSON.stringify(images)};\n` +
  `const BRAND = ${JSON.stringify(brand)};`;
const out = template.replace('/*__IMAGES__*/', () => payload);
const target = join(HERE, 'graybag-prototype.html');
writeFileSync(target, out);

console.log(`${Object.keys(images).length} real dish photos inlined (${(bytes / 1024 / 1024).toFixed(2)} MB of source)`);
if (missing.length) {
  console.log(`${missing.length} without a usable file — these render as pattern tiles:`);
  missing.forEach((d) => console.log(`  · ${d}`));
}
console.log(`\n${(Buffer.byteLength(out) / 1024 / 1024).toFixed(2)} MB → ${target}`);
