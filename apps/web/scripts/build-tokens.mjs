#!/usr/bin/env node
/**
 * Generate `src/styles/tokens.css` from `packages/shared/src/design`.
 *
 *     node apps/web/scripts/build-tokens.mjs          # write
 *     node apps/web/scripts/build-tokens.mjs --check  # fail if stale
 *
 * This is the second half of decision `S8` — "one source, two outputs, no third".
 * `apps/mobile` imports the token objects; the web cannot, because a stylesheet needs values
 * rather than modules, so it materialises them as CSS custom properties here.
 *
 * **The generated file is committed.** That is deliberate: `astro dev` must be able to start
 * from a clean checkout without a build step running first, and a designer opening the file
 * should see the values. The `--check` mode is what stops the committed copy going stale — it
 * runs in the smoke test, so a token change in `packages/shared` that nobody regenerated fails
 * CI rather than shipping a palette that disagrees with the app's.
 *
 * `cssVariableSheet()` is a `.ts` file in a package with no build step, so this script runs it
 * through `tsx`. That is the same mechanism the repo's other `.mts` scripts use.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const ROOT = join(WEB, '..', '..');
const OUT = join(WEB, 'src', 'styles', 'tokens.css');

/**
 * Run the generator in a `tsx` subprocess and capture its stdout.
 *
 * Importing `@graybag/shared` directly from this `.mjs` file would need Node to resolve and
 * transpile TypeScript, which it will not do. Shelling out to `tsx` keeps the token source
 * exactly one file — `packages/shared/src/design/css.ts` — rather than adding a second,
 * hand-maintained JavaScript copy of it, which is the failure `S8` exists to prevent.
 */
function generate() {
  // `@graybag/shared`'s only export is `.`, so the design module is reached through the package
  // root rather than as `@graybag/shared/design`.
  const program = [
    "import { design } from '@graybag/shared';",
    'process.stdout.write(design.cssVariableSheet());',
  ].join('\n');

  const tmp = join(ROOT, 'node_modules', '.graybag-tokens.mts');
  writeFileSync(tmp, program, 'utf8');
  return execFileSync('npx', ['tsx', tmp], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const sheet = generate();
const check = process.argv.includes('--check');

if (check) {
  if (!existsSync(OUT)) {
    console.error(`tokens.css is missing. Run: node apps/web/scripts/build-tokens.mjs`);
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== sheet) {
    console.error(
      'tokens.css is stale — packages/shared/src/design has changed since it was generated.\n' +
        'Run: node apps/web/scripts/build-tokens.mjs',
    );
    process.exit(1);
  }
  console.log('tokens.css is current.');
} else {
  writeFileSync(OUT, sheet, 'utf8');
  const count = sheet.split('\n').filter((l) => l.startsWith('  --gb-')).length;
  console.log(`Wrote ${OUT} — ${count} custom properties.`);
}
