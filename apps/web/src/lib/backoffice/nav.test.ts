import { describe, expect, it } from 'vitest';

import { EXAMPLE_LEVELS, NAV, canReach, noAccessReason, visibleNav, type Grant, type Operator } from './nav.js';

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
});
