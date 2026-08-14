#!/usr/bin/env node
/**
 * Every unresolved `«…-PENDING-…»` token on a surface we publish — `docs/placeholder-register.md`.
 *
 * ## Why this exists rather than a grep
 *
 * A bare grep for `«…»` across the repository returns 33 hits and is useless: most are the token
 * *convention* being described in prose, superseded drafts kept as history, or test fixtures
 * proving the guard works. A list nobody trusts is a list nobody finishes.
 *
 * This counts only documents that reach a reader, and separates the ones that block a production
 * build from the ones that will when their surface is wired up.
 *
 * ## What it does not do
 *
 * It does not fail. `assertPublishable` already fails a production build of the website, which is
 * the control that matters; this is the register, and a register that exits non-zero on every run
 * until launch is one people stop reading.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `«ANYTHING-PENDING-E20-01»`. The `…` forms are prose describing the convention. */
const TOKEN = /«[^»…]*PENDING[^»…]*»/g;

const SURFACES = [
  {
    file: 'docs/terms.md',
    what: 'Terms of service — /terms, and the app policy gate',
    blocking: true,
  },
  {
    file: 'docs/privacy-policy.md',
    what: 'Privacy policy — /privacy, and the app policy gate',
    blocking: true,
  },
  {
    file: 'docs/refund-policy.md',
    what: 'Refund policy — /refunds, and the app policy gate',
    blocking: true,
  },
  {
    file: 'docs/gst-invoicing.md',
    what: 'GST invoices emailed to parents',
    blocking: false,
    note: 'Will block once E07 renders invoices from this file (E12-24).',
  },
  {
    file: 'docs/dpdp-compliance.md',
    what: "The app's grievance block (Settings → Privacy)",
    blocking: false,
    note: 'Three of these are already answered in the published privacy policy §7A.',
  },
  {
    file: 'docs/store-submission.md',
    what: 'Play Store and App Store listings',
    blocking: false,
    note: 'Submitted by hand, so nothing can fail a build on it.',
  },
];

let blocking = 0;
let pendingElsewhere = 0;

console.log('Placeholders on surfaces we publish — docs/placeholder-register.md\n');

for (const surface of SURFACES) {
  const text = readFileSync(join(ROOT, surface.file), 'utf8');
  const tokens = [...new Set(text.match(TOKEN) ?? [])].sort();

  if (surface.blocking) blocking += tokens.length;
  else pendingElsewhere += tokens.length;

  const label = tokens.length === 0 ? 'clear' : `${tokens.length}`;
  console.log(`  ${surface.blocking ? '[blocks build]' : '[not yet     ]'} ${label.padStart(5)}  ${surface.file}`);
  console.log(`                          ${surface.what}`);
  if (surface.note && tokens.length > 0) console.log(`                          ${surface.note}`);
  for (const token of tokens) {
    // The line number, so filling them in does not start with a search.
    const line = text.split('\n').findIndex((l) => l.includes(token)) + 1;
    console.log(`                            ${String(line).padStart(4)}  ${token}`);
  }
  console.log('');
}

console.log(
  `${blocking} token(s) block a production build; ${pendingElsewhere} more on surfaces that ` +
    `will publish but are not built yet.`,
);
if (blocking > 0) {
  console.log(
    '\nA production build already refuses these — PUBLIC_SITE_STAGE=production npm run build:web.',
  );
}
