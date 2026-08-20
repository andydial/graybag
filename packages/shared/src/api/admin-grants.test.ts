import { afterEach, describe, expect, it } from 'vitest';

import { ACCOUNT_SEARCH_LIMIT, fetchAccess, searchAccounts, setApiTransport } from './index.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

const install = (rows: unknown) => {
  const fake = fakeTransport(rows);
  setApiTransport(fake.transport);
  return fake;
};

describe('fetchAccess — reads the grants, then only the accounts they name (E10-46)', () => {
  it('never selects the whole user table', async () => {
    // The regression this exists for. It used to `select` every `app_user` row so the screen
    // could render a card each — fine at four accounts, an unbounded read the moment parents
    // register. Andy: "how will this list look like in 1 week where 400 people have registered?"
    const fake = install([]);
    await fetchAccess();

    const userQueries = fake.queries.filter((q) => q.table === 'app_user');
    for (const q of userQueries) {
      expect(q.inFilters.length, 'an app_user read must be scoped by id').toBeGreaterThan(0);
    }
  });

  it('does not read app_user at all when nobody holds a grant', async () => {
    // Nothing to look up. A query with an empty `in` list is a query that returns nothing and
    // still costs a round trip on a school-gate connection.
    const fake = install([]);
    await fetchAccess();
    expect(fake.queries.some((q) => q.table === 'app_user')).toBe(false);
  });

  it('reads permission_grant first and excludes revoked grants', async () => {
    const fake = install([]);
    await fetchAccess();
    expect(fake.queries[0]?.table).toBe('permission_grant');
    // `eq('revoked_at', null)` renders as `= null`, which is never true — so a revoked grant
    // would be filtered by nothing at all. The same trap `fetchRecipients` hit.
    expect(fake.queries[0]?.isFilters).toContainEqual({ column: 'revoked_at', value: null });
  });
});

describe('searchAccounts (E10-46)', () => {
  it('returns nothing for an empty or one-character term', async () => {
    // An empty box must return nobody rather than everybody, and one letter matches most of the
    // table — which is never what somebody means.
    const fake = install([]);
    expect(await searchAccounts('')).toEqual([]);
    expect(await searchAccounts('  ')).toEqual([]);
    expect(await searchAccounts('a')).toEqual([]);
    expect(fake.queries).toHaveLength(0);
  });

  it('searches in the database, not the browser', async () => {
    const fake = install([]);
    await searchAccounts('priya');
    expect(fake.queries[0]?.table).toBe('app_user');
    expect(fake.queries[0]?.orFilters[0]).toContain('email.ilike');
  });

  it('matches email or either name, which a chain of eq cannot express', async () => {
    const fake = install([]);
    await searchAccounts('priya');
    const filter = fake.queries[0]?.orFilters[0] ?? '';
    expect(filter).toContain('email.ilike.%priya%');
    expect(filter).toContain('first_name.ilike.%priya%');
    expect(filter).toContain('last_name.ilike.%priya%');
  });

  it('caps the result, because this answers “find that person”, not “browse the table”', async () => {
    const fake = install([]);
    await searchAccounts('priya');
    expect(fake.queries[0]?.limits).toContain(ACCOUNT_SEARCH_LIMIT);
  });

  it('excludes deleted accounts', async () => {
    const fake = install([]);
    await searchAccounts('priya');
    expect(fake.queries[0]?.isFilters).toContainEqual({ column: 'deleted_at', value: null });
  });

  it('escapes a wildcard so it narrows the search rather than widening it', async () => {
    // `%` and `_` are wildcards in `ilike`. Unescaped, searching for an address containing one
    // would match far more than intended — the opposite of what the person typed it for.
    const fake = install([]);
    await searchAccounts('a%b_c');
    const filter = fake.queries[0]?.orFilters[0] ?? '';
    expect(filter).toContain('a\\%b\\_c');
  });

  it('returns an account with no grants — the onboarding case', async () => {
    // Somebody who has signed in once and holds nothing is exactly who this search is for.
    install([
      { id: 'u-9', email: 'newcook@example.com', first_name: 'Priya', last_name: null,
        is_disabled: false, deleted_at: null },
    ]);
    const [found] = await searchAccounts('newcook');
    expect(found).toMatchObject({ userId: 'u-9', email: 'newcook@example.com', held: [] });
    expect(found?.displayName).toBe('Priya');
  });
});
