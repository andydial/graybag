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

- [ ] `E15-01` Sentry on mobile, web and Edge Functions, with source maps so stack traces are readable
- [ ] `E15-02` (risk:high) Structured logging with the order **correlation ID** threaded end to end
- [ ] `E15-03` Better Stack uptime monitoring with **SMS alert** to Andy when the site or API is down
- [ ] `E15-04` Sentry MCP + Supabase MCP configured in Claude Code so failures can be investigated conversationally
- [ ] `E15-05` (risk:high) Payment-specific alerting: failed webhook, signature mismatch, reconciliation drift, refund failure
- [ ] `E15-06` Daily automated health digest email (orders, errors, payment success rate, reconciliation status)
- [ ] `E15-07` Performance monitoring: slow queries, slow API calls, app cold start, tracked over time
- [ ] `E15-08` Runbook: the ~10 most likely failures and the exact first step for each
- [ ] `E15-09` (risk:high) **Load test** order-create and `GET /menu/version` at 10x expected peak (k6 or similar). Output is pooler configuration and the right Supabase plan size, chosen on evidence
- [ ] `E15-10` (risk:high) **Rate limiting** at the Edge Function layer: per-IP and per-user on order creation, and on the public forms in `E12-02`/`E12-03`. CDN-cache `GET /menu/version` — it is called by every user on every app open
- [ ] `E15-11` Product analytics: install -> signup -> first order funnel, checkout drop-off, OTP completion rate. Privacy-respecting, with children's data explicitly excluded (`E20-10`)
- [ ] `E15-12` **Cost monitoring**: billing alerts on Supabase, Expo/EAS, Sentry and the SMS provider, plus a cost-per-order figure in the daily digest
- [ ] `E15-13` (risk:high) **Job-liveness monitor.** A silently-stopped cron produces silence, not a failed uptime probe (`E15-03` is uptime, not liveness). Emit a heartbeat per scheduled job — the webhook-retry sweep, the abandoned-checkout sweeper, the in-flight payment & refund reconcilers, the daily reconciliation, the idempotency-key purge (`docs/order-lifecycle.md` §11) — and page when a heartbeat is overdue for its cadence. Distinct from `E15-03` uptime and from per-job error alerts. Named in `docs/payments-design.md` §6.6 / `PY2` (review finding #22)
