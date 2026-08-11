import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The committed image set (`E12-01`).
 *
 * `RH1` keeps the 46 MB design package out of git and is right to. These files are the narrow
 * exception — build *outputs*, committed because Netlify's CI checkout cannot reach
 * `~/graybag-dish-images` or `../Legacy-Application/` — and an exception without a boundary is
 * just a reversal. The boundary is this test: a byte budget, a provenance record, and a check
 * that nothing arrived in `public/img/` except by way of the generator.
 */

const manifestUrl = new URL('../../public/img/MANIFEST.json', import.meta.url);
const imgDir = new URL('../../public/img/', import.meta.url);

interface Manifest {
  generated_by: string;
  budget_bytes: number;
  total_bytes: number;
  mosaic: { dish: string; label: string; slug: string; sourceWidth: number; sourceHeight: number }[];
  absent: string[];
  files: { file: string; bytes: number; width: number; height: number }[];
}

const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as Manifest;

describe('the committed image budget', () => {
  it('stays inside its budget', () => {
    expect(manifest.total_bytes).toBeLessThanOrEqual(manifest.budget_bytes);
  });

  it('agrees with what is actually on disk', () => {
    // A manifest that has drifted from the files is a budget nobody is really enforcing.
    const onDisk = manifest.files.reduce(
      (sum, file) => sum + statSync(fileURLToPath(new URL(file.file, imgDir))).size,
      0,
    );
    expect(onDisk).toBe(manifest.total_bytes);
  });

  it('records how it was generated, so nothing here is hand-curated', () => {
    expect(manifest.generated_by).toBe('apps/web/scripts/build-web-assets.mjs');
  });

  it('emitted every file it claims to have emitted', () => {
    for (const file of manifest.files) {
      expect(existsSync(fileURLToPath(new URL(file.file, imgDir))), file.file).toBe(true);
    }
  });
});

describe('the dish photographs', () => {
  it('has a photograph for every dish in the mosaic', () => {
    expect(manifest.absent).toEqual([]);
    expect(manifest.mosaic.length).toBeGreaterThanOrEqual(24);
  });

  it('never upscales — the source photography is 120px and stays 120px', () => {
    // The whole design of the food section rests on this. Every dish photo GrayBag owns is
    // 80-213px wide (72 of 82 are exactly 120x120), verified against the Bubble CDN with both
    // `?w=` and the Cloudflare resize path. Blowing one up to hero size would look exactly like
    // what it is, so the tiles are capped at 88 CSS px instead.
    for (const dish of manifest.mosaic) {
      expect(dish.sourceWidth, dish.dish).toBeLessThanOrEqual(240);
    }
    for (const file of manifest.files.filter((f) => f.file.startsWith('dishes/'))) {
      expect(file.width, file.file).toBeLessThanOrEqual(120);
      expect(file.height, file.file).toBeLessThanOrEqual(120);
    }
  });

  it('ships WebP only, because AVIF is bigger at this size', () => {
    // Measured: 5.3 KB average as AVIF against 3.8 KB as WebP over the same 28 tiles. At
    // 120x120 the container overhead costs more than the compression saves, so shipping both
    // would have added 147 KB to the repository to make every tile larger.
    const dishes = manifest.files.filter((f) => f.file.startsWith('dishes/'));
    expect(dishes.length).toBeGreaterThan(0);
    for (const file of dishes) {
      expect(file.file, file.file).toMatch(/\.webp$/);
    }
  });

  it('gives every dish a display label distinct from the raw catalogue name where needed', () => {
    for (const dish of manifest.mosaic) {
      expect(dish.label.length).toBeGreaterThan(0);
      // Catalogue names carry parentheticals ("Vada Pao (Atta Base Bread)") that read as
      // kitchen shorthand on a sales page.
      expect(dish.label).not.toMatch(/[(/]/);
    }
  });
});

describe('the brand assets', () => {
  it.each(['logo.webp', 'logo-white.webp', 'pattern.webp', 'favicon.png', 'apple-touch-icon.png', 'og.jpg'])(
    'emits %s',
    (name) => {
      expect(manifest.files.some((f) => f.file === name), name).toBe(true);
    },
  );

  it('emits the social card at exactly the size the platforms want', () => {
    const og = manifest.files.find((f) => f.file === 'og.jpg');
    expect(og?.width).toBe(1200);
    expect(og?.height).toBe(630);
  });

  it('keeps a white lockup, because the green one disappears on a green field', () => {
    // Not a cosmetic point: `Logo/Graybag_Logo_Transparent.png` is the lockup *in green*, and
    // the hero and footer are both `forest-500`.
    expect(manifest.files.some((f) => f.file === 'logo-white.webp')).toBe(true);
  });
});
