/**
 * The reads behind Reports are bounded by the range on the screen — `E11-19`.
 *
 * These assert the **query**, not the result, and that is the point. `fetchReportsGrowth` returns
 * exactly what `fetchGrowth` would have returned when the tables are small, so a test that only
 * checked the returned objects would pass just as happily against the unbounded version this
 * replaced. The whole defect was invisible in the output: revenue is filtered by date in the
 * database and stays correct while the usage half beside it quietly undercounts.
 *
 * So what is asserted is that every read carries a date filter and a cap.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { GROWTH_ORDER_COLUMNS, fetchReportsGrowth } from './admin-growth.js';
import { setApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

/** Run the read against empty tables and hand back what it asked for. */
async function queriesFor(from = '2026-08-01', to = '2026-08-26') {
  const fake = fakeTransport([]);
  setApiTransport(fake.transport);
  await fetchReportsGrowth(from, to);
  return fake.queries;
}

const forTable = (queries: Awaited<ReturnType<typeof queriesFor>>, table: string) =>
  queries.filter((q) => q.table === table);

describe('fetchReportsGrowth', () => {
  it('reads five bounded queries and no more', async () => {
    const queries = await queriesFor();
    expect(queries.map((q) => q.table).sort()).toEqual(
      ['app_user', 'guardian_link', 'order', 'order', 'recipient'],
    );
  });

  it('caps every read, so a broken bound fails loudly instead of truncating', async () => {
    // The cap is not a page size. A read that reaches it throws — see READ_CAP. Every query must
    // carry one, because the one without it is the one that silently under-reports.
    const queries = await queriesFor();
    for (const q of queries) {
      expect(q.limits.length, `${q.table} has no cap`).toBeGreaterThan(0);
    }
  });

  it('bounds registrations to the window at both ends', async () => {
    const [users] = forTable(await queriesFor(), 'app_user');
    expect(users!.gteFilters.map((f) => f.column)).toContain('created_at');
    expect(users!.ltFilters.map((f) => f.column)).toContain('created_at');
    // Soft-deleted accounts are not registrations we still have.
    expect(users!.isFilters).toContainEqual({ column: 'deleted_at', value: null });
  });

  /*
   * The two bounds that are arguments rather than obvious ones. A guardian link made by somebody
   * who registered inside the window cannot pre-date their own registration, and neither can an
   * order they placed — so a lower bound on each is sufficient to hold the whole cohort.
   */
  it('bounds guardian links below, which is enough to hold the cohort', async () => {
    const [links] = forTable(await queriesFor(), 'guardian_link');
    expect(links!.gteFilters.map((f) => f.column)).toContain('created_at');
    expect(links!.isFilters).toContainEqual({ column: 'revoked_at', value: null });
  });

  it('bounds the cohort orders below and NOT above, because a cohort is measured to the present', async () => {
    const orders = forTable(await queriesFor(), 'order');
    const cohort = orders.find((q) => q.gteFilters.some((f) => f.column === 'placed_at'));
    expect(cohort, 'no order read bounded by placed_at').toBeDefined();
    // An upper bound here would report yesterday's cohort as converting at zero.
    expect(cohort!.lteFilters.map((f) => f.column)).not.toContain('placed_at');
    expect(cohort!.ltFilters.map((f) => f.column)).not.toContain('placed_at');
  });

  it('bounds the usage orders by service date, exactly as the revenue read does', async () => {
    // The two halves of the screen must count the same orders. `fetchMonthlyRevenue` filters
    // `service_date` between the same two dates; if this drifted, the screen would contradict
    // itself and E11-17's guard would fire.
    const orders = forTable(await queriesFor('2026-08-01', '2026-08-26'), 'order');
    const usage = orders.find((q) => q.gteFilters.some((f) => f.column === 'service_date'));
    expect(usage, 'no order read bounded by service_date').toBeDefined();
    expect(usage!.gteFilters).toContainEqual({ column: 'service_date', value: '2026-08-01' });
    expect(usage!.lteFilters).toContainEqual({ column: 'service_date', value: '2026-08-26' });
  });

  it('reads deleted children by id only, never the live ones', async () => {
    const [recipient] = forTable(await queriesFor(), 'recipient');
    // The complement, deliberately: deletions are rare and registrations are not.
    expect(recipient!.notFilters).toContainEqual({ column: 'deleted_at', operator: 'is', value: null });
    // Non-negotiable #4. There is no name, class or section here and there must never be.
    expect(recipient!.columns).toBe('id');
  });

  it('asks for no child field on either order read', async () => {
    for (const q of forTable(await queriesFor(), 'order')) {
      expect(q.columns).toBe(GROWTH_ORDER_COLUMNS);
      for (const column of ['recipient', 'name', 'class', 'section', 'allerg', '*']) {
        expect(q.columns).not.toContain(column);
      }
    }
  });

  it('widens the instant window past the range, so the precise IST cut is the client’s', async () => {
    // The server bound is a superset on purpose: `created_at` is an instant and the range is an
    // IST calendar date, and `funnelForCohort` re-filters by IST day anyway. Widening can only
    // cost a few rows; narrowing would silently drop a real registration from the cohort.
    const [users] = forTable(await queriesFor('2026-08-10', '2026-08-20'), 'app_user');
    const lower = String(users!.gteFilters.find((f) => f.column === 'created_at')!.value);
    const upper = String(users!.ltFilters.find((f) => f.column === 'created_at')!.value);
    expect(lower.startsWith('2026-08-09')).toBe(true);
    expect(upper.startsWith('2026-08-22')).toBe(true);
    // IST, stated in the value rather than assumed by the server's timezone.
    expect(lower).toContain('+05:30');
    expect(upper).toContain('+05:30');
  });
});

describe('fetchGrowth', () => {
  it('caps all four reads, so an unbounded screen fails loudly rather than shrinking', async () => {
    // Growth is all-time by definition — a cumulative curve and an adoption count cannot be
    // computed from a slice — so this read is not date-bounded and is not meant to be. The cap
    // does not make it cheap; it makes the day it stops being viable a stated failure instead of
    // a screen quietly reporting a smaller product than exists. `E11-24` is the real fix.
    const fake = fakeTransport([]);
    setApiTransport(fake.transport);
    const { fetchGrowth } = await import('./admin-growth.js');
    await fetchGrowth();

    expect(fake.queries).toHaveLength(4);
    for (const q of fake.queries) {
      expect(q.limits.length, `${q.table} has no cap`).toBeGreaterThan(0);
    }
  });

  it('excludes deleted accounts and revoked links, which are not families we have', async () => {
    const fake = fakeTransport([]);
    setApiTransport(fake.transport);
    const { fetchGrowth } = await import('./admin-growth.js');
    await fetchGrowth();

    const users = fake.queries.find((q) => q.table === 'app_user')!;
    expect(users.isFilters).toContainEqual({ column: 'deleted_at', value: null });
    const links = fake.queries.find((q) => q.table === 'guardian_link')!;
    expect(links.isFilters).toContainEqual({ column: 'revoked_at', value: null });
  });
});
