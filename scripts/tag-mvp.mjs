#!/usr/bin/env node
// Applies / refreshes the (mvp) marker on backlog tasks from the rules below.
//
//   node scripts/tag-mvp.mjs           # apply
//   node scripts/tag-mvp.mjs --dry     # show what would change, write nothing
//
// Rule: everything is MVP unless excluded. New tasks therefore default to MVP —
// safer to see something and cut it than to have it silently vanish from the
// launch list. Scope reasoning lives in docs/mvp-scope.md.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'planning', 'backlog');
const DRY = process.argv.includes('--dry');

// Whole epics out of MVP
const EXCLUDE_EPICS = new Set(['E11', 'E18']);

// Individual tasks out of MVP
const EXCLUDE_IDS = new Set([
  // DLT / SMS — no longer on the critical path (auth is Google/Apple/email OTP)
  'E00-06', 'E00-07', 'E00-08', 'E00-09',
  // Phone OTP — fast-follow addition
  'E03-01', 'E03-02', 'E03-03', 'E03-04', 'E03-10',
  // Foundations
  'E01-09',                                          // PR preview environments
  // Ordering
  'E05-05',                                          // allergen blocking warning (tags still import)
  // Payments — ledger stays, wallet UX defers
  'E06-09', 'E06-10',
  // Revenue share / payouts stay a spreadsheet
  'E07-09', 'E07-10', 'E07-11', 'E07-12',
  // Push notifications — all of them
  'E08-01', 'E08-02', 'E08-04', 'E08-05', 'E08-07',
  'E08-08', 'E08-09', 'E08-12', 'E08-13', 'E08-14',
  // Kitchen aggregates, packing lists, pickup codes
  'E09-01', 'E09-02', 'E09-03', 'E09-06', 'E09-07', 'E09-11a',
  // Admin extras
  'E10-10', 'E10-11', 'E10-13', 'E10-14',
  // Automated a11y testing (manual pass E13-08 stays)
  'E13-10',
  // Full offline reads (menu cache E04-10 stays — that is the perf win)
  'E14-10',
  // Observability extras (Sentry, uptime, correlation ids, rate limiting stay)
  'E15-09', 'E15-11', 'E15-12',
  // Automated retention purge (the policy stays)
  'E20-05',
]);

const LINE = /^(\s*-\s*\[[ xX]\]\s*`([A-Z0-9-]+)`\s*)((?:\(risk:\w+\)\s*)?(?:\(owner:\w+\)\s*)?)((?:\(mvp\)\s*)?)(.*)$/;

let tagged = 0, untagged = 0, unchanged = 0;
const changes = [];

for (const f of readdirSync(SRC).filter((x) => x.endsWith('.md'))) {
  const p = join(SRC, f);
  const before = readFileSync(p, 'utf8');
  const out = before.split('\n').map((line) => {
    const m = line.match(LINE);
    if (!m) return line;
    const [, head, id, markers, existing, rest] = m;
    const epic = id.split('-')[0];
    const shouldBeMvp = !EXCLUDE_EPICS.has(epic) && !EXCLUDE_IDS.has(id);
    const hasMvp = existing.trim() === '(mvp)';
    if (shouldBeMvp === hasMvp) { unchanged++; return line; }
    if (shouldBeMvp) { tagged++; changes.push(`  + ${id}`); return `${head}${markers}(mvp) ${rest}`; }
    untagged++; changes.push(`  - ${id}`);
    return `${head}${markers}${rest}`;
  }).join('\n');
  if (out !== before && !DRY) writeFileSync(p, out);
}

console.log(`tag-mvp${DRY ? ' (dry run)' : ''}: +${tagged} tagged, -${untagged} untagged, ${unchanged} unchanged`);
if (changes.length && changes.length <= 60) console.log(changes.join('\n'));
if (!DRY) console.log('\nNow run: node scripts/build-backlog.mjs');
