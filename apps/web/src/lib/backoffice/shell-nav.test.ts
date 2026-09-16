// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@graybag/shared';

import { NAV, NAV_GROUPS } from './nav.js';
import { configureBackofficeApi } from './session.js';
import { mountShell } from './shell.js';

/**
 * The left navigation renders on **every** back-office route — `E12-46`.
 *
 * ## The bug this file was written to reproduce
 *
 * `/admin/menus` and `/admin/packs` rendered on production with an empty rail: the brand mark, a
 * Sign out button, and none of the four groups. Every other back-office screen was fine.
 *
 * **It was not a permission failure, and no permission read was failing on production.**
 * `mountShell` builds the rail from `api.fetchMyAccess()` inside a `try` whose `catch`
 * deliberately reveals nothing (`E10-73`: *"the list of screens is itself the disclosure"*).
 * `configureBackofficeApi()` is reached through `requireBackofficeAccess()`, and those two pages
 * were the only ones that ran `await mountShell()` **first**. So the transport was still null,
 * `getTransport()` threw `ApiNotConfiguredError` synchronously, and the catch that exists to avoid
 * advertising the system emptied the rail instead. The request was never made — nothing was denied.
 *
 * The ordering is invisible from any single page, which is why `/dashboard` looks wrong and is
 * fine: its `mountShell()` sits textually above its gate but executes after it. A source scan for
 * call order gets `/dashboard` wrong in one direction and `/admin/packs` wrong in the other, which
 * is why this file drives the real thing instead.
 *
 * ## Why nothing caught it
 *
 * `check:a11y` walks every back-office route — exactly the coverage that should have found this —
 * but it walks them with `?state`, and `mountShell` returns early in demo mode having built the
 * full `NAV` from a constant. The audited path and the real path diverge at the line that broke.
 */

/** A transport standing in for a signed-in owner. `fetchMyAccess` reads grants and asks the rpc. */
const OWNER = {
  from: () => ({ select: () => ({ is: async () => ({ data: [], error: null }) }) }),
  rpc: async () => ({ data: true, error: null }),
} as never;

/**
 * `configureBackofficeApi` is stubbed to install the transport — and that is the whole test seam.
 *
 * The real one builds a Supabase client from `PUBLIC_SUPABASE_URL`, which does not exist here, so
 * in jsdom it can only ever throw. Left real, every assertion below passes whether or not
 * `mountShell` calls it, which is a test that cannot fail for the reason it was written. Mutation
 * testing caught exactly that: the first version of this file passed with the fix removed.
 *
 * Stubbed this way, "does `mountShell` configure the api itself?" becomes observable: if it does,
 * a transport exists and the rail renders; if it does not, there is no transport, `getTransport()`
 * throws `ApiNotConfiguredError`, and the rail is empty — which is the production bug.
 */
vi.mock('./session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session.js')>();
  return {
    ...actual,
    configureBackofficeApi: vi.fn(() => { api.setApiTransport(OWNER); }),
    currentUser: vi.fn(async () => ({ email: 'andy@graybag.com' })),
    signOut: vi.fn(async () => undefined),
  };
});

const RAIL = (current: string) => `
  <div data-bonav data-nav-current="${current}">
    <nav data-nav-rail></nav>
    <div data-nav-who hidden><span data-nav-email></span><span data-nav-role></span></div>
    <button data-nav-signout hidden>Sign out</button>
  </div>`;

const groups = () =>
  [...document.querySelectorAll<HTMLElement>('[data-nav-group]')].map((el) => el.textContent);
const links = () =>
  [...document.querySelectorAll<HTMLElement>('[data-nav-item]')].map((el) => el.dataset.navItem);

/** The transport a REFUSED grant read gives back: configuration worked, the query did not. */
const REFUSED = {
  from: () => ({
    select: () => ({ is: async () => ({ data: null, error: { message: 'denied', code: '42501' } }) }),
  }),
  rpc: async () => ({ data: null, error: { message: 'denied', code: '42501' } }),
} as never;

beforeEach(() => {
  document.body.innerHTML = RAIL('/dashboard');
  // Back to the healthy default; individual tests re-point it at a refusing transport.
  vi.mocked(configureBackofficeApi).mockImplementation(() => { api.setApiTransport(OWNER); });
});
afterEach(() => api.setApiTransport(null));

describe('every route in the navigation', () => {
  /*
   * Driven from `NAV` itself rather than a list typed here, so a screen added to the rail is
   * covered the day it is added. `.each` gives one named case per route — the "not a sampled few"
   * Andy asked for, and a failure names the route rather than an index.
   */
  it.each(NAV.map((item) => [item.href, item.label] as const))(
    '%s (%s) renders the full rail',
    async (href) => {
      document.body.innerHTML = RAIL(href);
      // Deliberately NO transport installed here. The rail may only render because `mountShell`
      // configured the api itself — which is the property this whole file exists to hold.

      await mountShell();

      // Every group, and every link the rail offers — not a subset.
      //
      // Compared as sets: `build()` walks `NAV_GROUPS` and filters within each, so the rendered
      // order is grouped order and not the declaration order of `NAV`. Asserting the array would
      // pin an ordering this test has no opinion about and would break on a harmless regroup.
      expect(groups()).toEqual([...NAV_GROUPS]);
      expect([...links()].sort()).toEqual(NAV.map((item) => item.href).sort());
      // And this route is the one marked current.
      expect(document.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(href);
    },
  );
});

describe('the ordering bug that emptied the rail', () => {
  it('renders the rail even when mounted BEFORE any gate has configured the api', async () => {
    /*
     * The regression test proper. `configureBackofficeApi()` has not run, and in this environment
     * it cannot succeed — there is no `PUBLIC_SUPABASE_URL`. `mountShell` must still render from
     * the transport it is given, which is what removes the ordering requirement that `/admin/menus`
     * and `/admin/packs` violated.
     *
     * Verified by removing the `configureBackofficeApi()` call from `mountShell` and watching
     * this fail, rather than by assuming the assertion bites.
     */
    await mountShell();
    expect(groups()).toEqual([...NAV_GROUPS]);
  });
});

describe('a failed read still reveals nothing', () => {
  it('renders no groups and no links when the grant read fails', async () => {
    /*
     * `E10-73`, asserted so the fix above cannot be mistaken for permission to open the rail up.
     * A dropped request must not show a kitchen operator all fourteen screens. This is the
     * behaviour that was correct all along; what was wrong was reaching it by accident.
     */
    // Configuration SUCCEEDS and the read is refused — the real shape of a permission failure,
    // and a different thing from the unconfigured-transport bug this file was written for.
    vi.mocked(configureBackofficeApi).mockImplementation(() => { api.setApiTransport(REFUSED); });

    await mountShell();
    expect(groups()).toEqual([]);
    expect(links()).toEqual([]);
  });

  it('still mounts Sign out, so nobody is stranded on a bare frame', async () => {
    // `E12-42` put this outside the try for exactly this failure. Asserted so a later tidy-up
    // that moves it back inside is caught here rather than by somebody who cannot get out.
    vi.mocked(configureBackofficeApi).mockImplementation(() => { api.setApiTransport(REFUSED); });
    await mountShell();
    expect(document.querySelector<HTMLElement>('[data-nav-signout]')?.hidden).toBe(false);
  });
});

describe('the navigation and the pages agree', () => {
  /**
   * Where `src/pages` is, resolved rather than assumed.
   *
   * Two things make the obvious answers wrong. `import.meta.url` resolves against the document's
   * origin under the jsdom environment and yields `/src/pages`, which is not a path on disk. And
   * `process.cwd()` is `apps/web` when vitest is run from this package and the repository root
   * when it is run from `npm run smoke`, so either alone is right half the time — which is worse
   * than being wrong, because it passes locally and fails in CI.
   *
   * Throwing when neither exists is deliberate: the alternative is an empty sweep that asserts
   * nothing and reports success.
   */
  function pagesDir(): string {
    const candidates = [
      join(process.cwd(), 'src', 'pages'),
      join(process.cwd(), 'apps', 'web', 'src', 'pages'),
    ];
    const found = candidates.find((dir) => existsSync(dir));
    if (!found) throw new Error(`cannot find src/pages — looked in ${candidates.join(', ')}`);
    return found;
  }

  /** Every `.astro` page under `pages/`, as a route path and its source. */
  function everyPage(): { route: string; source: string }[] {
    const out: { route: string; source: string }[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}/${entry.name}`);
        else if (entry.name.endsWith('.astro')) {
          out.push({
            route: `${prefix}/${entry.name.replace(/\.astro$/, '')}`,
            source: readFileSync(join(dir, entry.name), 'utf8'),
          });
        }
      }
    };
    walk(pagesDir(), '');
    return out;
  }

  it('every route the rail links to is a page that mounts the shell', () => {
    /*
     * Not about ordering — that is fixed above and no longer expressible as a bug. This catches
     * the other half: a nav entry pointing at a page that renders no shell at all, which would be
     * a link to a screen with no way back.
     */
    const mounted = new Set(
      everyPage().filter((p) => /\bmountShell\s*\(/.test(p.source)).map((p) => p.route),
    );
    expect(mounted.size, 'no page mounts the shell — this sweep has stopped testing anything')
      .toBeGreaterThanOrEqual(9);

    const missing = NAV.map((item) => item.href).filter((href) => !mounted.has(href));
    expect(missing, 'the rail links to a page that does not mount the back-office shell').toEqual([]);
  });
});
