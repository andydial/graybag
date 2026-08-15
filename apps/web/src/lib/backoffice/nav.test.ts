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
    const item = NAV.find((i) => i.href === '/admin/orders')!;
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
