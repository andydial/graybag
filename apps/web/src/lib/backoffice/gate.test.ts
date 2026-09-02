import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { api } from '@graybag/shared';
import { describe, expect, it } from 'vitest';

import {
  LANDING,
  NO_ACCESS_MESSAGE,
  decideAccess,
  deniedSignInUrl,
  hasBackofficeAccess,
  mayOpen,
  reachable,
  signInUrlFor,
  wasDenied,
} from './gate.js';
import { EXAMPLE_LEVELS, NAV } from './nav.js';

const caps = (codes: Iterable<string>) => api.capabilities(codes);
const owner = api.capabilities([], true);
const nobody = caps([]);

describe('hasBackofficeAccess — the door, not the furniture (E10-73)', () => {
  it('refuses an account that holds nothing', () => {
    // The account in Andy's screenshot: signed in, and shown four cards naming the grants it
    // did not hold. It should never have got past the sign-in page.
    expect(hasBackofficeAccess(nobody)).toBe(false);
  });

  it('refuses an account whose grants open no screen', () => {
    // `orders.view_pii` alone is real — it is half of what a kitchen job holds — and on its own
    // it reaches nothing. Admitting them shows a frame with no contents, which is the same
    // disclosure in a smaller size.
    expect(hasBackofficeAccess(caps(['orders.view_pii']))).toBe(false);
    expect(hasBackofficeAccess(caps(['orders.mark_delivered']))).toBe(false);
  });

  it('admits the platform owner, who holds no grant rows at all', () => {
    // `E02-39`. The one account that satisfies everything while holding nothing — and the exact
    // shape a naive "has any grant" check would lock out.
    expect(owner.codes).toEqual([]);
    expect(hasBackofficeAccess(owner)).toBe(true);
  });

  it('admits a school viewer, who reaches exactly one screen', () => {
    expect(hasBackofficeAccess(caps(EXAMPLE_LEVELS.schoolViewer))).toBe(true);
    expect(reachable(caps(EXAMPLE_LEVELS.schoolViewer)).map((i) => i.href)).toEqual(['/reports']);
  });

  it('admits a kitchen operator', () => {
    expect(hasBackofficeAccess(caps(EXAMPLE_LEVELS.kitchenOperator))).toBe(true);
  });
});

describe('mayOpen — a route at a time', () => {
  it('lets anyone who may be here open the landing page', () => {
    // `/dashboard` has no `NAV` entry because it is not a destination you choose; it is where
    // you arrive, and it is built entirely from what the reader can reach.
    expect(NAV.some((i) => i.href === LANDING)).toBe(false);
    expect(mayOpen(LANDING, caps(EXAMPLE_LEVELS.schoolViewer))).toBe(true);
  });

  it('does not let the landing page in by the back door', () => {
    // The `NAV`-less route must still be refused to somebody who reaches nothing, or the whole
    // gate is one URL wide.
    expect(mayOpen(LANDING, nobody)).toBe(false);
  });

  it('refuses a screen the account cannot reach, typed as a URL', () => {
    const kitchen = caps(EXAMPLE_LEVELS.kitchenOperator);
    expect(mayOpen('/kitchen', kitchen)).toBe(true);
    // Money. `orders.view_financials` is a separate grant precisely so `orders.view` does not
    // carry it (D3), and knowing the URL must not be a way around that.
    expect(mayOpen('/orders', kitchen)).toBe(false);
    expect(mayOpen('/admin/people', kitchen)).toBe(false);
    expect(mayOpen('/admin/packs', kitchen)).toBe(false);
  });

  it('refuses every screen but Reports to a school viewer', () => {
    const school = caps(EXAMPLE_LEVELS.schoolViewer);
    const open = NAV.filter((item) => mayOpen(item.href, school)).map((i) => i.href);
    expect(open).toEqual(['/reports']);
  });

  it('opens everything to the owner', () => {
    expect(NAV.every((item) => mayOpen(item.href, owner))).toBe(true);
  });
});

describe('decideAccess', () => {
  it('sends a signed-out visitor to sign in', () => {
    expect(decideAccess({ signedIn: false, caps: null, path: '/kitchen' }))
      .toEqual({ kind: 'sign-in' });
  });

  it('signs out an account that reaches nothing', () => {
    expect(decideAccess({ signedIn: true, caps: nobody, path: LANDING }))
      .toEqual({ kind: 'no-access' });
  });

  it('separates "we do not know" from "we know, and it is nothing"', () => {
    // A dropped connection is not a revocation. Throwing somebody off a shared kitchen tablet
    // because the network blinked would be its own outage, so this fails closed and stays put
    // rather than signing them out.
    expect(decideAccess({ signedIn: true, caps: null, path: '/kitchen' }))
      .toEqual({ kind: 'unknown' });
  });

  it('sends somebody who belongs here to their own landing page', () => {
    expect(decideAccess({
      signedIn: true, caps: caps(EXAMPLE_LEVELS.schoolViewer), path: '/orders',
    })).toEqual({ kind: 'wrong-screen', to: LANDING });
  });

  it('allows a reachable screen, and hands back the capabilities', () => {
    const held = caps(EXAMPLE_LEVELS.kitchenOperator);
    expect(decideAccess({ signedIn: true, caps: held, path: '/kitchen' }))
      .toEqual({ kind: 'allow', caps: held });
  });

  it('never returns "wrong-screen" pointing at a screen they also cannot open', () => {
    // The redirect target has to be somewhere they may actually be, or this loops.
    const school = caps(EXAMPLE_LEVELS.schoolViewer);
    const outcome = decideAccess({ signedIn: true, caps: school, path: '/admin/growth' });
    if (outcome.kind !== 'wrong-screen') throw new Error('expected a redirect');
    expect(mayOpen(outcome.to, school)).toBe(true);
  });
});

describe('what the reader is told', () => {
  it('names no grant, no screen and no permission in the refusal', () => {
    // The whole point of the task: a stranger must not learn the vocabulary. If this sentence
    // ever mentions revenue, packs, reports or a grant code, the disclosure is back.
    for (const word of ['revenue', 'pack', 'report', 'kitchen', 'orders.', 'menu.', 'grant ']) {
      expect(NO_ACCESS_MESSAGE.toLowerCase()).not.toContain(word);
    }
  });

  it('puts nothing about the account in the denied URL', () => {
    expect(deniedSignInUrl()).toBe('/signin?denied=1');
    expect(wasDenied('?denied=1')).toBe(true);
    expect(wasDenied('?next=%2Forders')).toBe(false);
  });

  it('round-trips the route through the sign-in redirect', () => {
    expect(signInUrlFor('/admin/people')).toBe('/signin?next=%2Fadmin%2Fpeople');
  });
});

/* ------------------------------------------------------------------ the wiring */

const PAGES = fileURLToPath(new URL('../../pages', import.meta.url));

/** Every `.astro` under `src/pages`, path relative to it. */
function everyPage(dir = PAGES): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return everyPage(full);
    return entry.name.endsWith('.astro') ? [relative(PAGES, full)] : [];
  });
}

/** A back-office page is one that renders the shell. That is the whole definition. */
const backofficePages = everyPage()
  .map((file) => ({ file, source: readFileSync(join(PAGES, file), 'utf8') }))
  .filter((page) => page.source.includes('BackofficeShell'));

describe('every back-office page goes through the gate (E10-73)', () => {
  it('finds the back-office pages', () => {
    // If this collapses to a handful, the filter above has stopped matching and every assertion
    // below is passing vacuously — the exact failure `check-suites-ran.mjs` exists to catch,
    // in miniature.
    expect(backofficePages.length).toBeGreaterThanOrEqual(15);
  });

  it.each(backofficePages.map((p) => p.file))('%s calls requireBackofficeAccess', (file) => {
    const source = backofficePages.find((p) => p.file === file)!.source;
    expect(source).toContain('requireBackofficeAccess(');
  });

  it.each(backofficePages.map((p) => p.file))('%s names a route the gate knows', (file) => {
    const source = backofficePages.find((p) => p.file === file)!.source;
    const called = [...source.matchAll(/requireBackofficeAccess\('([^']+)'\)/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const route of called) {
      // Either a real nav entry or the landing page. A typo here would silently open a screen:
      // `mayOpen` treats an unknown route as "no requirement of its own", which is right for
      // `/dashboard` and wrong for everything else.
      const known = route === LANDING || NAV.some((item) => item.href === route);
      expect(known, `${file} gates on ${route}, which is in neither NAV nor the landing page`)
        .toBe(true);
    }
  });

  it('leaves no page checking only for a session', () => {
    // The pattern this replaced, in all its spellings. It asked "is anybody signed in", which is
    // the question that let an account holding nothing reach `/dashboard` and be shown the shape
    // of the system.
    for (const { file, source } of backofficePages) {
      expect(source, `${file} still redirects to /signin by hand`).not.toContain('/signin?next=');
    }
  });
});
