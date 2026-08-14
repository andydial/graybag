import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const easignore = readFileSync(join(ROOT, '.easignore'), 'utf8');
const lines = easignore
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/**
 * `.easignore` decides what an EAS build installs, not just what it uploads.
 *
 * EAS runs `npm ci` at the **workspace root**, so every dependency of every workspace present in
 * the tarball is installed — whether the app imports it or not. That makes a web-only dependency
 * able to break a mobile build, which is what happened on 2026-08-14: `apps/web` depends on
 * `sharp`, Astro's image library and a native module, and an iOS build died in "Install
 * dependencies" trying to compile it from source.
 *
 * These assertions exist because the failure is entirely invisible from this repository. Nothing
 * about deleting a line from `.easignore` looks like it could break an iOS build, and the error
 * when it does names `sharp` and `node-gyp` rather than anything a reader would connect to it.
 */
test('.easignore excludes the web app, because EAS installs every workspace it uploads', () => {
  assert.ok(
    lines.includes('apps/web/') || lines.includes('apps/web'),
    'apps/web must stay excluded from EAS uploads. Without it, `npm ci` at the workspace root ' +
      'installs the web app\'s dependencies into a mobile build — including `sharp`, which is ' +
      'native and fails to compile there. Adding `node-addon-api` fixes one build and leaves the ' +
      'next web-only native package to do the same thing.',
  );
});

test('.easignore keeps what the app actually needs', () => {
  // `apps/mobile` depends on `@graybag/shared`, and every tsconfig in the repo extends
  // `config/tsconfig.base.json` — which Metro's TypeScript resolver follows on startup. Excluding
  // `config/` cost three builds once, and the error said only "Unknown error".
  for (const needed of ['packages/', 'packages', 'config/', 'config', 'apps/mobile/', 'apps/mobile']) {
    assert.ok(
      !lines.includes(needed),
      `${needed} must not be excluded — the mobile build needs it.`,
    );
  }
});

test('.easignore still excludes node_modules, which is the whole reason it is tolerable', () => {
  // `.easignore` REPLACES `.gitignore` for upload purposes. Omitting `node_modules/` turns a
  // 3.4 MB upload into a multi-hundred-megabyte one over an 85 KB/s uplink.
  assert.ok(lines.includes('node_modules/'), 'node_modules/ must stay excluded');
});
