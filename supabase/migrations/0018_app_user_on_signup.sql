-- =============================================================================
-- 0018_app_user_on_signup.sql
--
-- **Signing in made the app worse than being signed out.** `E05-20`.
-- =============================================================================
--
-- Nothing in the system ever created an `app_user` row. Not a trigger, not an Edge Function,
-- not the auth module — `grep -rn "insert into app_user"` matched only the CREATE TABLE.
--
-- Every authenticated policy is gated on `auth_is_live_user()`, which is
--
--     select exists (select 1 from app_user u where u.id = auth.uid() and …)
--
-- so for a real parent who has just signed in with an email OTP it returns **false**, and:
--
--   * `school_read_picker` denies every row. The school picker is empty — and it worked a
--     moment earlier, because a signed-out visitor reads through `anon_school_onboarded` and
--     a signed-in one does not. **Signing in emptied the screen.**
--   * `create_recipient` inserts `guardian_link.user_id`, a foreign key to `app_user(id)`.
--     Adding a child fails with a foreign-key violation for every real user.
--   * `create_checkout` refuses with `not_authorized`, because there is no link to find.
--
-- This is `E05-16` one layer further out again, and it was found the same way: by walking the
-- whole path in one process (`scripts/order-path-check.mjs`) instead of testing each layer
-- against fixtures that supply what the layer above them never produces. Every pgTAP suite
-- passes because they all `insert into app_user` themselves.
--
-- -----------------------------------------------------------------------------
-- 1. `phone_e164` CANNOT BE `not null`, AND THAT IS A v1 SCOPE FACT
--
-- The column is `not null` with a format check and a total unique index, because the legacy
-- Bubble model was phone-first (`E02-17`). **v1 has no phone OTP** — sign-in is Google, Apple
-- or email OTP (`U1`, and CLAUDE.md's "no passwords, no phone OTP in v1"). So a real v1 user
-- has no phone number at all, and there is no value a trigger could honestly put here.
--
-- Making it nullable is data minimisation rather than a workaround: DPDP says collect what the
-- service needs, and v1 does not need a phone. The unique index becomes partial for the same
-- reason `uq_app_user_email` already is — otherwise the *second* user with no phone collides
-- with the first on `null`… which Postgres would in fact allow, but a total unique index on a
-- nullable column is a trap left for whoever adds a phone later.
--
-- The format check is unchanged and still correct: a `check` passes on `null`, so a stored
-- number must still be E.164 and only the absence of one is newly legal.
--
-- -----------------------------------------------------------------------------
-- 2. A TRIGGER, NOT AN EDGE FUNCTION
--
-- `A4` says the *app's* writes go through Edge Functions. This is not an app write — it is a
-- database invariant: **an `auth.users` row without an `app_user` row is a broken state**, and
-- the only way to guarantee it never exists is to close it where the row is created.
--
-- An endpoint the client calls after sign-in would work until the first client that forgot,
-- the first sign-in method added later (`E03-12` Google, `E03-13` Apple), or the first network
-- failure between "signed in" and "told the server about it" — and the symptom of each is this
-- same silent, total denial. `E16`'s Bubble import writes `app_user` rows directly too, and a
-- trigger covers that path as well.
-- =============================================================================

alter table app_user alter column phone_e164 drop not null;

drop index if exists uq_app_user_phone;
create unique index uq_app_user_phone on app_user (phone_e164) where phone_e164 is not null;

comment on column app_user.phone_e164 is
  'Nullable since 0018. v1 sign-in is Google, Apple or email OTP and there is no phone OTP (U1), so a v1 user genuinely has no phone. The E.164 format check still applies to any value that IS stored; a check passes on null.';

-- -----------------------------------------------------------------------------
-- The trigger.
--
-- `security definer` because it runs as the auth admin during sign-up and must write a table
-- that role has no rights on. `search_path` is pinned — a `security definer` function without
-- one is the standard privilege-escalation footgun.
--
-- `on conflict do nothing`: `E16`'s migration claims a legacy account by inserting the
-- `app_user` row *first* and creating the auth user afterwards (`claimed_at`, `E03-11`). This
-- trigger must not overwrite that row or fail that flow.
-- -----------------------------------------------------------------------------
create function handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into app_user (id, email, email_verified_at, migration_source)
  values (
    new.id,
    -- `citext`, and empty string is not a valid email — a provider that gives us no address
    -- (Apple's private relay opt-out) must leave this null rather than store ''.
    nullif(new.email, '')::citext,
    new.email_confirmed_at,
    'native'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function handle_new_auth_user() is
  'E05-20. Creates the app_user row every authenticated policy depends on. Before 0018 nothing did, so auth_is_live_user() was false for every real user: an empty school picker after sign-in, and a foreign-key violation on adding a child.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Backfill. Any account created before this migration is in exactly the broken state above,
-- and would stay broken forever — the trigger only fires on insert.
-- -----------------------------------------------------------------------------
insert into app_user (id, email, email_verified_at, migration_source)
select u.id, nullif(u.email, '')::citext, u.email_confirmed_at, 'native'
  from auth.users u
  left join app_user a on a.id = u.id
 where a.id is null
on conflict (id) do nothing;
