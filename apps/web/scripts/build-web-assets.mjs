#!/usr/bin/env node
/**
 * Produce every image the public site serves, from sources that live **outside** this
 * repository, and write them into `apps/web/public/img/` where CI can reach them.
 *
 *     node apps/web/scripts/build-web-assets.mjs
 *     node apps/web/scripts/build-web-assets.mjs --check   # verify budget + manifest only
 *
 * ## Why anything binary is committed at all
 *
 * `RH1` keeps the 46 MB design package out of git, and it is right: undiffable binary sources
 * that change twice a year, are read by humans rather than by the build, and cost every clone
 * forever. None of that describes what this script emits. Netlify's CI checkout has no access
 * to `~/graybag-dish-images` or to `../Legacy-Application/`, so **the site cannot build without
 * these files being in the repository** — and what goes in is a few hundred kilobytes of
 * re-encoded, budgeted build *output*, regenerable from a committed manifest.
 *
 * The distinction that makes this consistent rather than a loophole: the *sources* stay out,
 * this script is the only thing that may write into `public/img/`, and `MANIFEST.json` plus a
 * size budget asserted in the test suite is what stops it quietly becoming a dumping ground.
 *
 * ## The photographs are 120 pixels
 *
 * Every dish photo in `tools/mirror-dish-images/manifest.json` is between 80 and 213 pixels
 * wide; 72 of the 82 are exactly 120 x 120. That was verified against the Bubble CDN directly
 * — `?w=1200` and the Cloudflare `/cdn-cgi/image/` resize path both return 120 x 120, so no
 * larger original exists. It is the real catalogue photography at the size it was shot for.
 *
 * **Nothing here upscales them.** They are emitted at native size and the page displays them
 * at 96 CSS pixels, where they are still above 1x and hold up at 2x. A hero-sized food
 * photograph is not available from this source and pretending otherwise would look exactly
 * like what it is — so the page stops trying to win on photography and lets the copy carry
 * the argument until there is real photography to use (`E12-13`).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const ROOT = join(WEB, '..', '..');
const OUT = join(WEB, 'public', 'img');
const MANIFEST_OUT = join(OUT, 'MANIFEST.json');

/**
 * The committed-bytes budget. Asserted by `src/lib/assets.test.ts` — a budget nobody checks
 * is a wish.
 *
 * This governs what the *repository* carries, not what a visitor downloads — page weight has its
 * own budget in `scripts/check-build.mjs`. It halved when the 28-tile catalogue mosaic became
 * five range tiles; the number was reset to the new reality rather than left with the old
 * slack in it, because a budget with room to spare is one that never fires.
 */
export const BUDGET_BYTES = 130_000;

const PACKAGE = join(ROOT, '..', 'Legacy-Application', 'Graybag_Design Package');
const DISH_MANIFEST = join(ROOT, 'tools', 'mirror-dish-images', 'manifest.json');

/**
 * One dish per category, and that is the whole set.
 *
 * This was a 28-tile mosaic of the catalogue. It was replaced because it made the wrong
 * argument: a fixed grid of every dish reads as "here is our list", when the actual proposition
 * is that **each school gets its own menu, agreed with them, rotating through the term**. A
 * catalogue grid is also a maintenance liability — it goes stale the first time a menu changes,
 * and it implies a permanence the product does not have.
 *
 * Five dishes, one per category, chosen to show *range*: a breakfast, a main, a wrap, a salad,
 * a bake. The page uses them as supporting images beside category copy, not as the argument.
 * Two more — a snack and a drink — exist only for the hero's menu frame; `FOOD.categories`
 * drives the food section and does not name them, so it still renders five.
 *
 * A side effect worth stating: the committed image set drops from 232 KB to 113 KB.
 */
const RANGE = [
  ['breakfast', 'Idli Sambar', 'Idli sambar'],
  ['mains', 'Rajma Rice', 'Rajma rice'],
  ['wraps', 'Paneer Wrap', 'Paneer wrap'],
  ['salads', 'Quinoa Salad', 'Quinoa salad'],
  ['bakery', 'Wheat Jaggery Cake', 'Wheat jaggery cake'],
  // Two more for the hero's menu frame only. The food section iterates FOOD.categories and
  // looks these up by id, so it renders five cards regardless; these simply give the mockup a
  // sixth tile and a third row, which is what stops it looking like a stamp on the background.
  ['snacks', 'Paneer Puff', 'Paneer puff'],
  ['drinks', 'Banana Shake', 'Banana shake'],
];

/** `Rajma With Rice` -> `rajma-with-rice`. Same slug rule the prototype uses. */
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[(),/&]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function die(message) {
  console.error(message);
  process.exit(1);
}

function dirBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const s = statSync(path);
    total += s.isDirectory() ? dirBytes(path) : s.size;
  }
  return total;
}

// --------------------------------------------------------------------------- check mode

if (process.argv.includes('--check')) {
  if (!existsSync(MANIFEST_OUT)) die(`No ${MANIFEST_OUT}. Run this script without --check.`);
  const bytes = dirBytes(OUT);
  if (bytes > BUDGET_BYTES) {
    die(`public/img is ${bytes} bytes, over the ${BUDGET_BYTES} budget.`);
  }
  console.log(`public/img: ${bytes} bytes, within the ${BUDGET_BYTES} budget.`);
  process.exit(0);
}

// --------------------------------------------------------------------------- sources

if (!existsSync(PACKAGE)) {
  die(
    `The design package is not at ${PACKAGE}.\n` +
      `It lives outside the repository (RH1). Copy it in from ../Legacy-Application-backup/.`,
  );
}
if (!existsSync(DISH_MANIFEST)) die(`No dish manifest at ${DISH_MANIFEST}.`);

const dishManifest = JSON.parse(readFileSync(DISH_MANIFEST, 'utf8'));
const dishDir = dishManifest.outDir;
if (!existsSync(dishDir)) {
  die(
    `The mirrored dish photographs are not at ${dishDir}.\n` +
      `They live outside the repository by design. Re-run tools/mirror-dish-images/mirror.mjs.`,
  );
}

/** dish name -> absolute path of its mirrored file. First entry wins; the manifest repeats names. */
const dishFiles = new Map();
for (const entry of dishManifest.images) {
  if (entry.status !== 'ok' || !entry.file) continue;
  const path = join(dishDir, entry.file);
  if (!existsSync(path)) continue;
  if (!dishFiles.has(entry.dish)) dishFiles.set(entry.dish, path);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'dishes'), { recursive: true });

const records = [];

async function emit(relative, buffer) {
  const path = join(OUT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  const meta = await sharp(buffer).metadata();
  records.push({
    file: relative,
    bytes: buffer.length,
    width: meta.width,
    height: meta.height,
  });
  return relative;
}

// --------------------------------------------------------------------------- dishes

const range = [];
const absent = [];

for (const [category, dish, label] of RANGE) {
  const source = dishFiles.get(dish);
  if (!source) {
    absent.push(dish);
    continue;
  }
  const key = slug(dish);
  const input = sharp(source).ensureAlpha().flatten({ background: '#ffffff' });
  const meta = await sharp(source).metadata();

  // Square, centre-cropped, and **never enlarged** — `withoutEnlargement` is the whole point.
  //
  // **WebP only, and no AVIF.** The usual advice is AVIF-with-a-WebP-fallback, and it is wrong
  // at this size: measured over the original 28 tiles, AVIF came out at 5.3 KB average against WebP's
  // 3.8 KB, because a 120 x 120 image is small enough that AVIF's container and entropy-coder
  // overhead costs more than its compression saves. Shipping both would have added 147 KB to
  // the repository to make every tile bigger. WebP is supported by every browser this audience
  // has.
  await emit(
    `dishes/${key}.webp`,
    await input
      .clone()
      .resize(120, 120, { fit: 'cover', position: 'centre', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer(),
  );

  range.push({ category, dish, label, slug: key, sourceWidth: meta.width, sourceHeight: meta.height });
}

if (absent.length) {
  console.warn(`  no mirrored photograph for: ${absent.join(', ')}`);
}

// --------------------------------------------------------------------------- brand

const brandSource = (relative) => {
  const path = join(PACKAGE, relative);
  if (!existsSync(path)) die(`Missing brand asset: ${relative}`);
  return path;
};

/**
 * Which lockup goes where, because getting it wrong is invisible rather than broken:
 * `Logo/Graybag_Logo_Transparent.png` is the full lockup **in green**, so on a green field it
 * disappears. Green surfaces take the white lockup from `Black&White/`.
 */
await emit(
  'logo.webp',
  await sharp(brandSource('01_Graybag_Logo/Logo/Graybag_Logo_Transparent.png'))
    .resize({ width: 320, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer(),
);

await emit(
  'logo-white.webp',
  await sharp(brandSource('01_Graybag_Logo/Black&White/Graybag_Logo_White_Transparent.png'))
    .resize({ width: 320, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer(),
);


/**
 * The vegetable pattern.
 *
 * The supplied file is a 3276 x 4961 poster, not a seamless tile. It is used at ~10% opacity
 * as texture behind green fields, where a repeat seam is invisible — which is exactly how the
 * reference screens use it. The **dark green** colourway is the one that shows over a green
 * fill; `Pattern_Green` over `primary-500` is green on green and vanishes.
 *
 * `design-tokens.md` §1: the full-colour pattern is packaging and marketing; in digital
 * layouts it is the monochrome variant. A single-hue colourway is that variant.
 */
const patternAlpha = await sharp(brandSource('05_Pattern/Pattern_Dark Green.png'))
  .resize({ width: 420, withoutEnlargement: true })
  .ensureAlpha()
  .extractChannel('alpha')
  .toBuffer();

await emit(
  'pattern.webp',
  await sharp({ create: { width: 420, height: 636, channels: 3, background: '#000000' } })
    .joinChannel(patternAlpha)
    .webp({ quality: 30, alphaQuality: 72 })
    .toBuffer(),
);

// --------------------------------------------------------------------------- favicon + social

await emit(
  'favicon.png',
  await sharp(brandSource('01_Graybag_Logo/Icons/Graybag_Icon Filled_Nutritious Green.png'))
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

await emit(
  'apple-touch-icon.png',
  await sharp(brandSource('01_Graybag_Logo/Icons/Graybag_Icon Filled_White.png'))
    .resize(160, 160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: 16, bottom: 16, left: 16, right: 16,
      // `bg.surfaceBrandFlat` — a field carrying only the logo, which is the one place
      // `primary-500` is legal as a surface (design-tokens.md §2.1).
      background: { r: 0x00, g: 0xaf, b: 0x52, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

/**
 * The social preview card (1200 x 630).
 *
 * Composed here rather than hand-designed so it cannot drift from the brand: the same green
 * field, the same pattern, the same white lockup the site's own header uses.
 */
const OG_W = 1200;
const OG_H = 630;
const ogPattern = await sharp(brandSource('05_Pattern/Pattern_Dark Green.png'))
  .resize(OG_W, OG_H, { fit: 'cover', position: 'centre' })
  .ensureAlpha()
  .composite([{
    input: Buffer.from([255, 255, 255, 205]),
    raw: { width: 1, height: 1, channels: 4 },
    tile: true,
    blend: 'dest-out',
  }])
  .png()
  .toBuffer();

const ogLogo = await sharp(brandSource('01_Graybag_Logo/Black&White/Graybag_Logo_White_Transparent.png'))
  .resize({ width: 620 })
  .png()
  .toBuffer();

await emit(
  'og.jpg',
  await sharp({
    create: { width: OG_W, height: OG_H, channels: 4, background: '#00af52' },
  })
    .composite([
      { input: ogPattern, top: 0, left: 0 },
      { input: ogLogo, gravity: 'centre' },
    ])
    .jpeg({ quality: 76, progressive: true })
    .toBuffer(),
);

// --------------------------------------------------------------------------- manifest

const total = records.reduce((sum, r) => sum + r.bytes, 0);

writeFileSync(
  MANIFEST_OUT,
  `${JSON.stringify(
    {
      generated_by: 'apps/web/scripts/build-web-assets.mjs',
      task: 'E12-01',
      note:
        'Build OUTPUT, committed because CI cannot reach the sources. Regenerate, never hand-edit. ' +
        'Sources: ../Legacy-Application/Graybag_Design Package (RH1) and the dish mirror (E16-28).',
      photography_note:
        'Every dish photograph is 120px or smaller at source — verified against the Bubble CDN. ' +
        'Nothing here is upscaled and the page displays them at 72-88 CSS px.',
      budget_bytes: BUDGET_BYTES,
      total_bytes: total,
      dish_source_dir: dishDir,
      range,
      absent,
      files: records.sort((a, b) => a.file.localeCompare(b.file)),
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Wrote ${records.length} files, ${total} bytes (budget ${BUDGET_BYTES}).`);
if (total > BUDGET_BYTES) die('Over budget.');
