import { describe, expect, it, afterEach } from 'vitest';

import { SCHOOL_COLUMNS, SchoolPayloadError, fetchSchools, setApiTransport } from './index.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

const install = (rows: unknown, error: { message: string; code?: string } | null = null) => {
  const fake = fakeTransport(rows, error);
  setApiTransport(fake.transport);
  return fake;
};

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Alpha Public School',
  city: { name: 'SAS Nagar (Mohali)' },
  ...over,
});

describe('fetchSchools', () => {
  it('reads the school table, not a function', () => {
    // [AUTH-01], 0012: the read carries the caller's authority under an RLS policy. If this
    // ever goes back through an RPC, the boundary moves from the database into a function
    // body and the policies stop being the thing that decides.
    const fake = install([ROW()]);
    void fetchSchools();
    expect(fake.queries[0]?.table).toBe('school');
  });

  it('never selects * from school', () => {
    // A policy filters rows, never columns. `school` carries contact_name, contact_email
    // and contact_phone — a named member of staff — and nothing in the database stops a
    // glob here from publishing their mobile number to anyone holding the anon key. This
    // column list is the entire redaction.
    const fake = install([ROW()]);
    void fetchSchools();

    const columns = fake.queries[0]?.columns ?? '';
    expect(columns).toBe(SCHOOL_COLUMNS);
    expect(columns).not.toContain('*');
    for (const forbidden of [
      'contact_name',
      'contact_email',
      'contact_phone',
      'address_line1',
      'postcode',
      'kitchen_id',
      'legacy_bubble_id',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('flattens the embedded city', async () => {
    install([ROW()]);
    await expect(fetchSchools()).resolves.toEqual([
      { id: 's1', name: 'Alpha Public School', city: 'SAS Nagar (Mohali)' },
    ]);
  });

  it('treats no onboarded schools as an empty list, not an error', async () => {
    install([]);
    await expect(fetchSchools()).resolves.toEqual([]);
  });

  it('tolerates a missing city rather than dropping the school', async () => {
    // A school with no city is still a school the parent needs to pick. Failing the whole
    // list because one row is thin would put a broken picker in front of everyone.
    install([ROW({ city: null })]);
    await expect(fetchSchools()).resolves.toEqual([
      { id: 's1', name: 'Alpha Public School', city: '' },
    ]);
  });

  it('refuses a school with no id', async () => {
    install([{ name: 'Alpha' }]);
    await expect(fetchSchools()).rejects.toBeInstanceOf(SchoolPayloadError);
  });

  it('surfaces a backend error rather than an empty picker', async () => {
    // An RLS denial and "no schools onboarded" both look like an empty list. Only the
    // error branch can tell them apart, and losing it means an outage renders as "GrayBag
    // is not in your area yet".
    install(null, { message: 'permission denied', code: '42501' });
    await expect(fetchSchools()).rejects.toMatchObject({ name: 'ApiError', code: '42501' });
  });
});
