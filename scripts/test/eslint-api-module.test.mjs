import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';

import {
  API_MODULE_DIR,
  ENV_MODULE_FILES,
  SERVER_ONLY_VAR_NAMES,
} from '../../config/eslint-api-module.js';

/**
 * `E14-02` — the gates that keep non-negotiable #1 and `A4` true: every backend call goes
 * through one `api/` module, reads may use the Supabase client, **writes always go through
 * Edge Functions**.
 *
 * Same testing stance as `eslint-design-system.test.mjs`: lint snippets at real paths
 * against the **repository's actual config**, and assert both halves of every exemption.
 * "The rule is in the config" and "the rule fires" are different claims.
 */

const eslint = new ESLint();

async function lint(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return (result?.messages ?? []).map((m) => m.message);
}

const complains = (messages, fragment) => messages.some((m) => m.includes(fragment));

const SCREEN = 'apps/mobile/src/screens/MenuScreen.tsx';
const API_FILE = 'packages/shared/src/api/menu.ts';

// ---------------------------------------------------------------------------
// The import ban
// ---------------------------------------------------------------------------

test('a screen may not import the Supabase client', async () => {
  const messages = await lint(
    `import { createClient } from '@supabase/supabase-js';\nexport const x = createClient;\n`,
    SCREEN,
  );
  assert.ok(complains(messages, 'Only `packages/shared/src/api/`'), messages.join('\n'));
});

test('a screen may not reach a Supabase subpackage either', async () => {
  const messages = await lint(
    `import type { User } from '@supabase/auth-js';\nexport type U = User;\n`,
    SCREEN,
  );
  assert.ok(complains(messages, 'Supabase package'), messages.join('\n'));
});

test('the api module may import the Supabase client — it is the one that may', async () => {
  const messages = await lint(
    `import { createClient } from '@supabase/supabase-js';\nexport const x = createClient;\n`,
    API_FILE,
  );
  assert.equal(complains(messages, 'Only `packages/shared/src/api/`'), false, messages.join('\n'));
});

// ---------------------------------------------------------------------------
// Reads outside the module, writes anywhere
// ---------------------------------------------------------------------------

test('a screen may not build a Supabase query', async () => {
  const messages = await lint(
    `export const go = (supabase) => supabase.from('menu_item').select('*');\n`,
    SCREEN,
  );
  assert.ok(complains(messages, 'Supabase query outside'), messages.join('\n'));
});

test('the api module may read', async () => {
  const messages = await lint(
    `export const go = (supabase) => supabase.from('menu_item').select('*');\n`,
    API_FILE,
  );
  assert.equal(complains(messages, 'Supabase query outside'), false, messages.join('\n'));
});

for (const method of ['insert', 'update', 'upsert', 'delete']) {
  test(`a direct \`.${method}()\` fails even inside the api module`, async () => {
    const messages = await lint(
      `export const go = (supabase) => supabase.from('order').${method}({ a: 1 });\n`,
      API_FILE,
    );
    // This is the half that is easy to get wrong: the module is exempt from the *read*
    // rule, and it would be natural to exempt it from everything. `A4` does not relax
    // inside the module it governs — the module exists to obey it.
    assert.ok(complains(messages, 'Direct Supabase write'), messages.join('\n'));
  });
}

// ---------------------------------------------------------------------------
// Privileged keys (E01-18)
// ---------------------------------------------------------------------------

test('a server-only secret may not be referenced in app code', async () => {
  const messages = await lint(
    `export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`,
    SCREEN,
  );
  assert.ok(complains(messages, 'Server-only secret referenced'), messages.join('\n'));
});

test('naming it as a string does not evade the rule', async () => {
  const messages = await lint(
    `export const k = process.env['RAZORPAY_WEBHOOK_SECRET'];\n`,
    SCREEN,
  );
  assert.ok(complains(messages, 'Server-only secret named as a string'), messages.join('\n'));
});

test('a server-only secret is banned inside the api module too', async () => {
  const messages = await lint(
    `export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`,
    API_FILE,
  );
  assert.ok(complains(messages, 'Server-only secret referenced'), messages.join('\n'));
});

test('env.ts may write the names down — it is the module that defines them', async () => {
  const messages = await lint(
    `export const SERVER_ONLY_VARS = ['SUPABASE_SERVICE_ROLE_KEY'] as const;\n`,
    ENV_MODULE_FILES[0],
  );
  assert.equal(complains(messages, 'Server-only secret'), false, messages.join('\n'));
});

// ---------------------------------------------------------------------------
// The collision this file exists for
// ---------------------------------------------------------------------------

test('a design rule and an api rule both fire on the same file', async () => {
  // `no-restricted-syntax` is a single slot and ESLint flat config REPLACES a rule's
  // options rather than merging them (`S33`). If E14-02's rules were ever set in their own
  // block, this file would report only one of the two problems — and a lint config that
  // checks less than it did yesterday looks exactly like one that checks everything.
  const messages = await lint(
    `export const s = { color: '#00af52' };\nexport const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`,
    SCREEN,
  );
  assert.ok(complains(messages, 'Colour literal'), `design rule lost:\n${messages.join('\n')}`);
  assert.ok(
    complains(messages, 'Server-only secret referenced'),
    `api rule lost:\n${messages.join('\n')}`,
  );
});

test('every design-system exemption keeps the api rules', async () => {
  // The token directory may write a hex. It may not read a server-only secret. Each exempt
  // block re-states the full set minus one thing, and this asserts the "minus one thing"
  // did not quietly become "minus the other set".
  for (const path of [
    'packages/shared/src/design/color.ts',
    'packages/shared/src/design/motion.ts',
    'apps/mobile/src/components/cart/CartBadge.tsx',
    'apps/mobile/src/components/motion/SwipeRow.tsx',
  ]) {
    const messages = await lint(
      `export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`,
      path,
    );
    assert.ok(
      complains(messages, 'Server-only secret referenced'),
      `api rule lost at ${path}:\n${messages.join('\n')}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The duplicated list
// ---------------------------------------------------------------------------

test('the lint config names exactly the secrets env.ts names', async () => {
  // A lint config cannot import a TypeScript module, so the list is written twice. The
  // duplication is only safe while something asserts the copies agree — otherwise a fifth
  // secret added to env.ts is simply unguarded, and nothing says so.
  const envSource = readFileSync('packages/shared/src/env.ts', 'utf8');
  const block = envSource.match(/SERVER_ONLY_VARS = \[([\s\S]*?)\]/)?.[1] ?? '';
  const fromEnv = [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);

  assert.deepEqual(
    [...SERVER_ONLY_VAR_NAMES].sort(),
    [...fromEnv].sort(),
    'config/eslint-api-module.js and packages/shared/src/env.ts disagree about the server-only secrets',
  );
});

test('the api module directory is the one named in the config', () => {
  assert.equal(API_MODULE_DIR, 'packages/shared/src/api/**');
});
