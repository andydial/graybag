import { describe, expect, it, afterEach } from 'vitest';

import { SchoolPayloadError, fetchSchools, setApiTransport, type ApiTransport } from './index.js';

function stub(data: unknown, error: { message: string; code?: string } | null = null) {
  const calls: string[] = [];
  const transport: ApiTransport = {
    rpc(fn) {
      calls.push(fn);
      return Promise.resolve({ data, error });
    },
  };
  return { transport, calls };
}

afterEach(() => setApiTransport(null));

describe('fetchSchools', () => {
  it('returns the list in the order the database gave it', async () => {
    // City-then-name ordering is applied in SQL. Re-sorting here would be a second
    // opinion about ordering, and the two would eventually disagree.
    const { transport, calls } = stub([
      { id: 's2', name: 'Bravo International School', city: 'SAS Nagar (Mohali)' },
      { id: 's1', name: 'Alpha Public School', city: 'SAS Nagar (Mohali)' },
    ]);
    setApiTransport(transport);

    const schools = await fetchSchools();

    expect(calls).toEqual(['get_schools']);
    expect(schools.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('treats no onboarded schools as an empty list, not an error', async () => {
    setApiTransport(stub([]).transport);
    await expect(fetchSchools()).resolves.toEqual([]);
  });

  it('treats a null payload as empty', async () => {
    setApiTransport(stub(null).transport);
    await expect(fetchSchools()).resolves.toEqual([]);
  });

  it('tolerates a missing city rather than dropping the school', async () => {
    // A school with no city is still a school the parent needs to pick. Failing the whole
    // list because one row is thin would put a broken picker in front of everyone.
    setApiTransport(stub([{ id: 's1', name: 'Alpha' }]).transport);
    await expect(fetchSchools()).resolves.toEqual([{ id: 's1', name: 'Alpha', city: '' }]);
  });

  it('refuses a school with no id', async () => {
    setApiTransport(stub([{ name: 'Alpha' }]).transport);
    await expect(fetchSchools()).rejects.toBeInstanceOf(SchoolPayloadError);
  });

  it('refuses a response that is not an array', async () => {
    setApiTransport(stub({ schools: [] }).transport);
    await expect(fetchSchools()).rejects.toThrow(/not an array/);
  });

  it('surfaces a backend error rather than an empty picker', async () => {
    setApiTransport(stub(null, { message: 'down', code: '500' }).transport);
    await expect(fetchSchools()).rejects.toMatchObject({ name: 'ApiError' });
  });
});
