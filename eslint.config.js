// ESLint flat config.
//
// This is the one build-tool config file at the repository root, and it is here because
// ESLint resolves its config upward from the working directory and every editor
// integration expects to find it here. Everything else that could be moved has been —
// the shared TypeScript options live in config/tsconfig.base.json.
//
// Two custom gate sets live here, both ahead of the code they police:
//
//   - The design-system and motion gates (E13-11), in config/eslint-design-system.js.
//     Their whole job is to stop the *first* component being written with a literal in it,
//     so arriving after E13-03 would mean arriving after the habit (S31).
//   - The `api/` module gates (E14-02), in config/eslint-api-module.js. Non-negotiable #1
//     and A4: every backend call goes through one module, reads may use the Supabase
//     client, writes always go through Edge Functions. Same reasoning — the rule exists to
//     stop the first screen importing the client directly.
//
// **They share `no-restricted-syntax`, and that is why the api rules are passed *into*
// designSystemConfigs rather than set in a block of their own.** Flat config replaces a
// rule's options rather than merging them (S33), so a second block setting the same rule
// would delete the design-system gates for every file it matched — silently, with the
// build still green. scripts/test/eslint-api-module.test.mjs asserts one file can fail a
// design rule and an api rule at once, which is the regression test for that collision.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

import { designSystemConfigs } from './config/eslint-design-system.js';
import {
  API_MODULE_DIR,
  ENV_MODULE_FILES,
  ALL_API_SYNTAX_RULES,
  apiSyntaxRules,
  apiImportConfigs,
} from './config/eslint-api-module.js';

export default tseslint.config(
  {
    // Generated, vendored, or not ours.
    ignores: [
      '**/node_modules/**',
      '.claude/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      'planning/backlog.html',
      'Legacy-Application/**',
      // Written by `supabase start` — the local stack's own runtime bundle, minified vendor
      // code that is already in .gitignore. It only began failing lint when a Colima rebuild
      // made the CLI emit a different set of temp artefacts, which is a good reminder that
      // "gitignored" and "lint-ignored" are two different lists.
      'supabase/.temp/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Repo tooling, the menu importer and the prototype build: plain ESM JavaScript on Node.
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs', 'docs/prototype/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    // TypeScript, both application code and the .mts repo scripts.
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Money is integer paise and ids are opaque strings; an unused binding in this
      // codebase is usually a half-finished refactor, not a stylistic matter.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Non-negotiable #4: children's data must never be logged. console.log is not the
      // enforcement — that is E20-10 — but it should be a deliberate act, not a leftover.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Scripts talk to the operator; that is their entire job.
    files: ['scripts/**', 'tools/**', 'docs/prototype/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  {
    // Expo config plugins must be CommonJS — Expo `require()`s them from its own config
    // loader, so this is a constraint of the platform rather than a style choice.
    files: ['tools/spike-mobile/plugins/**/*.js', 'apps/*/plugins/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    // The plugin tests are ESM (node:test) sitting next to CommonJS plugins, which is why
    // they are .mjs — the directory has no "type": "module" and cannot get one without
    // breaking the plugins Expo require()s.
    files: ['apps/*/plugins/**/*.test.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    // Metro's config must be CommonJS for the same reason the Expo plugins above must be:
    // Metro `require()`s it from its own loader before any transform is in play. Same
    // constraint of the platform, same exemption.
    //
    // `app.config.js` joins them for the identical reason: Expo's config loader `require()`s
    // it before anything is transformed, and it reads `process.env.APP_ENV` to decide whether
    // the build gets the production identity or the staging one (`E17-28`).
    files: ['apps/*/metro.config.js', 'apps/*/app.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.test.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  // E14-02's import ban. Separate block because it uses `no-restricted-imports`, which
  // nothing else sets — so it carries no replacement hazard.
  ...apiImportConfigs(),

  // E13-11 + E14-02. Last, so their narrowing exemptions are not themselves overridden —
  // flat config replaces a rule's options rather than merging them, and order is the only
  // thing that decides which `no-restricted-syntax` set is in force for a given file.
  ...designSystemConfigs({
    extraRestrictedSyntax: ALL_API_SYNTAX_RULES,
    apiModuleDir: API_MODULE_DIR,
    // Inside `api/` a Supabase *read* is the point. A Supabase *write* is not, and is not
    // exempted here — `A4` says writes go through Edge Functions, and that rule is not
    // relaxed by being inside the module it governs.
    apiModuleExemptRules: apiSyntaxRules.outsideApiModule,
    envModuleFiles: ENV_MODULE_FILES,
    envModuleExemptRules: apiSyntaxRules.everywhere,
  }),

  {
    // The design tests assert against the tokens, so they name colours, sizes and
    // durations on purpose — that is the entire point of a test that catches drift.
    files: ['packages/shared/src/design/**/*.test.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
