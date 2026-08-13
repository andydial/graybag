import { readFileSync } from 'node:fs';

import { design } from '@graybag/shared';
import { describe, expect, it } from 'vitest';

/**
 * `tokens.css` is generated, and this is what stops it going stale (decision `S8`).
 *
 * The file is committed so `astro dev` starts from a clean checkout without a build step. The
 * cost of committing a generated file is that it can drift from its generator — silently, and
 * invisibly, because a slightly wrong green still looks like a green. This test is the price of
 * that convenience.
 */

const tokensUrl = new URL('./tokens.css', import.meta.url);
const siteUrl = new URL('./site.css', import.meta.url);

const tokens = readFileSync(tokensUrl, 'utf8');
const site = readFileSync(siteUrl, 'utf8');

describe('tokens.css', () => {
  it('is exactly what packages/shared/src/design generates', () => {
    expect(tokens).toBe(design.cssVariableSheet());
  });

  it('carries the semantic roles the site actually uses', () => {
    expect(tokens).toContain('--gb-action-primary-bg');
    expect(tokens).toContain('--gb-bg-surface-inverse');
    expect(tokens).toContain('--gb-focus-ring');
  });
});

describe('site.css', () => {
  it('contains no colour literal of its own', () => {
    // The lint rule `E13-11` polices `.ts` and `.tsx`; it does not see a stylesheet. Without
    // this assertion the one file most likely to acquire a stray hex is the only one unguarded.
    const stripped = site.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(stripped).not.toMatch(/\brgba?\(/);
    expect(stripped).not.toMatch(/\bhsla?\(/);
  });

  it('references only custom properties that exist', () => {
    const defined = new Set([...tokens.matchAll(/^\s*(--gb-[a-z0-9-]+):/gm)].map((m) => m[1]));
    const used = new Set([...site.matchAll(/var\((--gb-[a-z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((name) => !defined.has(name));
    // A `var()` pointing at nothing does not error — it falls back to the inherited value, so a
    // typo shows up as an element that is *nearly* right and nobody notices.
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(80);
  });

  it('reaches for a ramp only where the design system permits it', () => {
    // `S7`: components consume the semantic role map, never a ramp step. `css.ts` allows two
    // legitimate ramp consumers, and everything else that appears here is a marketing surface
    // the app's role map has no name for — the amber CTA on a green field, the pattern tint,
    // the hairlines inside a dark panel. Each is deliberate; the assertion is that the list
    // stays short and visible rather than growing quietly.
    const ramps = [...site.matchAll(/var\((--gb-ramp-[a-z0-9-]+)/g)].map((m) => m[1]);
    expect(new Set(ramps).size).toBeLessThanOrEqual(8);
  });

  it('sets no font-family literal outside the token', () => {
    // ux-spec §3.2: the family is one token so that swapping VAG Rounded Next back in — if
    // E19-03 ever permits it — stays a one-line change. `Nunito Fallback` is the metric-adjusted
    // local face and is defined in this file, so it is named here by necessity.
    const families = [...site.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    for (const family of families) {
      expect(family === "'Nunito'" || family === "'Nunito Fallback'" || family.includes('var(--gb-font-family)') || family === 'inherit').toBe(true);
    }
  });
});
