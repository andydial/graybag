import { describe, expect, it, vi } from 'vitest';

import {
  RetryExhaustedError,
  TimeoutError,
  backoffDelay,
  isRetryable,
  withRetry,
  withTimeout,
} from './retry.js';

/** Records what it was asked to wait, and waits for none of it. */
function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('isRetryable', () => {
  it('retries transport failures with no status', () => {
    // ECONNRESET lives here. It is a transport failure and the correct response is a fresh
    // connection — docs/learnings.md, 2026-08-09.
    expect(isRetryable(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryable(new Error('Network request failed'))).toBe(true);
  });

  it('retries a timeout', () => {
    expect(isRetryable(new TimeoutError(100))).toBe(true);
  });

  it('retries 5xx and the two 4xx that mean "later"', () => {
    expect(isRetryable(httpError(500))).toBe(true);
    expect(isRetryable(httpError(503))).toBe(true);
    expect(isRetryable(httpError(408))).toBe(true);
    expect(isRetryable(httpError(429))).toBe(true);
  });

  /**
   * The half that matters. A 401 will be a 401 again; retrying it turns one failure into
   * five, delays the sign-in prompt the user actually needs, and looks like an attack in the
   * logs.
   */
  it('does NOT retry a 4xx that means the request was wrong', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(isRetryable(httpError(status))).toBe(false);
    }
  });
});

describe('withTimeout', () => {
  it('resolves when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  /**
   * "No infinite spinners" (`E14-09`) is only true if the promise behind the spinner cannot
   * be infinite. A socket that is open but silent never rejects on its own — the request
   * that hangs forever is the one nobody notices, because it produces no error to report.
   */
  it('rejects a promise that never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(TimeoutError);
  });

  it('clears its timer so a fast success cannot leave the process alive', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 1_000);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe('backoffDelay', () => {
  it('doubles each attempt', () => {
    const o = { baseDelayMs: 100, maxDelayMs: 10_000, random: () => 1 };
    expect(backoffDelay(1, o)).toBe(100);
    expect(backoffDelay(2, o)).toBe(200);
    expect(backoffDelay(3, o)).toBe(400);
  });

  it('caps', () => {
    const o = { baseDelayMs: 100, maxDelayMs: 250, random: () => 1 };
    expect(backoffDelay(9, o)).toBe(250);
  });

  /**
   * Full jitter, and it is not decoration. Every device that lost connectivity at the same
   * moment retries at the same moment without it — a thundering herd against a service that
   * has just come back, which is how a brief outage becomes a long one.
   */
  it('spreads across the window rather than landing on the cap', () => {
    const o = { baseDelayMs: 1_000, maxDelayMs: 10_000 };
    expect(backoffDelay(3, { ...o, random: () => 0 })).toBe(0);
    expect(backoffDelay(3, { ...o, random: () => 0.5 })).toBe(2_000);
    expect(backoffDelay(3, { ...o, random: () => 1 })).toBe(4_000);
  });
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const { waits, sleep } = recordingSleep();
    const work = vi.fn(async () => 'ok');
    await expect(withRetry(work, { sleep })).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('retries a transient failure and succeeds', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const work = vi.fn(async () => {
      calls++;
      if (calls < 3) throw httpError(503);
      return 'ok';
    });
    await expect(withRetry(work, { sleep, random: () => 1, baseDelayMs: 10 })).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('backs off between attempts, increasing', async () => {
    const { waits, sleep } = recordingSleep();
    const work = vi.fn(async () => {
      throw httpError(500);
    });
    await expect(
      withRetry(work, { sleep, attempts: 4, baseDelayMs: 100, random: () => 1 }),
    ).rejects.toThrow(RetryExhaustedError);
    expect(waits).toEqual([100, 200, 400]);
  });

  it('sleeps one fewer time than it attempts', async () => {
    // The failure this catches: sleeping after the LAST attempt, which delays the error the
    // user is waiting for by a full backoff window and buys nothing.
    const { waits, sleep } = recordingSleep();
    const work = async () => {
      throw httpError(500);
    };
    await expect(withRetry(work, { sleep, attempts: 3, baseDelayMs: 1 })).rejects.toThrow();
    expect(waits).toHaveLength(2);
  });

  it('does not retry a non-retryable failure, and gives up immediately', async () => {
    const { waits, sleep } = recordingSleep();
    const work = vi.fn(async () => {
      throw httpError(401);
    });
    await expect(withRetry(work, { sleep })).rejects.toThrow(RetryExhaustedError);
    expect(work).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('carries the underlying error as the cause', async () => {
    // "Gave up after 3 attempts" with no cause is a message that tells an on-call nothing.
    const { sleep } = recordingSleep();
    const underlying = httpError(503);
    const error = await withRetry(async () => {
      throw underlying;
    }, { sleep, baseDelayMs: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect((error as RetryExhaustedError).cause).toBe(underlying);
    expect((error as RetryExhaustedError).attempts).toBe(3);
  });

  it('applies the per-attempt timeout, not a total one', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const work = async () => {
      calls++;
      if (calls === 1) return new Promise<string>(() => {}); // hangs
      return 'ok';
    };
    await expect(
      withRetry(work, { sleep, timeoutMs: 10, baseDelayMs: 1, random: () => 0 }),
    ).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('reports each retry so the app can say what it is doing', async () => {
    const { sleep } = recordingSleep();
    const onRetry = vi.fn();
    await withRetry(
      async () => {
        throw httpError(500);
      },
      { sleep, attempts: 3, baseDelayMs: 1, onRetry },
    ).catch(() => {});
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0]?.[0]).toBe(1);
  });

  it('honours a custom shouldRetry, so a write can refuse to be repeated', async () => {
    // A4 routes writes through Edge Functions and D16 makes idempotency a constraint, but
    // that is true of a checkout carrying an idempotency key and NOT of a bare POST.
    // Retrying a payment is how you charge somebody twice — [OL-05] says the schema cannot
    // even record it.
    const { sleep } = recordingSleep();
    const work = vi.fn(async () => {
      throw httpError(503);
    });
    await expect(
      withRetry(work, { sleep, shouldRetry: () => false }),
    ).rejects.toThrow(RetryExhaustedError);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
