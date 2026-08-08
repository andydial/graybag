import { describe, expect, it } from 'vitest';

import { cssVariableSheet, cssVariables } from './css.js';
import { color, scrim } from './color.js';
import { semantic } from './semantic.js';
import { scale } from './type.js';
import { duration, ease } from './motion.js';

describe('the generated stylesheet', () => {
  const vars = cssVariables();
  const sheet = cssVariableSheet();

  it('emits every semantic role', () => {
    // The role map is what components consume (S7). A role missing from the web output is
    // a role the web product silently does not have, and the symptom is one screen that
    // looks subtly wrong rather than a build failure.
    for (const [groupName, roles] of Object.entries(semantic)) {
      for (const role of Object.keys(roles)) {
        const kebab = `${groupName}-${role}`.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        expect(
          vars.some((v) => v.name === `--gb-${kebab}`),
          `no CSS variable for semantic.${groupName}.${role}`,
        ).toBe(true);
      }
    }
  });

  it('emits four properties for every type token', () => {
    for (const token of Object.keys(scale)) {
      const n = token.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      for (const facet of ['font-size', 'line-height', 'font-weight', 'tracking']) {
        expect(
          vars.some((v) => v.name === `--gb-${facet}-${n}`),
          `no --gb-${facet}-${n}`,
        ).toBe(true);
      }
    }
  });

  it('sizes type in rem, never px', () => {
    // §3.4: web uses rem throughout with a 16px root and never sets a px font size, so
    // that the OS text-size setting works at all.
    for (const v of vars.filter((x) => x.name.startsWith('--gb-font-size-'))) {
      expect(v.value, v.name).toMatch(/rem$/);
    }
  });

  it('contains no value that is not a token', () => {
    // The failure this catches is the whole reason the generator exists: a hard-coded
    // fallback hex in the file that is supposed to make hard-coded hexes impossible.
    const known = new Set<string>();
    for (const ramp of Object.values(color)) {
      if (typeof ramp === 'string') known.add(ramp);
      else for (const v of Object.values(ramp)) known.add(v);
    }
    known.add(scrim);

    const emittedColours = vars
      .map((v) => v.value)
      .filter((v) => /^#[0-9a-f]{3,8}$/i.test(v) || v.startsWith('rgba('));
    expect(emittedColours.length).toBeGreaterThan(0);
    for (const c of emittedColours) {
      expect(known.has(c), `${c} is in the stylesheet but is not a ramp value`).toBe(true);
    }
  });

  it('emits the motion tokens with units the browser understands', () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(vars.some((v) => v.name === `--gb-duration-${name}` && v.value === `${ms}ms`)).toBe(
        true,
      );
    }
    for (const name of Object.keys(ease)) {
      const v = vars.find((x) => x.name === `--gb-ease-${name}`);
      expect(v?.value, `--gb-ease-${name}`).toMatch(/^cubic-bezier\(/);
    }
  });

  it('names ramp variables so a component using one is visible on sight', () => {
    // A stylesheet cannot enforce S7 the way a lint rule can. The ramps are emitted for the
    // pattern SVG and the favicon, and `--gb-ramp-primary-500` in a component stylesheet is
    // meant to read as a violation without anyone having to check.
    expect(vars.some((v) => v.name === '--gb-ramp-primary-500')).toBe(true);
    expect(vars.some((v) => v.name === '--gb-text-primary')).toBe(true);
  });

  it('has no duplicate variable names', () => {
    // A duplicate is a silent overwrite: the later one wins and the earlier token is gone
    // from the web product with nothing to show for it.
    const names = vars.map((v) => v.name);
    expect(new Set(names).size, `duplicates: ${names.filter((n, i) => names.indexOf(n) !== i)}`).toBe(
      names.length,
    );
  });

  it('scopes itself to :root and sets nothing else', () => {
    // A token file that also styles `body` has started being a stylesheet and will
    // accumulate opinions that belong in a component.
    expect(sheet).toContain(':root {');
    expect(sheet.match(/\{/g)).toHaveLength(1);
    expect(sheet).toContain('do not edit');
  });

  it('produces a well-formed declaration for every variable', () => {
    for (const line of sheet.split('\n').filter((l) => l.trim().startsWith('--'))) {
      expect(line, line).toMatch(/^ {2}--gb-[a-z0-9-]+: .+;$/);
    }
  });
});
