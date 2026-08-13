#!/usr/bin/env node
// Two-way sync between backlog-state.json (what the HTML page writes) and the
// [ ] / [x] checkboxes in backlog/*.md. `[~]` (struck — decided against) is deliberately NOT
// matched by LINE below: a struck task is a decision recorded in the markdown, and neither a
// tick in the browser nor a pass of this script may quietly turn "we decided not to" into
// "we did".
//
//   node scripts/sync-state.mjs pull   # backlog-state.json -> markdown checkboxes
//   node scripts/sync-state.mjs push   # markdown checkboxes -> backlog-state.json
//   node scripts/sync-state.mjs        # same as pull, then push (union wins)

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'planning', 'backlog');
const STATE = join(ROOT, 'planning', 'backlog-state.json');
// Flags may appear in any position; the mode is the first non-flag argument.
// (Before this, `sync-state.mjs --andy` parsed "--andy" as the mode and silently
// did neither the push nor the pull — it looked like it worked and changed nothing.)
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mode = positional[0] || 'both';
if (!['pull', 'push', 'both'].includes(mode)) {
  console.error(`sync-state: unknown mode "${mode}" — expected pull, push or both.`);
  process.exit(1);
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.md'));
const LINE = /^(\s*-\s*\[)([ xX])(\]\s*`([A-Z0-9-]+)`)/;
const ALLOW_ANDY = process.argv.includes('--andy');

// Task ids Claude Code must never mark done on its own.
const andyOwned = new Set();
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.md'))) {
  for (const line of readFileSync(join(SRC, f), 'utf8').split('\n')) {
    const m = line.match(/`([A-Z0-9-]+)`[^\n]*\(owner:andy\)/);
    if (m) andyOwned.add(m[1]);
  }
}

let done = {};
if (existsSync(STATE)) {
  try { done = JSON.parse(readFileSync(STATE, 'utf8')).done || {}; } catch { done = {}; }
}

// What was already on the record before this run. An owner:andy task that Andy has
// already closed stays closed — the guard below exists to stop Claude Code closing
// one, not to reopen one every time the script runs without --andy.
const alreadyDone = new Set(Object.keys(done));

// push: markdown -> state
if (mode === 'push' || mode === 'both') {
  for (const f of files) {
    for (const line of readFileSync(join(SRC, f), 'utf8').split('\n')) {
      const m = line.match(LINE);
      if (m && m[2].toLowerCase() === 'x') done[m[4]] = true;
    }
  }
}

// Refuse to tick Andy-owned tasks unless explicitly told to (i.e. Andy said so).
const blocked = [];
if (!ALLOW_ANDY) {
  for (const id of Object.keys(done)) {
    if (andyOwned.has(id) && !alreadyDone.has(id)) { delete done[id]; blocked.push(id); }
  }
}

// pull: state -> markdown
let changed = 0;
if (mode === 'pull' || mode === 'both') {
  for (const f of files) {
    const p = join(SRC, f);
    const out = readFileSync(p, 'utf8').split('\n').map((line) => {
      const m = line.match(LINE);
      if (!m) return line;
      const want = done[m[4]] ? 'x' : ' ';
      if (m[2].toLowerCase() === want.trim().toLowerCase() || (m[2] === ' ' && want === ' ')) return line;
      changed++;
      return line.replace(LINE, `$1${want}$3`);
    }).join('\n');
    writeFileSync(p, out);
  }
}

writeFileSync(STATE, JSON.stringify({ updated: new Date().toISOString(), done }, null, 2) + '\n');
console.log(`sync-state (${mode}): ${Object.keys(done).length} tasks marked done, ${changed} markdown lines updated.`);
if (blocked.length) {
  console.log(`\n  REFUSED to tick ${blocked.length} owner:andy task(s): ${blocked.join(', ')}`);
  console.log(`  These are Andy's decisions/validations. Only he closes them.`);
  console.log(`  If Andy confirmed them himself, re-run with --andy.\n`);
}
