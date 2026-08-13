-- Rollback for 0042 — removes the only thing that can tell a working webhook endpoint from a
-- broken one. After this, a wrong secret is silent: 200s all round, no 5xx, no retries, and
-- every capture unprocessed until a customer complains.
drop function if exists assert_webhook_health(interval);
drop index if exists ix_webhook_event_received;
