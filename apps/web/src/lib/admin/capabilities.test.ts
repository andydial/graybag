/**
 * The invariants the People panel claims, asserted against the grants it claims them from.
 *
 * Andy stated these as a requirement rather than a preference: *"kitchen staff see only their own
 * kitchen, only child name and allergy badges, and never prices, revenue, parent contact details
 * or another kitchen."*
 *
 * Three things enforce that at different altitudes, and all three are needed:
 *
 * | | |
 * |---|---|
 * | `capabilities.ts` | **describes** it, derived from the bundles so the words cannot go stale |
 * | this file | **enforces** it on the bundles, so a grant cannot be added quietly |
 * | `scripts/test/kitchen-scope.test.mjs` | **proves** it end to end through a real operator's JWT |
 *
 * This one is the cheapest and runs on every push, which is why it is the one that will actually
 * catch the afternoon somebody adds a financial grant to the kitchen bundle for a good reason.
 */
import { describe, expect, it } from 'vitest';

import { JOBS } from './jobs.js';
import { PARENT_BASELINE, allCapabilities, capabilitiesOf } from './capabilities.js';

const jobBy = (key: string) => JOBS.find((j) => j.key === key)!;
const capBy = (jobKey: string, capKey: string) =>
  capabilitiesOf(jobBy(jobKey)).capabilities.find((c) => c.key === capKey)!;

/** Every job whose scope is a kitchen — the ones Andy's rule is about. */
const kitchenJobs = JOBS.filter((j) => j.scopes.includes('kitchen') && !j.scopes.includes('platform'));

describe('the kitchen rule, on the bundles themselves', () => {
  it('finds kitchen-scoped jobs to check, so this suite cannot pass vacuously', () => {
    // Without this, renaming the bundles would empty the list and every assertion below would
    // pass by describing nothing — the failure `E15-23` exists to stop.
    expect(kitchenJobs.length).toBeGreaterThan(0);
  });

  it('gives no kitchen job any financial grant', () => {
    for (const job of kitchenJobs) {
      expect(job.grants, `${job.key} can read money`).not.toContain('orders.view_financials');
      expect(job.grants, `${job.key} can refund`).not.toContain('orders.refund');
    }
  });

  it('gives no kitchen job any way to read a parent', () => {
    for (const job of kitchenJobs) {
      expect(job.grants, `${job.key} can read accounts`).not.toContain('users.view');
      expect(job.grants, `${job.key} can manage accounts`).not.toContain('users.manage');
    }
  });

  it('gives no kitchen job the power to grant access to anybody', () => {
    for (const job of kitchenJobs) {
      expect(job.grants, `${job.key} can grant access`).not.toContain('grants.manage');
    }
  });

  it('never scopes a kitchen job at platform, which would be every kitchen', () => {
    for (const job of kitchenJobs) {
      expect(job.scopes, `${job.key} reaches every kitchen`).not.toContain('platform');
    }
  });
});

describe('capabilitiesOf', () => {
  it('says a kitchen job cannot see money, and says it because the grant is absent', () => {
    const money = capBy('kitchen_staff', 'money');
    expect(money.has).toBe(false);
    expect(money.detail).toContain('No price');
  });

  it('says a kitchen job CAN see children, and marks that rather than ticking it quietly', () => {
    // Not a fault — the kitchen cannot hand the right bag to the right child without it. But it
    // is the line where a scope mistake stops being an inconvenience, so the panel marks it.
    const children = capBy('kitchen_staff', 'children');
    expect(children.has).toBe(true);
    expect(children.sensitive).toBe(true);
  });

  it('separates cancelling from refunding, because the bundles do', () => {
    expect(capBy('kitchen_staff', 'cancel').has).toBe(true);
    expect(capBy('kitchen_staff', 'refund').has).toBe(false);
  });

  it('describes the platform admin as reaching everything', () => {
    const admin = capabilitiesOf(jobBy('platform_admin'));
    expect(admin.reach).toContain('Every school');
    expect(admin.capabilities.filter((c) => c.has).length).toBe(admin.capabilities.length);
  });

  it('describes a school-scoped job as reaching one school', () => {
    expect(capabilitiesOf(jobBy('school_office')).reach).toContain('own school');
  });

  it('gives the school office no order access at all, which is what makes it safe to hand out', () => {
    const office = capabilitiesOf(jobBy('school_office'));
    for (const key of ['orders', 'money', 'children', 'parents']) {
      expect(office.capabilities.find((c) => c.key === key)!.has, key).toBe(false);
    }
  });

  /*
   * The property that makes the panel trustworthy: every line is a function of the grants. If a
   * bundle gains a grant, the corresponding line flips without anybody editing prose.
   */
  it('flips a line when the bundle gains the grant behind it', () => {
    const before = capabilitiesOf(jobBy('kitchen_staff')).capabilities.find((c) => c.key === 'money')!;
    const after = capabilitiesOf({
      ...jobBy('kitchen_staff'),
      grants: [...jobBy('kitchen_staff').grants, 'orders.view_financials'],
    }).capabilities.find((c) => c.key === 'money')!;

    expect(before.has).toBe(false);
    expect(after.has).toBe(true);
    expect(after.detail).not.toBe(before.detail);
  });
});

describe('the panel as a whole', () => {
  it('covers every job, so none is silently missing from the explanation', () => {
    expect(allCapabilities().map((c) => c.job.key)).toEqual(JOBS.map((j) => j.key));
  });

  it('states the parent baseline, because access is granted and not registered for', () => {
    expect(PARENT_BASELINE.reach).toContain('own children');
  });

  it('gives every capability a detail line, never a bare tick', () => {
    // A tick with no sentence is a claim nobody can check. Andy's rule for alerts — "every alert
    // must name what to do about it" — is the same rule read from the other end.
    for (const { job, capabilities } of allCapabilities()) {
      for (const c of capabilities) {
        expect(c.detail.length, `${job.key}/${c.key}`).toBeGreaterThan(20);
      }
    }
  });
});

describe('a job with no order access at all', () => {
  it('does not tell them they see an anonymous order when they see no order', () => {
    // The school office holds `reports.view` and nothing else. "You see an order without knowing
    // whose it is" would be false, and a panel whose job is being true cannot afford a line that
    // is nearly right — the small inaccuracies are what cost it its authority.
    const office = capabilitiesOf(jobBy('school_office'));
    const children = office.capabilities.find((c) => c.key === 'children')!;
    expect(children.has).toBe(false);
    expect(children.detail).not.toContain('without knowing whose');
    expect(children.detail).toContain('cannot see an order');
  });

  it('describes their money line as the report they do get, not as an absent order total', () => {
    const money = capabilitiesOf(jobBy('school_office')).capabilities.find((c) => c.key === 'money')!;
    expect(money.detail).toContain('own school');
  });

  it('still says the kitchen sees an order it cannot attribute, which is the other case', () => {
    const children = capBy('delivery', 'children');
    expect(children.has).toBe(true);
    // Delivery holds view_pii, so this is the "can" branch — the contrast that makes the
    // school-office wording worth having.
    expect(children.detail).toContain('right bag');
  });
});
