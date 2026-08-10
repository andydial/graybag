#!/usr/bin/env node
/**
 * Every `id:` a Maestro flow taps or asserts must exist in the app's source.
 *
 *     node scripts/check-maestro-ids.mjs
 *
 * ## Why this is a check and not a convention
 *
 * Twice now an artefact has documented a handle that was never verified: the prototype's README
 * advertised `#dish`, which silently fell back to the splash screen, and this flow's first draft
 * tapped `tab-menu` and `screen-menu-list`, neither of which existed — the tab bar had no
 * testIDs at all and the list id belongs to the FlatList rather than a row.
 *
 * A flow that references a missing id does not fail loudly. It hangs until Maestro times out,
 * which reads as flakiness, and a flaky end-to-end suite gets disabled rather than fixed. That
 * is how a team ends up back where we started, with a green unit suite and a broken app.
 *
 * So: a missing id fails the smoke test in about a second, on the machine of whoever removed it.
 *
 * ## What counts as existing
 *
 * A literal `testID="foo"` / `testID={'foo'}`, or a template that could produce it — a row
 * rendered as `testID={`menu-row-${item.id}`}` satisfies the flow's `menu-row-.*`. The check is
 * deliberately generous about templates and strict about literals: proving a template's runtime
 * output is the e2e suite's job, and duplicating it here would just be a second thing to be
 * wrong. Catching the id that exists nowhere at all is the whole win.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLOW_DIR = join(ROOT, 'apps', 'mobile', '.maestro');
const SRC_DIR = join(ROOT, 'apps', 'mobile', 'src');

function walk(dir, match, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') walk(path, match, out);
    } else if (match.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const source = walk(SRC_DIR, /\.tsx?$/)
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

/**
 * Every literal string that reaches a `testID`, plus the static prefix of every template one.
 * `testID={`menu-row-${item.id}`}` contributes `menu-row-`, which is enough to satisfy a flow
 * asking for `menu-row-.*`.
 */
const known = new Set();
const suffixes = new Set();

/**
 * An empty capture is worse than useless here: `testID={`${testID}-list`}` yields `''` as its
 * static prefix, and `'anything'.startsWith('')` is true — so one empty entry made every id in
 * every flow "resolve", including `tab-does-not-exist`. The check reported success on the very
 * input it was written to reject. Nothing shorter than a real handle goes in.
 */
const add = (set, value) => {
  if (typeof value === 'string' && value.trim().length >= 3) set.add(value.trim());
};

for (const [, value] of source.matchAll(/testID\s*=\s*["']([^"'{}]+)["']/g)) add(known, value);
for (const [, value] of source.matchAll(/testID\s*=\s*\{\s*['"]([^'"]+)['"]\s*\}/g)) add(known, value);
for (const [, value] of source.matchAll(/testID\s*=\s*\{`([^`$]*)\$\{/g)) add(known, value);
// `testID = 'screen-cart'` as a prop default, and `${testID}-button` suffixes built from it.
for (const [, value] of source.matchAll(/testID\s*=\s*['"]([^'"]+)['"]\s*,/g)) add(known, value);
for (const [, value] of source.matchAll(/\$\{testID\}(-[a-z0-9-]+)/gi)) add(suffixes, value);
for (const [, value] of source.matchAll(/tabBarButtonTestID:\s*['"]([^'"]+)['"]/g)) add(known, value);

/** Does any known id satisfy this flow reference? */
function satisfied(reference) {
  const isPattern = reference.endsWith('.*');
  const literal = reference.replace(/\.\*$/, '');
  if (literal.length < 3) return false;

  for (const id of known) {
    if (id === reference) return true;
    // A pattern (`menu-row-.*`) is satisfied by a known id or template prefix that starts with
    // its literal part. Only patterns get prefix treatment — an exact reference must exist
    // exactly, or `tab-does-not-exist` passes because `tab-home` shares three characters.
    if (isPattern && id.startsWith(literal)) return true;
    // `screen-dish-detail-button` is the screen's own `testID` plus a `${testID}-button` suffix
    // rendered inside it.
    for (const suffix of suffixes) {
      if (`${id}${suffix}` === reference) return true;
    }
  }
  return false;
}

let flows;
try {
  flows = walk(FLOW_DIR, /\.ya?ml$/);
} catch {
  console.log('No .maestro directory yet — nothing to check.');
  process.exit(0);
}

const problems = [];
for (const flow of flows) {
  const text = readFileSync(flow, 'utf8');
  for (const [, reference] of text.matchAll(/^\s*id:\s*['"]?([^'"\n]+)['"]?\s*$/gm)) {
    if (!satisfied(reference.trim())) {
      problems.push(`${flow.replace(`${ROOT}/`, '')}: id "${reference.trim()}" exists nowhere in apps/mobile/src`);
    }
  }
}

if (problems.length) {
  console.error('Maestro flows reference testIDs that do not exist:\n  ' + problems.join('\n  '));
  console.error('\nA missing id does not fail fast — the flow hangs until it times out, which');
  console.error('reads as flakiness. Add the testID, or fix the flow.');
  process.exit(1);
}

console.log(`${flows.length} Maestro flow(s) checked — every id resolves.`);
