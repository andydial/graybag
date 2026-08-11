-- =============================================================================
-- 0030_account_holder_name.sql — the account holder's own name. `P18`, `E05-39`.
-- =============================================================================
--
-- `app_user.first_name` and `last_name` have existed since `0001` and **nothing has ever
-- written them**. Not the signup trigger (`0018`), not the backfill beside it, not an Edge
-- Function, not the app. Every user in the system has a null name, and `E05-41`'s audit
-- confirmed that no surface renders one today — so this is a field that was declared and then
-- forgotten rather than one that is quietly half-working.
--
-- ## Where it is asked, and why not at checkout
--
-- `P18`, Andy 2026-08-11, overruling both of my proposals: **on ORDER CONFIRMED, after
-- payment.** His reasoning is better than mine was. Checkout is the most fragile screen in the
-- funnel and the one place friction is paid for in lost orders; nothing actually breaks without
-- a name; so there is no reason to risk the payment moment for a field we can collect thirty
-- seconds later, when the money is taken, the parent is pleased, and they are doing nothing.
--
-- ## `name_prompted_at`, because "never asked twice" needs somewhere to live
--
-- The optional field comes with a clear skip, and a skip that is not recorded is not a skip —
-- it is a question that comes back on the next order, which is how an optional field becomes a
-- nag. `first_name is null` alone cannot express "asked, and they said no thank you".
--
-- **Server-side rather than on the device.** The same account on a second phone is the same
-- person who already declined, and a local flag would ask them again. It is one nullable
-- timestamp on a row the user already owns.
--
-- It is stamped when the prompt is *answered*, either way — saving a name and skipping both
-- count as having been asked. So the condition a screen tests is
-- `first_name is null and name_prompted_at is null`, and both halves are load-bearing.
--
-- ## Not on the protected-columns list, deliberately
--
-- `0002`'s guard trigger protects the fields a customer must not set for themselves —
-- `is_disabled`, `phone_verified_at`, `deleted_at`. This is the opposite kind of field: it
-- records something the user did, and the worst a user can do by clearing it is ask themselves
-- the question again. Adding it to an exhaustive list of *dangerous* columns would misdescribe
-- it, and that list is only useful while every entry on it means the same thing.
--
-- ## Why functions and not a plain UPDATE
--
-- RLS has allowed a user to update their own `app_user` row since `0002`
-- (`app_user_update_self`), so the write was already permitted. Non-negotiable #1 is the reason
-- this exists anyway: **every write goes through an Edge Function**, and the Edge Function
-- takes the user's id from the verified JWT rather than from a body field. These two functions
-- are what it calls, and they are `security definer` so that the identity the function acts on
-- is the one the caller proved, not the one they sent.
-- =============================================================================

alter table app_user add column if not exists name_prompted_at timestamptz;

comment on column app_user.name_prompted_at is
  'When the account holder was asked for their own name and answered — INCLUDING by skipping (P18, E05-39). Null means never asked. "first_name is null and name_prompted_at is null" is the condition to ask; a skip that is not recorded is a question that comes back on the next order. Stamped server-side rather than on the device because the same account on a second phone is the same person who already declined.';

-- -----------------------------------------------------------------------------
-- Save a name, and record that the question has been answered.
--
-- Two things in one function on purpose: a name that was given IS an answer, and leaving the
-- stamp to a second call would mean a network failure between them could ask again for a name
-- we already hold.
-- -----------------------------------------------------------------------------
create or replace function set_user_name(
  p_user_id    uuid,
  p_first_name text,
  p_last_name  text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_first text;
  v_last  text;
begin
  -- Whitespace is not a name. A form that submitted "   " would otherwise leave a row that is
  -- non-null and renders as nothing, which is the worst of both — every "do we have a name"
  -- test would say yes and every surface would print a blank.
  v_first := nullif(trim(coalesce(p_first_name, '')), '');
  v_last  := nullif(trim(coalesce(p_last_name, '')), '');

  if v_first is null then
    raise exception 'a first name is required'
      using errcode = 'P0001', hint = 'first_name_required';
  end if;

  update app_user
     set first_name      = v_first,
         last_name       = v_last,
         -- Answered. Not `coalesce(name_prompted_at, now())`: the interesting date is when
         -- they last told us, and someone correcting a typo two months later has answered
         -- again.
         name_prompted_at = now(),
         updated_at      = now()
   where id = p_user_id
     and deleted_at is null;

  if not found then
    raise exception 'no such account'
      using errcode = 'P0001', hint = 'account_not_found';
  end if;

  -- The name is echoed back so the caller can render it without a second read. It is the
  -- caller's OWN name, so this discloses nothing they did not just type.
  return jsonb_build_object('first_name', v_first, 'last_name', v_last, 'prompted', true);
end;
$$;

comment on function set_user_name(uuid, text, text) is
  'P18 / E05-39. Sets the account holder''s own name and records that the question has been answered. Called by the `account` Edge Function with an id taken from the verified JWT — never from a body field, for the same reason create_recipient does not take one.';

-- -----------------------------------------------------------------------------
-- "Not now."
--
-- A separate function rather than `set_user_name(null)`, because a skip and an empty name are
-- different intentions and a single call that meant both would eventually be sent by a form
-- with an empty field.
-- -----------------------------------------------------------------------------
create or replace function skip_user_name_prompt(p_user_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update app_user
     set name_prompted_at = now(),
         updated_at       = now()
   where id = p_user_id
     and deleted_at is null
     -- Only the first refusal is recorded. Re-stamping would be harmless today, but the column
     -- means "when they answered", and a screen that fired this on every mount would turn it
     -- into "when they last opened the app".
     and name_prompted_at is null;

  -- Deliberately NOT `if not found then raise`. Skipping something already skipped is not an
  -- error, and a second device that dismissed the same prompt must not see a failure.
  return jsonb_build_object('prompted', true);
end;
$$;

comment on function skip_user_name_prompt(uuid) is
  'P18 / E05-39. Records that the account holder was asked for their name and declined, so the question is not asked again on the next order. Idempotent: skipping an already-skipped prompt succeeds silently, because a second device dismissing the same prompt is not a failure.';

-- -----------------------------------------------------------------------------
-- Take it back.
--
-- `set_user_name` refuses a blank first name, and it must: a form that submitted "   " would
-- otherwise leave a row that is non-null and renders as nothing. But "you may not save an empty
-- name" and "you may not remove the name you gave" are different sentences, and only the first
-- is what that guard is for.
--
-- `P18` is explicit that order one has no name and that must be fine everywhere. A name is
-- therefore something a person may give and then take back, and an edit form that refused an
-- empty field would be claiming we need it after we told them we do not.
--
-- `name_prompted_at` is left **alone**, which is the whole subtlety here. They have still been
-- asked; clearing the name is not a request to be asked again on the next order.
-- -----------------------------------------------------------------------------
create or replace function clear_user_name(p_user_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update app_user
     set first_name = null,
         last_name  = null,
         updated_at = now()
   where id = p_user_id
     and deleted_at is null;

  if not found then
    raise exception 'no such account'
      using errcode = 'P0001', hint = 'account_not_found';
  end if;

  return jsonb_build_object('first_name', null, 'last_name', null, 'prompted', true);
end;
$$;

comment on function clear_user_name(uuid) is
  'P18 / E05-39. Removes the account holder''s own name at their request. Deliberately leaves name_prompted_at set: they have been asked, and taking the name back is not a request to be asked again on the next order. Separate from set_user_name because "you may not save a blank name" and "you may not remove the name you gave" are different rules, and only the first is a guard.';

-- **`service_role` only, and this is the sharp edge of the whole migration.**
--
-- Both are `security definer` and both take the user id as a parameter, exactly as
-- `create_recipient` does. That combination means whoever may call them can act on **any**
-- account: granting `authenticated` would let any signed-in user rename anybody, which is
-- worse than the direct UPDATE this replaced, since RLS at least confined that to their own
-- row.
--
-- The identity is therefore proved *before* the call, from the caller's own JWT, in the Edge
-- Function — the same shape `checkout` and `recipients` set, and for the same reason. The
-- privilege baseline (`PB1`) is written down rather than inherited, so the revoke is explicit
-- even where the platform default would already have been restrictive.
revoke all on function set_user_name(uuid, text, text) from public;
revoke all on function skip_user_name_prompt(uuid) from public;
revoke all on function clear_user_name(uuid) from public;
grant execute on function set_user_name(uuid, text, text) to service_role;
grant execute on function skip_user_name_prompt(uuid) to service_role;
grant execute on function clear_user_name(uuid) to service_role;
