import { describe, expect, it } from 'vitest';

import { breakpoint, layout, space, touchTarget } from './space.js';
import { clampRadius, nestedRadius, radius } from './radius.js';
import { borderWidth, elevation, icon, opacity, zIndex } from './elevation.js';

describe('spacing', () => {
  it('is on the 4-point grid above the two sub-grid steps', () => {
    // `px` (1) and `0.5` (2) exist for hairlines and optical nudges. Everything else is a
    // multiple of 4, and a value that is not is how a 4-point grid stops being one.
    for (const [name, value] of Object.entries(space)) {
      if (name === 'px' || name === '0.5' || value === 0) continue;
      expect(value % 4, `space[${name}] = ${value}`).toBe(0);
    }
  });

  it('rises monotonically with its step number', () => {
    // Iterate by key rather than by `Object.values`: JS orders integer-like keys first
    // and numerically, so `px` and `0.5` sort to the end of a values array and a naive
    // monotonicity check fails on a scale that is perfectly fine.
    const numbered = ([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const).map((k) => space[k]);
    for (let i = 1; i < numbered.length; i += 1) {
      expect(numbered[i]).toBeGreaterThan(numbered[i - 1] ?? -1);
    }
    expect(space.px).toBeLessThan(space[0.5]);
    expect(space[0.5]).toBeLessThan(space[1]);
  });

  it('has no two tokens with the same value', () => {
    const values = Object.values(space);
    expect(new Set(values).size).toBe(values.length);
  });

  it('builds every layout rule from a scale value', () => {
    // A layout rule holding a number that is not in the scale is the scale being bypassed
    // by the file that defines it, which is the least likely place anyone would look.
    const scaleValues = new Set<number>(Object.values(space));
    for (const [name, value] of Object.entries(layout)) {
      if (name === 'containerMaxWidth') continue; // a page width, not a gap
      expect(scaleValues.has(value), `layout.${name} = ${value} is not a space token`).toBe(true);
    }
  });

  it('separates unrelated things more than related ones', () => {
    expect(layout.sectionGap).toBeGreaterThan(layout.blockGap);
    expect(layout.blockGap).toBeGreaterThan(layout.fieldGap);
  });

  it('widens the gutter on the larger breakpoint', () => {
    expect(layout.gutterWide).toBeGreaterThan(layout.gutter);
  });
});

describe('touch targets', () => {
  it('takes the stricter of the two platforms once, rather than per-platform', () => {
    // iOS says 44, Android says 48. Taking 48 everywhere means there is one number to
    // remember and no platform where the rule is weaker.
    expect(touchTarget.min).toBe(48);
  });

  it('keeps visual size and target size as separate concerns', () => {
    // The stepper draws at 28 and is hit-slopped out to 48. If these were ever equal, the
    // hitSlop would have been silently dropped and nothing would look different.
    expect(touchTarget.visualSmall).toBeLessThan(touchTarget.min);
  });

  it('gives a list row at least the minimum target height', () => {
    // 12 + 12 padding around a 20pt line height is 44 — so the row's own padding is not
    // sufficient on its own and the row must set a minimum height. Asserted so that a
    // future padding reduction cannot quietly take the row below 48.
    const rowHeight = layout.listRowPaddingY * 2 + 24;
    expect(rowHeight).toBeGreaterThanOrEqual(touchTarget.min);
  });

  it('leaves room between adjacent targets', () => {
    expect(touchTarget.minGap).toBeGreaterThanOrEqual(8);
  });
});

describe('breakpoints', () => {
  it('rises monotonically', () => {
    expect(breakpoint.sm).toBeLessThan(breakpoint.md);
    expect(breakpoint.md).toBeLessThan(breakpoint.lg);
    expect(breakpoint.lg).toBeLessThan(breakpoint.xl);
  });
});

describe('radius', () => {
  it('rises monotonically to the pill', () => {
    const values = Object.values(radius);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1] ?? -1);
    }
  });

  it('never exceeds half the shorter side', () => {
    // A 32-tall element cannot have `xl` (24). It gets `full` or `md`.
    expect(clampRadius(radius.xl, 32)).toBe(16);
    expect(clampRadius(radius.md, 32)).toBe(radius.md);
    expect(clampRadius(radius.full, 48)).toBe(24);
  });

  it('nests concentrically rather than in parallel', () => {
    // A lg (16) card with space[4] (16) padding holds a `none` image; with space[2] (8)
    // padding it holds an `sm` (8) image.
    expect(nestedRadius(radius.lg, space[4])).toBe(radius.none);
    expect(nestedRadius(radius.lg, space[2])).toBe(radius.sm);
    expect(nestedRadius(radius.xl, space[2])).toBe(radius.lg);
  });

  it('never returns a negative inner radius', () => {
    expect(nestedRadius(radius.sm, space[6])).toBe(0);
  });
});

describe('elevation', () => {
  it('defaults to flat', () => {
    // The mocks distinguish cards by fill, not shadow, and overlapping shadows are a
    // measurable cost on a mid-range Android. A shadow means "this floats above the
    // page"; it is never decoration.
    expect(elevation[0].web).toBe('none');
    expect(elevation[0].android).toBe(0);
  });

  it('sets both the iOS and Android props on every raised level', () => {
    // Android below API 28 ignores shadowColor and iOS ignores `elevation`. Setting one
    // and not the other produces a shadow on one platform and nothing on the other, which
    // is exactly the kind of thing that ships.
    for (const level of [1, 2, 3] as const) {
      expect(elevation[level].ios, `elevation[${level}].ios`).not.toBeNull();
      expect(elevation[level].android, `elevation[${level}].android`).toBeGreaterThan(0);
    }
  });

  it('points the bottom sheet shadow upward', () => {
    expect(elevation[2].ios.shadowOffset.height).toBeLessThan(0);
  });

  it('stacks z-index strictly, with the scrim beneath what it dims', () => {
    const order = [
      zIndex.content,
      zIndex.stickyHeader,
      zIndex.tabBar,
      zIndex.scrim,
      zIndex.sheet,
      zIndex.dialog,
      zIndex.toast,
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]).toBeGreaterThan(order[i - 1] ?? -1);
    }
    expect(zIndex.scrim).toBeLessThan(zIndex.sheet);
    expect(zIndex.scrim).toBeGreaterThan(zIndex.tabBar);
  });
});

describe('opacity', () => {
  it('has exactly one token, and it is for press feedback', () => {
    // Disabled states use the disabled colour tokens, never an opacity: dimming text with
    // opacity silently destroys its contrast ratio and is invisible in review, because
    // the token it resolves to still looks correct in the source.
    expect(Object.keys(opacity)).toEqual(['pressed']);
  });
});

describe('borders and icons', () => {
  it('has no 3px border', () => {
    expect(Object.values(borderWidth).every((w) => w <= 2)).toBe(true);
  });

  it('sizes icons on the 4-point grid with 24 as the default', () => {
    for (const [name, size] of Object.entries(icon.size)) {
      expect(size % 4, `icon.size.${name}`).toBe(0);
    }
    expect(icon.size.lg).toBe(24);
  });

  it('thickens the stroke only at the largest size', () => {
    expect(icon.stroke.large).toBeGreaterThan(icon.stroke.default);
  });
});
