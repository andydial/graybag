import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **No analytics, telemetry or behavioural tracking may ever touch a child's record.**
 *
 * Andy's rule, 2026-08-11, given as a hard constraint on `E15` and everything after it, to be
 * asserted "somewhere that fails a build, not a comment".
 *
 * ## Why it needed to be a test today, before any analytics exists
 *
 * The rule was already written down — in seven doc comments, across `api/recipients.ts`,
 * `kitchen/lists.ts`, `OrderTargetContext.tsx`, `AccountScreen.tsx`, `ChildrenScreen.tsx` and
 * CLAUDE.md's non-negotiable #4. Every one of them says never log this, never send it to
 * Sentry, never put it in analytics.
 *
 * That is exactly the state `setMenuCache` was in: **named in four doc comments during the
 * entire period in which nothing called it**. Prose is not enforcement. `E15` will add the
 * first real telemetry sink this repo has ever had, and the moment it does, the only thing
 * standing between a child's first name and a third-party analytics vendor would have been
 * whoever wrote that line remembering seven comments in six other files.
 *
 * ## What it asserts
 *
 * For every non-test source in `apps/mobile/src` and `packages/shared/src`: no **telemetry
 * sink** call carries a **child-record field** in its arguments.
 *
 * The scan reads the argument span of each sink call — from the opening parenthesis to its
 * match — rather than the line, so a call broken across lines is covered. Comments are
 * stripped first, for the `setMenuCache` reason above: a scan that counted prose would find
 * violations in the very comments that forbid the thing.
 *
 * ## What it cannot catch, stated plainly
 *
 * A child's value assigned to an innocuously-named variable first:
 *
 *     const label = recipient.firstName;
 *     analytics.track('viewed', { label });   // not caught
 *
 * That needs type-aware dataflow, which a source scan is not. This catches the direct form,
 * which is how it would actually be written by someone who had forgotten the rule — and the
 * indirect form is what code review and `E20-10`'s payload scrubbing are for. Saying so here
 * rather than implying completeness: `check-maestro-ids.mjs` claimed a guarantee it could not
 * make, and that cost a wrong testID shipping green.
 */

const APP_SRC = join(__dirname, '..');
const SHARED_SRC = join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'src');

/**
 * Anything that sends data off the device or into a log.
 *
 * `console.*` is included deliberately. Non-negotiable #4 and `E20-10` forbid a child's data
 * reaching a log line, and a log is where telemetry goes before anyone builds telemetry.
 *
 * **Adding to this list is a visible diff, and adding a sink that is not in it is the failure
 * mode.** When `E15` introduces a vendor, its call surface goes here in the same commit.
 */
export const TELEMETRY_SINKS: readonly string[] = [
  'Sentry\\.\\w+',
  'captureException',
  'captureMessage',
  'addBreadcrumb',
  'setUser',
  'setContext',
  'setTag',
  'analytics\\.\\w+',
  'track',
  'identify',
  'logEvent',
  'recordEvent',
  'posthog\\.\\w+',
  'mixpanel\\.\\w+',
  'amplitude\\.\\w+',
  'console\\.(?:log|info|warn|error|debug|trace)',
];

/**
 * The fields of a child's record. Tier P and tier S under `data-model.md` §13.3 — a name, a
 * class, a section, and health data about a minor.
 *
 * Both spellings, because the API layer speaks camelCase and PostgREST speaks snake_case, and
 * a rule that only knew one of them would be half a rule.
 */
export const CHILD_RECORD_FIELDS: readonly string[] = [
  'firstName',
  'lastName',
  'classLabel',
  'sectionLabel',
  'allergyNote',
  'allergenIds',
  'displayName',
  'first_name',
  'last_name',
  'class_label',
  'section_label',
  'allergy_note',
  'allergen_ids',
];

export interface Violation {
  path: string;
  sink: string;
  field: string;
  excerpt: string;
}

/** Comments out before scanning — see the note above. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

/**
 * The argument span of a call beginning at `open`: to the matching close paren, or 600
 * characters, whichever comes first. The cap keeps one unbalanced paren in a template literal
 * from swallowing the rest of the file and reporting every field in it.
 */
function argumentSpan(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < Math.min(code.length, open + 600); i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return code.slice(open, open + 600);
}

/**
 * The check itself, as a pure function over sources.
 *
 * Pure and exported so the fixtures below can prove it catches a violation. A guard whose only
 * evidence is "the real tree passes" is a guard that would pass just as happily with its
 * pattern list empty — which is the whole failure this file exists to prevent.
 */
export function childDataInTelemetry(
  sources: readonly { path: string; code: string }[],
): Violation[] {
  const found: Violation[] = [];
  const sinkPattern = new RegExp(`(?<![.\\w])(${TELEMETRY_SINKS.join('|')})\\s*\\(`, 'g');

  for (const { path, code } of sources) {
    const clean = stripComments(code);
    for (const match of clean.matchAll(sinkPattern)) {
      const open = clean.indexOf('(', match.index + match[0].length - 1);
      if (open === -1) continue;
      const span = argumentSpan(clean, open);
      for (const field of CHILD_RECORD_FIELDS) {
        if (new RegExp(`(?<![\\w])${field}(?![\\w])`).test(span)) {
          found.push({
            path,
            sink: match[1] ?? match[0],
            field,
            excerpt: span.replace(/\s+/g, ' ').slice(0, 120),
          });
        }
      }
    }
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (
      /\.tsx?$/.test(entry) &&
      !/\.test\.tsx?$/.test(entry) &&
      // Generated from `docs/`, and the policy text legitimately contains the words.
      !/\.generated\./.test(entry)
    ) {
      out.push(path);
    }
  }
  return out;
}

const sources = [...walk(APP_SRC), ...walk(SHARED_SRC)].map((path) => ({
  path,
  code: readFileSync(path, 'utf8'),
}));

describe("no telemetry may carry a child's record", () => {
  it('scans a tree that actually has sources in it', () => {
    // A walk that silently returned nothing would make every assertion below vacuous — the
    // shape of failure this whole file is about.
    expect(sources.length).toBeGreaterThan(40);
  });

  it('finds no child-record field in any telemetry call', () => {
    const violations = childDataInTelemetry(sources);
    const detail = violations
      .map((v) => `  ${v.path}\n    ${v.sink}(…${v.field}…)\n    ${v.excerpt}`)
      .join('\n');
    expect(
      violations.length === 0
        ? ''
        : `A child's personal data reaches telemetry in ${violations.length} place(s).\n` +
            `This is tier P/S data about a minor under DPDP (non-negotiable #4) and must never\n` +
            `leave the device in a log, a breadcrumb or an analytics event.\n\n${detail}`,
    ).toBe('');
  });

  /**
   * The guard proving itself. Without these, an empty pattern list would pass the assertion
   * above and the rule would be enforcement-shaped prose — which is what it was until today.
   */
  describe('it actually catches things', () => {
    const scan = (code: string) => childDataInTelemetry([{ path: 'fixture.ts', code }]);

    it('catches a name in an analytics event', () => {
      expect(scan(`analytics.track('added', { name: child.firstName });`)).toHaveLength(1);
    });

    it('catches allergy data in a Sentry breadcrumb — tier S, the worst case', () => {
      expect(scan(`Sentry.addBreadcrumb({ data: { allergyNote } });`)).toHaveLength(1);
    });

    it('catches a class and section in a log line', () => {
      expect(scan(`console.warn('recipient', classLabel, sectionLabel);`)).toHaveLength(2);
    });

    it('catches a call broken across lines, which a line-based scan would not', () => {
      expect(
        scan(`logEvent(\n  'recipient_added',\n  {\n    school: schoolId,\n    first_name: name,\n  },\n);`),
      ).toHaveLength(1);
    });

    it('does not fire on telemetry that carries no child data', () => {
      expect(scan(`console.error('menu failed', schoolId, error.code);`)).toHaveLength(0);
    });

    it('does not fire on a child field that goes nowhere near a sink', () => {
      expect(scan(`const label = recipient.firstName; setTitle(label);`)).toHaveLength(0);
    });

    it('does not read the doc comments that forbid it as violations of it', () => {
      // Seven files say "never send firstName to Sentry" in prose. A scan that counted
      // comments would report all seven and be turned off within a day.
      expect(
        scan(`// Never pass firstName to Sentry.captureMessage(firstName) — see DPDP.\nconst x = 1;`),
      ).toHaveLength(0);
    });
  });

  /**
   * The lists must not quietly shrink. Deleting a sink or a field is how this guard would be
   * made to pass without the code being fixed, and it is a one-line change in a large diff.
   */
  it('keeps its sink and field lists intact', () => {
    expect(TELEMETRY_SINKS).toHaveLength(16);
    expect(CHILD_RECORD_FIELDS).toHaveLength(13);
  });
});
