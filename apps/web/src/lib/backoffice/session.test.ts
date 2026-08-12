import { describe, expect, it } from 'vitest';

import { RESEND_AFTER_MS, looksLikeCode, resendAvailableIn } from './session.js';

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
