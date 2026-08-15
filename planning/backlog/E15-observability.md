---
id: E15
title: Observability & Monitoring
phase: 2
risk: high
status: not-started
depends_on: [E01]
summary: Because Andy is not a developer, the system has to be able to explain its own failures in plain English.
---

## Approach

Sentry for errors across app/web/backend, Supabase dashboard for query performance, Better Stack for uptime. The multiplier is that **Sentry and Supabase both have MCP servers** — wired into Claude Code, a plain-English question like "orders from St. Xavier's stopped going through around 9pm yesterday, find out why" can be answered by querying errors, logs and the database directly.

## Tasks

- [ ] `E15-01` (mvp) Sentry on mobile, web and Edge Functions, with source maps so stack traces are readable
- [ ] `E15-02` (risk:high) (mvp) Structured logging with the order **correlation ID** threaded end to end
- [ ] `E15-03` (mvp) Better Stack uptime monitoring with **SMS alert** to Andy when the site or API is down
- [ ] `E15-04` (mvp) Sentry MCP + Supabase MCP configured in Claude Code so failures can be investigated conversationally
- [ ] `E15-05` (risk:high) (mvp) Payment-specific alerting: failed webhook, signature mismatch, reconciliation drift, refund failure
- [ ] `E15-06` Daily automated health digest email (orders, errors, payment success rate, reconciliation status)
- [ ] `E15-07` Performance monitoring: slow queries, slow API calls, app cold start, tracked over time
- [ ] `E15-08` Runbook: the ~10 most likely failures and the exact first step for each
- [ ] `E15-09` (risk:high) **Load test** order-create and `GET /menu/version` at 10x expected peak (k6 or similar). Output is pooler configuration and the right Supabase plan size, chosen on evidence
- [ ] `E15-10` (risk:high) (mvp) **Rate limiting** at the Edge Function layer: per-IP and per-user on order creation, and on the public forms in `E12-02`/`E12-03`. CDN-cache `GET /menu/version` — it is called by every user on every app open
- [ ] `E15-11` Product analytics: install -> signup -> first order funnel, checkout drop-off, OTP completion rate. Privacy-respecting, with children's data explicitly excluded (`E20-10`)
- [ ] `E15-12` **Cost monitoring**: billing alerts on Supabase, Expo/EAS, Sentry and the SMS provider, plus a cost-per-order figure in the daily digest
- [ ] `E15-13` (risk:high) **Job-liveness monitor.** A silently-stopped cron produces silence, not a failed uptime probe (`E15-03` is uptime, not liveness). Emit a heartbeat per scheduled job — the webhook-retry sweep, the abandoned-checkout sweeper, the in-flight payment & refund reconcilers, the daily reconciliation, the idempotency-key purge (`docs/order-lifecycle.md` §11) — and page when a heartbeat is overdue for its cadence. Distinct from `E15-03` uptime and from per-job error alerts. Named in `docs/payments-design.md` §6.6 / `PY2` (review finding #22)

- [ ] `E15-14` Run `check:config` against production on a schedule once that project exists, not only at cutover — a dashboard setting changed by hand at 2am to unblock something else is exactly the failure a one-time gate misses
- [x] `E15-15` (risk:high) **The PII guard for crash reporting, built before the reporter.** Andy, 2026-08-16: *"assert no child's name, class, section or allergy can reach it. That guard matters more than the reporting."* `packages/shared/src/observability/scrub.ts` removes tier P and tier S fields **by key, at any depth**, plus emails and Indian phone numbers by value. By key rather than by value because value-matching cannot work: a child called "Sweep" and a dish called "Sweet corn" are both just words, and the filter that tries to tell them apart misses real names and mangles innocent text. The structure is what we know, because our own schema chose the field names. Nine tests, and the one that matters most reads `0001_initial_schema.sql` and **fails when a `recipient` column carrying a name, class, section, allergy, phone or email is not covered** — the real failure mode is a migration adding a personal column and nobody updating the list. Also asserted: it keeps what makes a report worth having (screen, error code, HTTP status, order ref, total, dish name), survives a cycle rather than hanging (a crash reporter that hangs on a crash is worse than none), preserves an `Error`'s message and stack (spreading one loses exactly what the report is for), and bounds depth. The free-text limit is stated as a limit, not papered over: `Aarav` in a message is indistinguishable from any other word, so the defence there is that we do not put a child's name into messages
- [ ] `E15-16` (owner:andy) (risk:medium) **A Sentry DSN, and the decision about when crash reporting ships.** Blocked, and the blocker is worth stating precisely. There is **no Sentry in this repository at all** — `@sentry/react-native` is not a dependency, nothing initialises it, and `EXPO_PUBLIC_SENTRY_DSN` is read by `configure.ts` into a config nothing consumes. So this is a from-scratch build, not a wiring job, and it needs a DSN that only Andy can create. **The timing constraint is the important half**: `@sentry/react-native` is a native SDK, so adding it invalidates build 12 — currently `WAITING_FOR_REVIEW` — and requires a new binary and a new Apple review, which is the one thing the 19th cannot absorb. Two options, and it is a decision rather than a task: **(a)** ship crash reporting in the first build after launch, accepting no crash visibility for the launch window; **(b)** a JS-only reporter posting to Sentry's HTTP API, which carries no native code, ships **over the air** on top of build 12, and catches JS errors — which is most of what a JS app produces — while missing native crashes. `E15-15`'s scrubber is written and tested and is a precondition of either
