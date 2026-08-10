#!/usr/bin/env node
// upload-dish-images — E16-43.
//
// Takes the 82 dish photographs mirrored off the dying Bubble CDN by `E16-28`
// (`tools/mirror-dish-images/`, binaries outside the repo) and:
//
//   1. verifies every local file still matches the SHA-256 committed in the manifest,
//   2. uploads it into the PUBLIC `dish-images` bucket created by migration `0002`,
//   3. upserts an `asset` row per image, and
//   4. points `dish.image_asset_id` at it so `public_menu.image_path` resolves.
//
// Idempotent. Re-running uploads nothing and changes nothing when the checksums already
// match — that is what makes it safe to run against staging and then production.
//
// It writes to exactly two application tables, `asset` and `dish`, and to
// `storage.objects` in one bucket. Nothing else.
//
// Usage
// -----
//   export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
//   node tools/upload-dish-images/upload.mjs --project-ref jcagqjsibcpjyskvebeq --dry-run
//   node tools/upload-dish-images/upload.mjs --project-ref jcagqjsibcpjyskvebeq
//
// See README.md for the credential rules and for what `--fixture-aliases` is.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const MANIFEST = join(REPO, 'tools', 'mirror-dish-images', 'manifest.json');

/** The one public bucket (`0002` §15). Long-cached, CDN-served, no PII. */
const BUCKET = 'dish-images';
/** Key prefix inside the bucket. Matches the shape the shared fixtures already assume. */
const PREFIX = 'dishes';
/** Bubble file ids are immutable, so a stored object never legitimately changes. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// -----------------------------------------------------------------------------
// Staging fixture aliases (`--fixture-aliases`)
//
// The 85 legacy dishes are NOT in the database yet — staging carries the five seed
// fixtures from `supabase/seed.sql`, none of which has a `legacy_bubble_id`. So the
// real join key does not exist, and two of the five happen to match a legacy dish by
// name while two more are the same dish under a different name.
//
// This table is the "different name" half, and it is opt-in precisely because it is a
// human judgement rather than a key. It applies to seed fixtures only. When the real
// menu is imported with its `legacy_bubble_id`s, this becomes dead weight and should
// be deleted rather than extended.
// -----------------------------------------------------------------------------
const FIXTURE_ALIASES = {
  'veg sandwich': 'Veg Sandwich In Brown Bread',
  'rajma chawal': 'Rajma Rice',
};

// -----------------------------------------------------------------------------
// Arguments
// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    projectRef: null,
    url: process.env.SUPABASE_URL ?? null,
    dir: null,
    dryRun: false,
    fixtureAliases: false,
    verifyOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--project-ref') args.projectRef = next();
    else if (a === '--url') args.url = next();
    else if (a === '--dir') args.dir = next();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--fixture-aliases') args.fixtureAliases = true;
    else if (a === '--verify-only') args.verifyOnly = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const USAGE = `
upload-dish-images (E16-43)

  --project-ref <ref>   Supabase project, e.g. jcagqjsibcpjyskvebeq. Used to derive the
                        API URL and, with SUPABASE_ACCESS_TOKEN, to fetch the service key.
  --url <url>           Override the API URL (default https://<ref>.supabase.co).
  --dir <path>          Where the mirrored binaries live. Defaults to the manifest's outDir.
  --fixture-aliases     Also match the staging seed fixtures whose names differ from the
                        legacy ones. Opt-in: it is a judgement, not a key.
  --dry-run             Report what would change and touch nothing.
  --verify-only         Re-check local files against the committed checksums and exit.

Credentials, in order of preference:
  SUPABASE_SERVICE_ROLE_KEY   used directly
  SUPABASE_ACCESS_TOKEN       + --project-ref, to fetch the service key from the
                              management API. On this machine:
                                export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
`.trim();

// -----------------------------------------------------------------------------
// Credentials
// -----------------------------------------------------------------------------

async function resolveServiceKey(projectRef) {
  const direct = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (direct) return direct;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'No credentials. Set SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ACCESS_TOKEN with --project-ref.\n' +
        'Uploading needs the SERVICE key — the anon key in apps/mobile/.env.staging cannot write.',
    );
  }
  if (!projectRef) throw new Error('SUPABASE_ACCESS_TOKEN needs --project-ref to find the service key');

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`management API ${res.status}: ${await res.text()}`);
  const keys = await res.json();
  const svc = Array.isArray(keys) && keys.find((k) => k.name === 'service_role');
  if (!svc?.api_key) throw new Error('management API returned no service_role key');
  return svc.api_key;
}

// -----------------------------------------------------------------------------
// Thin Supabase clients. No SDK: this is four HTTP calls and a dependency would
// outlive the one-off tool that needed it.
// -----------------------------------------------------------------------------

function makeClient(baseUrl, key) {
  const auth = { apikey: key, Authorization: `Bearer ${key}` };

  async function rest(path, init = {}) {
    const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...init,
      headers: { ...auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`REST ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  async function upload(key_, body, contentType) {
    const res = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${key_}`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': contentType,
        'Cache-Control': CACHE_CONTROL,
        'x-upsert': 'true',
      },
      body,
    });
    if (!res.ok) throw new Error(`storage upload ${key_} -> ${res.status}: ${await res.text()}`);
  }

  async function listObjects() {
    // The list endpoint pages at 100 by default; 82 objects fit, but ask for more so a
    // growing catalogue does not silently truncate into "missing, re-upload everything".
    const seen = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: `${PREFIX}/`, limit: 1000, offset }),
      });
      if (!res.ok) throw new Error(`storage list -> ${res.status}: ${await res.text()}`);
      const page = await res.json();
      seen.push(...page);
      if (page.length < 1000) break;
    }
    return new Set(seen.map((o) => `${PREFIX}/${o.name}`));
  }

  return { rest, upload, listObjects, publicUrl: (k) => `${baseUrl}/storage/v1/object/public/${BUCKET}/${k}` };
}

// -----------------------------------------------------------------------------
// Local verification
// -----------------------------------------------------------------------------

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Reads every mirrored file and re-checks it against the committed manifest.
 *
 * This runs before anything is uploaded, and a mismatch is fatal rather than skipped:
 * the manifest is the only auditable record that these bytes are the bytes that came
 * off the CDN, and uploading a file that no longer matches it would quietly destroy
 * that guarantee.
 */
async function loadAndVerify(images, dir) {
  const good = [];
  const bad = [];
  for (const img of images) {
    const path = join(dir, img.file);
    try {
      const buf = await readFile(path);
      if (buf.byteLength !== img.bytes) {
        bad.push({ img, why: `size ${buf.byteLength} != manifest ${img.bytes}` });
        continue;
      }
      const digest = sha256(buf);
      if (digest !== img.sha256) {
        bad.push({ img, why: `sha256 ${digest.slice(0, 12)}… != manifest ${img.sha256.slice(0, 12)}…` });
        continue;
      }
      good.push({ ...img, buf, key: `${PREFIX}/${img.file}`, dimensions: readDimensions(buf) });
    } catch (err) {
      bad.push({ img, why: err.code === 'ENOENT' ? `missing at ${path}` : String(err.message ?? err) });
    }
  }
  return { good, bad };
}

/**
 * Pixel dimensions straight out of the file header, for PNG and JPEG.
 *
 * Worth the thirty lines: `asset.width`/`height` let a list lay a tile out at the right
 * aspect ratio before the image has arrived, and the audience is on connections where
 * "before the image has arrived" is most of the time.
 */
function readDimensions(buf) {
  // PNG: 8-byte signature, then an IHDR chunk whose first two fields are the dimensions.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the marker segments to the start-of-frame, which carries the size.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Matching manifest entries to dish rows
// -----------------------------------------------------------------------------

const normalise = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Works out which dish each image belongs to.
 *
 * `legacy_bubble_id` is the real key and the only one that cannot be wrong, so it wins
 * outright. Name matching is the fallback for a database whose dishes predate the
 * legacy import — it is exact after whitespace and case normalisation, never fuzzy, and
 * an ambiguous name (the manifest has five duplicated ones) is reported rather than
 * resolved by luck.
 */
export function matchDishes(dishes, images, { useAliases = false } = {}) {
  const byLegacy = new Map();
  for (const img of images) byLegacy.set(img.id, img);

  const byName = new Map();
  for (const img of images) {
    const k = normalise(img.dish);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(img);
  }

  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const dish of dishes) {
    if (dish.legacy_bubble_id && byLegacy.has(dish.legacy_bubble_id)) {
      matched.push({ dish, image: byLegacy.get(dish.legacy_bubble_id), how: 'legacy_bubble_id' });
      continue;
    }

    let key = normalise(dish.name);
    let how = 'name';
    if (!byName.has(key) && useAliases && FIXTURE_ALIASES[key]) {
      key = normalise(FIXTURE_ALIASES[key]);
      how = 'fixture-alias';
    }

    const candidates = byName.get(key);
    if (!candidates) {
      unmatched.push(dish);
      continue;
    }
    if (candidates.length > 1) {
      // Deterministic: the legacy ids sort stably, so a re-run picks the same photo.
      const chosen = [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0];
      ambiguous.push({ dish, count: candidates.length, chosen });
      matched.push({ dish, image: chosen, how: `${how} (ambiguous, ${candidates.length} candidates)` });
      continue;
    }
    matched.push({ dish, image: candidates[0], how });
  }

  return { matched, unmatched, ambiguous };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const dir = resolve((args.dir ?? manifest.outDir).replace(/^~(?=$|\/)/, homedir()));
  const images = manifest.images.filter((i) => i.status === 'ok');

  console.log(`manifest  ${MANIFEST}`);
  console.log(`binaries  ${dir}`);
  console.log(`images    ${images.length} ok, ${manifest.images.length - images.length} permanently missing at source\n`);

  await stat(dir).catch(() => {
    throw new Error(`the mirrored binaries are not at ${dir}. Run tools/mirror-dish-images/mirror.mjs, or pass --dir.`);
  });

  const { good, bad } = await loadAndVerify(images, dir);
  for (const { img, why } of bad) console.error(`  CHECKSUM/FILE FAIL  ${img.file} — ${why}`);
  if (bad.length > 0) {
    throw new Error(`${bad.length} file(s) do not match the committed manifest. Refusing to upload.`);
  }
  console.log(`verified  ${good.length}/${images.length} files match their committed SHA-256`);

  if (args.verifyOnly) return 0;

  const baseUrl = args.url ?? (args.projectRef ? `https://${args.projectRef}.supabase.co` : null);
  if (!baseUrl) throw new Error('need --project-ref or --url (or SUPABASE_URL)');
  const key = await resolveServiceKey(args.projectRef);
  const db = makeClient(baseUrl, key);
  console.log(`target    ${baseUrl}${args.dryRun ? '  (DRY RUN — nothing will be written)' : ''}\n`);

  // ---------------------------------------------------------------------------
  // 1. Upload. An image is skipped when the object is already in the bucket AND the
  //    asset row records the same checksum — the two together are what "already
  //    uploaded, unchanged" means. Either one alone can be stale.
  // ---------------------------------------------------------------------------
  const existingObjects = await db.listObjects();
  const existingAssets = new Map(
    (await db.rest(`asset?select=id,path,checksum_sha256,mime_type,byte_size&bucket=eq.${BUCKET}`)).map((a) => [
      a.path,
      a,
    ]),
  );

  let uploaded = 0;
  let skipped = 0;
  const failed = [];
  const assetIdByKey = new Map();

  for (const img of good) {
    const priorAsset = existingAssets.get(img.key);
    const unchanged = existingObjects.has(img.key) && priorAsset?.checksum_sha256 === img.sha256;

    if (unchanged) {
      skipped += 1;
      assetIdByKey.set(img.key, priorAsset.id);
      continue;
    }

    if (args.dryRun) {
      console.log(`  would upload  ${img.key}  (${img.bytes} bytes, ${img.contentType})`);
      uploaded += 1;
      continue;
    }

    try {
      await db.upload(img.key, img.buf, img.contentType);
      const [row] = await db.rest(`asset?on_conflict=bucket,path&select=id`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          kind: 'dish_image',
          bucket: BUCKET,
          path: img.key,
          mime_type: img.contentType,
          byte_size: img.bytes,
          width: img.dimensions?.width ?? null,
          height: img.dimensions?.height ?? null,
          checksum_sha256: img.sha256,
        }),
      });
      assetIdByKey.set(img.key, row.id);
      uploaded += 1;
    } catch (err) {
      failed.push({ img, why: String(err.message ?? err) });
      console.error(`  FAILED  ${img.key} — ${err.message ?? err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Link. Only `dish.image_asset_id` is written, and only when it would change.
  // ---------------------------------------------------------------------------
  const dishes = await db.rest('dish?select=id,name,legacy_bubble_id,image_asset_id&order=name');
  const { matched, unmatched, ambiguous } = matchDishes(dishes, good, { useAliases: args.fixtureAliases });

  let linked = 0;
  let alreadyLinked = 0;
  const linkFailed = [];

  for (const { dish, image, how } of matched) {
    const assetId = assetIdByKey.get(image.key) ?? existingAssets.get(image.key)?.id;
    if (!assetId) {
      linkFailed.push({ dish, why: `no asset row for ${image.key}` });
      continue;
    }
    if (dish.image_asset_id === assetId) {
      alreadyLinked += 1;
      continue;
    }
    if (args.dryRun) {
      console.log(`  would link    ${dish.name}  ->  ${image.key}   [${how}]`);
      linked += 1;
      continue;
    }
    try {
      await db.rest(`dish?id=eq.${dish.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ image_asset_id: assetId }),
      });
      console.log(`  linked        ${dish.name}  ->  ${image.key}   [${how}]`);
      linked += 1;
    } catch (err) {
      linkFailed.push({ dish, why: String(err.message ?? err) });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Summary. The unmatched counts are the interesting half: an image nothing
  //    points at is inert, but a dish with no image is a placeholder in the app.
  // ---------------------------------------------------------------------------
  const usedKeys = new Set(matched.map((m) => m.image.key));

  console.log('\n─────────────────────────────────────────────');
  console.log(`  uploaded            ${uploaded}`);
  console.log(`  skipped (unchanged) ${skipped}`);
  console.log(`  failed              ${failed.length}`);
  console.log('  ---');
  console.log(`  dishes linked       ${linked}`);
  console.log(`  already linked      ${alreadyLinked}`);
  console.log(`  dishes without      ${unmatched.length}`);
  console.log(`  images unused       ${good.length - usedKeys.size}`);
  console.log('─────────────────────────────────────────────');

  for (const { dish, count } of ambiguous) {
    console.log(`  note: "${dish.name}" matched ${count} manifest entries; took the lowest legacy id`);
  }
  for (const dish of unmatched) {
    console.log(`  no image: ${dish.name}${dish.legacy_bubble_id ? '' : '  (no legacy_bubble_id)'}`);
  }
  for (const { dish, why } of linkFailed) console.error(`  LINK FAILED  ${dish.name} — ${why}`);

  if (!args.dryRun && linked + alreadyLinked > 0) {
    console.log(`\n  public URL shape: ${db.publicUrl(`${PREFIX}/<file>`)}`);
    console.log('  public_menu.image_path is asset.path — the KEY, not the URL. See README.');
  }

  return failed.length + linkFailed.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`\nupload-dish-images: ${err.message ?? err}`);
      process.exit(1);
    });
}
