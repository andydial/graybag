import { describe, expect, it } from 'vitest';

import { area, columns, niceScale, thinLabels } from './chart.js';
import type { Point } from './chart.js';

const p = (label: string, value: number): Point => ({ label, value });

describe('niceScale', () => {
  it('rounds up to a round number with evenly spaced ticks', () => {
    // Asserted as properties rather than three magic numbers. The first version of this test
    // expected 20 for an input of 12; the code returns 15, whose ticks are 0/5/10/15 — a better
    // scale than the one I had guessed at. The properties are what actually matter.
    for (const input of [1, 7, 12, 99, 230, 1_000_000]) {
      const s = niceScale(input);
      expect(s.max, `${input} must not clip`).toBeGreaterThanOrEqual(input);
      expect(s.values[0], `${input} starts at zero`).toBe(0);
      expect(s.values.at(-1), `${input} ends at the max`).toBe(s.max);

      const step = s.values[1]! - s.values[0]!;
      for (let i = 1; i < s.values.length; i++) {
        expect(s.values[i]! - s.values[i - 1]!, `${input} spacing`).toBeCloseTo(step, 6);
      }
      // Headroom of at most one tick. More than that wastes half the chart on empty space.
      expect(s.max - input, `${input} headroom`).toBeLessThan(step);
    }
  });

  it('always starts at zero', () => {
    // A truncated y axis exaggerates every change on it. On a revenue chart that is not a
    // presentation choice, it is a misleading one.
    expect(niceScale(500).values[0]).toBe(0);
  });

  it('survives an all-zero series rather than dividing by it', () => {
    // Day one, and every day before the first order. It must render a flat empty chart.
    expect(niceScale(0)).toEqual({ max: 1, values: [0, 1] });
  });

  it('handles a single tiny value', () => {
    const s = niceScale(1);
    expect(s.max).toBeGreaterThanOrEqual(1);
    expect(s.values.at(-1)).toBe(s.max);
  });

  it('refuses infinity and NaN rather than emitting broken geometry', () => {
    expect(niceScale(Number.POSITIVE_INFINITY).max).toBe(1);
    expect(niceScale(Number.NaN).max).toBe(1);
  });
});

describe('thinLabels', () => {
  it('keeps every label when they fit', () => {
    expect(thinLabels(5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('always keeps the last one', () => {
    // "Where does it end" is the question being asked of a growth chart, so the final label is
    // the one that must never be the one dropped.
    for (const n of [8, 17, 31, 100, 365]) {
      expect(thinLabels(n).at(-1), `n=${n}`).toBe(n - 1);
    }
  });

  it('thins a long series to roughly the target', () => {
    expect(thinLabels(365).length).toBeLessThanOrEqual(8);
    expect(thinLabels(365).length).toBeGreaterThan(1);
  });
});

describe('columns', () => {
  const svg = columns([p('Mon', 3), p('Tue', 0), p('Wed', 7)], { label: 'Orders per day' });

  it('is announced to a screen reader', () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Orders per day"');
  });

  it('gives every bar a native tooltip', () => {
    // `<title>` is a browser tooltip with no JavaScript, and it is what a screen reader reads.
    expect(svg).toContain('<title>Mon: 3</title>');
    expect(svg).toContain('<title>Wed: 7</title>');
  });

  it('draws a baseline and gridlines, not just the data', () => {
    expect(svg).toContain('cx__axis');
    expect(svg).toContain('cx__grid');
    expect(svg).toContain('cx__ytick');
  });

  it('does not stretch — the viewBox keeps its aspect', () => {
    // `preserveAspectRatio="none"` distorted every slope in the first version. Its absence is
    // the fix, so its absence is the assertion.
    expect(svg).not.toContain('preserveAspectRatio="none"');
  });

  it('renders a zero bar as nothing, not as a sliver', () => {
    // A 1.5px floor applies to positive values so a small number is still visible. Zero must be
    // genuinely absent, or "no orders" and "one order" look the same.
    expect(svg).toContain('height="0.0"');
  });

  it('formats the axis with the caller’s formatter', () => {
    const money = columns([p('Aug', 10500)], { label: 'Revenue', format: (n) => `₹${n / 100}` });
    expect(money).toContain('₹');
  });

  it('returns nothing for an empty series', () => {
    expect(columns([], { label: 'x' })).toBe('');
  });

  it('escapes a label rather than letting it close the tag', () => {
    // Labels are school names, which come from the database.
    const evil = columns([p('<script>x</script>', 1)], { label: 'ok' });
    expect(evil).not.toContain('<script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});

describe('area', () => {
  const svg = area([p('1 Aug', 1), p('2 Aug', 4), p('3 Aug', 9)], { label: 'Cumulative' });

  it('fills beneath the line and draws the line over it', () => {
    expect(svg).toContain('cx__area');
    expect(svg).toContain('cx__line');
  });

  it('marks each point when they are sparse enough to tell apart', () => {
    expect((svg.match(/cx__dot/g) ?? []).length).toBe(3);
  });

  it('drops the dots on a long series, where they would merge into the line', () => {
    const long = area(Array.from({ length: 90 }, (_, i) => p(`d${i}`, i)), { label: 'x' });
    expect(long).not.toContain('cx__dot');
  });

  it('centres a single point instead of pinning it to the left edge', () => {
    const one = area([p('only', 5)], { label: 'x' });
    expect(one).toContain('cx__dot');
    expect(one).not.toContain('NaN');
  });

  it('emits no NaN for an all-zero series', () => {
    expect(area([p('a', 0), p('b', 0)], { label: 'x' })).not.toContain('NaN');
  });
});
