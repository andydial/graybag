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
 * rendered as `testID={`menu-row-${item.id}`}` satisfies the flow's `menu-row-.*`.
 *
 * ## What it CANNOT catch, stated plainly
 *
 * **A composition that is individually real but never occurs.** `DishDetailScreen` defines
 * `screen-dish-detail` and, in the same file, renders a Button as `${testID}-button` — but that
 * Button's `testID` is the sub-component's `screen-dish-detail-add`, so the real handle is
 * `screen-dish-detail-add-button`. Both halves of `screen-dish-detail-button` are genuinely
 * present in that file, so this check accepts it, and it exists nowhere at runtime.
 *
 * That is not a bug to be fixed by a cleverer regex — deciding it needs to know which testID
 * prop reaches which component, which is the program's runtime behaviour. **Only Maestro
 * running against a real build can tell you.** This check is the cheap half: it catches the id
 * that exists nowhere at all, in a second, in the smoke test. It is not a substitute for the
 * e2e run, and a green result here is not evidence that a flow will pass.
 *
 * The flow shipped with exactly that wrong id for a day while this check reported success.
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

const sourceFiles = walk(SRC_DIR, /\.tsx?$/)
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const source = sourceFiles.map((f) => f.text).join('\n');

/**
 * Every literal string that reaches a `testID`, plus the static prefix of every template one.
 * `testID={`menu-row-${item.id}`}` contributes `menu-row-`, which is enough to satisfy a flow
 * asking for `menu-row-.*`.
 */
const known = new Set();
/** Base+suffix combinations that genuinely occur together in one file. */
const composed = new Set();

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
/**
 * `${testID}-button` style suffixes, paired with the base ids declared in the SAME file.
 *
 * Pairing matters. Composing every known base with every known suffix accepted
 * `screen-dish-detail-button`, which exists nowhere — the real id is
 * `screen-dish-detail-add-button`, because the button lives inside a sub-component whose own
 * testID is `screen-dish-detail-add`. Both halves were real; the combination was not, and the
 * flow would have hung on it until Maestro timed out.
 *
 * Per-file pairing is still not proof — a base and a suffix can be real in one file and never
 * meet at runtime — but it removes the whole class of cross-file coincidences.
 */
for (const { text } of sourceFiles) {
  const bases = [
    ...[...text.matchAll(/testID\s*=\s*['"]([^'"]+)['"]\s*,/g)].map((m) => m[1]),
    ...[...text.matchAll(/testID\s*=\s*\{`([^`$]*)\$\{/g)].map((m) => m[1]),
  ].filter((v) => typeof v === 'string' && v.length >= 3);
  const suffixes = [...text.matchAll(/\$\{testID\}(-[a-z0-9-]+)/gi)].map((m) => m[1]);

  /**
   * Compose to TWO levels, because ids nest. `screen-dish-detail` passes `${testID}-add` to a
   * sub-component, which passes `${testID}-button` to a Button — so the real id is
   * `screen-dish-detail-add-button`, three segments from two suffixes.
   *
   * One level accepted `screen-dish-detail-button` (which exists nowhere) and rejected
   * `screen-dish-detail-add-button` (which is the actual handle) — the worst of both, and it
   * got the wrong id into the committed flow.
   *
   * Two levels is deliberate rather than unbounded: it matches the nesting the codebase
   * actually has, and each extra level widens what the check will accept.
   */
  let level = [...bases];
  for (let depth = 0; depth < 2; depth += 1) {
    const next = [];
    for (const base of level) {
      for (const suffix of suffixes) {
        const id = `${base}${suffix}`;
        add(composed, id);
        next.push(id);
      }
    }
    level = next;
  }
}
for (const [, value] of source.matchAll(/tabBarButtonTestID:\s*['"]([^'"]+)['"]/g)) add(known, value);

/** Does any known id satisfy this flow reference? */
function satisfied(reference) {
  if (composed.has(reference)) return true;

  /**
   * A reference is a PATTERN if it carries regex syntax anywhere, and its literal part is
   * everything before the first metacharacter.
   *
   * This used to recognise a trailing `.*` and nothing else, which quietly punished the more
   * precise form. `school-picker-.*` passed; `school-picker-[0-9a-f]{8}-…` — which matches the
   * school ROWS and not the nine other testIDs sharing that prefix — was reported as existing
   * nowhere. The loose pattern was not merely less precise, it was wrong: it matched
   * `school-picker-search`, which is rendered before the list, so `index: 0` tapped the search
   * box and the flow never left the picker (`E14-38`).
   *
   * `menu-row-.*` still resolves to the literal `menu-row-`, exactly as before, and a reference
   * with no metacharacters must still match a known id exactly — otherwise `tab-does-not-exist`
   * passes on three shared characters.
   */
  const meta = reference.search(/[.*+?^${}()|[\]\\]/);
  const isPattern = meta !== -1;
  const literal = isPattern ? reference.slice(0, meta) : reference;
  if (literal.length < 3) return false;

  for (const id of known) {
    if (id === reference) return true;
    // A pattern (`menu-row-.*`) is satisfied by a known id or template prefix that starts with
    // its literal part. Only patterns get prefix treatment — an exact reference must exist
    // exactly, or `tab-does-not-exist` passes because `tab-home` shares three characters.
    if (isPattern && id.startsWith(literal)) return true;

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

// ---------------------------------------------------------------------------- appId
//
// `E01-26`. A flow's `appId` must be the package the CI build actually installs, and for two
// months it was not: the flow named `com.gracord.graybag.staging` — the **iOS** bundle id with a
// staging suffix — while the Android build produced `com.Gracord.Graybag.staging`. Android
// package names are case-sensitive, so Maestro answered "Package … is not installed" after a
// 24-minute build, every time, on every pull request.
//
// A wrong `appId` fails *late and expensively*: after the emulator boots and the APK builds.
// This check fails in a second, on the machine of whoever changed it.
//
// Derived from `app.json` and `app.config.js` rather than written down again — a second copy of
// the package name is exactly what went wrong, and hardcoding the answer here would recreate it.
const APP_JSON = JSON.parse(readFileSync(join(ROOT, 'apps/mobile/app.json'), 'utf8'));
const ANDROID_PACKAGE = APP_JSON.expo?.android?.package ?? APP_JSON.android?.package;

// The staging suffix, read out of the identity table rather than assumed to be '.staging'.
const CONFIG_SOURCE = readFileSync(join(ROOT, 'apps/mobile/app.config.js'), 'utf8');
const STAGING_SUFFIX = /staging:\s*\{[^}]*suffix:\s*'([^']*)'/.exec(CONFIG_SOURCE)?.[1];

if (!ANDROID_PACKAGE || STAGING_SUFFIX === undefined) {
  problems.push(
    'could not read the Android package or the staging suffix from app.json / app.config.js — ' +
      'the appId check below cannot run, which means it is not protecting anything',
  );
} else {
  const expected = `${ANDROID_PACKAGE}${STAGING_SUFFIX}`;
  for (const flow of flows) {
    const found = /^appId:\s*(\S+)\s*$/m.exec(readFileSync(flow, 'utf8'))?.[1];
    if (found === undefined) continue;
    if (found !== expected) {
      problems.push(
        `${flow.replace(`${ROOT}/`, '')}: appId is "${found}" but the CI build installs ` +
          `"${expected}" (Android package + staging suffix). Package names are case-sensitive, ` +
          `and the iOS bundle id is deliberately different — see E01-26.`,
      );
    }
  }
}

if (problems.length) {
  console.error('Maestro flows reference things that do not exist:\n  ' + problems.join('\n  '));
  console.error('\nA missing id does not fail fast — the flow hangs until it times out, which');
  console.error('reads as flakiness. A wrong appId fails only after the APK is built. Both are');
  console.error('cheap to catch here and expensive to catch in CI. Fix the flow, or the app.');
  process.exit(1);
}

console.log(
  `${flows.length} Maestro flow(s) checked — every id resolves, and every appId matches the build.`,
);
