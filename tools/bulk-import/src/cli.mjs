#!/usr/bin/env node
// Bulk import of schools, dishes and menus — the 17 August data load.
//
// Usage:
//   node tools/bulk-import/src/cli.mjs [options]
//
//     --schools <file.csv|json>   schools to create or update
//     --dishes  <file.csv|json>   dishes to create or update
//     --menu    <file.csv|json>   menu items and their assignment to schools
//     --apply                     actually write. WITHOUT THIS NOTHING IS WRITTEN
//     --json <path>               also write the plan as JSON
//     --quiet                     suppress the report
//
// The file format is documented in `docs/import-format.md`, with a worked example of each file.
//
// **Dry run is the default and `--apply` is required.** Not a flag to enable safety — a flag to
// disable it. This is run once, by one person, two days before go-live, against data exported
// from Bubble by hand. The same choice `tools/menu-import` makes, for the same reason.
//
// Files are processed in a fixed order — schools, then dishes, then menus — because a menu refers
// to dishes and schools. Passing all three in one run is the intended use: the planner counts
// dishes being created in the same run as existing, so a single file set describing a new school,
// its dishes and its menu plans cleanly.
//
// Exit codes: 0 clean (or a dry run with no problems), 1 something was invalid or unresolved,
//             2 a file could not be read or the database could not be reached.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { parseFile, ParseError } from './parse.mjs';
import { validateSchools, validateDishes, validateMenuItems } from './validate.mjs';
import { planSchools, planDishes, planMenus } from './plan.mjs';
import {
  renderBlockers, renderDishPlan, renderErrors, renderMenuPlan, renderSchoolPlan, renderVerdict,
} from './report.mjs';
import { applyDishes, applyMenus, applySchools, connect, snapshot } from './db.mjs';

const USAGE = `usage: node tools/bulk-import/src/cli.mjs [--schools FILE] [--dishes FILE] [--menu FILE]
                                        [--apply] [--json PATH] [--quiet]

Dry run unless --apply is given. See docs/import-format.md.`;

function parseArgs(argv) {
  const o = { schools: null, dishes: null, menu: null, apply: false, json: null, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--schools': o.schools = argv[++i]; break;
      case '--dishes': o.dishes = argv[++i]; break;
      case '--menu': o.menu = argv[++i]; break;
      case '--apply': o.apply = true; break;
      case '--json': o.json = argv[++i]; break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': o.help = true; break;
      default:
        throw new Error(`unknown option: ${argv[i]}`);
    }
  }
  return o;
}

const say = (options, text) => {
  if (!options.quiet && text) console.log(text);
};

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (cause) {
    console.error(cause.message);
    console.error(USAGE);
    return 2;
  }

  if (options.help || (!options.schools && !options.dishes && !options.menu)) {
    console.log(USAGE);
    return options.help ? 0 : 2;
  }

  // ---- read and validate, before touching the database at all -------------------------------
  //
  // Deliberately first. A malformed file should fail in under a second without a connection,
  // and on an import day the commonest failure by far is the file rather than the database.
  const parsed = {};
  const errors = [];

  for (const [kind, file, validate] of [
    ['schools', options.schools, validateSchools],
    ['dishes', options.dishes, validateDishes],
    ['menu', options.menu, validateMenuItems],
  ]) {
    if (!file) continue;
    let rows;
    try {
      rows = parseFile(file, readFileSync(file, 'utf8'), kind);
    } catch (cause) {
      if (cause instanceof ParseError) {
        console.error(`${file}: ${cause.message}`);
        return 2;
      }
      console.error(`${file}: ${cause.message}`);
      return 2;
    }
    const result = validate(rows);
    parsed[kind] = result.records;
    if (result.errors.length > 0) {
      say(options, renderErrors(result.errors, { label: `${kind} file` }));
      say(options, '');
      errors.push(...result.errors);
    }
  }

  // ---- plan against what exists --------------------------------------------------------------
  let db;
  let snap;
  try {
    db = connect();
    snap = await snapshot(db);
  } catch (cause) {
    console.error(cause.message);
    return 2;
  }

  const blockers = [];
  let changeCount = 0;
  const plans = {};

  if (parsed.schools) {
    plans.schools = planSchools(parsed.schools, snap);
    blockers.push(...plans.schools.blockers);
    changeCount += plans.schools.creates.length + plans.schools.updates.length;
    say(options, renderSchoolPlan(plans.schools));
    say(options, '');
  }

  if (parsed.dishes) {
    plans.dishes = planDishes(parsed.dishes, snap);
    blockers.push(...plans.dishes.blockers);
    changeCount += plans.dishes.creates.length + plans.dishes.updates.length;
    say(options, renderDishPlan(plans.dishes));
    say(options, '');
  }

  if (parsed.menu) {
    // Dishes and schools created earlier in this same run count as existing, so one file set
    // describing a new school, its dishes and its menu does not block on its own first half.
    const withPending = {
      ...snap,
      pendingDishes: plans.dishes?.creates ?? [],
      pendingSchools: plans.schools?.creates ?? [],
    };
    plans.menu = planMenus(parsed.menu, withPending);
    blockers.push(...plans.menu.blockers);
    changeCount += plans.menu.menus.filter((m) => m.changed).length;
    say(options, renderMenuPlan(plans.menu.menus));
    say(options, '');
  }

  if (blockers.length > 0) {
    say(options, renderBlockers(blockers));
    say(options, '');
  }

  if (options.json) {
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, JSON.stringify({ plans, errors, blockers }, null, 2));
  }

  const refused = errors.length > 0 || blockers.length > 0;
  say(options, renderVerdict({
    dryRun: !options.apply,
    errorCount: new Set(errors.map((e) => e.row)).size,
    blockerCount: blockers.length,
    changeCount,
  }));

  if (refused) return 1;
  if (!options.apply || changeCount === 0) return 0;

  // ---- apply ---------------------------------------------------------------------------------
  //
  // Fixed order, because a menu refers to dishes and schools. Not transactional across
  // statements — PostgREST has no such thing — which is survivable only because every write is
  // idempotent on a natural key. A failure part-way is re-run, not unwound.
  try {
    let written = 0;
    if (plans.schools) written += await applySchools(db, plans.schools, snap);
    if (plans.dishes) written += await applyDishes(db, plans.dishes, snap);
    if (plans.menu) {
      // Re-snapshot: schools and dishes created above are referenced by the menu pass, and the
      // snapshot in hand predates them.
      const after = await snapshot(db);
      written += await applyMenus(db, plans.menu.menus, after);
    }
    say(options, '');
    say(options, `Applied. ${written} write(s) made.`);
    return 0;
  } catch (cause) {
    console.error('');
    console.error(`FAILED PART-WAY: ${cause.message}`);
    console.error(
      'Some writes may have landed. Every write this tool makes is idempotent on a natural key ' +
        '(school code, kitchen+dish name, menu+dish), so the fix is to correct the cause and run ' +
        'the same command again — it will update what landed and create what did not. Run without ' +
        '--apply first to see what is left.',
    );
    return 2;
  }
}

const code = await main(process.argv.slice(2));
process.exit(code);
