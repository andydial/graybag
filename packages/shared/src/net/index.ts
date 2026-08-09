/**
 * Network resilience (`E14-09`).
 *
 * The audience is on unreliable connections (`P11`, CLAUDE.md's performance priorities), so a
 * request failing once and succeeding a second later is the ordinary case rather than an
 * incident. These are the primitives the `api/` module (`A4`) wraps every call in.
 */
export {
  RetryExhaustedError,
  TimeoutError,
  backoffDelay,
  isRetryable,
  withRetry,
  withTimeout,
  type RetryOptions,
} from './retry.js';
