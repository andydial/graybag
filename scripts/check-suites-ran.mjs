#!/usr/bin/env node
/**
 * Every test suite must have actually run something — `E15-23`.
 *
 *     node scripts/check-suites-ran.mjs
 *
 * Andy: *"A suite reporting 'ran nothing' that looks identical to 'passed' has hidden three
 * outages this month. That belongs in CI, not in one suite."*
 *
 * ## The failure
 *
 * `node --test` on a glob that matches nothing exits **0** and prints `# tests 0`. `vitest` with
 * `--passWithNoTests` — which this repo uses, deliberately, so a package without tests does not
 * fail the build — does the same. Both are indistinguishable from a green run at the exit code,
 * which is the only thing CI looks at.
 *
 * That is how `authorization.test.sql` contributed **zero assertions** on 2026-08-08 while the
 * pipeline stayed green, and how `kitchen-scope.test.mjs` reported `tests 0, pass 0, fail 0` on
 * the day it was written. The integration workflow already guards the pgTAP suite for exactly
 * this reason. This generalises that guard to every other suite.
 *
 * ## What it does
 *
 * Runs each suite, reads the count out of its own output, and fails if the count is below a floor
 * recorded here. A floor rather than "greater than zero", because the interesting regression is
 * not usually a suite vanishing entirely — it is a **glob quietly matching fewer files** after a
 * rename, which takes the count from 180 to 12 and looks perfectly healthy.
 *
 * The floors are set below the current counts with a little slack, so ordinary work does not trip
 * them and deleting a file's worth of tests does. When a floor legitimately needs lowering, that
 * is a visible diff with a reason in the commit — which is the whole point.
 *
 * ## Floors need raising as well as defending — `E10-53`
 *
 * A floor is only worth what the gap between it and reality is small. The web suite was written
 * with a floor of 100 when it held 388 tests; by the time it held **455**, that floor would have
 * let three quarters of the suite disappear without a word. A guard nobody maintains degrades into
 * a guard that only catches the total collapse it was never really about — and the failure it *was*
 * about, a glob quietly matching fewer files after a rename, is exactly the middling loss a stale
 * floor sleeps through.
 *
 * So: **raise these when a suite grows meaningfully**, in the commit that grew it, to roughly 90%
 * of the new count. Slack enough that deleting one obsolete test does not fail the build; tight
 * enough that deleting a file does.
 *
 * | | floor | actual, 2026-08-27 |
 * |---|---|---|
 * | scripts | 170 | 182 |
 * | mobile plugins | 20 | 25 |
 * | shared | 950 | 1009 |
 * | web | 420 | 455 |
 */
import { execSync } from 'node:child_process';

const SUITES = [
  {
    name: 'scripts',
    command: 'npm run --silent test:scripts',
    /** `# tests 180` at the end of a TAP run. */
    parse: (out) => Number(/^# tests (\d+)$/m.exec(out)?.[1] ?? -1),
    floor: 170,
  },
  {
    name: 'mobile plugins',
    command: 'npm run --silent test:plugins',
    parse: (out) => Number(/^# tests (\d+)$/m.exec(out)?.[1] ?? -1),
    floor: 20,
  },
  {
    name: 'shared package (vitest)',
    // `--passWithNoTests` is set in the workspace script and is exactly what makes this check
    // necessary: without a floor, a broken include pattern is a silent green.
    // The default reporter. `--reporter=basic` is not valid in this vitest version and made the
    // command fail, which this guard then reported as "could not find a test count" — correctly,
    // and it is worth noting that the guard caught its own misconfiguration.
    command: 'npm --prefix packages/shared run --silent test',
    parse: (out) => {
      // vitest: "Tests  925 passed (925)" — take the total in brackets, which counts skips too.
      const m = /Tests\s+.*?\((\d+)\)/.exec(out);
      return Number(m?.[1] ?? -1);
    },
    floor: 950,
  },
  {
    name: 'web app (vitest)',
    command: 'npm --prefix apps/web run --silent test',
    parse: (out) => Number(/Tests\s+.*?\((\d+)\)/.exec(out)?.[1] ?? -1),
    floor: 420,
  },
];

let failed = false;
const report = [];

for (const suite of SUITES) {
  let output = '';
  let ran = true;
  try {
    output = execSync(suite.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // A failing suite is not this script's business — `npm test` already fails the build for
    // that. What matters here is whether it *ran*, so the output is still parsed.
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    ran = false;
  }

  const count = suite.parse(output);

  if (count < 0) {
    report.push(`  ✗ ${suite.name}: could not find a test count in the output.`);
    report.push(`      The reporter has changed shape, so this guard is no longer guarding.`);
    failed = true;
    continue;
  }

  if (count < suite.floor) {
    report.push(`  ✗ ${suite.name}: ${count} tests, floor is ${suite.floor}.`);
    report.push(
      `      Either a glob stopped matching files, or tests were deleted. Both look identical`,
    );
    report.push(`      to a green run at the exit code, which is why this check exists.`);
    failed = true;
    continue;
  }

  report.push(`  ✓ ${suite.name}: ${count} tests${ran ? '' : ' (suite failed, but it did run)'}`);
}

console.log('Suites that actually ran:');
for (const line of report) console.log(line);

if (failed) {
  console.error(
    '\nA suite ran fewer tests than its floor. "Ran nothing" and "passed" must never look the\n' +
      'same — that is the failure that hid three outages this month (E15-23).\n' +
      'If the drop is legitimate, lower the floor in scripts/check-suites-ran.mjs in the same\n' +
      'commit, so the decision is visible in the diff.',
  );
  process.exit(1);
}

console.log('\nEvery suite ran at least its floor.');
