// The rules that enforce non-negotiable #1 and decision `A4` — every backend call from the
// app goes through one `api/` module; **reads may use the Supabase client, writes always go
// through Edge Functions** (`E14-02`).
//
// Why this is worth a build failure rather than a review comment: the promise `A4` makes is
// that "add a dedicated API server later" is a base-URL change rather than a rewrite. That
// promise is only true while the number of files that know what Supabase is stays at one.
// It degrades one convenient import at a time, each of which looks reasonable on its own,
// and the day it matters is the day somebody is pricing a migration.
//
// **On the choice of rules.** The import ban and the privileged-key ban use
// `no-restricted-imports`, which nothing else in this repo touches. The write-path and
// env-name gates need AST selectors, and `no-restricted-syntax` is a **single shared slot** —
// ESLint flat config *replaces* a rule's options rather than merging them (`S33`). A second
// config block setting `no-restricted-syntax` would not add these rules; it would silently
// delete E13-11's design-system gates for every file it matched, and the build would still
// pass. So these selectors are handed to `designSystemConfigs({ extraRestrictedSyntax })`
// and composed into the one set. `scripts/test/eslint-api-module.test.mjs` asserts a file
// can fail a design rule and an api rule at the same time, which is the regression test for
// exactly that collision.

/**
 * The one module allowed to know that Supabase exists.
 *
 * **This directory does not exist yet.** Naming it here before it is built is the same
 * deliberate choice as `E13-11`'s `CartBadge.tsx` (`S31`, `S32`): the gate's whole job is to
 * stop the *first* screen reaching for the client directly, and arriving after the first
 * screen means arriving after the habit.
 */
export const API_MODULE_DIR = 'packages/shared/src/api/**';

/**
 * `env.ts` is the module that *defines* the server-only names, and its test asserts the
 * list. Both must be able to write the strings down.
 */
export const ENV_MODULE_FILES = [
  'packages/shared/src/env.ts',
  'packages/shared/src/env.test.ts',
];

/**
 * Server-only secrets, mirroring `SERVER_ONLY_VARS` in `packages/shared/src/env.ts`.
 *
 * Duplicated on purpose, and the duplication is the check — a lint config cannot import a
 * TypeScript module, and the test asserts the two lists are identical, so a name added to
 * one and not the other fails rather than silently going unguarded.
 */
export const SERVER_ONLY_VAR_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_WEBHOOK_SECRET_PREVIOUS',
];

const say = (what, where) => `${what} ${where}`;

const SERVER_ONLY_PATTERN = `^(${SERVER_ONLY_VAR_NAMES.join('|')})$`;

/**
 * Rules that need `no-restricted-syntax`. Composed into the design-system set rather than
 * set in their own block — see the note at the top of this file.
 */
export const apiSyntaxRules = {
  /** Applies everywhere, including inside the `api/` module. */
  everywhere: [
    {
      selector: `MemberExpression[property.name=/${SERVER_ONLY_PATTERN}/]`,
      message: say(
        'Server-only secret referenced in application code.',
        'These four names must never be reachable from a bundle — `SUPABASE_SERVICE_ROLE_KEY` is the one credential that bypasses RLS and defeats non-negotiable #2. They live only as Edge Function env vars (`SR1`). `E01-18` asserts the built bundle is clean; this fails at the source, which is cheaper to read.',
      ),
    },
    {
      selector: `Literal[value=/${SERVER_ONLY_PATTERN}/]`,
      message: say(
        'Server-only secret named as a string in application code.',
        'Reading it dynamically (`process.env[name]`) evades the member-expression rule and reaches the bundle just the same. Only `packages/shared/src/env.ts` may write these names down.',
      ),
    },
  ],

  /**
   * Applies everywhere **except** the `api/` module — outside it, nothing may build a
   * Supabase query at all, because nothing outside it holds a client.
   */
  outsideApiModule: [
    {
      selector: 'CallExpression[callee.property.name="from"][callee.object.name=/^(supabase|client|db)$/]',
      message: say(
        'Supabase query outside the `api/` module.',
        'Every backend call goes through `packages/shared/src/api/` (`A4`, non-negotiable #1). A screen that queries directly is what turns "add an API server" from a config change into a rewrite.',
      ),
    },
  ],

  /**
   * Applies **inside** the `api/` module. Reads are allowed there; writes are not, anywhere.
   */
  writesGoThroughEdgeFunctions: [
    {
      selector:
        'CallExpression[callee.property.name=/^(insert|update|upsert|delete)$/][callee.object.callee.property.name="from"]',
      message: say(
        'Direct Supabase write.',
        'Reads may use the Supabase client; **writes always go through Edge Functions** (`A4`). A write from the client is a write with no server-side idempotency key, no `order_event` row, and no place to put the invariants — `D16` makes idempotency a database constraint precisely because logic gets refactored. Call `functions.invoke(...)`.',
      ),
    },
  ],
};

/** Every api-module rule that needs `no-restricted-syntax`, in message order. */
export const ALL_API_SYNTAX_RULES = [
  ...apiSyntaxRules.everywhere,
  ...apiSyntaxRules.outsideApiModule,
  ...apiSyntaxRules.writesGoThroughEdgeFunctions,
];

const APP_FILES = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'];

/**
 * The blocks that use `no-restricted-imports` — a rule nothing else in this repo sets, so
 * these are free to live in their own block without the `S33` replacement hazard.
 *
 * Exported as a function so the test can point it somewhere else if it ever needs to.
 */
export function apiImportConfigs({ apiModuleDir = API_MODULE_DIR } = {}) {
  const supabaseImportBan = {
    paths: [
      {
        name: '@supabase/supabase-js',
        message:
          'Only `packages/shared/src/api/` may import the Supabase client (`A4`, non-negotiable #1). Import the `api/` module instead — that is what keeps "add a dedicated API server later" a base-URL change rather than a rewrite.',
      },
    ],
    patterns: [
      {
        group: ['@supabase/*'],
        message:
          'Only `packages/shared/src/api/` may import a Supabase package (`A4`). Import the `api/` module instead.',
      },
    ],
  };

  return [
    {
      files: APP_FILES,
      rules: { 'no-restricted-imports': ['error', supabaseImportBan] },
    },
    {
      // The one module that may hold the client.
      files: [apiModuleDir],
      rules: { 'no-restricted-imports': 'off' },
    },
  ];
}
