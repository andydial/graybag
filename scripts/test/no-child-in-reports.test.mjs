/**
 * No child's name reaches a report, an export or an aggregate — `E02-37`.
 *
 *   node --test scripts/test/no-child-in-reports.test.mjs
 *
 * Andy: *"no child's name may appear in any report, export or aggregate."*
 *
 * ## Why this is a source test and not a data test
 *
 * A test that reads a report and looks for names proves one report on one day's data. This asserts
 * the mechanism instead: **every reporting query names its columns explicitly, and none of those
 * lists contains a child field.** That is the control the reporting modules already claim to rely
 * on — `REPORT_ORDER_COLUMNS` says so in its own header — and asserting the claim is what stops
 * the next person widening a `select` in a hurry.
 *
 * It runs with no database, on every push, which is the point: this is the guarantee most likely
 * to be broken by an ordinary-looking edit, so it must be checked by the fast suite rather than
 * the nightly one.
 *
 * ## What counts as a child field
 *
 * The three snapshot columns plus the recipient table itself. `recipient_id` is deliberately in
 * the list: an id is not a name, but a report carrying one is a join away from being a report
 * carrying a name, and there is no reporting question that needs it.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Anything that names, or leads directly to, a child. */
const CHILD_FIELDS = [
  'recipient_name_snapshot',
  'class_label_snapshot',
  'section_label_snapshot',
  'recipient_id',
  'allergy_note',
];

/**
 * The modules that produce a report, an export or an aggregate.
 *
 * Listed rather than globbed: a glob silently covers a new file and silently stops covering a
 * renamed one, and this is a guarantee that should break loudly when the shape of the code moves.
 */
const REPORTING_SOURCES = [
  'packages/shared/src/api/admin-reports.ts',
  'packages/shared/src/api/admin-growth.ts',
  'supabase/functions/_shared/order-alert.ts',
  'supabase/functions/ops-heartbeat/index.ts',
];

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Everything inside a `select('…')` or a `COLUMNS = '…'`, which is what PostgREST is handed. */
function columnLists(source) {
  const lists = [];
  for (const m of source.matchAll(/\.select\(\s*([`'"])([\s\S]*?)\1/g)) lists.push(m[2]);
  for (const m of source.matchAll(/COLUMNS\s*=\s*([\s\S]*?);/g)) lists.push(m[1]);
  return lists;
}

describe('no child reaches a report, an export or an aggregate', () => {
  for (const rel of REPORTING_SOURCES) {
    test(`${rel} selects no child field`, () => {
      const source = read(rel);
      const lists = columnLists(source);
      assert.ok(lists.length > 0, `no column list found in ${rel} — the parser has drifted from the code`);

      for (const list of lists) {
        /*
         * One exception, and only one — `guardian_link`.
         *
         * That table is nothing but two foreign keys, so its `recipient_id` is structural: the
         * funnel cannot count "parents who added a child" without joining a parent to a child.
         * It is used to count and is never rendered — `GrowthChild` is `{id, schoolId, createdAt}`
         * and has nowhere to put a name.
         *
         * The rule still bites everywhere it matters. `recipient_id` on `order` stays forbidden,
         * because there it sits beside a name, a class and a price, and that is the row that ends
         * up in a screenshot.
         */
        if (list.includes('user_id') && list.includes('recipient_id') && list.split(',').length === 2) continue;

        for (const field of CHILD_FIELDS) {
          assert.ok(
            !list.includes(field),
            `${rel} selects ${field}. A report is aggregate by definition, and a child's name in ` +
              `a query is one screenshot, one CSV or one console.log away from a school's inbox.`,
          );
        }
      }
    });
  }

  test('the growth report reads three columns from recipient and no more', () => {
    // The narrowest list in the codebase, and the reason the funnel can count children without
    // being able to name one. Asserted by value: a widening should be a visible diff here.
    const source = read('packages/shared/src/api/admin-growth.ts');
    const match = /GROWTH_CHILD_COLUMNS\s*=\s*'([^']+)'/.exec(source);
    assert.ok(match, 'GROWTH_CHILD_COLUMNS has been renamed or removed');
    assert.deepEqual(match[1].split(','), ['id', 'school_id', 'created_at']);
  });

  test('every report page says so on the screen', () => {
    // The promise is worth making out loud: somebody reading the page should know the absence is
    // deliberate rather than an oversight they might helpfully fix.
    const pages = ['apps/web/src/pages/reports.astro', 'apps/web/src/pages/admin/sales.astro'];
    for (const page of pages) {
      const source = read(page);
      assert.match(
        source, /no recipient, class or section|No child appears|child'?.s name/i,
        `${page} does not state that no child appears on it`,
      );
    }
  });

  test('the CSV export, when it exists, is built from the same rows', () => {
    // A placeholder that will start meaning something the moment an export lands. Named here so
    // whoever writes it finds this test rather than inventing a second query.
    const files = readdirSync(join(ROOT, 'apps/web/src/lib/admin'));
    const exporters = files.filter((f) => /csv|export/i.test(f));
    for (const f of exporters) {
      const source = read(`apps/web/src/lib/admin/${f}`);
      for (const field of CHILD_FIELDS) {
        assert.ok(!source.includes(field), `apps/web/src/lib/admin/${f} references ${field}`);
      }
    }
  });
});
