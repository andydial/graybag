import { describe, expect, it } from 'vitest';

import { defaultServiceDateInIndia, todayInIndia } from './india.js';

/**
 * `E05-49`. Every case names its instant, so the window that was broken is provable at any hour
 * on any machine — which is the entire point of taking `now` as an argument.
 *
 * The old implementation used `Date.now()` internally, so a test could only assert whatever the
 * clock happened to say when it ran. The bad window is 00:00–05:30 IST: five and a half hours out
 * of twenty-four, so a naive test passes 77% of the time and fails nightly in one timezone, which
 * reads as flakiness and gets retried.
 */

/** `2026-08-14T05:24+05:30` is `2026-08-13T23:54Z`. The instant the web thread proved it at. */
const AT_0524_IST = new Date('2026-08-13T23:54:00Z');

describe('todayInIndia', () => {
  it('is already the next day at 05:24 IST, when UTC still says yesterday', () => {
    expect(AT_0524_IST.toISOString().slice(0, 10)).toBe('2026-08-13'); // what UTC thinks
    expect(todayInIndia(AT_0524_IST)).toBe('2026-08-14'); // what India thinks
  });

  it.each([
    ['2026-08-13T18:31:00Z', '2026-08-14'], // 00:01 IST — the first minute of the Indian day
    ['2026-08-13T18:29:00Z', '2026-08-13'], // 23:59 IST — the last minute of the previous one
    ['2026-08-14T12:00:00Z', '2026-08-14'], // mid-afternoon IST, where UTC and IST agree
  ])('%s → %s', (instant, expected) => {
    expect(todayInIndia(new Date(instant))).toBe(expected);
  });
});

describe('defaultServiceDateInIndia', () => {
  it('offers TOMORROW at 05:24 IST, not today — the bug, stated directly', () => {
    // The old code returned 2026-08-14 here: correct as "tomorrow in UTC", and the same calendar
    // day it already was in India. The cutoff for that day passed at 00:00 IST, five hours
    // earlier, so the parent was shown a day they could not order for.
    expect(defaultServiceDateInIndia(AT_0524_IST)).toBe('2026-08-15');
  });

  it('is always exactly one day after the Indian date, at every hour of the day', () => {
    // The property, rather than a list of instants: whatever "today" is in India, the default is
    // the day after it. Twenty-four samples across a day catch an off-by-one the examples miss.
    for (let hour = 0; hour < 24; hour += 1) {
      const instant = new Date(Date.UTC(2026, 7, 14, hour, 0, 0));
      const today = todayInIndia(instant);
      const next = defaultServiceDateInIndia(instant);
      const expected = new Date(`${today}T00:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() + 1);
      expect(next).toBe(expected.toISOString().slice(0, 10));
    }
  });

  it('never returns today in India, which is the property that matters', () => {
    for (let minute = 0; minute < 24 * 60; minute += 37) {
      const instant = new Date(Date.UTC(2026, 7, 14, 0, minute, 0));
      expect(defaultServiceDateInIndia(instant)).not.toBe(todayInIndia(instant));
    }
  });

  it('crosses a month boundary correctly', () => {
    // 2026-08-31T20:00Z is 01:30 IST on the 1st of September.
    expect(defaultServiceDateInIndia(new Date('2026-08-31T20:00:00Z'))).toBe('2026-09-02');
  });
});
