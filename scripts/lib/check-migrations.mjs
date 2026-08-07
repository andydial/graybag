// Enforces the migration rules in docs/migrations.md.
//
// Pure and directory-driven so it can be tested against throwaway fixtures rather
// than only against the real repository. The CLI wrapper is ../check-migrations.mjs.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** `0001_initial_schema.sql` — four digits, underscore, lower_snake_case, `.sql`. */
const UP_NAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const DOWN_NAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.down\.sql$/;

/** `-- irreversible: <reason>` anywhere in the file's leading comment block. */
const IRREVERSIBLE = /^\s*--\s*irreversible\s*:(.*)$/im;

const sqlFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];

/** True when a file carries no SQL — only blank lines and `--` comments. */
function isEffectivelyEmpty(body) {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('--'))
    .length === 0;
}

/**
 * @param {{upDir: string, downDir: string}} dirs
 * @returns {{ok: boolean, checked: number, problems: {code: string, file: string, message: string}[],
 *            irreversible: {file: string, reason: string}[]}}
 */
export function checkMigrations({ upDir, downDir }) {
  const problems = [];
  const irreversible = [];
  const fail = (code, file, message) => problems.push({ code, file, message });

  const ups = [];
  for (const file of sqlFiles(upDir)) {
    const m = file.match(UP_NAME);
    if (!m) {
      fail('bad-name', file, `"${file}" is not a valid migration name. Expected NNNN_lower_snake_case.sql (four digits).`);
      continue;
    }
    ups.push({ file, version: m[1], slug: m[2], body: readFileSync(join(upDir, file), 'utf8') });
  }

  // Versions: unique, and contiguous from 0001. A gap means a migration was deleted
  // or a branch renumbered one, and both mean the applied order is no longer the
  // committed order on some database somewhere.
  const byVersion = new Map();
  for (const up of ups) {
    if (byVersion.has(up.version)) {
      fail('duplicate-version', up.file, `Version ${up.version} is used by both "${byVersion.get(up.version).file}" and "${up.file}". Versions are permanent and unique — append a new one, never reuse.`);
    } else {
      byVersion.set(up.version, up);
    }
  }
  const versions = [...byVersion.keys()].sort();
  versions.forEach((v, i) => {
    const expected = String(i + 1).padStart(4, '0');
    if (v !== expected) {
      fail('version-gap', byVersion.get(v).file, `Expected version ${expected} but found ${v}. Migration versions run consecutively from 0001 with no gaps.`);
    }
  });

  // Reversibility.
  const downFiles = new Set(sqlFiles(downDir));
  const claimedDowns = new Set();

  for (const up of ups) {
    const downFile = `${up.version}_${up.slug}.down.sql`;
    const hasDown = downFiles.has(downFile);
    const marker = up.body.match(IRREVERSIBLE);

    if (marker) {
      const reason = marker[1].trim();
      if (reason === '') {
        fail('irreversible-without-reason', up.file, `"${up.file}" is marked irreversible but gives no reason. Write "-- irreversible: <why>" so the rollback plan is a decision on the record, not a shrug.`);
      } else if (hasDown) {
        claimedDowns.add(downFile);
        fail('irreversible-with-down', up.file, `"${up.file}" is marked irreversible but "${downFile}" exists. It is one or the other — remove the marker or remove the down migration.`);
      } else {
        irreversible.push({ file: up.file, reason });
      }
      continue;
    }

    if (!hasDown) {
      fail('missing-down', up.file, `"${up.file}" has no rollback. Add supabase/down/${downFile}, or mark the migration "-- irreversible: <why>".`);
      continue;
    }

    claimedDowns.add(downFile);
    if (isEffectivelyEmpty(readFileSync(join(downDir, downFile), 'utf8'))) {
      fail('empty-down', downFile, `"${downFile}" contains no SQL. A rollback that silently does nothing is worse than an honest "-- irreversible:" marker, because it will be trusted.`);
    }
  }

  for (const downFile of downFiles) {
    if (claimedDowns.has(downFile)) continue;
    const m = downFile.match(DOWN_NAME);
    if (!m) {
      fail('bad-name', downFile, `"${downFile}" is not a valid rollback name. Expected NNNN_lower_snake_case.down.sql.`);
    } else {
      fail('orphan-down', downFile, `"${downFile}" does not match any migration in ${upDir}. Rollbacks are named after the migration they reverse.`);
    }
  }

  return { ok: problems.length === 0, checked: ups.length, problems, irreversible };
}
