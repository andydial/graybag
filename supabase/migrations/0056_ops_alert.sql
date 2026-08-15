-- =============================================================================
-- 0056_ops_alert.sql — somewhere to record that we shouted. `E06-39`.
-- =============================================================================
--
-- The alert needs a dedupe key, and the first implementation reached for
-- `notification_delivery` because `0050`'s unique index there is already the pattern for
-- "claim the send before making it". Two things make that wrong, and both are the kind that
-- would have failed at the first real alert rather than in review:
--
-- 1. **`notification_delivery.user_id` is NOT NULL.** An operational alert is not addressed to a
--    person. Pointing it at some staff account to satisfy the constraint would put an
--    infrastructure event inside that person's notification history — and that table is in the
--    DPDP retention and erasure story (§13.4). An alert about a stuck payment must not become a
--    thing we have to delete when somebody exercises their rights.
--
-- 2. **`uq_notification_one_per_order_group` is partial on `order_group_id is not null`**, so a
--    row without one is not deduped by it at all. The claim would have succeeded every time and
--    an hourly cron would have sent twenty-four identical emails — the exact failure the dedupe
--    exists to prevent, silently.
--
-- So: its own table, two columns of substance, and a unique key that is the whole point.
-- =============================================================================

create table if not exists ops_alert (
  id           bigint generated always as identity primary key,
  -- `settlement_stuck`, `refund_unrecordable`, … Text rather than an enum: this is operational
  -- vocabulary that changes when a new money path appears, and needing a migration to name a new
  -- alert is how the next one ends up reusing a wrong existing name.
  kind         text        not null,
  -- **The IST calendar date, as text.** Not a timestamp: the uniqueness is per DAY, and deriving
  -- a day from an instant inside an index means picking a timezone in a second place. IST because
  -- a UTC boundary falls at 05:30 IST, so two problems on the same working morning would land in
  -- different buckets (`E05-49`).
  alert_date   date        not null,
  summary      text        not null,
  -- Counts, provider ids, function names. **Never** a name, an address or anything about a child
  -- (non-negotiable #4) — an alert is forwarded and pasted into chat far more casually than a
  -- customer email is.
  detail       jsonb       not null default '{}'::jsonb,
  status       text        not null default 'queued',
  sent_at      timestamptz,
  error_text   text,
  created_at   timestamptz not null default now(),
  constraint ops_alert_status_valid check (status in ('queued', 'sent', 'failed', 'suppressed'))
);

-- **The dedupe.** One row per kind per IST day, enforced here rather than by a read-then-write in
-- the sender — two concurrent drains would both read "nothing sent yet" and both send.
create unique index if not exists uq_ops_alert_kind_day on ops_alert (kind, alert_date);

comment on table ops_alert is
  'E06-39. The one alert, and the record that it was sent. NOT notification_delivery: that table '
  'is addressed to a person (user_id is NOT NULL), is in the DPDP retention and erasure story, '
  'and its unique index is partial on order_group_id so it would not have deduped these at all. '
  'One row per kind per IST day — the action is human and measured in hours, so anything finer '
  'is telling somebody what they already know, and an hourly cron sending 24 identical emails is '
  'how a sender gets ignored.';

comment on column ops_alert.detail is
  'Counts, provider ids, function names. NEVER a child''s name, a parent''s name or an email '
  'address (non-negotiable #4). Alerts get forwarded and pasted into chat.';

-- Service-role only. Nothing in a browser, and no parent, has any business reading operational
-- alerts — they name payment ids and failure counts.
alter table ops_alert enable row level security;

-- **And the privilege, revoked explicitly.** RLS with no policy already returns zero rows, so
-- this looks redundant — it is not. Measured on the local stack: `authenticated` arrives holding
-- SELECT on a newly created table (Supabase's default privileges, the same inheritance `E02-26`
-- found giving `anon` EXECUTE on every function), while `anon` does not. So the two roles were
-- protected by two different mechanisms, one of which is a policy somebody could later add a
-- permissive clause to.
--
-- Revoking makes it the same mechanism for both, and the stronger one: refused before RLS is
-- consulted at all. `service_role` bypasses RLS and is unaffected — it is the only intended
-- reader. `E02-25`'s rule applies: state the privilege baseline in version control rather than
-- inheriting it from the platform.
revoke all on table ops_alert from anon, authenticated;

comment on index uq_ops_alert_kind_day is
  'E06-39. The whole dedupe. The sender claims by inserting and treats 23505 as "already sent '
  'today", so there is no read-then-write window for two concurrent drains to slip through.';
