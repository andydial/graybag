-- =============================================================================
-- 0042_webhook_health.sql — the alert for the failure that makes no noise. `E06-28`.
-- =============================================================================
--
-- **A wrong webhook secret fails 100% of webhooks, records every one of them, and returns `200`
-- to all of them.** So it produces no 5xx, no retries, no error rate, and no gap in traffic. It
-- is indistinguishable from an attack, and — worse — indistinguishable from silence.
--
-- Meanwhile every capture goes unprocessed. Customers are charged, orders sit `pending_payment`,
-- and the sweeper eventually cancels them. The first signal without this alert is a support
-- ticket.
--
-- `docs/e06-build-plan.md` puts `E06-28` in step 4 rather than later for exactly this reason: the
-- alert is not an operational nicety bolted onto a finished feature, it is the only thing that
-- distinguishes "working" from "broken" for this endpoint.
--
-- =============================================================================
-- TWO CHECKS, BECAUSE THERE ARE TWO WAYS TO BE BROKEN
-- =============================================================================
--
-- **`signature_failure_rate`** — events arriving and failing verification. Catches a wrong or
-- rotated secret, and a genuine forgery attempt. It is a *rate* over recent events rather than a
-- count, because a handful of unverified events is the internet and 100% is a deploy.
--
-- **`no_verified_events`** — orders were placed and **nothing arrived at all**. Catches the
-- subscription being deleted, the URL changing, the function failing to deploy, Razorpay
-- disabling the endpoint after too many failures. The first check cannot see this one, because
-- its denominator is zero: *no events* is a 0% failure rate, which looks perfect.
--
-- Neither is redundant, and the pair exists because each is the other's blind spot.
--
-- =============================================================================
-- WHY IT IS A FUNCTION AND NOT A CRON JOB
-- =============================================================================
--
-- Same shape as `assert_ledger_integrity()` (`M9`): a `stable` function returning one row per
-- check, so the thing that decides *when* to look — the nightly run, an uptime probe, a
-- dashboard — is not the thing that decides *what healthy means*. Scheduling is `E15`; this is
-- the definition, and it is testable without a scheduler.
-- =============================================================================

create or replace function assert_webhook_health(
  p_window interval default interval '6 hours'
) returns table (
  check_name  text,
  failures    bigint,
  detail      text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 1. Events are arriving and failing verification.
  --
  -- Reported as a count of FAILURES with the rate in the detail, so a caller can treat any
  -- non-zero as worth reading while the number tells them whether it is noise or a deploy. The
  -- threshold deliberately lives in the caller, not here: what counts as "too many" is an
  -- operational judgement and this function's job is to report, not to decide.
  select 'signature_failure_rate'::text,
         count(*) filter (where not signature_verified)::bigint,
         format('%s of %s events in the last %s failed verification',
                count(*) filter (where not signature_verified), count(*), p_window)
    from payment_webhook_event
   where received_at > now() - p_window

  union all

  -- 2. Orders were placed and nothing verified arrived.
  --
  -- **The blind spot of check 1.** With no events at all its failure rate is 0%, which reads as
  -- perfect health — so this asks the opposite question: did we expect traffic?
  --
  -- "Expected traffic" is `pending_payment` orders created in the window. An order that reached
  -- `pending_payment` had a Razorpay order created for it, so an event should have followed. A
  -- window with no orders is a quiet night, not an outage, and reports zero.
  select 'no_verified_events'::text,
         case
           when (select count(*) from "order" o
                  where o.created_at > now() - p_window
                    and o.status in ('pending_payment', 'paid')) > 0
            and (select count(*) from payment_webhook_event e
                  where e.received_at > now() - p_window
                    and e.signature_verified) = 0
           then 1::bigint
           else 0::bigint
         end,
         format('%s orders placed and %s verified events in the last %s',
                (select count(*) from "order" o
                  where o.created_at > now() - p_window
                    and o.status in ('pending_payment', 'paid')),
                (select count(*) from payment_webhook_event e
                  where e.received_at > now() - p_window and e.signature_verified),
                p_window);
$$;

comment on function assert_webhook_health(interval) is
  'E06-28. A wrong webhook secret fails 100% of webhooks, records them all and returns 200 — no 5xx, no retries, no error rate, no gap in traffic, and every capture unprocessed. Two checks because each is the other blind spot: a signature failure RATE (which cannot see a subscription that was deleted, since no events is a 0% failure rate) and orders-placed-but-nothing-verified-arrived (which cannot see a wrong secret, since events are arriving). Reports; does not decide. The threshold and the schedule belong to the caller — E15.';

-- Both checks scan by time. Without this they are sequential scans on a table that grows by
-- every event Razorpay ever sends.
create index if not exists ix_webhook_event_received
  on payment_webhook_event (received_at desc);

revoke all on function assert_webhook_health(interval) from public;
grant execute on function assert_webhook_health(interval) to service_role;
