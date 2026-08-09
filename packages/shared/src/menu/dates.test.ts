import { describe, expect, it } from 'vitest';

import {
  InvalidServiceDateError,
  isServiceDate,
  isWithin,
  isoWeekday,
  parseServiceDate,
} from './dates.js';

describe('isoWeekday', () => {
  it('maps ISO weekdays with Monday = 1 and Sunday = 7', () => {
    // 2026-08-03 is a Monday.
    expect(isoWeekday('2026-08-03')).toBe(1);
    expect(isoWeekday('2026-08-04')).toBe(2);
    expect(isoWeekday('2026-08-05')).toBe(3);
    expect(isoWeekday('2026-08-06')).toBe(4);
    expect(isoWeekday('2026-08-07')).toBe(5);
    expect(isoWeekday('2026-08-08')).toBe(6);
    expect(isoWeekday('2026-08-09')).toBe(7);
  });

  it('agrees with the platform for a century of dates, in UTC', () => {
    // Cross-check against Date's own UTC weekday. This is a *check*, not the
    // implementation — see the next test for why the implementation cannot use it.
    for (let i = 0; i < 36_525; i += 7) {
      const probe = new Date(Date.UTC(2000, 0, 1 + i));
      const iso = probe.toISOString().slice(0, 10);
      const expected = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
      expect(isoWeekday(iso)).toBe(expected);
    }
  });

  /**
   * The bug this module exists to make impossible.
   *
   * `new Date('2026-08-09')` is midnight **UTC**. `getDay()` reads it in the runner's local
   * zone, so west of Greenwich it reports the previous day. A menu unavailable on Sundays
   * would be orderable on Sunday for some users and not others, and a test written with
   * `getDay()` would pass in London and fail in New York — or worse, pass in CI and be wrong
   * on a device in Mohali. `G9` recorded this exact class of bug for the financial year.
   */
  it('does not depend on the process timezone', () => {
    const original = process.env.TZ;
    try {
      const answers = new Set<number>();
      for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        answers.add(isoWeekday('2026-08-09'));
      }
      expect([...answers]).toEqual([7]);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('handles leap days and century rules', () => {
    expect(isoWeekday('2024-02-29')).toBe(4); // Thursday
    expect(isoWeekday('2000-02-29')).toBe(2); // Tuesday — 2000 IS a leap year
    expect(isoWeekday('1900-03-01')).toBe(4); // Thursday — 1900 is NOT
  });
});

describe('parseServiceDate', () => {
  it('rejects anything that is not YYYY-MM-DD', () => {
    for (const bad of ['2026-8-9', '09-08-2026', '2026-08-09T00:00:00Z', '', 'today']) {
      expect(() => parseServiceDate(bad)).toThrow(InvalidServiceDateError);
    }
  });

  it('rejects dates the calendar does not have', () => {
    // The trap: Date.UTC(2026, 1, 30) silently rolls over to 2 March. Without the
    // round-trip check this parses "successfully" and every downstream answer is for the
    // wrong day.
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29']) {
      expect(() => parseServiceDate(bad)).toThrow(InvalidServiceDateError);
    }
  });

  it('accepts real dates', () => {
    expect(isServiceDate('2026-02-28')).toBe(true);
    expect(isServiceDate('2024-02-29')).toBe(true);
  });
});

describe('isWithin', () => {
  it('treats validFrom as inclusive and validTo as EXCLUSIVE', () => {
    // Matches the schema's '[)' daterange. Getting validTo backwards produces a one-day
    // overlap the database would reject on insert but that a reader would happily select.
    expect(isWithin('2026-08-01', '2026-08-01', '2026-09-01')).toBe(true);
    expect(isWithin('2026-08-31', '2026-08-01', '2026-09-01')).toBe(true);
    expect(isWithin('2026-09-01', '2026-08-01', '2026-09-01')).toBe(false);
    expect(isWithin('2026-07-31', '2026-08-01', '2026-09-01')).toBe(false);
  });

  it('treats a null validTo as open-ended', () => {
    expect(isWithin('2099-01-01', '2026-08-01', null)).toBe(true);
    expect(isWithin('2026-07-31', '2026-08-01', null)).toBe(false);
  });
});
