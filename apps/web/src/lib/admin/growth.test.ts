import { describe, expect, it } from 'vitest';

import { growth, istDate, linePath } from './growth.js';
import type { GrowthChild, GrowthLink, GrowthUser } from './growth.js';

const TODAY = '2026-08-20';

const user = (id: string, createdAt: string): GrowthUser => ({ id, createdAt });
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
