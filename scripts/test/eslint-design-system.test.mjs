import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import {
  ALL_RULES,
  CART_BADGE_MODULE,
  HEIGHT_ANIMATION_MODULES,
  MOTION_MODULE,
} from '../../config/eslint-design-system.js';

/**
 * E13-11's gates, tested against the **repository's real ESLint config** rather than
 * against a fixture config.
 *
 * "The rule is in the config" and "the rule fires" are different claims, and only the
 * second one is worth anything. The specific way a `no-restricted-syntax` gate dies is
 * silent: flat config *replaces* a rule's options rather than merging them, so one badly
 * ordered block leaves a subset in force and the build still passes. Nothing about that is
 * visible in a diff, and a lint config that checks less than it did yesterday looks
 * exactly like one that checks everything.
 *
 * So each case below lints a snippet as if it were a file at a real path and asserts the
 * message it expects — and, for the exempt paths, asserts the same snippet is *allowed*
 * there. Both halves matter: an exemption that stopped applying would make the cart badge
 * unbuildable, and an exemption that applied everywhere would make the rule decorative.
 */

const eslint = new ESLint();

/** Lint `code` as though it lived at `filePath`; return the rule messages. */
async function lint(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return (result?.messages ?? []).map((m) => m.message);
}

/** Did any message come from `no-restricted-syntax` and mention `fragment`? */
function complainsAbout(messages, fragment) {
  return messages.some((m) => m.includes(fragment));
}

const APP_FILE = 'apps/mobile/src/components/Example.tsx';

test('a colour literal fails outside the token directory', async () => {
  const messages = await lint(`export const a = { color: '#00af52' };\n`, APP_FILE);
  assert.ok(complainsAbout(messages, 'Colour literal'), messages.join('\n'));
});

test('an rgba() literal fails outside the token directory', async () => {
  const messages = await lint(`export const a = { bg: 'rgba(20, 23, 20, 0.48)' };\n`, APP_FILE);
  assert.ok(complainsAbout(messages, 'Colour literal'), messages.join('\n'));
});

test('the token directory may hold colour literals — it is the one place that may', async () => {
  const messages = await lint(
    `export const primary = { 500: '#00af52' };\n`,
    'packages/shared/src/design/color.ts',
  );
  assert.equal(complainsAbout(messages, 'Colour literal'), false, messages.join('\n'));
});

test('a font size literal fails', async () => {
  const messages = await lint(`export const s = { fontSize: 17 };\n`, APP_FILE);
  assert.ok(complainsAbout(messages, 'Type literal'), messages.join('\n'));
});

test('a border radius literal fails', async () => {
  const messages = await lint(`export const s = { borderRadius: 12 };\n`, APP_FILE);
  assert.ok(complainsAbout(messages, 'Radius literal'), messages.join('\n'));
});

test('a spacing literal fails', async () => {
  const messages = await lint(`export const s = { paddingHorizontal: 16 };\n`, APP_FILE);
  assert.ok(complainsAbout(messages, 'Spacing literal'), messages.join('\n'));
});

test('zero spacing is allowed, because it is not a scale decision', async () => {
  const messages = await lint(`export const s = { padding: 0 };\n`, APP_FILE);
  assert.equal(complainsAbout(messages, 'Spacing literal'), false, messages.join('\n'));
});

test('a duration literal passed to withTiming fails', async () => {
  const messages = await lint(
    `import { withTiming } from 'x';\nexport const a = () => withTiming(1, { duration: 180 });\n`,
    APP_FILE,
  );
  assert.ok(complainsAbout(messages, 'Duration literal'), messages.join('\n'));
});

test('a duration token passed to withTiming is allowed', async () => {
  const messages = await lint(
    `import { withTiming } from 'x';\nimport { duration } from 'y';\n` +
      `export const a = () => withTiming(1, { duration: duration.base });\n`,
    APP_FILE,
  );
  assert.equal(complainsAbout(messages, 'Duration literal'), false, messages.join('\n'));
});

test('`transition: all` fails', async () => {
  const messages = await lint(`export const s = { transition: 'all 200ms' };\n`, APP_FILE);
  assert.ok(complainsAbout(messages, 'transition: all'), messages.join('\n'));
});

test('a named transition property is allowed', async () => {
  const messages = await lint(`export const s = { transition: 'opacity 200ms' };\n`, APP_FILE);
  assert.equal(complainsAbout(messages, 'transition: all'), false, messages.join('\n'));
});

test('an Easing.bezier call fails outside motion.ts', async () => {
  const messages = await lint(
    `import { Easing } from 'x';\nexport const e = Easing.bezier(0.2, 0, 0, 1);\n`,
    APP_FILE,
  );
  assert.ok(complainsAbout(messages, 'Easing curve outside'), messages.join('\n'));
});

test('a cubic-bezier string fails outside motion.ts', async () => {
  const messages = await lint(
    `export const s = { transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)' };\n`,
    APP_FILE,
  );
  assert.ok(complainsAbout(messages, 'Easing curve outside'), messages.join('\n'));
});

test('motion.ts may hold an easing curve — it is the one module that may', async () => {
  const messages = await lint(
    `import { Easing } from 'x';\nexport const e = Easing.bezier(0.2, 0, 0, 1);\n`,
    MOTION_MODULE,
  );
  assert.equal(complainsAbout(messages, 'Easing curve outside'), false, messages.join('\n'));
});

test('withSpring fails outside the cart badge', async () => {
  const messages = await lint(
    `import { withSpring } from 'x';\nexport const a = () => withSpring(1);\n`,
    APP_FILE,
  );
  assert.ok(complainsAbout(messages, 'withSpring'), messages.join('\n'));
});

test('the cart badge may use withSpring — S4, exactly one place', async () => {
  const messages = await lint(
    `import { withSpring } from 'x';\nexport const a = () => withSpring(1);\n`,
    CART_BADGE_MODULE,
  );
  assert.equal(complainsAbout(messages, 'withSpring'), false, messages.join('\n'));
});

test('animating height fails outside the three exempt modules', async () => {
  const messages = await lint(
    `import { useAnimatedStyle } from 'x';\n` +
      `export const s = () => useAnimatedStyle(() => { return { height: 1 }; });\n`,
    APP_FILE,
  );
  assert.ok(complainsAbout(messages, 'other than `transform`'), messages.join('\n'));
});

test('animating transform and opacity is always allowed', async () => {
  const messages = await lint(
    `import { useAnimatedStyle } from 'x';\n` +
      `export const s = () => useAnimatedStyle(() => { return { opacity: 1, transform: [] }; });\n`,
    APP_FILE,
  );
  assert.equal(complainsAbout(messages, 'other than `transform`'), false, messages.join('\n'));
});

for (const module of HEIGHT_ANIMATION_MODULES) {
  test(`${module} may animate height — E13-19 found the gate exempted two files and needed three`, async () => {
    const messages = await lint(
      `import { useAnimatedStyle } from 'x';\n` +
        `export const s = () => useAnimatedStyle(() => { return { height: 1 }; });\n`,
      module,
    );
    assert.equal(complainsAbout(messages, 'other than `transform`'), false, messages.join('\n'));
  });
}

test('an exempt module keeps every rule it was not exempted from', async () => {
  // The failure this catches: an exemption written as "turn the rule off here" rather
  // than "drop this one entry here", which would let the cart badge hold a raw hex.
  const messages = await lint(`export const a = { color: '#00af52' };\n`, CART_BADGE_MODULE);
  assert.ok(complainsAbout(messages, 'Colour literal'), messages.join('\n'));
});

test('motion.ts is still held to the spring rule', async () => {
  const messages = await lint(
    `import { withSpring } from 'x';\nexport const a = () => withSpring(1);\n`,
    MOTION_MODULE,
  );
  assert.ok(complainsAbout(messages, 'withSpring'), messages.join('\n'));
});

test('every rule carries a message a reader can act on', async () => {
  // A lint failure that says only "restricted syntax" is a lint failure somebody disables
  // with an inline comment. Each message has to name the token to use instead.
  for (const rule of ALL_RULES) {
    assert.ok(rule.message.length > 60, `terse message: ${rule.selector}`);
    assert.ok(rule.selector.length > 0);
  }
});

test('the rule set has no duplicate selectors', async () => {
  // Two entries with the same selector means the exemption helper, which matches on
  // selector, would drop both — and the second one silently.
  const selectors = ALL_RULES.map((r) => r.selector);
  assert.equal(new Set(selectors).size, selectors.length);
});
