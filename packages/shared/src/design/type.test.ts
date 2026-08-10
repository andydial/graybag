import { describe, expect, it } from 'vitest';

import { MIN_FONT_SIZE, brandTypeBands, font, scale, maxFontSizeMultiplier } from './type.js';

/**
 * Which brand band each token was placed in, and why the placement is the assertion
 * rather than the size.
 *
 * `E13-15` moved `h3` 18→20, `bodyLg` 17→16 and `overline` 11→12 because all three sat
 * outside every band the brand specifies. Recording the intended band here means a future
 * size change fails loudly if it wanders back out, instead of quietly reintroducing the
 * thing that took a 40-page PDF read to find.
 */
const BAND: Record<keyof typeof scale, keyof typeof brandTypeBands> = {
  display: 'mainHeading',
  h1: 'heading',
  h2: 'subheading',
  h3: 'subheading',
  bodyLg: 'body',
  body: 'body',
  bodyStrong: 'body',
  bodySm: 'body',
  label: 'body',
  button: 'body',
  caption: 'body',
  overline: 'body',
};

/**
 * Styles the brand hierarchy has no row for, and which therefore set their own weight.
 *
 * `label`, `button` and `overline` are UI chrome — small type that must read at a glance
 * on a mid-range phone in daylight, and the brand's four levels are a document-typography
 * spec with no entry for a button. `bodyStrong` is emphasis *inside* body, which the
 * hierarchy does not describe either; its size still obeys the Body band.
 *
 * This is the only place the scale extends the brand rather than following it, and it
 * extends it only into cases the brand does not cover. Keeping the list explicit is what
 * stops "the brand says Regular" being argued away one token at a time.
 */
const OUTSIDE_HIERARCHY = new Set(['label', 'button', 'overline', 'bodyStrong']);

describe('the type scale sits inside the brand hierarchy', () => {
  it.each(Object.entries(scale))('%s is inside its band', (name, token) => {
    const band = brandTypeBands[BAND[name as keyof typeof scale]];
    expect(token.size).toBeGreaterThanOrEqual(band.min);
    expect(token.size).toBeLessThanOrEqual(band.max);
  });

  it.each(Object.entries(scale).filter(([n]) => !OUTSIDE_HIERARCHY.has(n)))(
    '%s carries its band weight',
    (name, token) => {
      expect(token.weight).toBe(brandTypeBands[BAND[name as keyof typeof scale]].weight);
    },
  );

  it('keeps the list of styles that set their own weight short and deliberate', () => {
    // Four. If this grows, the brand hierarchy has stopped governing the scale and
    // nobody had to decide that it should.
    expect(OUTSIDE_HIERARCHY.size).toBeLessThanOrEqual(4);
    for (const name of OUTSIDE_HIERARCHY) expect(scale).toHaveProperty(name);
  });

  it('gives the four levels a visible ladder — 32 / 28 / 24 / 20', () => {
    expect([scale.display.size, scale.h1.size, scale.h2.size, scale.h3.size]).toEqual([
      32, 28, 24, 20,
    ]);
  });
});

describe('12 is the floor', () => {
  // §3.2 asserted this in prose while defining an 11pt `overline` one line below it. The
  // contradiction survived until an external document forced a line-by-line re-read.
  it.each(Object.entries(scale))('%s is not below the floor', (_name, token) => {
    expect(token.size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it('matches the floor of the brand body band', () => {
    expect(MIN_FONT_SIZE).toBe(brandTypeBands.body.min);
  });
});

describe('there is no Bold in the product (S13)', () => {
  it('bundles Regular, Medium and SemiBold — three weights, and these three', () => {
    expect(Object.values(font).map((f) => f.weight).sort()).toEqual([400, 500, 600]);
  });

  it('uses no weight the bundle does not contain', () => {
    const bundled = new Set(Object.values(font).map((f) => f.weight));
    for (const [name, token] of Object.entries(scale)) {
      expect(bundled.has(token.weight), `${name} asks for weight ${token.weight}`).toBe(true);
    }
  });

  it('is Nunito outright — not a fallback behind an unlicensed face', () => {
    // `DS-06`, decided 2026-08-10: Nunito IS the family. `DS-02` named it as a substitute while
    // the VAG Rounded Next licence was unresolved; that question is now closed rather than
    // deferred, and the pair was removed so nobody "restores" the brand face without checking.
    for (const f of Object.values(font)) expect(f.family).toBe('Nunito');
    for (const f of Object.values(font)) expect(f).not.toHaveProperty('fallback');
  });

  it('bundles exactly the three weights the brand hierarchy uses', () => {
    // Every extra weight is bundle size on the connection that is the real constraint.
    expect(Object.values(font).map((f) => f.weight).sort()).toEqual([400, 500, 600]);
  });
});

describe('line heights', () => {
  it('are even, so they land on the 4-point grid', () => {
    for (const [name, token] of Object.entries(scale)) {
      expect(token.lineHeight % 2, `${name}`).toBe(0);
    }
  });

  it('are never smaller than the size they set', () => {
    for (const [name, token] of Object.entries(scale)) {
      expect(token.lineHeight, `${name}`).toBeGreaterThanOrEqual(token.size);
    }
  });

  it('gives bodyLg looser leading than body at the same size', () => {
    // The distinction between them was always leading, not size.
    expect(scale.bodyLg.size).toBe(scale.body.size);
    expect(scale.bodyLg.lineHeight).toBeGreaterThan(scale.body.lineHeight);
  });
});

describe('dynamic type is capped', () => {
  it('caps every style in the scale', () => {
    // A style with no cap scales to 200% and destroys a two-line button on a 360dp
    // Android. Missing a cap is silent until someone turns the OS setting up.
    for (const name of Object.keys(scale)) {
      expect(maxFontSizeMultiplier, `${name} has no cap`).toHaveProperty(name);
    }
  });

  it('lets body copy grow further than headings and chrome', () => {
    expect(maxFontSizeMultiplier.body).toBeGreaterThan(maxFontSizeMultiplier.h1);
    expect(maxFontSizeMultiplier.body).toBeGreaterThan(maxFontSizeMultiplier.button);
    expect(maxFontSizeMultiplier.tabBarLabel).toBeLessThan(maxFontSizeMultiplier.button);
  });

  it('never allows an uncapped or shrinking multiplier', () => {
    for (const [name, m] of Object.entries(maxFontSizeMultiplier)) {
      expect(m, `${name}`).toBeGreaterThanOrEqual(1);
      expect(m, `${name}`).toBeLessThanOrEqual(2);
    }
  });
});

describe('tracking', () => {
  it('gives the only uppercase style enough of it to be readable', () => {
    // Uppercase at 12pt without tracking is unreadable, which is the whole reason the
    // token carries +0.08em rather than inheriting 0.
    expect(scale.overline.tracking).toBeGreaterThanOrEqual(0.08);
  });

  it('tightens as size rises and never the other way', () => {
    expect(scale.display.tracking).toBeLessThan(scale.h1.tracking);
    expect(scale.h1.tracking).toBeLessThan(scale.h2.tracking);
    expect(scale.body.tracking).toBe(0);
  });
});
