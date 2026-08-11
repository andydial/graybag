import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts/check-outbound-claims.mjs');
const LISTING = join(ROOT, 'docs/store-submission.md');

/**
 * `check-outbound-claims` — Andy's standing rule, 2026-08-11.
 *
 * The check exists because the App Store listing claimed *"GrayBag currently serves schools in
 * Chandigarh, SAS Nagar (Mohali) and Panchkula"* when two of those had no school, no kitchen and
 * no menu. So **the test that matters is the one that puts that exact sentence back and proves
 * the check refuses it.** A guard against a specific past mistake that has never been shown to
 * catch that mistake is a guard nobody should trust.
 *
 * It runs the real script against the real repository rather than a fixture, because what is
 * being asserted is a property of this repository's actual outbound copy — a fixture would
 * prove the regex works and nothing about whether the store listing is honest today.
 */
const run = () => {
  try {
    execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
};

test('the outbound copy in this repo claims no city we do not serve', () => {
  const result = run();
  assert.equal(result.ok, true, `check-outbound-claims failed:\n${result.output}`);
});

test('it refuses the exact sentence that shipped to the store listing', () => {
  const original = readFileSync(LISTING, 'utf8');
  try {
    writeFileSync(
      LISTING,
      original.replace(
        'GrayBag currently serves schools in SAS Nagar (Mohali).',
        'GrayBag currently serves schools in Chandigarh, SAS Nagar (Mohali) and Panchkula.',
      ),
    );

    const result = run();
    assert.equal(result.ok, false, 'the check passed the sentence it exists to catch');
    assert.match(result.output, /Chandigarh/);
    assert.match(result.output, /Panchkula/);
  } finally {
    writeFileSync(LISTING, original);
  }
});

test('a data-region mention is not read as a service claim', () => {
  // `A2`: "Supabase, AWS Mumbai (ap-south-1)" is a statement about where data is stored, and the
  // store listing is required to make it. A check that flagged it would be turned off.
  const listing = readFileSync(LISTING, 'utf8');
  assert.match(listing, /AWS Mumbai/, 'the listing should still state the data region');
  assert.equal(run().ok, true);
});

test('an internal planning document may still forecast other cities', () => {
  // The defect was never the forecast — `docs/data-model.md` has a 12-month planning column and
  // must. It was the forecast being quoted as fact somewhere it left the building. If this check
  // ever starts reading internal design notes, that distinction is lost and the honest planning
  // figure becomes the thing people delete.
  const planning = readFileSync(join(ROOT, 'docs/data-model.md'), 'utf8');
  assert.match(planning, /12-month planning figure/);
  assert.equal(run().ok, true);
});
