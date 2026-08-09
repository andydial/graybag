/**
 * Retry with backoff (`E14-09`).
 *
 * The audience is on unreliable connections in tier-1 Indian cities on mid-range Androids
 * (`P11`), where a request failing once and succeeding a second later is the ordinary case
 * rather than an incident. Without a retry the app is as unreliable as the worst second of
 * the connection; with an undisciplined one it is a way to charge somebody twice.
 *
 * **The dangerous half of this file is what it refuses to retry.**
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  constructor(attempts: number, cause: unknown) {
    super(`Gave up after ${attempts} attempt(s)`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

/**
 * Is this worth trying again?
 *
 * Retry a **transport** failure and a server saying "later". Never retry a `4xx` other than
 * `408`/`429` — the request was wrong and it will be wrong again, and hammering a `401`
 * turns one failure into five.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;

  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 429) return true;
    if (status >= 500) return true;
    return false;
  }

  // No status at all: a DNS failure, a reset, a dropped connection. `ECONNRESET` lives here
  // — it is a transport failure, and the correct response to one is to try again on a fresh
  // connection (docs/learnings.md, 2026-08-09).
  return true;
}

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  /** First backoff step; each retry doubles it. */
  baseDelayMs?: number;
  /** Ceiling on any single wait. */
  maxDelayMs?: number;
  /** Per-attempt timeout. **There is no default of "forever"** — see `withTimeout`. */
  timeoutMs?: number;
  /** Injected so tests do not sleep and so the pacing is assertable. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so jitter is deterministic under test. */
  random?: () => number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Race a promise against a timeout.
 *
 * **Every network call gets one.** `E14-09` says "no infinite spinners", and a spinner is
 * infinite exactly when the promise behind it can be. A socket that is open but silent never
 * rejects on its own — the request that hangs forever is the one nobody notices, because it
 * produces no error to report.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Exponential backoff with **full jitter**: the wait is a random value in `[0, capped]`
 * rather than the capped value itself.
 *
 * Not decoration. Every device that lost connectivity at the same moment retries at the same
 * moment without it — a thundering herd against a service that has just come back, which is
 * how a brief outage becomes a long one. Full jitter spreads them across the window.
 */
export function backoffDelay(
  attempt: number,
  { baseDelayMs = 300, maxDelayMs = 8_000, random = Math.random }: RetryOptions = {},
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * capped);
}

/**
 * Run `work`, retrying transient failures.
 *
 * **Only for reads and for writes that are safe to repeat.** `A4` routes every write through
 * an Edge Function, and `D16` makes idempotency a database constraint precisely so a repeat
 * is harmless — but that is true of a checkout carrying an idempotency key and *not* true of
 * a bare POST. `L4` chose the recoverable failure over the unrecoverable one for the same
 * reason. Retrying a payment is how you charge somebody twice, and `[OL-05]` says the schema
 * cannot even record it.
 */
export async function withRetry<T>(
  work: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    timeoutMs,
    sleep = defaultSleep,
    shouldRetry = isRetryable,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const started = work();
      return timeoutMs === undefined ? await started : await withTimeout(started, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) break;

      const delay = backoffDelay(attempt, options);
      onRetry?.(attempt, delay, error);
      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(attempts, lastError);
}
