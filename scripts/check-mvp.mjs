#!/usr/bin/env node
// Verifies that the MVP include list and the backlog markdown agree.
//
//   node scripts/check-mvp.mjs
//
// **This script does not write anything.** It replaced `tag-mvp.mjs`, which rewrote the markdown
// from the include list — and that is precisely how four tasks nearly left v1 without anyone
// deciding to remove them.
//
// `E03-20`, `E05-16`, `E05-20` and `E05-21` carried `(mvp)` in the markdown and were absent from
// the list. Running the old script would have **stripped** all four: an app that re-OTPs on every
// cold start, and three hard blockers on placing an order at all. Nothing would have failed, no
// diff would have looked alarming, and v1 would quietly have been four tasks smaller. Scope
// resolved as "whoever ran the script last wins", which is not a process.
//
// So the list stays the single authority and stays edited by hand, on purpose, in one place —
// and this script's whole job is to shout when the two disagree. Widening MVP is still a
// deliberate act. It can no longer be an accidental one.
//
// Wired into `npm run smoke`, so CI fails on any disagreement.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'planning', 'backlog');

// EXPLICIT INCLUDE LIST. Anything not named here is fast-follow, including any task added later.
// That is deliberate: the backlog grows on every review pass, and an exclude-list default is how
// a 161-task MVP became 288.
//
// To put something in v1 you must add its id here, on purpose.
// Scope and reasoning: docs/mvp-scope.md
//
// **E21 was carried across the tooling migration, not newly admitted.** Those twenty ids were in
// `scripts/tag-mvp.mjs` — the include list this file replaced — on the `ux-spec-and-prototype`
// branch, which is where the screen-design epic was created. This file was written on `main`,
// where E21 did not exist, so its list could not name them; the two lists then met at the merge.
//
// Called out because the rule is that nobody adds an id here on their own judgement. This is not
// that: it is the same twenty ids, in the same v1, moved from a list that was deleted into the
// list that replaced it. If they should not be in v1, that is a deliberate removal, taken here.
//
// **Nothing else may go in this list without Andy.** Note the comment must live out here rather
// than inside the template literal below — that string is split on whitespace, so a comment
// inside it becomes forty fast-follow "task ids" named `//`, `the` and `epic.`
export const MVP = new Set(`
E00-01 E00-02 E00-03 E00-04 E00-05 E00-12 E00-13 E00-14 E00-15 E00-18

E01-00 E01-01 E01-02 E01-04 E01-05 E01-06 E01-07 E01-08 E01-10 E01-13 E01-14

E02-01 E02-02 E02-03 E02-04 E02-05 E02-06 E02-07 E02-08 E02-09 E02-10
E02-13 E02-14 E02-15 E02-16 E02-24

E03-05 E03-06 E03-07 E03-08 E03-09 E03-12 E03-13 E03-14 E03-15 E03-16 E03-17
E03-20

E04-01 E04-02 E04-03 E04-04 E04-05 E04-06 E04-07 E04-08 E04-09 E04-10 E04-12 E04-13
E04-14 E04-15 E04-16 E04-17 E04-19 E04-20

E05-01 E05-02 E05-04 E05-06 E05-07 E05-08 E05-09 E05-10 E05-11 E05-12 E05-13
E05-16 E05-20 E05-21

E06-02 E06-03 E06-04 E06-05 E06-06 E06-07 E06-08 E06-11 E06-12 E06-13 E06-36
E06-14 E06-16 E06-20 E06-21 E06-29

E07-01 E07-02 E07-04 E07-05 E07-06 E07-07 E07-13 E07-16 E07-20

E08-03 E08-06 E08-10 E08-11

E09-04 E09-05 E09-08 E09-09 E09-11 E09-17 E09-33

E10-01 E10-02 E10-03 E10-04 E10-06 E10-07 E10-08 E10-10 E10-12 E10-21 E10-33

E12-01 E12-02 E12-04 E12-06 E12-09 E12-10

E13-01 E13-02 E13-03 E13-04 E13-05 E13-06 E13-07 E13-08 E13-09

E14-01 E14-02 E14-03 E14-05 E14-06 E14-07 E14-08 E14-09 E14-11 E14-14

E15-01 E15-02 E15-03 E15-04 E15-05 E15-10

E16-01 E16-02 E16-03 E16-04 E16-05 E16-06 E16-08 E16-09 E16-10 E16-11 E16-15

E17-02 E17-03 E17-04 E17-06 E17-07 E17-08 E17-09 E17-10 E17-11 E17-12 E17-13

E19-01 E19-02 E19-03 E19-04

E20-02 E20-03 E20-04 E20-06 E20-07 E20-10

E21-01 E21-02 E21-03 E21-04 E21-05 E21-06 E21-07 E21-08 E21-09 E21-10
E21-11 E21-12 E21-13 E21-14 E21-15 E21-16 E21-17 E21-18 E21-19 E21-20
`.trim().split(/\s+/));

/**
 * A backlog task line, split into its id, its markers and its description.
 *
 * **The markers are only the parenthesised run immediately after the id**, and that boundary is
 * load-bearing rather than tidy. `E01-25`'s description contains the literal string `(mvp)` —
 * it is a task *about* the mvp marker — so a check that searched the whole line for `(mvp)`
 * reports it as tagged. That false positive is not hypothetical: it happened while writing this,
 * with a one-line `.includes('(mvp)')` check.
 */
const TASK = /^\s*-\s*\[[ xX]\]\s*`([A-Z]\d{2}-\d{2})`\s*((?:\([a-z]+(?::[a-z]+)?\)\s*)*)(.*)$/;

export function parseTask(line) {
  const m = line.match(TASK);
  if (!m) return null;
  const [, id, markerRun, description] = m;
  const markers = markerRun.trim().split(/\s+/).filter(Boolean);
  return { id, markers, description, isMvp: markers.includes('(mvp)') };
}

export function readBacklog(dir) {
  const tasks = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const task = parseTask(line);
      if (task) tasks.push({ ...task, file, line: i + 1 });
    });
  }
  return tasks;
}

/**
 * The four ways this can be wrong. Each names both sides, because either may be wrong.
 *
 * **`duplicated` is here because its absence hid a real bug.** Two different tasks both carried
 * `E09-11`, and every lookup in this file keyed tasks by id — so the second silently replaced the
 * first, the genuinely-MVP task looked untagged, and the "fix" was to tag the wrong task. An id
 * collision makes every other check in here unsound, which is why it is reported first and why
 * ids being permanent is not the same as ids being unique unless something checks.
 */
export function findDisagreements(tasks, mvp) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const counts = new Map();
  for (const t of tasks) counts.set(t.id, [...(counts.get(t.id) ?? []), t]);
  const duplicated = [...counts.values()].filter((group) => group.length > 1);

  return {
    duplicated,
    taggedNotListed: tasks.filter((t) => t.isMvp && !mvp.has(t.id)),
    listedNotTagged: [...mvp].filter((id) => byId.has(id) && !byId.get(id).isMvp).map((id) => byId.get(id)),
    listedNotFound: [...mvp].filter((id) => !byId.has(id)),
  };
}

// --------------------------------------------------------------------------- run

if (import.meta.url === `file://${process.argv[1]}`) {
  const tasks = readBacklog(SRC);
  const { duplicated, taggedNotListed, listedNotTagged, listedNotFound } = findDisagreements(tasks, MVP);
  const total = duplicated.length + taggedNotListed.length + listedNotTagged.length + listedNotFound.length;

  if (total === 0) {
    console.log(`check-mvp: ${MVP.size} ids in the list, ${tasks.length} tasks in the backlog, no disagreements.`);
    process.exit(0);
  }

  console.error(`check-mvp: ${total} disagreement(s) between scripts/check-mvp.mjs and planning/backlog/.\n`);

  if (duplicated.length) {
    console.error(`  The same id used by more than one task — ${duplicated.length}:`);
    for (const group of duplicated) {
      console.error(`    ${group[0].id}`);
      for (const t of group) console.error(`      ${t.file}:${t.line}  ${t.description.slice(0, 60)}`);
    }
    console.error('    Ids are permanent, so the LATER task takes a new one. Every other check');
    console.error('    here keys by id and is unsound until this is resolved.\n');
  }

  if (taggedNotListed.length) {
    console.error(`  Tagged (mvp) in the markdown but NOT in the include list — ${taggedNotListed.length}:`);
    for (const t of taggedNotListed) console.error(`    ${t.id}  ${t.file}:${t.line}`);
    console.error('    Either they belong in v1 — add the id to MVP above — or the marker is wrong.');
    console.error('    This is the direction that used to silently DROP tasks from v1.\n');
  }

  if (listedNotTagged.length) {
    console.error(`  In the include list but NOT tagged (mvp) in the markdown — ${listedNotTagged.length}:`);
    for (const t of listedNotTagged) console.error(`    ${t.id}  ${t.file}:${t.line}`);
    console.error('    Add `(mvp)` after the id, or remove the id from the list.\n');
  }

  if (listedNotFound.length) {
    console.error(`  In the include list but NO SUCH TASK exists — ${listedNotFound.length}:`);
    for (const id of listedNotFound) console.error(`    ${id}`);
    console.error('    A renumbered or deleted task. Ids are permanent, so this is a typo or a removal.\n');
  }

  console.error('Nothing was written. Widening or narrowing v1 is a deliberate edit, in one place.');
  process.exit(1);
}
