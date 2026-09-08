import { describe, expect, it } from 'vitest';

import {
  LAST_EMAIL_KEY,
  RESEND_AFTER_MS,
  SESSION_MAX_AGE_MS,
  type KeyValueStorage,
  lastEmail,
  looksLikeCode,
  purgeSession,
  rememberEmail,
  resendAvailableIn,
  sessionHasExpired,
} from './session.js';

/** `localStorage`'s contract over a `Map`, so these rules are testable with no DOM. */
function fakeStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('looksLikeCode', () => {
  it.each(['123456', ' 123456 '])('accepts six digits: %s', (v) => {
    expect(looksLikeCode(v)).toBe(true);
  });

  it.each([
    ['five digits', '12345'],
    ['seven digits', '1234567'],
    ['letters', '12a456'],
    ['empty', ''],
  ])('rejects %s', (_why, v) => {
    expect(looksLikeCode(v)).toBe(false);
  });
});

describe('resendAvailableIn', () => {
  it('blocks a resend immediately after sending', () => {
    expect(resendAvailableIn(1000, 1000)).toBe(RESEND_AFTER_MS);
  });

  it('counts down as real time passes', () => {
    expect(resendAvailableIn(1000, 1000 + 10_000)).toBe(RESEND_AFTER_MS - 10_000);
  });

  it('allows a resend once the window has passed', () => {
    expect(resendAvailableIn(1000, 1000 + RESEND_AFTER_MS)).toBe(0);
  });

  it('never goes negative, so a long-backgrounded tab does not report a bogus wait', () => {
    // The whole reason this takes two timestamps rather than counting ticks: a tick-driven
    // countdown restarts when the tab is backgrounded, and a kitchen tablet is backgrounded
    // constantly (ux-spec §5.9.1).
    expect(resendAvailableIn(1000, 1000 + RESEND_AFTER_MS * 100)).toBe(0);
  });
});

/**
 * The 30-day cap — `E12-74`.
 *
 * The session moved from `sessionStorage` to `localStorage` so a kitchen tablet that reboots at
 * 3am does not demand an OTP. Supabase ends this session for nobody — `sessions_timebox` and
 * `sessions_inactivity_timeout` are both `0` on production and staging — so this function is the
 * only thing that bounds it, and it is worth testing at the edges rather than in the middle.
 */
describe('sessionHasExpired', () => {
  const now = 1_800_000_000_000;

  it('treats an absent stamp as live, so a deploy does not sign everybody out', () => {
    // A session written by the build before this one has no stamp. Signing those people out on
    // the very deploy that gives them longer sessions would be a perverse way to ship it.
    expect(sessionHasExpired(null, now)).toBe(false);
  });

  it('treats an unreadable stamp as expired', () => {
    // Should not be reachable. The safe direction for a value we cannot interpret is the one that
    // asks for an OTP, not the one that skips it.
    expect(sessionHasExpired('not-a-number', now)).toBe(true);
    expect(sessionHasExpired('', now)).toBe(true);
  });

  it('keeps a session signed in for the whole window', () => {
    expect(sessionHasExpired(String(now - 1), now)).toBe(false);
    expect(sessionHasExpired(String(now - SESSION_MAX_AGE_MS + 1000), now)).toBe(false);
  });

  it('expires exactly at 30 days, and after', () => {
    expect(sessionHasExpired(String(now - SESSION_MAX_AGE_MS), now)).toBe(true);
    expect(sessionHasExpired(String(now - SESSION_MAX_AGE_MS * 4), now)).toBe(true);
  });

  it('is 30 days, which is what was asked for', () => {
    expect(SESSION_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('purgeSession', () => {
  it('takes every back-office key, including the stamp', () => {
    const storage = fakeStorage({
      'gb.backoffice.auth-token': '{"refresh_token":"r"}',
      'gb.backoffice.auth-token.0': 'chunk',
      'gb.backoffice.started-at': '123',
    });
    purgeSession(storage);
    expect(storage.length).toBe(0);
  });

  it('removes every key rather than every other one', () => {
    // Removing while walking `length`/`key(i)` skips entries, because the indices shift under the
    // loop. That bug leaves a refresh token behind on sign-out, which is the one outcome this
    // function must not have — so the case is eight keys, not two.
    const seed: Record<string, string> = {};
    for (let i = 0; i < 8; i++) seed[`gb.backoffice.k${i}`] = String(i);
    const storage = fakeStorage(seed);
    purgeSession(storage);
    expect(storage.length).toBe(0);
  });

  it('leaves the remembered address, which is a convenience and not a credential', () => {
    const storage = fakeStorage({
      'gb.backoffice.auth-token': 'x',
      [LAST_EMAIL_KEY]: 'kitchen@graybag.com',
    });
    purgeSession(storage);
    expect(storage.getItem(LAST_EMAIL_KEY)).toBe('kitchen@graybag.com');
    expect(storage.getItem('gb.backoffice.auth-token')).toBeNull();
  });

  it('leaves anything that is not ours alone', () => {
    const storage = fakeStorage({ 'gb.backoffice.auth-token': 'x', 'other.app.thing': 'keep' });
    purgeSession(storage);
    expect(storage.getItem('other.app.thing')).toBe('keep');
  });
});

/**
 * Prefilling the address on `/signin` — `E12-74`.
 *
 * Andy: *"remember the last email in localStorage and prefill it. Email only — never store a
 * token, code, or anything else client-side."* This is the only writer, so that rule is enforced
 * in one function rather than trusted at the call sites.
 */
describe('rememberEmail and lastEmail', () => {
  it('round-trips an address', () => {
    const storage = fakeStorage();
    rememberEmail('Kitchen@GrayBag.com', storage);
    expect(lastEmail(storage)).toBe('kitchen@graybag.com');
  });

  it('normalises the way the sign-in form does, so the prefill matches what was typed', () => {
    const storage = fakeStorage();
    rememberEmail('  Ops@GrayBag.com  ', storage);
    expect(lastEmail(storage)).toBe('ops@graybag.com');
  });

  it.each([
    ['a six-digit code', '123456'],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'],
    ['a bare word', 'kitchen'],
    ['an address with no dot', 'kitchen@graybag'],
    ['empty', ''],
    ['whitespace', '   '],
  ])('refuses to store %s', (_why, value) => {
    const storage = fakeStorage();
    rememberEmail(value, storage);
    expect(storage.length).toBe(0);
    expect(lastEmail(storage)).toBe('');
  });

  it('stores under exactly one key, so nothing else can ride along', () => {
    const storage = fakeStorage();
    rememberEmail('ops@graybag.com', storage);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe(LAST_EMAIL_KEY);
  });

  it('offers nothing when there is nothing, rather than the string "null"', () => {
    expect(lastEmail(fakeStorage())).toBe('');
  });

  it('survives a store that throws, because a prefill is never worth a failed sign-in', () => {
    const hostile: KeyValueStorage = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(() => rememberEmail('ops@graybag.com', hostile)).not.toThrow();
    expect(lastEmail(hostile)).toBe('');
  });
});
