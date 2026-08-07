// ESLint flat config.
//
// This is the one build-tool config file at the repository root, and it is here because
// ESLint resolves its config upward from the working directory and every editor
// integration expects to find it here. Everything else that could be moved has been —
// the shared TypeScript options live in config/tsconfig.base.json.
//
// The two custom rules that enforce non-negotiable #1 — every backend call goes through
// the `api/` module, and writes go through Edge Functions — are NOT here yet. They land
// with the module itself in Block 5 (E14-08), because a rule with nothing to check is a
// rule nobody notices has stopped working.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

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
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Repo tooling and the menu importer: plain ESM JavaScript on Node.
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs'],
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
    files: ['scripts/**', 'tools/**'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.test.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
