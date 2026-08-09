import { describe, expect, it } from 'vitest';

import {
  VERSION_MAX_AGE_SECONDS,
  menuVersionResponse,
  parseSchoolId,
} from './version-endpoint.js';

const SCHOOL = '50000000-0000-0000-0000-000000000001';

describe('parseSchoolId', () => {
  it('accepts a uuid and lowercases it', () => {
    expect(parseSchoolId(SCHOOL.toUpperCase())).toBe(SCHOOL);
  });

  it('rejects anything that is not a uuid', () => {
    for (const bad of [null, undefined, '', '   ', 'alpha_public', '1', `${SCHOOL} or 1=1`]) {
      expect(parseSchoolId(bad)).toBeNull();
    }
  });
});

describe('menuVersionResponse', () => {
  it('returns the version in the smallest body that can carry it', () => {
    const res = menuVersionResponse(SCHOOL, { version: 12 });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"v":12}');
    // Every user, every app open, on connections that are the binding constraint. A
    // helpfully verbose envelope here is paid for a million times.
    expect(res.body.length).toBeLessThan(20);
  });

  it('is cacheable for a short window', () => {
    // The token is monotonic, so a stale read can only ever cause a missed refresh for a
    // few seconds — never a wrong menu. no-store would give that up for a correctness
    // property we do not need, on the one endpoint most worth putting behind a CDN.
    const res = menuVersionResponse(SCHOOL, { version: 12 });
    expect(res.headers['cache-control']).toBe(`public, max-age=${VERSION_MAX_AGE_SECONDS}`);
    expect(VERSION_MAX_AGE_SECONDS).toBeGreaterThan(0);
    expect(VERSION_MAX_AGE_SECONDS).toBeLessThanOrEqual(60);
  });

  it('400s a malformed school id and says what the shape should be', () => {
    const res = menuVersionResponse('not-a-uuid', { version: 12 });
    expect(res.status).toBe(400);
    expect(res.body).toContain('uuid');
  });

  it('400s a missing school id', () => {
    expect(menuVersionResponse(null, { version: 12 }).status).toBe(400);
  });

  /**
   * These are different failures and must not collapse into one status. A 400 is a client
   * bug — the app sent nonsense. A 404 is a school with no menu assigned yet, which is a
   * legitimate state of the system. Reporting both as 400 makes the second undiagnosable
   * from the outside, and it is the one an operator will actually hit.
   */
  it('404s an unknown school, distinctly from a malformed one', () => {
    const res = menuVersionResponse(SCHOOL, null);
    expect(res.status).toBe(404);
    expect(menuVersionResponse('nope', null).status).toBe(400);
  });

  it('validates before it trusts the lookup', () => {
    // A malformed id must never reach the database, so the 400 wins even when a caller
    // has somehow supplied a row alongside it.
    expect(menuVersionResponse('; drop table dish;--', { version: 1 }).status).toBe(400);
  });

  it('always returns JSON', () => {
    for (const res of [
      menuVersionResponse(SCHOOL, { version: 1 }),
      menuVersionResponse(SCHOOL, null),
      menuVersionResponse('bad', null),
    ]) {
      expect(res.headers['content-type']).toBe('application/json');
      expect(() => JSON.parse(res.body)).not.toThrow();
    }
  });

  it('carries version 0 rather than treating it as absent', () => {
    // A falsy-check on the version instead of a null-check on the row would turn a real
    // version 0 into a 404. The column defaults to 1 so this should not arise — which is
    // exactly why it would never be noticed.
    expect(menuVersionResponse(SCHOOL, { version: 0 }).status).toBe(200);
    expect(menuVersionResponse(SCHOOL, { version: 0 }).body).toBe('{"v":0}');
  });
});
