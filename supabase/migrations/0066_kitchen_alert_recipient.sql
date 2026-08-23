-- =============================================================================
-- Who gets told when an order is paid — `E08-16`.
--
-- Andy, 2026-08-23: *"Recipients are configured in the admin UI, not in environment variables.
-- Per kitchen, not global. Each kitchen has its own list. Each recipient has an on/off toggle
-- that stops alerts without deleting the address."*
--
-- ## Why a table and not `ORDER_EMAIL_TO`
--
-- An env var is one global list, changing it is a deploy, and nobody can see what it currently
-- says without shell access. `E12-34` is the standing lesson here: `ORDER_EMAIL_FROM` was wrong
-- on production for a day and **every** transactional send failed silently, because the value
-- lived somewhere nobody looks. A row an admin can read and edit is the fix for that class of
-- problem, not just for this feature.
--
-- ## The toggle is a column, not a delete
--
-- "Stop alerting me for a fortnight" and "this person has left" are different acts with different
-- consequences, and collapsing them into a delete means the first one loses the address. Same
-- reasoning as `permission_grant.revoked_at` and `guardian_link.revoked_at`: rows that represent
-- a decision are turned off, not removed.
--
-- ## Scope
--
-- Per kitchen, because that is who cooks the order — a Mohali alert is not Chandigarh's business,
-- and a kitchen taking fifty orders a morning should not be able to flood another kitchen's inbox
-- by being added to one global list.
-- =============================================================================

create table if not exists kitchen_alert_recipient (
  id                 uuid        primary key default gen_random_uuid(),
  kitchen_id         uuid        not null references kitchen(id) on delete cascade,
  -- `citext`, so Andy@ and andy@ are the same recipient and the unique index below means it.
  email              citext      not null,
  -- Off, not gone. See the header.
  is_enabled         boolean     not null default true,
  -- Free text so a list of five addresses is readable: "Vivek — kitchen lead".
  label              text,
  created_by_user_id uuid        references app_user(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint kitchen_alert_recipient_email_shape
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint kitchen_alert_recipient_label_length
    check (label is null or char_length(label) between 1 and 80)
);

-- One row per address per kitchen. Adding an address that is already there is an edit of the
-- existing row, never a second row that would send the same person two emails.
create unique index if not exists uq_kitchen_alert_recipient
  on kitchen_alert_recipient (kitchen_id, email);

-- The send reads "enabled recipients for this kitchen" on every paid order, so it is worth an
-- index that answers exactly that.
create index if not exists ix_kitchen_alert_recipient_live
  on kitchen_alert_recipient (kitchen_id) where is_enabled;

comment on table kitchen_alert_recipient is
  'E08-16. Who is emailed when an order is paid, per kitchen. Configured in /admin/alerts rather than an env var, because a value nobody can read is how E12-34 broke every transactional send for a day. is_enabled is a pause, not a delete: "stop alerting me" and "this person has left" are different acts.';

alter table kitchen_alert_recipient enable row level security;

-- -----------------------------------------------------------------------------
-- Access.
--
-- `kitchen.edit`, **not** `kitchen.config_edit`.
--
-- `config_edit` reads like the closer fit and cannot do the job: the catalogue in `0001` gives it
-- `valid_scope_types = {platform}`, and a trigger enforces that, so it can only ever be held
-- platform-wide. This feature is per kitchen by design — a kitchen's own manager maintaining their
-- own list — and a permission that cannot be granted at kitchen scope makes that promise
-- undeliverable. `kitchen.edit` is `{platform,kitchen}`.
--
-- Found on staging, by the grant being refused. Worth recording: the catalogue's scope list is a
-- real constraint on design, not documentation.
--
-- `auth_can(..., 'kitchen', id)` then gives scope widening for free: a platform grant satisfies
-- it, a grant on this kitchen satisfies it, a grant on a different kitchen does not.
--
-- **No parent-facing policy of any kind.** This table holds staff addresses and is read by the
-- alert sender under the service role. There is deliberately no path by which a customer session
-- can see who is alerted about their order.
-- -----------------------------------------------------------------------------

drop policy if exists kitchen_alert_recipient_read_admin on kitchen_alert_recipient;
create policy kitchen_alert_recipient_read_admin on kitchen_alert_recipient
  for select to authenticated
  using (auth_can('kitchen.edit', 'kitchen', kitchen_id));

-- No INSERT, UPDATE or DELETE policy. Writes go through the `admin-alert-recipients` Edge
-- Function (`A4`, non-negotiable #1) — the same shape as every other back-office write here.

-- -----------------------------------------------------------------------------
-- One alert per order.
--
-- **Not `notification_delivery`.** That table's `user_id` is `NOT NULL` and it is inside the DPDP
-- retention and erasure story (§13.4) — `0056` worked through exactly this and gave operational
-- alerts their own table rather than pointing them at a person. A staff alert is not addressed to
-- a customer, and putting one in a customer's notification history so a foreign key is satisfied
-- would make it something we have to delete when they exercise their rights.
--
-- A column on the order is the whole requirement: the alert is per order, the order is the thing
-- being alerted about, and "have we already told the kitchen" is a fact about the order.
--
-- Both settlement paths — the webhook push and the `checkout-status` pull — can reach a paid
-- order within seconds of each other. `settle_payment` is idempotent; an email is not, so the
-- sender claims this column with a conditional update and only sends if it wrote the row.
-- -----------------------------------------------------------------------------

alter table "order"
  add column if not exists staff_alert_sent_at timestamptz;

comment on column "order".staff_alert_sent_at is
  'E08-16. When the kitchen alert for this order was sent. Claimed by a conditional update before the send, so the two settlement paths cannot both email the same order. Null means not yet, and a failed send leaves it null so it stays retryable.';
