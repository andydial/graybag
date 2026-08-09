# Decisions — Network resilience

`NR1`–`NR4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E14-09`. `P11` fixes the constraint — the audience is mid-range Androids on unreliable
connections, and the binding limit is network, not CPU — and everything below is a choice about
what the app does when a request fails.

| # | Decision | Why |
|---|---|---|
| NR1 | **Every network call carries a per-attempt timeout. There is no "wait forever" path** | `E14-09` says "no infinite spinners", and a spinner is infinite exactly when the promise behind it can be. A socket that is open but silent never rejects on its own, so the request that hangs forever is the one nobody notices — it produces no error to report, no Sentry event and no log line. The timeout is per *attempt* rather than total, so a retry gets a full budget instead of inheriting the exhausted remainder of the first try |
| NR2 | **Backoff uses full jitter — the wait is random in `[0, capped]`, not the cap itself** | Every device that lost connectivity at the same moment retries at the same moment without it. That is a thundering herd against a service that has just come back, and it is how a brief outage becomes a long one. The cost of jitter is that a single user occasionally waits a little longer; the cost of no jitter is paid by everybody at once |
| NR3 | **A `4xx` other than `408`/`429` is never retried** | The request was wrong and it will be wrong again. Retrying a `401` turns one failure into five, delays the sign-in prompt the user actually needs, and looks like an attack in the logs. `5xx`, `408`, `429` and every transport failure with no status are retried — `ECONNRESET` is in that last group, because it is a transport failure and the correct response to one is a fresh connection (`docs/learnings.md`, 2026-08-09) |
| NR4 | **Retrying is opt-in per call site via `shouldRetry`, and a write is not retryable by default just because `D16` exists** | `A4` routes writes through Edge Functions and `D16` makes idempotency a database constraint, which makes a *repeat* harmless — for a checkout carrying an idempotency key. It is not harmless for a bare POST. **Retrying a payment is how you charge somebody twice**, and `[OL-05]` says the schema cannot record two captures against one group, so it cannot be reconciled or refunded afterwards either. Same reasoning as `S21`'s Ending B, one layer down: the rule is decided by whether money can move, not by whether the error looked transient |

**What this does not do.** It does not know whether the device is offline — that is a platform
signal (`expo-network`) and it belongs to the screen, not to the retry loop. The cache already
gives the app the honest answer for the menu (`MC3`: serve what we have, marked stale), and a
retry that consulted a connectivity flag would be making a decision the timeout already makes
correctly and more cheaply.
