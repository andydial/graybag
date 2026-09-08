import { describe, expect, it } from 'vitest';

import {
  LAST_EMAIL_KEY,
  RESEND_AFTER_MS,
  SESSION_ABSOLUTE_MAX_AGE_MS,
  SESSION_IDLE_MAX_AGE_MS,
  type KeyValueStorage,
  lastEmail,
  looksLikeCode,
  purgeSession,
  rememberEmail,
  resendAvailableIn,
  resetSessionWindow,
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
 * Two windows — `E12-42`, revised by Andy on 2026-09-08.
 *
 * *"Make the 30 days slide: each successful refresh extends the expiry to 30 days from that
 * moment, so a device in regular use never sees an OTP. Keep the absolute cap sensible — 90 days
 * from original sign-in — so an abandoned device does eventually expire."*
 *
 * Supabase ends this session for nobody — `sessions_timebox` and `sessions_inactivity_timeout`
 * are both `0` on production and staging — so these two constants are the only bound that exists,
 * and they are worth testing at the edges rather than in the middle.
 */
describe('sessionHasExpired — the sliding 30-day window', () => {
  const now = 1_800_000_000_000;
  const ago = (ms: number) => String(now - ms);
  const DAY = 24 * 60 * 60 * 1000;

  it('keeps a session alive right up to the idle limit', () => {
    expect(sessionHasExpired({ startedAt: ago(60 * DAY), lastSeenAt: ago(29 * DAY) }, now)).toBe(false);
    expect(
      sessionHasExpired({ startedAt: ago(60 * DAY), lastSeenAt: ago(SESSION_IDLE_MAX_AGE_MS - 1000) }, now),
    ).toBe(false);
  });

  it('expires exactly at 30 idle days', () => {
    expect(
      sessionHasExpired({ startedAt: ago(31 * DAY), lastSeenAt: ago(SESSION_IDLE_MAX_AGE_MS) }, now),
    ).toBe(true);
  });

  it('a refresh yesterday keeps a session signed in that first signed in 80 days ago', () => {
    // The whole point of the change: a device in regular use never sees an OTP.
    expect(sessionHasExpired({ startedAt: ago(80 * DAY), lastSeenAt: ago(DAY) }, now)).toBe(false);
  });

  it('is 30 days, which is what was asked for', () => {
    expect(SESSION_IDLE_MAX_AGE_MS).toBe(30 * DAY);
  });
});

describe('sessionHasExpired — the absolute 90-day ceiling', () => {
  const now = 1_800_000_000_000;
  const ago = (ms: number) => String(now - ms);
  const DAY = 24 * 60 * 60 * 1000;

  it('ends a session 90 days after sign-in however recently it refreshed', () => {
    // The ceiling is the thing that makes a sliding window safe. A tablet refreshing hourly must
    // still stop eventually, and "refreshed a minute ago" must not save it.
    expect(sessionHasExpired({ startedAt: ago(SESSION_ABSOLUTE_MAX_AGE_MS), lastSeenAt: ago(60_000) }, now))
      .toBe(true);
    expect(sessionHasExpired({ startedAt: ago(200 * DAY), lastSeenAt: ago(60_000) }, now)).toBe(true);
  });

  it('does not end it a day early', () => {
    expect(sessionHasExpired({ startedAt: ago(89 * DAY), lastSeenAt: ago(60_000) }, now)).toBe(false);
  });

  it('is 90 days, and is longer than the idle window it bounds', () => {
    expect(SESSION_ABSOLUTE_MAX_AGE_MS).toBe(90 * DAY);
    expect(SESSION_ABSOLUTE_MAX_AGE_MS).toBeGreaterThan(SESSION_IDLE_MAX_AGE_MS);
  });

  it('either window alone is enough to end the session', () => {
    const DAY_MS = DAY;
    // Idle only.
    expect(sessionHasExpired({ startedAt: ago(40 * DAY_MS), lastSeenAt: ago(31 * DAY_MS) }, now)).toBe(true);
    // Absolute only.
    expect(sessionHasExpired({ startedAt: ago(91 * DAY_MS), lastSeenAt: ago(DAY_MS) }, now)).toBe(true);
    // Neither.
    expect(sessionHasExpired({ startedAt: ago(40 * DAY_MS), lastSeenAt: ago(DAY_MS) }, now)).toBe(false);
  });
});

describe('sessionHasExpired — stamps that are missing or unreadable', () => {
  const now = 1_800_000_000_000;
  const ago = (ms: number) => String(now - ms);
  const DAY = 24 * 60 * 60 * 1000;

  it('treats both stamps absent as live, so a deploy does not sign everybody out', () => {
    expect(sessionHasExpired({ startedAt: null, lastSeenAt: null }, now)).toBe(false);
  });

  it('measures the idle window from sign-in when only the sign-in stamp exists', () => {
    // The real upgrade path, not a hypothetical: the first version of `E12-42` wrote only
    // `started-at`, so every session it created arrives with exactly this shape.
    expect(sessionHasExpired({ startedAt: ago(2 * DAY), lastSeenAt: null }, now)).toBe(false);
    expect(sessionHasExpired({ startedAt: ago(31 * DAY), lastSeenAt: null }, now)).toBe(true);
  });

  it('treats an unreadable stamp as expired, on either side', () => {
    expect(sessionHasExpired({ startedAt: 'nonsense', lastSeenAt: ago(60_000) }, now)).toBe(true);
    expect(sessionHasExpired({ startedAt: ago(DAY), lastSeenAt: 'nonsense' }, now)).toBe(true);
    expect(sessionHasExpired({ startedAt: '', lastSeenAt: '' }, now)).toBe(true);
  });
});

describe('resetSessionWindow', () => {
  it('writes both stamps, so a new sign-in does not inherit an old ceiling', () => {
    // Signing in on a browser carrying an 89-day-old `started-at` would otherwise expire the new
    // session a day later, for a reason nobody could work out.
    const storage = fakeStorage({ 'gb.backoffice.started-at': '1' });
    resetSessionWindow(storage);
    expect(sessionHasExpired(
      {
        startedAt: storage.getItem('gb.backoffice.started-at'),
        lastSeenAt: storage.getItem('gb.backoffice.last-seen-at'),
      },
      Date.now(),
    )).toBe(false);
  });

  it('does not throw when there is no storage at all', () => {
    expect(() => resetSessionWindow(null)).not.toThrow();
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
 * Prefilling the address on `/signin` — `E12-42`.
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
