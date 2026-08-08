import { describe, expect, it } from 'vitest';

import { color, logoOnColor, neutral, amber, primary, forest, lime, danger } from './color.js';
import { semantic, text, border, nav, badge, action, status, bg } from './semantic.js';

/**
 * The brand's five colours, transcribed from `00_Graybag_Brand Guidelines.pdf` §3.0
 * together with the RGB values printed beside each swatch.
 *
 * This is the only place in the repo where these are written down twice on purpose. If
 * somebody "tidies" a ramp and the brand hex drifts, this test is what notices — and it
 * checks the RGB decomposition as well as the hex, because a transposed digit produces a
 * plausible-looking hex and an obviously wrong colour.
 */
const BRAND = [
  { name: 'Fresh Lunch Green', hex: '#00af52', rgb: [0, 175, 82], token: primary[500] },
  { name: 'Sunlit Snack Yellow', hex: '#ffbb39', rgb: [255, 187, 57], token: amber[500] },
  { name: 'Deep Tiffin Green', hex: '#145f48', rgb: [20, 95, 72], token: forest[500] },
  { name: 'Citrus Zest Green', hex: '#b3cf3f', rgb: [179, 207, 63], token: lime[500] },
  { name: 'Light Lemon Mist', hex: '#e5ea98', rgb: [229, 234, 152], token: lime[200] },
] as const;

const toRgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('the brand palette', () => {
  it.each(BRAND)('$name is $hex and nothing else', ({ hex, rgb, token }) => {
    expect(token).toBe(hex);
    expect(toRgb(token)).toEqual([...rgb]);
  });

  it('fixes exactly five logo-on-colour pairings', () => {
    // Brand rules, not accessibility rules, and not negotiable (§2.6). A sixth entry is
    // somebody inventing a lockup.
    expect(Object.keys(logoOnColor)).toHaveLength(5);
    expect(logoOnColor['#00af52']).toBe('white');
    expect(logoOnColor['#b3cf3f']).toBe(forest[500]);
    expect(logoOnColor['#145f48']).toBe(lime[500]);
    expect(logoOnColor['#ffbb39']).toBe('white');
    expect(logoOnColor['#e5ea98']).toBe(forest[500]);
  });

  it('never recolours the logo to a tonal step', () => {
    // No `primary[700]` logo. Every value is white or a brand hex.
    const brandHexes: string[] = BRAND.map((b) => b.hex);
    for (const on of Object.values(logoOnColor)) {
      expect(on === 'white' || brandHexes.includes(on)).toBe(true);
    }
  });
});

describe('the ramps', () => {
  it('holds only lowercase six-digit hex, so string comparison is meaningful', () => {
    for (const [rampName, ramp] of Object.entries(color)) {
      if (typeof ramp === 'string') continue; // scrim
      for (const [step, value] of Object.entries(ramp)) {
        expect(value, `${rampName}[${step}]`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('has no duplicate values within a ramp', () => {
    // Two steps with the same hex is a copy-paste, and it is silent: the UI just loses a
    // step of hierarchy it was designed to have.
    for (const [rampName, ramp] of Object.entries(color)) {
      if (typeof ramp === 'string') continue;
      const values = Object.values(ramp);
      expect(new Set(values).size, `${rampName} has a repeated value`).toBe(values.length);
    }
  });

  it('darkens monotonically as the step number rises', () => {
    // Relative luminance, not the hex — a ramp that is out of order somewhere in the
    // middle looks fine in a swatch strip and reads as a mistake in a UI.
    const lum = (hex: string): number => {
      const c = toRgb(hex)
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    for (const [rampName, ramp] of Object.entries(color)) {
      if (typeof ramp === 'string') continue;
      const steps = Object.entries(ramp)
        .map(([k, v]) => [Number(k), v] as const)
        .sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < steps.length; i += 1) {
        const prev = steps[i - 1];
        const here = steps[i];
        if (!prev || !here) continue;
        expect(lum(here[1]), `${rampName}[${here[0]}] is lighter than [${prev[0]}]`).toBeLessThan(
          lum(prev[1]),
        );
      }
    }
  });
});

describe('the semantic role map', () => {
  const rampValues = new Set<string>();
  for (const ramp of Object.values(color)) {
    if (typeof ramp === 'string') rampValues.add(ramp);
    else for (const v of Object.values(ramp)) rampValues.add(v);
  }

  it('resolves every role to a value that exists in a ramp', () => {
    // This is the test that catches a hand-typed hex in semantic.ts — the exact way a
    // token system springs a leak, because the value looks right and belongs to nothing.
    for (const [groupName, group] of Object.entries(semantic)) {
      for (const [roleName, value] of Object.entries(group)) {
        expect(rampValues.has(value), `${groupName}.${roleName} = ${value} is not a ramp value`).toBe(
          true,
        );
      }
    }
  });

  describe('E13-17 — an ink is chosen against the darkest surface it may sit on', () => {
    // These three were each picked by measuring against white, passed there, and failed
    // on the tinted surface where the role actually lives. The guard is that they never
    // come back as ink.
    it('never uses neutral[500] as a text colour', () => {
      // 4.2280 on bg.surfaceMuted, which is where a placeholder lives.
      expect(Object.values(text)).not.toContain(neutral[500]);
      expect(Object.values(nav)).not.toContain(neutral[500]);
      expect(Object.values(status)).not.toContain(neutral[500]);
    });

    it('never uses amber[700] as a text colour', () => {
      // 4.4057 on bg.surfaceMuted.
      expect(Object.values(text)).not.toContain(amber[700]);
      expect(Object.values(status)).not.toContain(amber[700]);
    });

    it('never uses danger[600] as a text colour', () => {
      // 4.4441 on the danger[50] banner it exists to pair with.
      expect(Object.values(text)).not.toContain(danger[600]);
      expect(Object.values(status)).not.toContain(danger[600]);
    });

    it('keeps danger[600] where it is measured correctly', () => {
      // White on it is 4.83 in both directions, so the fill and the boundary are fine.
      expect(action.destructiveBg).toBe(danger[600]);
      expect(border.danger).toBe(danger[600]);
    });

    it('keeps neutral[500] as border.strong, where the bar is 3:1', () => {
      expect(border.strong).toBe(neutral[500]);
    });

    it('has a green surface that can legally carry body text', () => {
      // The hole E13-17 found: white on surfaceBrand is 3.85, and surfaceBrand was
      // *defined* as the field that carries things. surfaceBrandStrong is the fix, and it
      // introduces no new colour — it is action.primaryBg.
      expect(bg.surfaceBrandStrong).toBe(primary[700]);
      expect(bg.surfaceBrandStrong).toBe(action.primaryBg);
      expect(bg.surfaceBrand).not.toBe(bg.surfaceBrandStrong);
    });
  });

  describe('the 500 rule (S6) — identity colours are never ink', () => {
    const identity: string[] = [primary[500], amber[500], lime[500], lime[200]];

    it('colours no text with an identity hue', () => {
      for (const value of Object.values(text)) {
        expect(identity, `${value} is an identity colour and is being used as ink`).not.toContain(
          value,
        );
      }
    });

    it('colours no focus ring or control boundary with an identity hue', () => {
      // border.accent is the one identity value allowed on a border, and only because it
      // is declared decorative — 1.27 on white, so it can never bound a control.
      expect(identity).not.toContain(border.strong);
      expect(identity).not.toContain(border.brand);
      expect(identity).not.toContain(border.danger);
      expect(identity).not.toContain(border.subtle);
    });

    it('allows an identity hue as a fill, which is what it is for', () => {
      expect(bg.surfaceBrandFlat).toBe(primary[500]);
      expect(bg.surfaceAccent).toBe(lime[200]);
      expect(badge.bg).toBe(amber[500]);
    });
  });

  it('introduces no blue — informational is forest', () => {
    expect(status.info).toBe(forest[500]);
  });
});
