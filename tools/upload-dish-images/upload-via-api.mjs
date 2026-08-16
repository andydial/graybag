#!/usr/bin/env node
/**
 * Put the mirrored legacy dish photos on production **through the app's own upload path** —
 * `E16-55`.
 *
 *     set -a; . ~/.graybag-secrets/prod.env; set +a
 *     node tools/upload-dish-images/upload-via-api.mjs                # dry run
 *     node tools/upload-dish-images/upload-via-api.mjs --apply
 *
 * ## Why this exists when `upload.mjs` already uploads
 *
 * `upload.mjs` writes to Storage and to `asset` **itself**, with the service role. It predates
 * `admin-dish-image` (`E10-24`), and it is now a second write path into the same three places —
 * the bucket, the `asset` row and `dish.image_asset_id`. Two paths mean two sets of rules about
 * what a valid image is, and the one a person uses from the admin screen is not the one that put
 * 77 photos on production.
 *
 * So this drives the **same Edge Function the single-dish uploader calls**. Same `dish.edit`
 * check, same content-type allowlist, same size ceiling, same `asset` row shape, same orphan
 * cleanup if the row fails after the object is stored. Nothing here writes to a table.
 *
 * ## Matching is by id, and it cannot be wrong
 *
 * All 79 production dishes carry `legacy_bubble_id`, and every manifest entry carries the same
 * Bubble id. `matchDishes` — reused from `upload.mjs`, not reimplemented — takes that key
 * outright and never falls back to a name where an id exists. **A wrong photo on a dish is worse
 * than no photo**, which is why the name fallback is exact rather than fuzzy and why an ambiguous
 * name is reported instead of resolved.
 *
 * ## "Resized" here means the browser's rule, applied honestly
 *
 * `prepareDishImage` in the admin screen downscales only when the long edge exceeds 1280px. Every
 * one of these files is **120px tall** — they are thumbnails, which is what the legacy CDN
 * actually stores — so the rule is a no-op on all 82 and they are sent as they are. Re-encoding a
 * 120px thumbnail would lose quality and gain nothing. The resize path is implemented and used
 * when a file needs it; today none does, and the run says so rather than implying work it did not
 * do.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { matchDishes, readDimensions } from './upload.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const MANIFEST = join(REPO, 'tools', 'mirror-dish-images', 'manifest.json');

/** The same ceiling `apps/web/src/lib/admin/dish-image.ts` uses. Kept in step by hand, and named. */
export const MAX_EDGE = 1280;

/** `admin-dish-image` accepts exactly these. A file of any other type is reported, never converted. */
const ALLOWED = new Set(['image/webp', 'image/jpeg', 'image/png']);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const value = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const APPLY = has('--apply');
const OPERATOR = value('--as') ?? 'anuragdial@gmail.com';
const LIMIT = Number(value('--limit') ?? 0);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function die(message) {
  console.error(message);
  process.exit(2);
}

/**
 * Whether a file has to be shrunk, and to what.
 *
 * Pure, and separated from the shrinking so the rule can be tested without an image. Mirrors
 * `prepareDishImage`: scale by the long edge, never up.
 */
export function resizePlan({ width, height }, maxEdge = MAX_EDGE) {
  const longest = Math.max(width || 0, height || 0);
  if (!longest || longest <= maxEdge) return { needed: false, width, height };
  const scale = maxEdge / longest;
  return {
    needed: true,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Shrink with `sips`, which ships with macOS.
 *
 * No image library is added for this. The repository has no native image dependency and one
 * would be a build-time cost on every machine and every CI run, for a path that — see the header
 * — currently never executes.
 */
function shrink(buffer, plan, ext) {
  const dir = mkdtempSync(join(tmpdir(), 'gb-img-'));
  const src = join(dir, `in${ext}`);
  writeFileSync(src, buffer);
  const out = spawnSync('sips', ['-Z', String(Math.max(plan.width, plan.height)), src], {
    encoding: 'utf8',
  });
  if (out.status !== 0) die(`sips could not resize: ${out.stderr || out.stdout}`);
  const resized = readFileSync(src);
  try { unlinkSync(src); } catch { /* the temp dir goes with the process */ }
  return resized;
}

/**
 * Everything below runs only when this file is executed, not when it is imported.
 *
 * The test imports `resizePlan`, and a module that reads env, mints a session and calls
 * `process.exit` at import time cannot be tested at all — which is how the pure rule ends up
 * being the one part nobody covers.
 */
async function main() {
  // ------------------------------------------------------------------------------------ inputs

  const url = process.env.SUPABASE_PROD_URL;
  const anon = process.env.SUPABASE_PROD_ANON_KEY;
  const service = process.env.SUPABASE_PROD_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    die('Set SUPABASE_PROD_URL, SUPABASE_PROD_ANON_KEY and SUPABASE_PROD_SERVICE_ROLE_KEY.\n' +
        '  set -a; . ~/.graybag-secrets/prod.env; set +a');
  }

  if (!existsSync(MANIFEST)) die(`No manifest at ${MANIFEST}.`);
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const outDir = manifest.outDir;
  if (!outDir || !existsSync(outDir)) {
    die(`The mirrored images are not at ${outDir}.\n` +
        'They live outside the repository by design — re-run tools/mirror-dish-images to fetch them.');
  }

  // ---------------------------------------------------------------------------- read production

  const rest = async (path) => {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    if (!response.ok) die(`reading ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };

  const dishes = await rest('dish?select=id,name,legacy_bubble_id,image_asset_id&order=name');

  /**
   * A real user session, so the **write** runs under that person's grants rather than the service
   * role. The service key is used only to mint the link and to read — every call to
   * `admin-dish-image` carries a user JWT and is refused without `dish.edit`, exactly as the admin
   * screen is.
   */
  async function operatorToken(email) {
    const link = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email }),
    }).then((r) => r.json());
    if (!link.hashed_token) die(`Could not mint a session for ${email}: ${JSON.stringify(link).slice(0, 200)}`);

    const session = await fetch(`${url}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
    }).then((r) => r.json());
    if (!session.access_token) die(`Could not verify a session for ${email}.`);
    return session.access_token;
  }

  // ----------------------------------------------------------------------------------- matching

  const { matched, unmatched, ambiguous } = matchDishes(dishes, manifest.images);

  /** Split the matches by whether the bytes are actually on disk — three were never mirrored. */
  const onDisk = [];
  const noFile = [];
  for (const m of matched) {
    const path = m.image.file ? join(outDir, m.image.file) : null;
    if (path && existsSync(path)) onDisk.push({ ...m, path });
    else noFile.push(m);
  }

  // Verify every file against the manifest BEFORE uploading any of it. The manifest is the only
  // auditable record that these bytes came off the legacy CDN; uploading one that no longer matches
  // would quietly destroy that guarantee, and a half-finished run is worse than a refused one.
  const corrupt = [];
  for (const m of onDisk) {
    const buffer = readFileSync(m.path);
    if (sha256(buffer) !== m.image.sha256) corrupt.push(m);
  }
  if (corrupt.length > 0) {
    die(`${corrupt.length} file(s) no longer match the manifest checksum. Nothing was uploaded.\n` +
        corrupt.map((m) => `    ${m.image.file}`).join('\n'));
  }

  const already = onDisk.filter((m) => m.dish.image_asset_id !== null);
  const todo = onDisk.filter((m) => m.dish.image_asset_id === null);
  const work = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

  // ------------------------------------------------------------------------------------- report

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  console.log(`${dishes.length} dishes on production, ${manifest.images.length} images in the manifest.\n`);
  console.log(`  matched by legacy_bubble_id   ${onDisk.length}`);
  console.log(`  already have a photo          ${already.length}`);
  console.log(`  to upload                     ${work.length}${LIMIT > 0 ? ` (--limit ${LIMIT})` : ''}`);
  console.log(`  matched but never mirrored    ${noFile.length}`);
  console.log(`  no image at all               ${unmatched.length}`);
  if (ambiguous.length > 0) console.log(`  AMBIGUOUS, not resolved       ${ambiguous.length}`);

  const noPhoto = [...noFile.map((m) => ({ name: m.dish.name, why: 'mirrored copy missing — a permanent 403 at the legacy CDN' })),
                   ...unmatched.map((d) => ({ name: d.name ?? d.dish?.name, why: 'no image in the manifest for this dish' })),
                   ...ambiguous.map((a) => ({ name: a.dish.name, why: 'more than one image claims this name — refused rather than guessed' }))];

  if (noPhoto.length > 0) {
    console.log(`\nThese ${plural(noPhoto.length, 'dish', 'dishes')} will have NO photo:`);
    for (const n of noPhoto) console.log(`  - ${n.name}\n      ${n.why}`);
  }

  // How many would actually be shrunk, stated before anything runs.
  let wouldShrink = 0;
  for (const m of work) {
    const dims = readDimensions(readFileSync(m.path)) ?? {};
    if (resizePlan(dims).needed) wouldShrink += 1;
  }
  console.log(`\nOf the ${work.length} to upload, ${wouldShrink} exceed ${MAX_EDGE}px and would be shrunk.`);
  if (wouldShrink === 0 && work.length > 0) {
    console.log(`  Every file is at or under ${MAX_EDGE}px — these are 120px thumbnails, which is what`);
    console.log(`  the legacy CDN stores. Re-encoding them would lose quality and gain nothing.`);
  }

  if (!APPLY) {
    console.log(`\nDry run. Nothing was uploaded. Add --apply to do it.`);
    process.exit(0);
  }

  // -------------------------------------------------------------------------------------- upload

  const token = await operatorToken(OPERATOR);
  console.log(`\nUploading as ${OPERATOR}, through admin-dish-image.\n`);

  let ok = 0;
  const failed = [];

  for (const [i, m] of work.entries()) {
    const raw = readFileSync(m.path);
    const contentType = m.image.contentType;
    if (!ALLOWED.has(contentType)) {
      failed.push({ name: m.dish.name, why: `content type ${contentType} is not one the endpoint accepts` });
      continue;
    }

    const dims = readDimensions(raw) ?? {};
    const plan = resizePlan(dims);
    const bytes = plan.needed ? shrink(raw, plan, extname(m.image.file)) : raw;

    const response = await fetch(`${url}/functions/v1/admin-dish-image`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dishId: m.dish.id,
        filename: m.image.file,
        contentType,
        dataBase64: bytes.toString('base64'),
        width: plan.needed ? plan.width : dims.width,
        height: plan.needed ? plan.height : dims.height,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      failed.push({ name: m.dish.name, why: `${response.status} ${JSON.stringify(body).slice(0, 160)}` });
    } else {
      ok += 1;
    }
    process.stdout.write(`\r  ${i + 1}/${work.length} — ${ok} uploaded, ${failed.length} failed   `);
  }

  console.log('\n');
  console.log(`Uploaded ${ok}. Failed ${failed.length}.`);
  for (const f of failed) console.log(`  - ${f.name}: ${f.why}`);
  process.exit(failed.length > 0 ? 1 : 0);

}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
