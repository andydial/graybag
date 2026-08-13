#!/usr/bin/env node
/**
 * Copy that leaves the repo for a third party must describe what EXISTS, not what is planned.
 *
 * Andy's standing rule, 2026-08-11, after the App Store listing was found claiming *"GrayBag
 * currently serves schools in Chandigarh, SAS Nagar (Mohali) and Panchkula."* Two of those had
 * no school, no kitchen and no menu. That is a false statement to Apple and Google, not an
 * internal inconsistency — and it got there because the listing's own audit note cited
 * `docs/data-model.md` §1.7, whose "Cities | 3" was the **12-month planning column**.
 *
 * The rule this enforces: **a claim in outbound copy is checked against the seed data, never
 * against a planning document.**
 *
 * ## What counts as outbound
 *
 * Anything a third party reads: the store listings, and the three customer-facing policy
 * documents. Internal design notes are exempt — `data-model.md` is *allowed* to forecast three
 * cities, and must be, because that is what a planning column is for. The defect was never the
 * forecast; it was the forecast being quoted as fact somewhere it left the building.
 *
 * ## What it checks
 *
 * Every place name mentioned in outbound copy must correspond to a city we actually seed. The
 * city list comes from `supabase/seeds/catalogue.sql` — the real catalogue, not the synthetic
 * fixtures — because that is the closest thing in the repo to "what exists".
 *
 * It is deliberately a **name check and not a semantic one**. A regex cannot tell "we serve
 * Panchkula" from "we do not serve Panchkula yet", and it should not try: the point is to make
 * a human look at any sentence naming a place we do not serve, which is cheap and catches the
 * class. False positives are answered by rewording or by adding the name to `ALLOWED` with a
 * reason, and both are better outcomes than the silence this replaces.
 *
 * Run by `npm run smoke`. Exits non-zero with the file, the line and the offending name.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Copy a third party reads. Internal design documents are deliberately absent. */
const OUTBOUND = [
  'docs/store-submission.md',
  'docs/terms.md',
  'docs/privacy-policy.md',
  'docs/refund-policy.md',
  'packages/shared/src/policy/documents.generated.ts',
];

/**
 * Indian place names worth noticing. Not a gazetteer — the ones this product has plausibly
 * claimed or might claim, which is the set a mistake actually comes from. Add to it rather than
 * trying to detect place names in general; a general detector would flag "Punjab National Bank"
 * and be turned off within a week.
 */
const PLACES = [
  'Chandigarh', 'Panchkula', 'Mohali', 'SAS Nagar', 'Zirakpur', 'Kharar', 'Ludhiana',
  'Amritsar', 'Jalandhar', 'Patiala', 'Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Mumbai',
  'Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ambala', 'Haryana',
];

/**
 * Names that may appear in outbound copy without a seeded city, each with the reason.
 *
 * `Punjab` is the state we are in and appears as a place of supply and in the registered
 * address; `India` for governing law. Neither is a claim to serve a city.
 */
const ALLOWED = new Map([
  ['Punjab', 'the state GrayBag operates in — place of supply and registered address, not a service claim'],
  ['India', 'governing law and the DPDP Act'],
  // `A2`: the Supabase region. A statement about where data is stored, and one the store
  // listing is required to make. It is the opposite of a service claim — it says nothing about
  // where we deliver lunch.
  ['Mumbai', 'AWS ap-south-1, the data region (A2) — a storage location, not a service area'],
]);

/** The cities that actually exist, read from the real catalogue seed. */
function seededCities() {
  const seed = join(ROOT, 'supabase/seeds/catalogue.sql');
  if (!existsSync(seed)) {
    console.error('check-outbound-claims: supabase/seeds/catalogue.sql is missing — cannot establish what exists.');
    process.exit(1);
  }
  const sql = readFileSync(seed, 'utf8');
  // `insert into city (...) values ('uuid', 'code', 'Name', ...)` — the display name is the
  // first quoted string that is not a uuid or a short code.
  const block = sql.slice(sql.indexOf('insert into city'));
  const stanza = block.slice(0, block.indexOf(';'));
  const names = new Set();
  for (const m of stanza.matchAll(/'([^']{4,})'/g)) {
    const value = m[1];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) continue; // a uuid
    if (/^\d+$/.test(value)) continue;
    // `Asia/Kolkata` is the timezone column, and it was letting a claim to serve Kolkata pass
    // as "served" — a FALSE NEGATIVE, which is the direction that matters here. A city name
    // never contains a slash.
    if (value.includes('/')) continue;
    // `Punjab` is the state column on the same row. Keeping it would make any Punjab city read
    // as served, which is the same false negative one level up.
    if (value === 'Punjab') continue;
    names.add(value);
  }
  return names;
}

const cities = seededCities();
if (cities.size === 0) {
  console.error('check-outbound-claims: no cities parsed from the catalogue seed — refusing to pass.');
  process.exit(1);
}

/** A seeded city satisfies any place name it contains — "SAS Nagar" covers "Mohali" and back. */
const served = (place) =>
  [...cities].some(
    (city) =>
      city.toLowerCase().includes(place.toLowerCase()) ||
      place.toLowerCase().includes(city.toLowerCase()),
  );

const failures = [];

for (const file of OUTBOUND) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const lines = readFileSync(path, 'utf8').split('\n');

  lines.forEach((line, i) => {
    for (const place of PLACES) {
      if (!new RegExp(`\\b${place}\\b`, 'i').test(line)) continue;
      if (ALLOWED.has(place)) continue;
      if (served(place)) continue;
      failures.push({
        file: relative(ROOT, path),
        line: i + 1,
        place,
        text: line.trim().slice(0, 140),
      });
    }
  });
}

if (failures.length > 0) {
  console.error('\ncheck-outbound-claims: FAIL\n');
  console.error('Copy that a third party reads names a place GrayBag does not serve.\n');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line} — "${f.place}"`);
    console.error(`    ${f.text}\n`);
  }
  console.error(`  Seeded cities: ${[...cities].join(', ')}\n`);
  console.error('  A claim in outbound copy is checked against the seed data, never against a');
  console.error('  planning document. If the sentence is fine as written, reword it so it does');
  console.error('  not read as a service claim, or add the name to ALLOWED with the reason.\n');
  process.exit(1);
}

console.log(`check-outbound-claims: ${OUTBOUND.length} documents, no unserved place claimed. OK`);
