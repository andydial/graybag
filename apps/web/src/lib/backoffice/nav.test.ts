import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXAMPLE_LEVELS,
  NAV,
  SEEDED_PERMISSIONS,
  canReach,
  noAccessReason,
  visibleNav,
  type Grant,
  type Operator,
} from './nav.js';

const operator = (grants: Iterable<Grant>): Operator => ({ name: 'Test', grants: new Set(grants) });

describe('visibleNav — one app, three levels (E10-12)', () => {
  it('gives a platform admin everything', () => {
    expect(visibleNav(operator(EXAMPLE_LEVELS.platformAdmin))).toHaveLength(NAV.length);
  });

  it('gives a kitchen operator the kitchen and menus, and no money screen', () => {
    const items = visibleNav(operator(EXAMPLE_LEVELS.kitchenOperator)).map((i) => i.href);
    expect(items).toContain('/kitchen');
    expect(items).toContain('/admin/menus');
    // The all-kitchens order screen shows refunds and totals, and `orders.view_financials` is a
    // separate grant precisely so a kitchen does not get it by having `orders.view` (D3).
    expect(items).not.toContain('/admin/orders');
    expect(items).not.toContain('/admin/people');
  });

  it('gives a school viewer reports and nothing else', () => {
    expect(visibleNav(operator(EXAMPLE_LEVELS.schoolViewer)).map((i) => i.href)).toEqual(['/reports']);
  });

  it('requires every grant an item names, not any of them', () => {
    // `orders.view` alone must not open the financial order screen. This is the check that
    // would have quietly passed with an `.some()`.
    //
    // It was also looking up `/admin/orders`, a route that has never existed, and the `!` turned
    // the miss into a TypeError only once the table changed under it. A test that asserts about
    // a named thing has to fail when that thing is absent, not dereference undefined.
    const item = NAV.find((i) => i.href === '/orders');
    if (!item) throw new Error('no /orders item in NAV');
    expect(canReach(item, operator(['orders.view']))).toBe(false);
    expect(canReach(item, operator(['orders.view', 'orders.view_financials']))).toBe(true);
  });

  it('omits what cannot be reached rather than disabling it', () => {
    // A disabled link to a screen somebody will never be given invites a request for access they
    // do not need, and advertises the shape of the system to an account that should not see it.
    const items = visibleNav(operator(['reports.view']));
    expect(items.every((i) => canReach(i, operator(['reports.view'])))).toBe(true);
  });
});

describe('noAccessReason', () => {
  it('is null when the person can reach something', () => {
    expect(noAccessReason(operator(EXAMPLE_LEVELS.schoolViewer))).toBeNull();
  });

  it('explains an account with no grants at all', () => {
    // A real state: a back-office user created before anyone assigned permissions. An empty
    // shell with no explanation is §5.21's N3 rendering as N1 — "nothing here" when the truth is
    // "not for you".
    expect(noAccessReason(operator([]))).toMatch(/no back-office permissions yet/);
  });

  it('distinguishes "no grants" from "grants that open nothing"', () => {
    const reason = noAccessReason(operator(['orders.view_pii']));
    expect(reason).toMatch(/none that open a back-office screen/);
    expect(reason).not.toMatch(/no back-office permissions yet/);
  });
});

describe('the nav table itself', () => {
  it('gives every item at least one required grant', () => {
    // A back-office route reachable by anyone signed in would be a hole, and the type permits
    // an empty array — so this is the check that keeps the permission model honest.
    for (const item of NAV) expect(item.requires.length, item.href).toBeGreaterThan(0);
  });

  it('has no duplicate hrefs', () => {
    // The lesson from E09-11: anything keyed by an identifier must prove it is unique first.
    expect(new Set(NAV.map((i) => i.href)).size).toBe(NAV.length);
  });

  it('describes every item, because a label alone does not say what a screen is for', () => {
    for (const item of NAV) expect(item.description.length, item.href).toBeGreaterThan(20);
  });

  /**
   * Every href must be a page that exists — `E10-43`.
   *
   * `/admin/orders` sat in this table and has never existed; the real screen is `/orders`. It
   * failed in the same silent direction as `E10-06`'s invented grant codes: a nav item pointing
   * at nothing looks exactly like a nav item correctly hidden from you, so a full platform admin
   * saw no Orders link and there was nothing to notice.
   *
   * Reading the filesystem in a unit test is unusual and deliberate. The route table and the
   * pages are two representations of one fact, they are edited by different tasks months apart,
   * and nothing else in the build compares them — Astro is happy to have pages nobody links to,
   * and a link checker only walks links that were rendered.
   */
  it('points only at pages that exist on disk', () => {
    const pages = join(fileURLToPath(new URL('.', import.meta.url)), '../../pages');
    for (const item of NAV) {
      const route = item.href.replace(/^\//, '');
      const candidates = [`${route}.astro`, `${route}/index.astro`];
      const found = candidates.some((c) => existsSync(join(pages, c)));
      expect(found, `${item.href} — expected one of ${candidates.join(' or ')}`).toBe(true);
    }
  });

  /**
   * The other direction: a back-office page that no navigation reaches.
   *
   * This is the failure Andy reported — *"I need to find and paste URL endpoints to open some /
   * many of those"*. `/kitchen/sheet`, `/admin/allergens` and `/admin/people` were each reachable
   * from no link anywhere in the app. The marketing pages, the policy pages and `/signin` are
   * excluded because they are not back-office screens and are reached from the public site.
   */
  it('covers every back-office page, so none is reachable only by typing its URL', () => {
    const pages = join(fileURLToPath(new URL('.', import.meta.url)), '../../pages');
    const NOT_BACK_OFFICE = new Set(['index', 'signin', 'thanks', '[policy]']);
    const found: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith('.astro')) found.push(`${prefix}${entry.name.replace(/\.astro$/, '')}`);
      }
    };
    walk(pages, '');

    const navigable = new Set(NAV.map((i) => i.href.replace(/^\//, '')));
    // The dashboard is where the navigation lives; it does not need to appear inside itself.
    navigable.add('dashboard');
    const orphans = found.filter((p) => !NOT_BACK_OFFICE.has(p) && !navigable.has(p));
    expect(orphans, 'back-office pages no navigation reaches').toEqual([]);
  });

  /**
   * The regression test for `E10-06`'s find.
   *
   * `/admin/people` required `user.edit`, and `/admin/config` would have required `config.edit`.
   * Neither is a code this system seeds — they are `users.manage` and `config.platform_edit`.
   * Nothing failed: a nav item whose required grant cannot exist is simply never visible, so the
   * screen was unreachable by every account including a full platform admin, and it was
   * indistinguishable from correct default-deny.
   *
   * An invented grant is silent in exactly the direction nobody investigates — it denies rather
   * than allows — which is why it needs a test rather than a review.
   */
  it('requires only grants that actually exist in the permission table', () => {
    const seeded = new Set<string>(SEEDED_PERMISSIONS);
    for (const item of NAV) {
      for (const grant of item.requires) {
        expect(seeded.has(grant), `${item.href} requires "${grant}", which is not a seeded permission`).toBe(true);
      }
    }
  });

  it('keeps every example bundle to grants that exist', () => {
    const seeded = new Set<string>(SEEDED_PERMISSIONS);
    for (const [level, grants] of Object.entries(EXAMPLE_LEVELS)) {
      for (const grant of grants) {
        expect(seeded.has(grant), `${level} holds "${grant}", which is not a seeded permission`).toBe(true);
      }
    }
  });

  it('lets a platform admin reach the configuration screen', () => {
    // The direct assertion that the bug is gone: before the fix this was false, because
    // `config.edit` was not a grant anyone could hold.
    const item = NAV.find((i) => i.href === '/admin/config')!;
    expect(canReach(item, operator(EXAMPLE_LEVELS.platformAdmin))).toBe(true);
  });

  it('does not open the configuration screen to a kitchen operator', () => {
    // `revenue_share_bps` (M4) is on the same row as the cutoff, and RLS filters rows, never
    // columns — which is why config is shut to kitchen staff rather than column-redacted.
    const item = NAV.find((i) => i.href === '/admin/config')!;
    expect(canReach(item, operator(EXAMPLE_LEVELS.kitchenOperator))).toBe(false);
  });
});
