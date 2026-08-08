import { describe, expect, it } from 'vitest';

import {
  BAR,
  EXEMPT_ROLES,
  EXEMPT_VALUES,
  FORBIDDEN_PAIRS,
  LEGAL_PAIRS,
  contrastRatio,
  relativeLuminance,
} from './contrast.js';
import { amber, forest, neutral, primary } from './color.js';
import { semantic } from './semantic.js';

const show = (n: number): string => n.toFixed(4);

describe('the ratio function', () => {
  it('matches the WCAG reference values at both ends', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 10);
  });

  it('is order-independent, as the specification defines it', () => {
    expect(contrastRatio(primary[700], '#ffffff')).toBe(contrastRatio('#ffffff', primary[700]));
  });

  it('rejects anything that is not #rrggbb rather than guessing', () => {
    // A shorthand or a named colour silently parsing to something plausible is how a
    // contrast test starts passing for the wrong reason.
    expect(() => relativeLuminance('#fff')).toThrow();
    expect(() => relativeLuminance('white')).toThrow();
    expect(() => relativeLuminance('rgba(20, 23, 20, 0.48)')).toThrow();
  });

  it('reproduces the four ratios that were wrong because they were rounded', () => {
    // S20. Each of these prints as a pass at two decimal places and fails at full
    // precision — which is exactly how they got into the document.
    expect(show(contrastRatio(forest[500], amber[500]))).toBe('4.4994');
    expect(show(contrastRatio(neutral[500], neutral[50]))).toBe('4.4969');
    expect(show(contrastRatio(primary[700], primary[100]))).toBe('4.4734');
    // E13-16's original: the document claimed 3.25 for this pair, which is actually
    // forest[700]'s figure. This one never came close to the 3:1 bar.
    expect(show(contrastRatio(forest[600], primary[600]))).toBe('2.5750');
    expect(show(contrastRatio(forest[700], primary[600]))).toBe('3.2463');
  });
});

describe('the declared legal pairs all pass their bar (E13-13)', () => {
  it.each(LEGAL_PAIRS.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))(
    '%s',
    (_label, pair) => {
      const ratio = contrastRatio(pair.fgValue, pair.bgValue);
      expect(
        ratio,
        `${pair.fg} (${pair.fgValue}) on ${pair.bg} (${pair.bgValue}) is ${show(ratio)}, ` +
          `below the ${pair.bar}:1 bar. ${pair.note}`,
      ).toBeGreaterThanOrEqual(pair.bar);
    },
  );
});

describe('the forbidden pairs keep failing', () => {
  // If one of these starts passing, either a token moved or somebody "fixed" the list.
  // Both are worth a build failure: the pair was written down because a component would
  // reach for it, and a passing entry here means nothing is stopping that any more.
  it.each(FORBIDDEN_PAIRS.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))(
    '%s stays illegal',
    (_label, pair) => {
      const ratio = contrastRatio(pair.fgValue, pair.bgValue);
      expect(
        ratio,
        `${pair.fg} on ${pair.bg} is now ${show(ratio)} and clears the ${pair.bar}:1 bar. ` +
          `If a token moved on purpose, move this row to LEGAL_PAIRS deliberately. ` +
          `Why it is tempting: ${pair.note}`,
      ).toBeLessThan(pair.bar);
    },
  );
});

describe('the pair lists themselves', () => {
  it('checks every ink role in the semantic map at least once', () => {
    // The failure this catches is a role that exists, is used, and is checked by nothing —
    // which is what "a declared list" costs if nobody maintains it. A new `text.*` or
    // `nav.*` role must arrive with a pair or fail here.
    const checked = new Set(LEGAL_PAIRS.map((pair) => pair.fgValue));
    const groups = { text: semantic.text, nav: semantic.nav };
    for (const [groupName, group] of Object.entries(groups)) {
      for (const [role, value] of Object.entries(group)) {
        if (EXEMPT_ROLES.includes(`${groupName}.${role}`)) continue;
        expect(checked.has(value), `no legal pair covers ${groupName}.${role} (${value})`).toBe(
          true,
        );
      }
    }
  });

  it('checks every surface an ink can land on', () => {
    const checked = new Set(LEGAL_PAIRS.map((pair) => pair.bgValue));
    for (const [role, value] of Object.entries(semantic.bg)) {
      // The scrim is rgba and has no ratio; the flat brand field carries only the logo,
      // and logotypes are exempt from 1.4.3.
      if (role === 'scrim' || role === 'surfaceBrandFlat') continue;
      expect(checked.has(value), `no legal pair lands on bg.${role} (${value})`).toBe(true);
    }
  });

  it('never lists the same pair as both legal and forbidden', () => {
    const key = (pair: { fgValue: string; bgValue: string; bar: number }) =>
      `${pair.fgValue}|${pair.bgValue}|${pair.bar}`;
    const legal = new Set(LEGAL_PAIRS.map(key));
    for (const pair of FORBIDDEN_PAIRS) {
      expect(legal.has(key(pair)), `${pair.fg} on ${pair.bg} appears in both lists`).toBe(false);
    }
  });

  it('allows one pair of values at two different bars, and only that one', () => {
    // `text.onBrand` on `bg.surfaceBrand` is legal at 3:1 and forbidden at 4.5:1 — that is
    // the whole content of "large text and controls only", and it is the one case where
    // the same two colours appear in both lists.
    const legalValues = new Set(LEGAL_PAIRS.map((x) => `${x.fgValue}|${x.bgValue}`));
    const overlap = FORBIDDEN_PAIRS.filter((x) => legalValues.has(`${x.fgValue}|${x.bgValue}`));
    expect(overlap).toHaveLength(1);
    expect(overlap[0]?.bg).toBe('bg.surfaceBrand');
  });

  it('keeps the exempt roles out of both lists', () => {
    // Disabled text is exempt under 1.4.3. Listing it would make "it's disabled" an
    // argument that had already been won once.
    for (const role of EXEMPT_ROLES) {
      expect(LEGAL_PAIRS.some((x) => x.fg === role), `${role} is in LEGAL_PAIRS`).toBe(false);
      expect(FORBIDDEN_PAIRS.some((x) => x.fg === role), `${role} is in FORBIDDEN_PAIRS`).toBe(
        false,
      );
    }
  });

  it('exempts by role and not by hex, because three roles share neutral[400]', () => {
    // text.disabled, action.disabledFg and border.default are the same colour and only
    // the first two are exempt. border.default is in FORBIDDEN_PAIRS precisely because it
    // is not — matching on the hex would have quietly exempted the one entry that guards
    // a control boundary.
    expect(EXEMPT_VALUES.every((v) => v === semantic.border.default)).toBe(true);
    expect(FORBIDDEN_PAIRS.some((x) => x.fg === 'border.default')).toBe(true);
  });

  it('uses only the two bars WCAG 2.1 sets', () => {
    const bars: number[] = [BAR.bodyText, BAR.largeTextOrBoundary];
    for (const pair of [...LEGAL_PAIRS, ...FORBIDDEN_PAIRS]) {
      expect(bars, `${pair.fg} on ${pair.bg} invents a bar`).toContain(pair.bar);
    }
  });

  it('gives every pair a note, so a failure says why the pair exists', () => {
    // A failing assertion with no context is a failing assertion somebody deletes.
    for (const pair of [...LEGAL_PAIRS, ...FORBIDDEN_PAIRS]) {
      expect(pair.note.length, `${pair.fg} on ${pair.bg}`).toBeGreaterThan(10);
    }
  });

  it('does not shrink silently', () => {
    // A list that quietly loses rows looks exactly like a list that passes. These floors
    // are deliberately below the current counts — they catch deletion, not growth.
    expect(LEGAL_PAIRS.length).toBeGreaterThanOrEqual(40);
    expect(FORBIDDEN_PAIRS.length).toBeGreaterThanOrEqual(9);
  });
});
