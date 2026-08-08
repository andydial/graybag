/**
 * The web output (E13-01, completing §8's "one source, two outputs").
 *
 * `apps/mobile` imports the token objects directly. `apps/web` cannot — a stylesheet needs
 * values, not modules — so it generates CSS custom properties from **these same objects**
 * at build time. That is the whole of decision `S8`: two hand-maintained copies of a
 * palette diverge, and the divergence is invisible until someone screenshots both products
 * side by side.
 *
 * This file therefore contains **no colour, size, duration or radius of its own**, and
 * `css.test.ts` asserts that by regenerating the sheet and checking every value in it came
 * from a token. A generator that quietly hard-codes one fallback is the same failure as a
 * hand-copied hex, with an extra step.
 *
 * Naming: `--gb-<group>-<role>`, kebab-cased. The `gb-` prefix exists because the
 * marketing site will eventually load third-party embeds, and `--text-primary` is a name
 * somebody else will also pick.
 */

import { color, scrim } from './color.js';
import { semantic } from './semantic.js';
import { scale, font, fontStack } from './type.js';
import { space, layout, touchTarget, breakpoint } from './space.js';
import { radius } from './radius.js';
import { borderWidth, elevation, dialogShadow, opacity, zIndex, icon } from './elevation.js';
import { duration, ease, cubicBezier } from './motion.js';

const PREFIX = '--gb';

/** `surfaceBrandStrong` → `surface-brand-strong`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export interface CssVar {
  readonly name: string;
  readonly value: string;
}

function group(prefix: string, entries: Record<string, string | number>): CssVar[] {
  return Object.entries(entries).map(([key, value]) => ({
    name: `${PREFIX}-${prefix}-${kebab(key)}`,
    value: String(value),
  }));
}

/**
 * Every custom property the web build emits.
 *
 * **The semantic roles come first and the ramps are emitted too, but under `--gb-ramp-*`.**
 * Both are present for one reason: a CSS file cannot enforce `S7` the way a lint rule can,
 * so the ramp variables exist for the two legitimate consumers — the pattern SVG and the
 * favicon — and are named so that `--gb-ramp-primary-500` in a component stylesheet is
 * visible as a violation on sight.
 */
export function cssVariables(): CssVar[] {
  const vars: CssVar[] = [];

  for (const [groupName, roles] of Object.entries(semantic)) {
    vars.push(...group(kebab(groupName), roles as Record<string, string>));
  }

  for (const [rampName, ramp] of Object.entries(color)) {
    if (typeof ramp === 'string') continue;
    vars.push(...group(`ramp-${rampName}`, ramp as Record<string, string>));
  }
  vars.push({ name: `${PREFIX}-ramp-scrim`, value: scrim });

  for (const [token, t] of Object.entries(scale)) {
    const n = kebab(token);
    vars.push({ name: `${PREFIX}-font-size-${n}`, value: `${t.size / 16}rem` });
    vars.push({ name: `${PREFIX}-line-height-${n}`, value: `${t.lineHeight / t.size}` });
    vars.push({ name: `${PREFIX}-font-weight-${n}`, value: String(t.weight) });
    vars.push({ name: `${PREFIX}-tracking-${n}`, value: `${t.tracking}em` });
  }
  vars.push({ name: `${PREFIX}-font-family`, value: fontStack });
  for (const [weightName, f] of Object.entries(font)) {
    vars.push({ name: `${PREFIX}-font-${kebab(weightName)}`, value: String(f.weight) });
  }

  // `0.5` becomes `0-5`: a dot is legal in a custom property name and every tool that
  // parses one — minifiers, PostCSS plugins, the devtools filter — treats it differently.
  vars.push(...group('space', Object.fromEntries(
    Object.entries(space).map(([k, v]) => [k.replace('.', '-'), `${v}px`]),
  )));
  vars.push(...group('layout', Object.fromEntries(
    Object.entries(layout).map(([k, v]) => [k, `${v}px`]),
  )));
  vars.push(...group('touch', Object.fromEntries(
    Object.entries(touchTarget).map(([k, v]) => [k, `${v}px`]),
  )));
  vars.push(...group('breakpoint', Object.fromEntries(
    Object.entries(breakpoint).map(([k, v]) => [k, `${v}px`]),
  )));

  vars.push(...group('radius', Object.fromEntries(
    Object.entries(radius).map(([k, v]) => [k, `${v}px`]),
  )));
  vars.push(...group('border-width', Object.fromEntries(
    Object.entries(borderWidth).map(([k, v]) => [k, `${v}px`]),
  )));

  for (const [level, e] of Object.entries(elevation)) {
    vars.push({ name: `${PREFIX}-elevation-${level}`, value: e.web });
  }
  vars.push({ name: `${PREFIX}-elevation-dialog`, value: dialogShadow });
  vars.push(...group('z', Object.fromEntries(Object.entries(zIndex).map(([k, v]) => [k, v]))));
  vars.push(...group('opacity', opacity));
  vars.push(...group('icon-size', Object.fromEntries(
    Object.entries(icon.size).map(([k, v]) => [k, `${v}px`]),
  )));

  vars.push(...group('duration', Object.fromEntries(
    Object.entries(duration).map(([k, v]) => [k, `${v}ms`]),
  )));
  for (const [curveName, curve] of Object.entries(ease)) {
    vars.push({ name: `${PREFIX}-ease-${kebab(curveName)}`, value: cubicBezier(curve) });
  }

  return vars;
}

/**
 * The stylesheet, as a string, for the web build to write to disk.
 *
 * It is `:root`-scoped and nothing else, because a token file that also sets `body { }` has
 * started being a stylesheet and will accumulate opinions.
 */
export function cssVariableSheet(): string {
  const lines = cssVariables().map((v) => `  ${v.name}: ${v.value};`);
  return [
    '/* Generated from packages/shared/src/design — do not edit.',
    ' * One source, two outputs (S8). Regenerate rather than patch.',
    ' */',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}
