#!/usr/bin/env node
/**
 * `platform_config`'s seller identity, derived from `docs/legal/company.json`. `E07-24`.
 *
 *   SUPABASE_DB_URL=… node scripts/sync-seller-identity.mjs [--check]
 *
 * # Why this exists
 *
 * A tax invoice went to a real inbox reading:
 *
 *     Supplier: «GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»
 *     GSTIN:    «GRAYBAG-GSTIN-PENDING-E00-10»
 *
 * The facts existed and were published — the web thread had cleared them into
 * `docs/legal/company.json` the same day. The invoice renderer read `platform_config`, which
 * nobody had updated, because **the entity facts lived in two places and only one of them was
 * maintained.**
 *
 * So this makes the database a *derivative* of the file rather than a second copy of it. The file
 * is the source; `platform_config` is a snapshot of it that the invoice issuer reads inside a
 * transaction. `--check` fails when they disagree, which is what a deploy runs.
 *
 * # `null` is never substituted
 *
 * `company.json`'s own comment: *"null means genuinely unknown. It is never substituted, so its
 * «TOKEN» survives into the rendered document."* This honours that — a null leaves whatever is in
 * the column, and the token guard in `order-confirmation.ts` is what stops the result being sent.
 * Writing "null" or an empty string here would turn an unknown into a known, which is the one
 * thing the placeholder system exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const company = JSON.parse(readFileSync(join(ROOT, 'docs/legal/company.json'), 'utf8'));

const dbUrl = process.env.SUPABASE_DB_URL ?? '';
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set.');
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');

/**
 * The mapping, stated once. Column ← file key.
 *
 * `sac_code` is deliberately absent and that is a finding rather than an omission: the database
 * holds `996331` and `company.json` holds `null`. One of them is wrong and it is not this
 * script's business to decide which — see the warning below.
 */
const FIELDS = [
  ['seller_legal_name', 'legalName'],
  ['seller_address', 'registeredAddress'],
  ['seller_gstin', 'gstin'],
];

const psql = (sql) =>
  execFileSync('psql', [dbUrl, '-tAc', sql], { encoding: 'utf8' }).trim();

const current = Object.fromEntries(
  FIELDS.map(([column]) => [column, psql(`select coalesce(${column}, '') from platform_config limit 1;`)]),
);

const differences = [];
for (const [column, key] of FIELDS) {
  const wanted = company[key];
  if (wanted === null || wanted === undefined) continue; // genuinely unknown — never substituted
  if (current[column] !== wanted) differences.push({ column, from: current[column], to: wanted });
}

if (differences.length === 0) {
  console.log('sync-seller-identity: platform_config already matches docs/legal/company.json');
} else if (checkOnly) {
  console.error('\nsync-seller-identity: platform_config DISAGREES with docs/legal/company.json\n');
  for (const d of differences) {
    console.error(`  ${d.column}\n    db:   ${d.from || '(empty)'}\n    file: ${d.to}\n`);
  }
  console.error('  docs/legal/company.json is the source. Run this script without --check.\n');
  process.exit(1);
} else {
  for (const d of differences) {
    psql(
      `update platform_config set ${d.column} = ${quote(d.to)}, updated_at = now() where true;`,
    );
    console.log(`  ${d.column}: ${d.from || '(empty)'} → ${d.to}`);
  }
  console.log(`sync-seller-identity: updated ${differences.length} field(s) from docs/legal/company.json`);
}

/**
 * **The divergence this script will not resolve on its own.**
 *
 * `company.json` says `sacCode: null` — genuinely unknown — while `platform_config.sac_code`
 * holds `996331`, which somebody entered without recording where it came from. A SAC on a tax
 * invoice is a statutory particular (Rule 46(f)); an invented one is worse than a token, because
 * a token is visibly unfinished and a plausible number is not.
 *
 * Reported every run rather than fixed, because deciding it is `E00-10`'s accountant question.
 */
const sac = psql(`select coalesce(sac_code, '') from platform_config limit 1;`);
if (company.sacCode === null && sac !== '') {
  console.warn(
    `\n  WARNING: sac_code is "${sac}" in the database and null in docs/legal/company.json.\n` +
      '  Two sources disagree about a statutory particular. E00-10 decides which is right;\n' +
      '  until then the invoice prints a number nobody has attributed.\n',
  );
}

/** Single-quote for SQL. The values are a company name and an address, not user input. */
function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
