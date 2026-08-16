#!/usr/bin/env node
/**
 * Every `var(--gb-…)` must name a token that exists — `E13-30`.
 *
 *     node scripts/check-css-tokens.mjs
 *
 * ## Why this exists
 *
 * A CSS custom property that is not defined does not error. The declaration is simply dropped and
 * the element keeps whatever it inherited, so the page renders — just not the way anyone wrote.
 *
 * On 17 August the back office had **14 of them**, across every stylesheet it uses:
 * `--gb-text-muted`, `--gb-font-size-sm`, `--gb-font-weight-semibold` and so on. The real names
 * are `--gb-text-secondary`, `--gb-font-size-body-sm`, `--gb-font-weight-body-strong`. The result
 * was that the admin screens had no working type scale and no muted text at all: every line of
 * every dish row rendered at the same size and the same weight, which is exactly how they looked.
 * The redesign would have been building on sand.
 *
 * Nothing could have caught it. It is not a lint error, the build succeeds, the a11y gate passes
 * (contrast of inherited black on white is fine), and the page looks *plausible* — just flat.
 *
 * ## A fallback is not an excuse
 *
 * `var(--gb-font-size-xs, 0.75rem)` works, which is worse: it looks deliberate, it hides the typo
 * for good, and the value silently stops tracking the design system. Those are reported too.
 *
 * Wired into `npm run smoke`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'apps', 'web', 'src', 'styles');
const TOKENS = join(STYLES, 'tokens.css');

const tokenSource = readFileSync(TOKENS, 'utf8');

/** Definitions, i.e. `--gb-foo: value;` — the left-hand side of a declaration. */
const defined = new Set(
  [...tokenSource.matchAll(/^\s*(--gb-[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
);

/** Uses, i.e. `var(--gb-foo)` or `var(--gb-foo, fallback)`. */
const USE = /var\(\s*(--gb-[a-z0-9-]+)\s*(,)?/g;

const files = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
const problems = [];

for (const file of files) {
  const css = readFileSync(join(STYLES, file), 'utf8');
  // A token file may reference its own tokens; every other file is checked the same way.
  const seen = new Map();
  for (const m of css.matchAll(USE)) {
    const [, name, hasFallback] = m;
    if (defined.has(name)) continue;
    const key = `${name}|${hasFallback ? 'fallback' : 'bare'}`;
    if (!seen.has(key)) seen.set(key, { name, hasFallback: Boolean(hasFallback) });
  }
  for (const { name, hasFallback } of seen.values()) {
    problems.push({ file, name, hasFallback });
  }
}

if (problems.length > 0) {
  console.error('\ncheck-css-tokens: FAIL\n');
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of byFile) {
    console.error(`  ${file} — ${list.length} undefined token(s):`);
    for (const p of list) {
      console.error(`    ${p.name}${p.hasFallback ? '   (has a fallback, so it renders — and hides the typo)' : ''}`);
    }
    console.error('');
  }
  console.error(
    '  An undefined custom property does not error: the declaration is dropped and the element\n' +
      '  keeps what it inherited. The page renders, just not as written. Check the real name in\n' +
      `  apps/web/src/styles/tokens.css — there are ${defined.size} of them.\n`,
  );
  process.exit(1);
}

// `readdirSync` already yields basenames. Passing `basename` straight to `map` hands it the
// index as its `suffix` argument, which throws — the kind of thing a success path hides until
// the day it first succeeds.
console.log(
  `check-css-tokens: ok — every var(--gb-…) in ${files.join(', ')} ` +
    `resolves against ${defined.size} tokens.`,
);
