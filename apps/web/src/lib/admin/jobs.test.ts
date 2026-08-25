import { describe, expect, it } from 'vitest';

import { SEEDED_PERMISSIONS } from '../backoffice/nav.js';
import { JOBS, describeAccess, jobByKey } from './jobs.js';
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

  it('falls back to Custom rather than guessing', () => {
    // Half of Kitchen staff is not Kitchen staff. Telling somebody it is would be the one failure
    // this screen cannot have: they would believe a cook can hand food over when they cannot.
    const summary = describeAccess(at('kitchen', 'orders.view', 'orders.view_pii'));
    expect(summary.job).toBeNull();
    expect(summary.label).toMatch(/^Custom — 2 permissions/);
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

  it('never claims a job the person cannot actually do', () => {
    // Property check across every job: removing any single grant must stop it matching that job.
    for (const job of JOBS) {
      for (const missing of job.grants) {
        const partial = job.grants.filter((g) => g !== missing);
        const summary = describeAccess(at('kitchen', ...partial));
        expect(summary.job?.key, `${job.key} without ${missing}`).not.toBe(job.key);
      }
    }
  });
});
