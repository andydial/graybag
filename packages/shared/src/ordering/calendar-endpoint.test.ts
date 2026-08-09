import { describe, expect, it } from 'vitest';

import {
  CALENDAR_MAX_AGE_SECONDS,
  CALENDAR_MAX_RANGE_DAYS,
  orderCalendarResponse,
  parseCalendarRequest,
} from './calendar-endpoint.js';

const SCHOOL = '50000000-7e57-0000-0000-000000000511';

const ROWS = [
  { service_date: '2026-08-10', cutoff_at: '2026-08-09T18:30:00Z', is_orderable: true, reason: null },
  {
    service_date: '2026-08-11',
    cutoff_at: '2026-08-10T18:30:00Z',
    is_orderable: false,
    reason: 'cutoff_passed',
  },
];

const body = (response: { body: string }) => JSON.parse(response.body);

describe('parseCalendarRequest', () => {
  it('accepts a school and an inclusive date range', () => {
    expect(parseCalendarRequest(SCHOOL, '2026-08-10', '2026-08-16')).toEqual({
      schoolId: SCHOOL,
      from: '2026-08-10',
      to: '2026-08-16',
    });
  });

  it('lowercases the school id', () => {
    expect(parseCalendarRequest(SCHOOL.toUpperCase(), '2026-08-10', '2026-08-16')?.schoolId).toBe(
      SCHOOL,
    );
  });

  it('rejects a school that is not a uuid', () => {
    expect(parseCalendarRequest('not-a-uuid', '2026-08-10', '2026-08-16')).toBeNull();
  });

  it('rejects a missing school', () => {
    expect(parseCalendarRequest(null, '2026-08-10', '2026-08-16')).toBeNull();
  });

  // A date is `YYYY-MM-DD` in the school's timezone, never an instant (G9). Accepting an ISO
  // datetime here would let a caller send `2026-08-10T23:50Z` and get the previous day's
  // calendar in IST.
  it('rejects a datetime where a service date belongs', () => {
    expect(parseCalendarRequest(SCHOOL, '2026-08-10T00:00:00Z', '2026-08-16')).toBeNull();
  });

  it('rejects a date that is not a real day', () => {
    expect(parseCalendarRequest(SCHOOL, '2026-02-30', '2026-03-05')).toBeNull();
  });

  it('rejects a malformed date', () => {
    expect(parseCalendarRequest(SCHOOL, '10-08-2026', '2026-08-16')).toBeNull();
  });

  // The horizon is bounded so one request cannot ask for ten years of days. The default
  // max_advance_order_days is 14, so a month is already generous.
  it('rejects a range longer than the cap', () => {
    expect(parseCalendarRequest(SCHOOL, '2026-08-10', '2027-08-10')).toBeNull();
  });

  it('accepts a range exactly at the cap', () => {
    const from = new Date(Date.UTC(2026, 7, 10));
    const to = new Date(from.getTime() + (CALENDAR_MAX_RANGE_DAYS - 1) * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    expect(parseCalendarRequest(SCHOOL, iso(from), iso(to))).not.toBeNull();
  });

  // A backwards range is a client bug, and the SQL answers it with no rows. Refusing it here
  // means the caller finds out rather than rendering an empty month and wondering.
  it('rejects a backwards range', () => {
    expect(parseCalendarRequest(SCHOOL, '2026-08-16', '2026-08-10')).toBeNull();
  });

  it('accepts a single-day range', () => {
    expect(parseCalendarRequest(SCHOOL, '2026-08-10', '2026-08-10')).not.toBeNull();
  });
});

describe('orderCalendarResponse', () => {
  it('is a 400 with a hint when the request is malformed', () => {
    const response = orderCalendarResponse(null, '2026-08-10', '2026-08-16', []);

    expect(response.status).toBe(400);
    expect(body(response).hint).toMatch(/school=/);
  });

  it('returns the days', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-11', ROWS);

    expect(response.status).toBe(200);
    expect(body(response).days).toHaveLength(2);
  });

  // The wire shape is camelCase and carries the cutoff instant, because the client's job is
  // to compare and to render — never to recompute. The arithmetic is §9.1's and lives in SQL.
  it('carries each day, its cutoff instant and why it is closed', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-11', ROWS);

    expect(body(response).days[1]).toEqual({
      serviceDate: '2026-08-11',
      cutoffAt: '2026-08-10T18:30:00Z',
      isOrderable: false,
      reason: 'cutoff_passed',
    });
  });

  it('omits the reason on an open day rather than inventing one', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-11', ROWS);
    expect(body(response).days[0].reason).toBeNull();
  });

  // An empty calendar is a legitimate answer (a school with every day past its cutoff), and
  // it is not a 404 — the school exists and we answered the question.
  it('is a 200 with no days rather than a 404 when nothing is orderable', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-16', []);

    expect(response.status).toBe(200);
    expect(body(response).days).toEqual([]);
  });

  // §9.2 E1: this is advisory. Saying so on the wire keeps a future client author from
  // treating a cached calendar as permission.
  it('says on the wire that it is advisory', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-11', ROWS);
    expect(body(response).advisory).toBe(true);
  });

  // Short, because the answer changes at every cutoff — but non-zero, because a calendar is
  // redrawn as the user pages through months and each redraw is a request on a bad line.
  it('may be cached briefly', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-11', ROWS);
    expect(response.headers['cache-control']).toBe(`private, max-age=${CALENDAR_MAX_AGE_SECONDS}`);
  });

  // Private, not public: the answer depends on the school's config chain and, through the
  // cutoff, on when it was asked. A shared cache serving one school's calendar to another is
  // the kind of bug that only shows up behind a CDN.
  it('is privately cached, never shared', () => {
    const response = orderCalendarResponse(SCHOOL, '2026-08-10', '2026-08-11', ROWS);
    expect(response.headers['cache-control']).toMatch(/^private,/);
  });
});
