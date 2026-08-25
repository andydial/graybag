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
- [x] `E15-08` Runbook: the ~10 most likely failures and the exact first step for each
- [ ] `E15-09` (risk:high) **Load test** order-create and `GET /menu/version` at 10x expected peak (k6 or similar). Output is pooler configuration and the right Supabase plan size, chosen on evidence
- [ ] `E15-10` (risk:high) (mvp) **Rate limiting** at the Edge Function layer: per-IP and per-user on order creation, and on the public forms in `E12-02`/`E12-03`. CDN-cache `GET /menu/version` — it is called by every user on every app open
- [ ] `E15-11` Product analytics: install -> signup -> first order funnel, checkout drop-off, OTP completion rate. Privacy-respecting, with children's data explicitly excluded (`E20-10`)
- [x] `E15-12` **Cost monitoring**: billing alerts on Supabase, Expo/EAS, Sentry and the SMS provider, plus a cost-per-order figure in the daily digest
- [ ] `E15-13` (risk:high) **Job-liveness monitor.** A silently-stopped cron produces silence, not a failed uptime probe (`E15-03` is uptime, not liveness). Emit a heartbeat per scheduled job — the webhook-retry sweep, the abandoned-checkout sweeper, the in-flight payment & refund reconcilers, the daily reconciliation, the idempotency-key purge (`docs/order-lifecycle.md` §11) — and page when a heartbeat is overdue for its cadence. Distinct from `E15-03` uptime and from per-job error alerts. Named in `docs/payments-design.md` §6.6 / `PY2` (review finding #22)

- [ ] `E15-14` Run `check:config` against production on a schedule once that project exists, not only at cutover — a dashboard setting changed by hand at 2am to unblock something else is exactly the failure a one-time gate misses
- [x] `E15-15` (risk:high) **Know production is broken before a parent says so.** Andy: *"Three times this month a complete outage was invisible until a human found it by reading a log by hand — settlement failing on every attempt, every confirmation email 403ing, an entire test suite running zero files."* All three share one shape: **the system reported nothing, and nothing is what a healthy system reports.** So the rule everything here is built on is that **silence must be impossible** — every run produces a verdict and the digest is sent on a quiet day too, one line saying it was quiet. **`ops-heartbeat`**, one Edge Function, two modes. `?mode=probe` runs seven checks that **exercise rather than ping**: the marketing page must contain its own headline, `/signin` and `/kitchen` must render, two Edge Functions must answer in the shape their callers expect, a database read must return a row, and **Resend must report the `ORDER_EMAIL_FROM` domain as verified** — which is precisely the outage that 403'd every confirmation for a day (`E12-34`) and would have been caught in fifteen minutes. `?mode=digest` adds yesterday's orders, revenue, failed payments, drain depth and alerts raised, and emails it to `SUPPORT_ALERT_EMAIL`. Escalation reuses `sendMoneyAlert`, which dedupes once per kind per IST day, so a sustained outage is one email rather than ninety-six: a down endpoint, a **captured payment with no order**, a drain backlog over 20, and the digest itself failing to send. **Every probe carries a `remedy` and the type makes it awkward to add one without.** Scheduled by GitHub Actions — every 15 minutes for the probes, 07:00 IST for the digest — deliberately **outside** Supabase, because a scheduler living inside the thing it watches cannot report that the thing is down, and because `pg_cron` would have needed a migration in a week when migration numbers are held elsewhere. **No migration was written:** `ops_alert.kind` is free text by design (`0056`), so five new alert kinds were a code change. Verified end to end on staging: gateway 401 without a token, **my own 401 with a wrong secret**, seven probes green, a genuine failure escalating to a `sent` `ops_alert`, and a quiet-day digest delivered. The first version of the `policy` probe expected a GET 200 and failed against a healthy staging — the false alarm that teaches people to ignore a monitor, caught here rather than at 3am
- [ ] `E15-16` (owner:andy) **Set `OPS_HEARTBEAT_SECRET`, `PRODUCTION_SUPABASE_URL` and `PRODUCTION_SUPABASE_ANON_KEY` as GitHub Actions secrets.** Until they exist the monitor **fails loudly on every run** rather than skipping quietly, which is deliberate — a monitor that silently does nothing is the exact failure it exists to prevent. The same secret must be set on the production Supabase project; the deploy below does that half
