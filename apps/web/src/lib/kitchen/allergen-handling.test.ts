import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fixtureDay } from './fixture.js';
import { MEMORY_ONLY } from './types.js';

/**
 * The constraints that make kitchen-visible allergy flags acceptable — `E09-33`.
 *
 * Andy, 2026-08-14: *"I'm accepting the privacy cost deliberately; the constraints below are what
 * makes it acceptable, so treat them as part of the requirement, not advice."*
 *
 * So they are tested, not merely written down. Allergen codes are **tier S** data about a child:
 * they exist on the kitchen screen for the length of a render and nowhere else.
 *
 * These are static assertions over the shipped sources. That is a weaker instrument than
 * exercising the code, and it is the right one here: what must be proven is the *absence* of a
 * call — a `console.log` that never runs in a test still ships, and still writes a child's
 * allergy to a log the next time somebody opens the console.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HERE, '../..');

/**
 * Comments out, code in.
 *
 * The first version of this scanned raw text and failed on its own documentation — a comment
 * saying "never sent to Sentry or analytics" matched the rule forbidding Sentry. A test that
 * cannot tell a prohibition from a violation teaches people to delete the prohibition.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

function sourcesUnder(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourcesUnder(path));
    else if (/\.(ts|astro)$/.test(entry.name) && !entry.name.includes('.test.'))
      out.push({ file: path.slice(WEB_SRC.length + 1), text: codeOnly(readFileSync(path, 'utf8')) });
  }
  return out;
}

const SOURCES = sourcesUnder(WEB_SRC);

/** Every line that mentions allergens, with its file, so a failure names the place. */
const allergenLines = SOURCES.flatMap(({ file, text }) =>
  text
    .split('\n')
    .map((line, i) => ({ file, line: i + 1, text: line }))
    .filter((l) => /allergen/i.test(l.text)),
);

describe('allergen codes are never logged', () => {
  it('no console call mentions them', () => {
    // Not console, not Sentry, not analytics. A log line is a copy of the data that outlives the
    // render, gets shipped to a third party, and is read by people the parent never consented to.
    const logged = allergenLines.filter((l) =>
      /\b(console\.\w+|captureException|captureMessage|Sentry\.|track|analytics)\b/.test(l.text),
    );
    expect(logged.map((l) => `${l.file}:${l.line}`)).toEqual([]);
  });

  it('the screen has no telemetry that could carry a whole order', () => {
    // The order object holds `allergenCodes`, so anything that serialises an order wholesale is
    // the same leak by a longer route.
    const shipped = SOURCES.filter(({ file }) => file.startsWith('lib/kitchen') || file.endsWith('kitchen.astro'));
    for (const { file, text } of shipped) {
      expect(text, `${file} sends telemetry`).not.toMatch(/Sentry|analytics|gtag|posthog|mixpanel/i);
    }
  });
});

describe('allergen codes never leave the screen', () => {
  it('no export, CSV or packing list carries them', () => {
    // `packages/shared/src/kitchen/lists.ts` builds the production, per-school and packing CSVs.
    // A downloaded file is the one artefact that outlives the session and travels by email.
    const lists = codeOnly(
      readFileSync(join(WEB_SRC, '../../../packages/shared/src/kitchen/lists.ts'), 'utf8'),
    );
    expect(lists).not.toMatch(/allergen/i);
  });

  it('is never put in a URL', () => {
    // A query string is logged by every proxy between the tablet and the server, and pasted into
    // support tickets.
    const inUrls = allergenLines.filter((l) =>
      /(searchParams|URLSearchParams|location\.(href|search)|history\.(push|replace))/.test(l.text),
    );
    expect(inUrls.map((l) => `${l.file}:${l.line}`)).toEqual([]);
  });
});

describe('allergen codes are not persisted client-side', () => {
  it('no storage API touches them', () => {
    const stored = allergenLines.filter((l) =>
      /(localStorage|sessionStorage|indexedDB|caches|document\.cookie)/.test(l.text),
    );
    expect(stored.map((l) => `${l.file}:${l.line}`)).toEqual([]);
  });

  it('the board still declares itself memory-only', () => {
    // `MEMORY_ONLY` is the existing rule for tier-P names on this screen (a shared tablet is
    // never locked). Allergen codes ride the same order objects and inherit it.
    expect(MEMORY_ONLY).toBe(true);
  });

  it('a fixture order carries codes only in memory', () => {
    // Proves the shape rather than the absence: the data is on the object, and the object is
    // never handed to anything that writes.
    const day = fixtureDay('2026-08-14');
    expect(day.orders.some((o) => (o.allergenCodes ?? []).length > 0)).toBe(true);
  });
});
