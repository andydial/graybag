import { describe, expect, it } from 'vitest';

import {
  DURATION_CEILING_MS,
  MOTION_PATTERNS,
  cubicBezier,
  duration,
  ease,
  motion,
  reduceMotion,
  resolveDuration,
  spring,
  stagger,
} from './motion.js';

describe('the duration scale is closed', () => {
  it('has four tokens and these four', () => {
    // "No other duration exists" is the load-bearing sentence of §2. A fifth token is how
    // a closed system reopens — not through a decision, through a pull request that
    // needed 180ms once.
    expect(Object.keys(duration).sort()).toEqual(['base', 'fast', 'instant', 'slow']);
    expect([duration.instant, duration.fast, duration.base, duration.slow]).toEqual([
      0, 120, 200, 320,
    ]);
  });

  it('never exceeds the 350ms ceiling', () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(ms, `duration.${name}`).toBeLessThanOrEqual(DURATION_CEILING_MS);
    }
  });

  it('keeps every animating step above the ~100ms perceptibility floor', () => {
    // Below ~100ms the user does not learn where the new thing came from, which is the
    // entire point of an entrance. `instant` is the reduce-motion substitute and is
    // exempt by definition.
    for (const [name, ms] of Object.entries(duration)) {
      if (name === 'instant') continue;
      expect(ms, `duration.${name}`).toBeGreaterThanOrEqual(100);
    }
  });

  it('leaves a real step between each token', () => {
    // Two durations 40ms apart are two names for one motion, and the second one exists
    // only because somebody wanted a knob.
    expect(duration.base - duration.fast).toBeGreaterThanOrEqual(60);
    expect(duration.slow - duration.base).toBeGreaterThanOrEqual(60);
  });
});

describe('stagger', () => {
  it('costs no more than 150ms of added latency', () => {
    // The first item has no delay, so six items is five steps: 5 x 30 = 150ms. Item seven
    // onwards appears with the sixth rather than extending the tail — an eleventh item at
    // 300ms would spend most of the ceiling on nothing but arrival order.
    const lastItemDelay = stagger.stepMs * (stagger.maxElements - 1);
    expect(lastItemDelay).toBeLessThanOrEqual(150);
  });

  it('keeps the full stagger under the ceiling even on a slow entrance', () => {
    const worst = stagger.stepMs * (stagger.maxElements - 1) + duration.base;
    expect(worst).toBeLessThanOrEqual(DURATION_CEILING_MS);
  });
});

describe('the three easing curves', () => {
  it('exposes exactly standard, enter, exit and the one permitted linear', () => {
    expect(Object.keys(ease).sort()).toEqual(['enter', 'exit', 'linear', 'standard']);
  });

  it('holds well-formed bezier control points', () => {
    for (const [name, curve] of Object.entries(ease)) {
      expect(curve, `ease.${name}`).toHaveLength(4);
      // x must stay in [0,1] or the curve is not a function of time; y may overshoot in
      // principle, but nothing in this system does, so an out-of-range y is a typo.
      expect(curve[0], `ease.${name} x1`).toBeGreaterThanOrEqual(0);
      expect(curve[0], `ease.${name} x1`).toBeLessThanOrEqual(1);
      expect(curve[2], `ease.${name} x2`).toBeGreaterThanOrEqual(0);
      expect(curve[2], `ease.${name} x2`).toBeLessThanOrEqual(1);
    }
  });

  it('decelerates on enter and accelerates on exit', () => {
    // The property that makes the names mean something: an entrance ends gently (x2 low,
    // y2 at 1) and an exit ends fast (x2 at 1). If these were swapped every animation in
    // the app would feel subtly wrong and nothing would look broken in a diff.
    expect(ease.enter[2]).toBeLessThan(ease.exit[2]);
    expect(ease.enter[3]).toBe(1);
    expect(ease.exit[2]).toBe(1);
  });

  it('renders a web cubic-bezier from the same source as the native curve', () => {
    // One source, two outputs (S8). A hand-written cubic-bezier in a stylesheet is the
    // motion equivalent of a hard-coded hex.
    expect(cubicBezier(ease.standard)).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(cubicBezier(ease.linear)).toBe('cubic-bezier(0, 0, 1, 1)');
  });
});

describe('the one spring', () => {
  it('is the only one', () => {
    // A second key here is a second kind of motion, and it needs a decision-log line
    // rather than a copy-paste (S4).
    expect(Object.keys(spring)).toEqual(['pop']);
  });

  it('is underdamped enough to pop and damped enough not to wobble', () => {
    // ζ = damping / (2 * sqrt(stiffness * mass)) ≈ 0.67 — one bounce, ~5.8% overshoot,
    // settled within ~330ms. Below ~0.5 it reads as jelly; at 1 it does not pop at all,
    // and the cart badge exists to be noticed from across the screen.
    const { damping, stiffness, mass } = spring.pop;
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    expect(zeta).toBeGreaterThan(0.5);
    expect(zeta).toBeLessThan(1);
  });

  it('settles inside the duration ceiling', () => {
    // A spring has no duration, but it still has to finish before the ceiling means
    // anything. ~4 time constants to settle: 4 / (zeta * omega_n).
    const { damping, stiffness, mass } = spring.pop;
    const omegaN = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const settleMs = (4 / (zeta * omegaN)) * 1000;
    expect(settleMs).toBeLessThanOrEqual(DURATION_CEILING_MS);
  });
});

describe('the catalogue is closed', () => {
  it('has fourteen entries, M01 to M14', () => {
    expect(MOTION_PATTERNS).toHaveLength(14);
    expect(MOTION_PATTERNS[0]).toBe('M01');
    expect(MOTION_PATTERNS[13]).toBe('M14');
  });

  it('has no gaps or duplicates in the numbering', () => {
    expect(new Set(MOTION_PATTERNS).size).toBe(MOTION_PATTERNS.length);
    MOTION_PATTERNS.forEach((p, i) => {
      expect(p).toBe(`M${String(i + 1).padStart(2, '0')}`);
    });
  });
});

describe('reduce motion — the harness (E13-12)', () => {
  it('names a substitute for every pattern in the catalogue', () => {
    // The gap this closes: a pattern with no entry is a pattern nobody decided about,
    // and the default behaviour of "no entry" is silently doing nothing.
    for (const p of MOTION_PATTERNS) {
      expect(reduceMotion, `${p} has no reduce-motion entry`).toHaveProperty(p);
    }
    expect(Object.keys(reduceMotion).sort()).toEqual([...MOTION_PATTERNS].sort());
  });

  it('substitutes a different animation rather than the absence of one', () => {
    // This is the accessibility bug no visual review catches, because the reviewer has
    // reduce motion off: a component that drops a state change instead of substituting
    // one. M02 still cross-fades, M06 still changes the count, M09 still waits.
    expect(reduceMotion.M02.reduced).toMatch(/cross-fade/i);
    expect(reduceMotion.M06.reduced).toMatch(/count changes/i);
    expect(reduceMotion.M10.reduced).toMatch(/fade/i);
    expect(reduceMotion.M13.reduced).toMatch(/fade/i);
  });

  it('keeps M09 Ending B unbounded under reduce motion', () => {
    // E13-20/S21: a reduce-motion user must not get a version of the payment flow that
    // quietly gives up where the default one waits. The 8-second timeout never applies to
    // a write that can move money, and turning animation off does not change that.
    expect(reduceMotion.M09.reduced).toMatch(/does not time out/i);
    expect(reduceMotion.M09.reduced).not.toMatch(/retry/i);
  });

  it('defers M12 to the platform rather than reimplementing it', () => {
    // Screen push and pop are the navigator's and the OS's, and honouring reduce motion
    // there is theirs too. `null` is the decision, not a missing entry.
    expect(reduceMotion.M12.reduced).toBeNull();
  });

  it('is the only pattern the platform owns', () => {
    const deferred = MOTION_PATTERNS.filter((p) => reduceMotion[p].reduced === null);
    expect(deferred).toEqual(['M12']);
  });
});

describe('resolveDuration', () => {
  it('collapses to instant when reduce motion is on', () => {
    for (const token of ['fast', 'base', 'slow'] as const) {
      expect(resolveDuration(token, true)).toBe(duration.instant);
    }
  });

  it('returns the token value when it is off', () => {
    expect(resolveDuration('slow', false)).toBe(320);
    expect(resolveDuration('fast', false)).toBe(120);
  });

  it('returns a number rather than skipping, so completion callbacks still fire', () => {
    // A zero-duration transition still fires its completion callback. A component whose
    // state advance hangs off that callback is one of the ways reduce motion silently
    // breaks a flow, and returning `undefined` here would produce exactly that.
    expect(typeof resolveDuration('base', true)).toBe('number');
  });
});

describe('the module surface', () => {
  it('exports duration, ease and spring and nothing else that animates', () => {
    // E13-12's requirement, and the reason E13-11's lint rule has somewhere to point: if
    // there is no third place to put a number, there is no third place to look for one.
    expect(Object.keys(motion).sort()).toEqual([
      'DURATION_CEILING_MS',
      'duration',
      'ease',
      'reduceMotion',
      'spring',
      'stagger',
    ]);
  });
});
