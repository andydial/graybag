import { describe, expect, it } from 'vitest';

import { STUCK_LIMIT, funnelForCohort, growth, istDate, linePath, usageInRange } from './growth.js';
import type { GrowthChild, GrowthLink, GrowthUser } from './growth.js';

const TODAY = '2026-08-20';

const user = (id: string, createdAt: string, email: string | null = `${id}@example.invalid`): GrowthUser =>
  ({ id, createdAt, email });
const child = (id: string, schoolId: string, createdAt = '2026-08-01T00:00:00Z'): GrowthChild =>
  ({ id, schoolId, createdAt });
const link = (userId: string, recipientId: string): GrowthLink => ({ userId, recipientId });

const SCHOOLS = [
  { id: 's1', name: 'Amity International' },
  { id: 's2', name: 'Gem Public' },
];

describe('istDate', () => {
  it('puts an evening signup on the day it happened in India', () => {
    // 19:00 IST on the 20th is 13:30Z on the 20th — same day either way.
    expect(istDate('2026-08-20T13:30:00Z')).toBe('2026-08-20');
  });

  it('keeps a late-evening signup out of the previous day', () => {
    // 23:30 IST on the 20th is 18:00Z on the 20th. Bucketing by the UTC date is right here...
    expect(istDate('2026-08-20T18:00:00Z')).toBe('2026-08-20');
    // ...and wrong here: 01:00 IST on the 21st is 19:30Z on the 20th. A signup a parent made
    // after midnight belongs to the 21st, which is the date they would say it happened.
    expect(istDate('2026-08-20T19:30:00Z')).toBe('2026-08-21');
  });

  it('returns empty for something unparseable rather than throwing', () => {
    expect(istDate('not a date')).toBe('');
  });
});

describe('growth — the daily series', () => {
  it('counts registrations per day and runs a cumulative total', () => {
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z'), user('u2', '2026-08-18T07:00:00Z'), user('u3', '2026-08-20T06:00:00Z')],
      [], [], SCHOOLS, TODAY,
    );
    expect(g.daily.map((d) => [d.date, d.registrations, d.cumulative])).toEqual([
      ['2026-08-18', 2, 2],
      ['2026-08-19', 0, 2],
      ['2026-08-20', 1, 3],
    ]);
  });

  it('includes days with no signups, so a quiet week looks quiet', () => {
    // Plotting only the days that had a registration turns a flat fortnight into a line that
    // climbs steadily. That is the one thing a growth chart must not do.
    const g = growth([user('u1', '2026-08-15T06:00:00Z')], [], [], SCHOOLS, TODAY);
    expect(g.daily).toHaveLength(6);
    expect(g.daily.filter((d) => d.registrations === 0)).toHaveLength(5);
    expect(g.daily.at(-1)?.cumulative).toBe(1);
  });

  it('is empty, not broken, before anybody registers', () => {
    const g = growth([], [], [], SCHOOLS, TODAY);
    expect(g.daily).toEqual([]);
    expect(g.totalUsers).toBe(0);
  });
});

describe('growth — by school', () => {
  it('counts a family once per school, however many children they have', () => {
    // Two siblings at one school is one family. Counting two overstates reach by exactly the
    // families most likely to be a reference.
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z')],
      [child('c1', 's1'), child('c2', 's1')],
      [link('u1', 'c1'), link('u1', 'c2')],
      SCHOOLS, TODAY,
    );
    const amity = g.bySchool.find((s) => s.schoolId === 's1')!;
    expect(amity.guardians).toBe(1);
    expect(amity.children).toBe(2);
  });

  it('counts both guardians of one child', () => {
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z'), user('u2', '2026-08-18T06:00:00Z')],
      [child('c1', 's1')],
      [link('u1', 'c1'), link('u2', 'c1')],
      SCHOOLS, TODAY,
    );
    expect(g.bySchool.find((s) => s.schoolId === 's1')?.guardians).toBe(2);
  });

  it('counts a parent at each school they have a child at', () => {
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z')],
      [child('c1', 's1'), child('c2', 's2')],
      [link('u1', 'c1'), link('u1', 'c2')],
      SCHOOLS, TODAY,
    );
    expect(g.bySchool.map((s) => s.guardians)).toEqual([1, 1]);
  });

  it('puts the biggest school first, not the alphabetically first', () => {
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z'), user('u2', '2026-08-18T06:00:00Z')],
      [child('c1', 's2'), child('c2', 's2')],
      [link('u1', 'c1'), link('u2', 'c2')],
      SCHOOLS, TODAY,
    );
    expect(g.bySchool[0]?.name).toBe('Gem Public');
  });

  it('lists a school with nobody at it rather than hiding it', () => {
    // A school with no families is the most actionable row on the screen.
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z')],
      [child('c1', 's1')], [link('u1', 'c1')], SCHOOLS, TODAY,
    );
    expect(g.bySchool.find((s) => s.schoolId === 's2')).toMatchObject({ guardians: 0, children: 0 });
  });

  it('ignores a link pointing at a child that is not readable', () => {
    // RLS can return a link whose recipient row was filtered. Counting it would attribute a
    // family to no school and inflate the total.
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z')], [], [link('u1', 'missing')], SCHOOLS, TODAY,
    );
    expect(g.bySchool.every((s) => s.guardians === 0)).toBe(true);
    expect(g.usersWithoutChildren).toBe(1);
  });
});

describe('growth — the conversion gap', () => {
  it('counts accounts that registered and never added a child', () => {
    // `AR7`: an account with no child cannot order. This is the drop-off, not a curiosity.
    const g = growth(
      [user('u1', '2026-08-18T06:00:00Z'), user('u2', '2026-08-18T06:00:00Z')],
      [child('c1', 's1')], [link('u1', 'c1')], SCHOOLS, TODAY,
    );
    expect(g.usersWithoutChildren).toBe(1);
  });
});

describe('growth — recent windows', () => {
  it('compares the last 7 days against the 7 before them', () => {
    const g = growth(
      [
        user('a', '2026-08-19T06:00:00Z'), // within 7
        user('b', '2026-08-16T06:00:00Z'), // within 7
        user('c', '2026-08-10T06:00:00Z'), // previous 7
      ],
      [], [], SCHOOLS, TODAY,
    );
    const week = g.recent.find((r) => r.days === 7)!;
    expect(week.now).toBe(2);
    expect(week.previous).toBe(1);
  });
});

describe('linePath', () => {
  it('scales to the viewBox with the largest value at the top', () => {
    expect(linePath([0, 5, 10], 100, 50)).toBe('0.0,50.0 50.0,25.0 100.0,0.0');
  });

  it('does not divide by zero on a flat series of zeroes', () => {
    // Every value zero is the state on day one, and it must render a flat line rather than NaN.
    expect(linePath([0, 0], 100, 50)).toBe('0.0,50.0 100.0,50.0');
  });

  it('returns nothing for an empty series', () => {
    expect(linePath([], 100, 50)).toBe('');
  });
});

describe('the funnel (E11-15)', () => {
  const paid = (userId: string, day: string, status = 'paid') =>
    ({ customerUserId: userId, placedAt: `${day}T09:00:00Z`, status, totalPaise: 10000 });

  const base = () => ({
    users: [user('u1', '2026-08-01T06:00:00Z'), user('u2', '2026-08-01T06:00:00Z'),
            user('u3', '2026-08-01T06:00:00Z'), user('u4', '2026-08-01T06:00:00Z')],
    children: [child('c1', 's1'), child('c2', 's1'), child('c3', 's1')],
    links: [link('u1', 'c1'), link('u2', 'c2'), link('u3', 'c3')],
  });

  const stepOf = (g: ReturnType<typeof growth>, key: string) => g.funnel.find((f) => f.key === key)!;

  it('counts each step and the drop-off between them as a number', () => {
    // Andy: "Show the drop-off between each step as a number, not just a percentage."
    const b = base();
    const g = growth(b.users, b.children, b.links, SCHOOLS, TODAY, [
      paid('u1', '2026-08-05'), paid('u1', '2026-08-12'), paid('u2', '2026-08-06'),
    ]);
    expect(stepOf(g, 'registered').reached).toBe(4);
    expect(stepOf(g, 'addedChild').reached).toBe(3);
    expect(stepOf(g, 'addedChild').lost).toBe(1);
    expect(stepOf(g, 'firstOrder').reached).toBe(2);
    expect(stepOf(g, 'firstOrder').lost).toBe(1);
    expect(stepOf(g, 'orderedAgain').reached).toBe(1);
    expect(stepOf(g, 'orderedAgain').lost).toBe(1);
  });

  it('does not count an unpaid order as a conversion', () => {
    // Reaching checkout and never paying is not buying anything. Counting it would make the
    // funnel flatter than the business actually is, which is the one direction it must not lie in.
    const b = base();
    const g = growth(b.users, b.children, b.links, SCHOOLS, TODAY, [
      paid('u1', '2026-08-05', 'pending_payment'), paid('u2', '2026-08-05', 'cancelled'),
    ]);
    expect(stepOf(g, 'firstOrder').reached).toBe(0);
  });

  it('counts preparing and delivered as having ordered', () => {
    const b = base();
    const g = growth(b.users, b.children, b.links, SCHOOLS, TODAY, [
      paid('u1', '2026-08-05', 'preparing'), paid('u2', '2026-08-05', 'delivered'),
    ]);
    expect(stepOf(g, 'firstOrder').reached).toBe(2);
  });

  it('gives every step something to do about the people who dropped', () => {
    // "Every alert must name what to do about it" applies to a funnel too — a step that only
    // states a number is a step nobody acts on.
    const b = base();
    const g = growth(b.users, b.children, b.links, SCHOOLS, TODAY, []);
    for (const s of g.funnel) expect(s.action.length, s.key).toBeGreaterThan(20);
  });

  it('has no rate on the first step, and none when the step before was empty', () => {
    const g = growth([], [], [], SCHOOLS, TODAY, []);
    expect(stepOf(g, 'registered').rate).toBeNull();
    expect(stepOf(g, 'addedChild').rate).toBeNull();
  });

  it('counts a parent active only if they ordered in the last seven days', () => {
    const b = base();
    const g = growth(b.users, b.children, b.links, SCHOOLS, TODAY, [
      paid('u1', '2026-08-19'),  // within 7 of 2026-08-20
      paid('u2', '2026-08-01'),  // long before
    ]);
    expect(g.activeParents).toBe(1);
  });

  it('lists stuck parents by email, newest first, and nothing about a child', () => {
    const users = [
      user('old', '2026-08-01T06:00:00Z', 'old@example.invalid'),
      user('new', '2026-08-19T06:00:00Z', 'new@example.invalid'),
      user('has', '2026-08-10T06:00:00Z', 'has@example.invalid'),
    ];
    const g = growth(users, [child('c1', 's1')], [link('has', 'c1')], SCHOOLS, TODAY, []);
    expect(g.stuck.map((s) => s.email)).toEqual(['new@example.invalid', 'old@example.invalid']);
    // The shape carries an address and a date. There is nowhere to put a child even by mistake.
    expect(Object.keys(g.stuck[0]!).sort()).toEqual(['email', 'registered']);
  });

  it('caps the stuck list, because it is a worklist and not an export', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      user(`u${i}`, '2026-08-01T06:00:00Z', `p${i}@example.invalid`));
    const g = growth(many, [], [], SCHOOLS, TODAY, []);
    expect(g.stuck).toHaveLength(STUCK_LIMIT);
  });

  it('averages only over orders that were paid', () => {
    const b = base();
    const g = growth(b.users, b.children, b.links, SCHOOLS, TODAY, [
      { customerUserId: 'u1', placedAt: '2026-08-05T09:00:00Z', status: 'paid', totalPaise: 20000 },
      { customerUserId: 'u2', placedAt: '2026-08-05T09:00:00Z', status: 'pending_payment', totalPaise: 99999 },
    ]);
    expect(g.averageOrderPaise).toBe(20000);
  });
});

describe('funnelForCohort — the funnel that moves to Reports (E11-16)', () => {
  const paid = (userId: string, day: string, status = 'paid') =>
    ({ customerUserId: userId, placedAt: `${day}T09:00:00Z`, status, totalPaise: 10000 });

  // Three registered inside the range, one before it.
  const users = [
    user('in1', '2026-08-10T06:00:00Z'),
    user('in2', '2026-08-12T06:00:00Z'),
    user('in3', '2026-08-14T06:00:00Z'),
    user('before', '2026-07-01T06:00:00Z'),
  ];
  const children = [child('c1', 's1'), child('c2', 's1'), child('cb', 's1')];
  const links = [link('in1', 'c1'), link('in2', 'c2'), link('before', 'cb')];

  it('counts only the parents who registered inside the range', () => {
    const { cohort, steps } = funnelForCohort(users, links, children, [], '2026-08-01', '2026-08-20');
    expect(cohort).toBe(3);
    expect(steps.find((s) => s.key === 'registered')!.reached).toBe(3);
  });

  it('excludes a parent who registered before the range, however far they got', () => {
    // The one that makes it a cohort rather than a filter. `before` added a child and ordered
    // twice; none of that belongs to a range they were not in.
    const { steps } = funnelForCohort(
      users, links, children,
      [paid('before', '2026-08-05'), paid('before', '2026-08-06')],
      '2026-08-01', '2026-08-20',
    );
    expect(steps.find((s) => s.key === 'addedChild')!.reached).toBe(2);
    expect(steps.find((s) => s.key === 'firstOrder')!.reached).toBe(0);
  });

  it('counts an order placed AFTER the range, because the cohort is measured to the present', () => {
    // A parent who registers on the 14th and orders on the 22nd converted. Truncating at the end
    // of the range would make every recent range look terrible and would make a past range
    // improve each time you looked at it — a number that changes when nothing happened.
    const { steps } = funnelForCohort(
      users, links, children, [paid('in1', '2026-08-22')], '2026-08-01', '2026-08-20',
    );
    expect(steps.find((s) => s.key === 'firstOrder')!.reached).toBe(1);
  });

  it('reports the drop at each step as a count', () => {
    const { steps } = funnelForCohort(
      users, links, children, [paid('in1', '2026-08-15')], '2026-08-01', '2026-08-20',
    );
    expect(steps.find((s) => s.key === 'addedChild')!.lost).toBe(1);   // in3 added none
    expect(steps.find((s) => s.key === 'firstOrder')!.lost).toBe(1);   // in2 never ordered
  });

  it('does not count an unpaid order as a conversion', () => {
    const { steps } = funnelForCohort(
      users, links, children, [paid('in1', '2026-08-15', 'pending_payment')], '2026-08-01', '2026-08-20',
    );
    expect(steps.find((s) => s.key === 'firstOrder')!.reached).toBe(0);
  });

  it('is empty rather than broken when nobody registered in the range', () => {
    const { cohort, steps } = funnelForCohort(users, links, children, [], '2026-01-01', '2026-01-31');
    expect(cohort).toBe(0);
    expect(steps.every((s) => s.reached === 0)).toBe(true);
    expect(steps.find((s) => s.key === 'addedChild')!.rate).toBeNull();
  });
});

describe('usageInRange — E11-17', () => {
  /** A paid order served on `serviceDate`, placed the evening before in IST. */
  const served = (
    customerUserId: string, serviceDate: string, schoolId = 's1', status = 'delivered',
  ) => ({
    customerUserId, serviceDate, schoolId, status, totalPaise: 12_600,
    placedAt: `${serviceDate}T02:00:00Z`,
  });

  it('counts a parent once however many times they ordered', () => {
    const u = usageInRange(
      [served('p1', '2026-08-10'), served('p1', '2026-08-11'), served('p2', '2026-08-11')],
      '2026-08-01', '2026-08-20',
    );
    expect(u.activeParents).toBe(2);
    expect(u.paidOrders).toBe(3);
    expect(u.ordersPerParent).toBeCloseTo(1.5);
  });

  it('counts a second order in the range as a repeat, and one order as not', () => {
    const u = usageInRange(
      [served('p1', '2026-08-10'), served('p1', '2026-08-11'), served('p2', '2026-08-11')],
      '2026-08-01', '2026-08-20',
    );
    expect(u.repeatParents).toBe(1);
    expect(u.repeatRate).toBeCloseTo(0.5);
  });

  /*
   * The reason `service_date` was added to the growth read at all. Every other number on Reports
   * is bucketed on the service date, and an order placed at 21:00 IST on the 9th for the 10th is
   * a UTC 15:30 on the 9th — so counting on `placed_at` would put it in a different bucket from
   * the money it earned, on the same screen.
   */
  it('buckets on the service date rather than when it was placed', () => {
    const order = {
      customerUserId: 'p1', serviceDate: '2026-08-10', schoolId: 's1',
      status: 'delivered', totalPaise: 12_600, placedAt: '2026-08-09T15:30:00Z',
    };
    expect(usageInRange([order], '2026-08-10', '2026-08-10').paidOrders).toBe(1);
    expect(usageInRange([order], '2026-08-09', '2026-08-09').paidOrders).toBe(0);
  });

  it('ignores unpaid and cancelled orders, which are not usage', () => {
    const u = usageInRange(
      [served('p1', '2026-08-10', 's1', 'pending_payment'),
       served('p2', '2026-08-10', 's1', 'cancelled'),
       served('p3', '2026-08-10')],
      '2026-08-01', '2026-08-20',
    );
    expect(u.activeParents).toBe(1);
    expect(u.paidOrders).toBe(1);
  });

  it('breaks active parents down by school, counting a parent once per school', () => {
    const u = usageInRange(
      [served('p1', '2026-08-10', 's1'), served('p1', '2026-08-11', 's1'),
       served('p2', '2026-08-11', 's2')],
      '2026-08-01', '2026-08-20',
    );
    expect(u.bySchool.get('s1')).toBe(1);
    expect(u.bySchool.get('s2')).toBe(1);
  });

  it('honours the school filter, so usage agrees with the money above it', () => {
    const orders = [served('p1', '2026-08-10', 's1'), served('p2', '2026-08-11', 's2')];
    expect(usageInRange(orders, '2026-08-01', '2026-08-20', 's2').activeParents).toBe(1);
    expect(usageInRange(orders, '2026-08-01', '2026-08-20', 's2').paidOrders).toBe(1);
  });

  it('reports a null repeat rate rather than 0% when nobody ordered', () => {
    // 0% reads as "they came and did not come back"; null is "there is nothing to divide".
    const u = usageInRange([], '2026-08-01', '2026-08-20');
    expect(u.activeParents).toBe(0);
    expect(u.repeatRate).toBeNull();
    expect(u.ordersPerParent).toBe(0);
  });

  it('skips an order with no service date rather than guessing one', () => {
    const u = usageInRange(
      [{ customerUserId: 'p1', placedAt: '2026-08-10T02:00:00Z', status: 'paid', totalPaise: 100 }],
      '2026-08-01', '2026-08-20',
    );
    expect(u.paidOrders).toBe(0);
  });
});
