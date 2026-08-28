import { describe, expect, it } from 'vitest';

import { SEEDED_PERMISSIONS } from '../backoffice/nav.js';
import { JOBS, OWNER_LABEL, describeAccess, jobByKey } from './jobs.js';
import type { HeldGrant } from './jobs.js';

const at = (scopeType: string, ...codes: string[]): HeldGrant[] =>
  codes.map((permissionCode) => ({ permissionCode, scopeType }));

const jobHeld = (key: string, scopeType = 'kitchen'): HeldGrant[] =>
  at(scopeType, ...(jobByKey(key)?.grants ?? []));

describe('the job table itself', () => {
  it('names only permissions that exist', () => {
    // The `E10-06` lesson, which cost `/admin/people` its visibility: an invented code is silent
    // in the direction nobody investigates. Here it would be worse than silent — granting a job
    // would half-apply, and the person would be told they are Kitchen staff while holding four of
    // five grants.
    const seeded = new Set<string>(SEEDED_PERMISSIONS);
    for (const job of JOBS) {
      for (const grant of job.grants) {
        expect(seeded.has(grant), `${job.key} names ${grant}`).toBe(true);
      }
    }
  });

  it('gives every job a scope it can be granted at', () => {
    for (const job of JOBS) expect(job.scopes.length, job.key).toBeGreaterThan(0);
  });

  it('has unique keys and labels', () => {
    expect(new Set(JOBS.map((j) => j.key)).size).toBe(JOBS.length);
    expect(new Set(JOBS.map((j) => j.label)).size).toBe(JOBS.length);
  });

  it('describes each job in words a person hiring someone would use', () => {
    for (const job of JOBS) expect(job.summary.length, job.key).toBeGreaterThan(30);
  });

  it('keeps refunding out of every kitchen job', () => {
    // `E09-09`'s whole point, and the reason `D3` refuses a role column. Cancelling is in the
    // kitchen bundles; moving money is not, and must never be folded in for convenience.
    for (const job of JOBS.filter((j) => j.key.startsWith('kitchen') || j.key === 'delivery')) {
      expect(job.grants, job.key).not.toContain('orders.refund');
      expect(job.grants, job.key).not.toContain('orders.view_financials');
    }
  });

  it('keeps the school office away from orders entirely', () => {
    const office = jobByKey('school_office')!;
    expect(office.grants).toEqual(['reports.view']);
  });
});

describe('describeAccess', () => {
  it('names an account holding exactly one job', () => {
    const summary = describeAccess(jobHeld('kitchen_staff'));
    expect(summary.job?.key).toBe('kitchen_staff');
    expect(summary.label).toBe('Kitchen staff');
    expect(summary.scopeType).toBe('kitchen');
    expect(summary.extra).toEqual([]);
  });

  it('says plainly when an account holds nothing', () => {
    // The state everybody starts in, and the reason this screen lists accounts with no grants.
    expect(describeAccess([]).label).toMatch(/holds nothing/i);
  });

  /*
   * **Rewritten in `E10-64`, and the contract changed deliberately.**
   *
   * This asserted that anything short of a whole bundle is "Custom". That rule is what named a
   * platform admin "Kitchen manager, plus 23 more permissions" on production: adding one grant to
   * the platform-admin bundle dropped him out of it entirely, and a smaller bundle he happened to
   * contain won instead.
   *
   * The property worth keeping is **not** "never name a partial job" — it is "never let somebody
   * believe they can do a job they cannot". Naming the job *and its gap* satisfies that and is
   * more useful, because it says what to grant.
   */
  it('names a near-complete job together with what is missing from it', () => {
    // Two of Delivery's three. Named, with the gap stated — not silently promoted to Delivery.
    const summary = describeAccess(at('kitchen', 'orders.view', 'orders.view_pii'));
    expect(summary.job?.key).toBe('delivery');
    expect(summary.label).toContain('missing orders.mark_delivered');
  });

  it('still falls back to Custom when it holds too little of any job to name one', () => {
    // One grant is a third of the smallest job. Below the floor, guessing would be dressing a
    // fragment up as a role.
    const summary = describeAccess(at('kitchen', 'orders.view'));
    expect(summary.job).toBeNull();
    expect(summary.label).toMatch(/^Custom — 1 permission/);
  });

  it('names the job and the extras when somebody holds more than it', () => {
    const summary = describeAccess([...jobHeld('kitchen_staff'), ...at('kitchen', 'orders.refund')]);
    expect(summary.job?.key).toBe('kitchen_staff');
    expect(summary.extra).toEqual(['orders.refund']);
    expect(summary.label).toBe('Kitchen staff, plus 1 more permission');
  });

  it('prefers the largest matching job, not the first', () => {
    // A platform admin also satisfies Delivery. Calling them Delivery would understate their
    // access by an enormous margin, on the one screen whose job is to state it accurately.
    const summary = describeAccess(jobHeld('platform_admin', 'platform'));
    expect(summary.job?.key).toBe('platform_admin');
  });

  it('reports no scope when a job is held across mixed scopes', () => {
    // Legitimate — somebody can be kitchen staff at one kitchen and hold a grant at another. It
    // is simply not summarisable in one line, and inventing one would be a lie by rounding.
    const mixed: HeldGrant[] = [
      ...at('kitchen', 'orders.view', 'orders.view_pii', 'orders.mark_delivered', 'orders.cancel'),
      ...at('platform', 'menu.view'),
    ];
    const summary = describeAccess(mixed);
    expect(summary.job?.key).toBe('kitchen_staff');
    expect(summary.scopeType).toBeNull();
  });

  /*
   * The safety property, restated for the new contract — `E10-64`.
   *
   * It used to be "removing any grant stops the job matching". Now a near-match is named, so the
   * property that actually protects somebody is: **a label must never imply an ability they do not
   * have.** If any of the job's grants is absent, the label has to say so.
   *
   * That is the same guarantee, stated over the thing a person reads rather than over an internal
   * match — which is stricter, because the old version said nothing about the label at all.
   */
  it('never lets a label imply a job somebody cannot actually do', () => {
    for (const job of JOBS) {
      for (const absent of job.grants) {
        const partial = job.grants.filter((g) => g !== absent);
        const summary = describeAccess(at('kitchen', ...partial));
        if (summary.job?.key === job.key) {
          expect(summary.label, `${job.key} without ${absent} reads as complete`).toContain('missing');
        }
      }
    }
  });
});

describe('naming a job when the bundle has moved on — E10-64', () => {
  /*
   * Andy's real production grants on 2026-08-28, read from the database rather than imagined.
   *
   * Thirty-one permissions, every one at platform scope, and NOT `meal_packs.manage` — that
   * permission is seeded by migration 0070, which has not reached production. So he holds a
   * superset of the platform-admin bundle in every respect except the one grant added to that
   * bundle the same morning.
   *
   * The old matcher required a bundle to be held entirely, so it discarded Platform admin and
   * named him **"Kitchen manager, plus 23 more permissions"**. This is that exact input.
   */
  const ANDY = [
    'audit.view', 'config.platform_edit', 'consent.view', 'dish.edit', 'grants.manage',
    'invoices.view', 'kitchen.config_edit', 'kitchen.edit', 'kitchen.view', 'menu.edit',
    'menu.import', 'menu.publish', 'menu.view', 'orders.cancel', 'orders.create_on_behalf',
    'orders.mark_delivered', 'orders.refund', 'orders.view', 'orders.view_financials',
    'orders.view_pii', 'payouts.manage', 'payouts.view', 'reports.financial_view', 'reports.view',
    'school.config_edit', 'school.edit', 'school.onboard', 'school.view', 'users.impersonate',
    'users.manage', 'users.view',
  ].map((permissionCode) => ({ permissionCode, scopeType: 'platform' }));

  it('calls a platform admin a platform admin, not a kitchen manager', () => {
    const access = describeAccess(ANDY);
    expect(access.job?.key).toBe('platform_admin');
    expect(access.label).not.toContain('Kitchen');
  });

  it('names the grant they are missing, because that is the actionable half', () => {
    // "missing meal_packs.manage" tells you what to grant. "plus 23 more" tells you nothing you
    // can act on, and hides the gap under the surplus.
    expect(describeAccess(ANDY).label).toContain('missing meal_packs.manage');
  });

  it('still names an exact match plainly, with nothing appended', () => {
    const admin = jobByKey('platform_admin')!;
    const exact = admin.grants.map((permissionCode) => ({ permissionCode, scopeType: 'platform' }));
    expect(describeAccess(exact).label).toBe('Platform admin');
  });

  it('does not promote a smaller complete job over a larger near-complete one', () => {
    // The heart of the bug: Kitchen manager fitted perfectly inside what he held, and perfection
    // on a fragment beat near-perfection on the truth.
    const access = describeAccess(ANDY);
    expect(access.job?.grants.length).toBeGreaterThan(jobByKey('kitchen_manager')!.grants.length);
  });

  it('prefers the complete job when two cover the same amount', () => {
    // Exactly Kitchen staff: it and Kitchen manager both cover five, and only one is complete.
    const staff = jobByKey('kitchen_staff')!;
    const held = staff.grants.map((permissionCode) => ({ permissionCode, scopeType: 'kitchen' }));
    expect(describeAccess(held).job?.key).toBe('kitchen_staff');
  });

  it('refuses to dress a fragment up as a job', () => {
    // One third of Delivery is not Delivery. Below half, it is Custom.
    const held = [{ permissionCode: 'orders.view', scopeType: 'kitchen' }];
    expect(describeAccess(held).job).toBeNull();
    expect(describeAccess(held).label).toContain('Custom');
  });
});

/**
 * The owner's label — `E02-39`.
 *
 * Andy: *"Its own label: 'Owner — everything, by construction'. Don't let it borrow a job name it
 * isn't."* After `E10-64` this file has strong opinions about naming somebody a job they are not,
 * and the owner is the sharpest case: they hold none of Platform admin's twenty-two grants.
 */
describe('the platform owner is named as itself — E02-39', () => {
  it('is labelled "Owner — everything, by construction"', () => {
    expect(describeAccess([], { isOwner: true }).label).toBe(OWNER_LABEL);
    expect(OWNER_LABEL).toBe('Owner — everything, by construction');
  });

  it('does not borrow a job name — it matches no bundle, and must claim none', () => {
    expect(describeAccess([], { isOwner: true }).job).toBeNull();
    expect(describeAccess([], { isOwner: true }).label).not.toContain('Platform admin');
  });

  /*
   * Order matters here. The owner holds nothing, so the empty case would otherwise catch them
   * first and the account that can do everything would be described as holding nothing.
   */
  it('is not described as "No access", which is what an empty grant list otherwise means', () => {
    expect(describeAccess([]).label).toBe('No access — signed in, holds nothing');
    expect(describeAccess([], { isOwner: true }).label).toBe(OWNER_LABEL);
  });

  it('stays the owner even if the account also happens to hold grants', () => {
    // Not the intended state, and not one to render wrongly either: the grants are not what this
    // account can do, so summarising them would understate it.
    expect(describeAccess(jobHeld('kitchen_staff'), { isOwner: true }).label).toBe(OWNER_LABEL);
  });

  it('leaves everybody else exactly as they were — the option defaults off', () => {
    expect(describeAccess(jobHeld('kitchen_staff')).label).toBe('Kitchen staff');
    expect(describeAccess(jobHeld('kitchen_staff'), {}).label).toBe('Kitchen staff');
    expect(describeAccess(jobHeld('kitchen_staff'), { isOwner: false }).label).toBe('Kitchen staff');
  });
});
