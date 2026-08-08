#!/usr/bin/env node
// Applies the (mvp) marker to backlog tasks.
//
//   node scripts/tag-mvp.mjs           # apply
//   node scripts/tag-mvp.mjs --dry     # report only
//
// EXPLICIT INCLUDE LIST. Anything not named here is fast-follow, including any
// task added later. That is deliberate: the backlog grows on every review pass,
// and an exclude-list default is how a 161-task MVP became 288.
//
// To put something in v1 you must add its id here, on purpose.
// Scope and reasoning: docs/mvp-scope.md

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'planning', 'backlog');
const DRY = process.argv.includes('--dry');

const MVP = new Set(`
E00-01 E00-02 E00-03 E00-04 E00-05 E00-12 E00-13 E00-14 E00-15 E00-18

E01-00 E01-01 E01-02 E01-04 E01-05 E01-06 E01-07 E01-08 E01-10 E01-13 E01-14

E02-01 E02-02 E02-03 E02-04 E02-05 E02-06 E02-07 E02-08 E02-09 E02-10
E02-13 E02-14 E02-15 E02-16 E02-24

E03-05 E03-06 E03-07 E03-08 E03-09 E03-12 E03-13 E03-14 E03-15 E03-16 E03-17

E04-01 E04-02 E04-03 E04-04 E04-05 E04-06 E04-07 E04-08 E04-09 E04-10 E04-12 E04-13

E05-01 E05-02 E05-04 E05-06 E05-07 E05-08 E05-09 E05-10 E05-11 E05-12 E05-13

E06-02 E06-03 E06-04 E06-05 E06-06 E06-07 E06-08 E06-11 E06-12 E06-13
E06-14 E06-16 E06-20 E06-21 E06-29

E07-01 E07-02 E07-04 E07-05 E07-06 E07-07 E07-13 E07-16 E07-20

E08-03 E08-06 E08-10 E08-11

E09-04 E09-05 E09-08 E09-09 E09-11

E10-01 E10-02 E10-03 E10-04 E10-06 E10-07 E10-08 E10-12

E12-01 E12-02 E12-04 E12-06 E12-09 E12-10

E13-01 E13-02 E13-03 E13-04 E13-05 E13-06 E13-07 E13-08 E13-09

E14-01 E14-02 E14-03 E14-05 E14-06 E14-07 E14-08 E14-09 E14-11 E14-14

E15-01 E15-02 E15-03 E15-04 E15-05 E15-10

E16-01 E16-02 E16-03 E16-04 E16-05 E16-06 E16-08 E16-09 E16-10 E16-11 E16-15

E17-02 E17-03 E17-04 E17-06 E17-07 E17-08 E17-09 E17-10 E17-11 E17-12 E17-13

E19-01 E19-02 E19-03 E19-04

E20-02 E20-03 E20-04 E20-06 E20-07 E20-10
`.trim().split(/\s+/));

const LINE = /^(\s*-\s*\[[ xX]\]\s*`([A-Z0-9-]+)`\s*)((?:\(risk:\w+\)\s*)?(?:\(owner:\w+\)\s*)?)((?:\(mvp\)\s*)?)(.*)$/;

let added = 0, removed = 0, same = 0, seen = new Set();

for (const f of readdirSync(SRC).filter((x) => x.endsWith('.md'))) {
  const p = join(SRC, f);
  const before = readFileSync(p, 'utf8');
  const out = before.split('\n').map((line) => {
    const m = line.match(LINE);
    if (!m) return line;
    const [, head, id, markers, existing, rest] = m;
    seen.add(id);
    const want = MVP.has(id);
    const has = existing.trim() === '(mvp)';
    if (want === has) { same++; return line; }
    if (want) { added++; return `${head}${markers}(mvp) ${rest}`; }
    removed++;
    return `${head}${markers}${rest}`;
  }).join('\n');
  if (out !== before && !DRY) writeFileSync(p, out);
}

const missing = [...MVP].filter((id) => !seen.has(id));
console.log(`tag-mvp${DRY ? ' (dry run)' : ''}: MVP list has ${MVP.size} ids · +${added} tagged, -${removed} untagged, ${same} unchanged`);
if (missing.length) {
  console.log(`\n  WARNING — ${missing.length} id(s) in the MVP list do not exist in the backlog:`);
  console.log('  ' + missing.join(', '));
}
if (!DRY) console.log('\nNow run: node scripts/build-backlog.mjs');
