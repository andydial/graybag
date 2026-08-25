-- =============================================================================
-- 0067_resumable_checkout.sql — a pending payment can be resumed, abandoned, or expires. `E05-54`
--
-- **Two real parents are stranded on production right now.** `GB-8ZDW8S` and `GB-G2DEYM`, placed
-- 18 and 19 August, still `pending_payment` six days later, for a service date of 20 August whose
-- cutoff passed on the 20th. Neither can be paid (the app can only pay inside the checkout flow it
-- has already left), neither can be cancelled (`OrderDetailScreen` refuses to cancel an unpaid
-- order), and each blocks deleting the child it names. The screen tells them it "will close by
-- itself if the payment does not come through", which is false: nothing closes it.
--
-- This migration is the server half of making that sentence true.
--
-- ## The window, and why it is what it is
--
-- `checkout_expires_at` is **the earlier of 24 hours after the group was created, and the moment
-- the order can no longer be fulfilled.**
--
--   * **Never past `cutoff_at`.** After cutoff the kitchen cannot make the food. An order that is
--     resumable but unfulfillable is a worse lie than the one this replaces — the parent pays and
--     then finds out. This is the binding constraint and it is why the rule is a `least()` rather
--     than a fixed timer.
--   * **24 hours otherwise.** The realistic recovery cases are all inside a day: the sheet was
--     dismissed, the signal dropped, the phone died, "I'll do it after dinner". Beyond a day the
--     parent has moved on, and what is left is a stale "Payment pending" row blocking an erasure
--     request. The lead time is up to 14 days (`platform_config`), so without the 24-hour arm an
--     order placed a fortnight ahead would sit resumable for a fortnight.
--
-- A group with no orders — impossible today, but the join permits it — expires at 24 hours, since
-- `min()` over nothing is null and `least()` ignores nulls.
--
-- ## What this deliberately does NOT do
--
-- **Nothing here posts to the ledger, and that is the point.** Abandoning or expiring an unpaid
-- checkout moves no money: no payment was captured, no invoice was issued, no ledger transaction
-- exists to reverse. `E06-46`'s refund machinery is for money that actually moved. The pgTAP suite
-- asserts the ledger is untouched in both paths, because "we cancelled it and also posted
-- something" is the failure that would be found in a month-end reconciliation rather than here.
--
-- It also does not add an `expired` status. `pending_payment → cancelled` is already a legal
-- transition for `system`, `customer` and `admin` (`0039`), and PostgreSQL cannot drop an enum
-- value once added. The distinction lives in `reason_code`, which is what it is for.
-- =============================================================================

-- ---------------------------------------------------------------------------------------------
-- A reason distinct from `customer_cancelled`, which means a *paid* order the parent cancelled
-- and which owes them money back. Abandoning an unpaid checkout owes nobody anything, and a
-- report that cannot tell them apart will overstate refunds.
-- ---------------------------------------------------------------------------------------------
insert into reason_code (code, category, display_name, requires_note, is_customer_visible, is_active)
values ('checkout_abandoned', 'cancellation', 'Payment not completed', false, true, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------------------------
-- When this checkout stops being resumable. A PostgREST computed column, so the app reads it on
-- the order group it already fetches rather than duplicating the rule in TypeScript.
-- ---------------------------------------------------------------------------------------------
create or replace function checkout_expires_at(g order_group) returns timestamptz
language sql stable as $$
  select least(
    g.created_at + interval '24 hours',
    (select min(o.cutoff_at) from "order" o where o.order_group_id = g.id)
  );
$$;

comment on function checkout_expires_at(order_group) is
  'E05-54: the earlier of 24h after creation and the first cutoff. Never resumable past the point '
  'the kitchen can still make the food.';

-- ---------------------------------------------------------------------------------------------
-- Is there still a payment to resume? Read by the app to decide whether to offer "continue".
--
-- Deliberately false for anything that is not `pending_payment`: a `paid` group has nothing to
-- resume, and a `cancelled` one must never offer a way back.
-- ---------------------------------------------------------------------------------------------
create or replace function checkout_resumable(g order_group) returns boolean
language sql stable as $$
  select g.status = 'pending_payment' and now() < checkout_expires_at(g);
$$;

comment on function checkout_resumable(order_group) is
  'E05-54: pending_payment and not yet expired. The app offers Continue only on this.';

-- ---------------------------------------------------------------------------------------------
-- The attempt a resume should re-use, if there is one.
--
-- **This is the anti-double-charge rule.** `payments-create-order` creates a fresh Razorpay order
-- on every call, so resuming naively would leave two live provider orders against one group —
-- two things that can each be paid, and a parent charged twice for one lunch. Reuse is only safe
-- when nothing about the money has changed, so all four conditions must hold:
--
--   1. the group is still `pending_payment` — not paid, not cancelled;
--   2. the attempt is still `created` — not captured, not failed;
--   3. the amount still matches `payable_paise` — a reprice invalidates it, and the parent must
--      be shown the new total rather than quietly charged the old one;
--   4. the checkout has not expired.
--
-- When any of them fails this returns nothing and the caller creates a new attempt, which is the
-- safe direction: an extra unpaid Razorpay order costs nothing, a reused wrong one costs money.
-- ---------------------------------------------------------------------------------------------
create or replace function reusable_payment_attempt(
  p_order_group_id uuid,
  p_customer_user_id uuid
)
returns table (payment_id uuid, provider_order_id text, amount_paise bigint, attempt_no smallint)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_group order_group%rowtype;
begin
  select * into v_group from order_group where id = p_order_group_id;
  if not found then
    raise exception 'no such order group' using hint = 'not_found';
  end if;

  -- Same refusal for "not yours" as for "does not exist": a caller naming somebody else's group
  -- must not learn whether it exists.
  if v_group.customer_user_id is distinct from p_customer_user_id then
    raise exception 'not authorized' using hint = 'not_authorized';
  end if;

  if v_group.status <> 'pending_payment' then
    return;
  end if;

  if now() >= checkout_expires_at(v_group) then
    return;
  end if;

  return query
    select p.id, p.provider_order_id, p.amount_paise, p.attempt_no
      from payment p
     where p.order_group_id = p_order_group_id
       and p.status = 'created'
       and p.amount_paise = v_group.payable_paise
       and p.provider_order_id is not null
     order by p.attempt_no desc
     limit 1;
end;
$$;

revoke all on function reusable_payment_attempt(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The parent gives up on an unpaid checkout. Explicit, and available without support.
-- ---------------------------------------------------------------------------------------------
create or replace function abandon_checkout(
  p_order_group_id uuid,
  p_customer_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_group order_group%rowtype;
  v_prev  text;
  v_count integer;
begin
  select * into v_group from order_group where id = p_order_group_id for update;
  if not found then
    raise exception 'no such order group' using hint = 'not_found';
  end if;

  if v_group.customer_user_id is distinct from p_customer_user_id then
    raise exception 'not authorized' using hint = 'not_authorized';
  end if;

  -- Money already moved. Abandoning is for a checkout that never completed; a paid order is
  -- `cancel_order`'s business (`E06-45`) and owes the parent a refund.
  if v_group.status = 'paid' then
    raise exception 'this order is already paid' using hint = 'already_paid';
  end if;

  if v_group.status <> 'pending_payment' then
    raise exception 'this order is not awaiting payment' using hint = 'not_pending';
  end if;

  -- `set_config(..., true)` is transaction-local, not function-local, so the caller's actor type
  -- would leak out of here into the rest of their transaction. Saved and restored — the lesson
  -- from `0053`.
  v_prev := current_setting('app.actor_type', true);
  perform set_config('app.actor_type', 'customer', true);

  update "order"
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason_code = 'checkout_abandoned',
         cancelled_by_user_id     = p_customer_user_id
   where order_group_id = p_order_group_id
     and status = 'pending_payment';
  get diagnostics v_count = row_count;

  update order_group set status = 'cancelled' where id = p_order_group_id;

  perform set_config('app.actor_type', coalesce(v_prev, ''), true);

  -- No ledger posting, no refund row, no invoice. Nothing was ever captured.
  return jsonb_build_object(
    'order_group_id', p_order_group_id,
    'orders_cancelled', v_count,
    'reason', 'checkout_abandoned'
  );
end;
$$;

revoke all on function abandon_checkout(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The sweep. Everything past its window becomes `cancelled` with `checkout_expired`.
--
-- **There is no `pg_cron` on production**, which is why this is a plain function rather than a
-- schedule: it is called opportunistically from paths that already run — `checkout-status` when
-- the app polls, `payments-drain`, and the resume endpoint — so it resolves without anything
-- being installed. `checkout_resumable` is false past the window regardless of whether the sweep
-- has run yet, so the app is never wrong even between sweeps.
--
-- **It only expires what is provably unchargeable, and that restriction is the whole safety
-- argument.** A group with a live `created` attempt has a Razorpay order that *might* have just
-- been paid — a webhook in flight, a capture we have not heard about yet. Cancelling that from
-- SQL would take money for an order we had just marked cancelled, which is the one outcome worse
-- than the bug being fixed.
--
-- So this sweep skips any group holding a `created` attempt. Those are handled by
-- `expirable_with_live_attempt()` below, whose caller reconciles against Razorpay first — the
-- provider check can only be made where the credentials are, which is the Edge Function, not
-- here. Groups that never reached Razorpay, or whose every attempt already `failed`, cannot have
-- taken money and are safe to expire outright.
--
-- Returns the number of GROUPS expired, so a caller can log a number that means something.
-- ---------------------------------------------------------------------------------------------
create or replace function expire_stale_checkouts(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prev   text;
  v_groups uuid[];
begin
  select coalesce(array_agg(g.id), '{}')
    into v_groups
    from (
      select og.id
        from order_group og
       where og.status = 'pending_payment'
         and now() >= checkout_expires_at(og)
         -- Nothing that could still be captured. See the header.
         and not exists (
           select 1 from payment p
            where p.order_group_id = og.id and p.status = 'created'
         )
       order by og.created_at
       limit greatest(p_limit, 0)
    ) g;

  if array_length(v_groups, 1) is null then
    return 0;
  end if;

  v_prev := current_setting('app.actor_type', true);
  perform set_config('app.actor_type', 'system', true);

  update "order"
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason_code = 'checkout_expired'
   where order_group_id = any (v_groups)
     and status = 'pending_payment';

  update order_group set status = 'cancelled' where id = any (v_groups);

  perform set_config('app.actor_type', coalesce(v_prev, ''), true);

  return array_length(v_groups, 1);
end;
$$;

revoke all on function expire_stale_checkouts(integer) from public, anon, authenticated;

comment on function expire_stale_checkouts(integer) is
  'E05-54: cancels pending_payment groups past checkout_expires_at. Called opportunistically — '
  'there is no pg_cron on production. Posts nothing to the ledger; no money moved.';


-- ---------------------------------------------------------------------------------------------
-- The other half: expired groups that DO hold a live attempt, for a caller that can ask Razorpay.
--
-- Returned rather than acted on, because deciding these needs the provider. The caller fetches
-- `/v1/orders/<provider_order_id>/payments`, and:
--
--   * a captured payment  → settle it, do not expire. The webhook was simply late.
--   * nothing captured    → `expire_checkout_group()` below.
--
-- `checkout-status` already performs exactly this reconciliation for a single group (`E06-16`),
-- so this is that logic pointed at a list instead of at whatever the app happens to be polling.
-- ---------------------------------------------------------------------------------------------
create or replace function expirable_with_live_attempt(p_limit integer default 100)
returns table (order_group_id uuid, provider_order_id text, attempt_no smallint, expires_at timestamptz)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select og.id, p.provider_order_id, p.attempt_no, checkout_expires_at(og)
    from order_group og
    join lateral (
      select p2.provider_order_id, p2.attempt_no
        from payment p2
       where p2.order_group_id = og.id and p2.status = 'created'
       order by p2.attempt_no desc
       limit 1
    ) p on true
   where og.status = 'pending_payment'
     and now() >= checkout_expires_at(og)
   order by og.created_at
   limit greatest(p_limit, 0);
$$;

revoke all on function expirable_with_live_attempt(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Expire one group, having established elsewhere that it took no money.
--
-- Re-checks the status inside the transaction rather than trusting the caller's snapshot: the
-- gap between "Razorpay says unpaid" and this call is exactly where a late capture lands, and
-- `settle_payment` may have moved the group to `paid` in between. Returns false in that case
-- instead of cancelling a paid order.
-- ---------------------------------------------------------------------------------------------
create or replace function expire_checkout_group(p_order_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prev   text;
  v_status order_group_status;
begin
  select status into v_status from order_group where id = p_order_group_id for update;
  if not found or v_status <> 'pending_payment' then
    return false;
  end if;

  v_prev := current_setting('app.actor_type', true);
  perform set_config('app.actor_type', 'system', true);

  update "order"
     set status = 'cancelled', cancelled_at = now(), cancel_reason_code = 'checkout_expired'
   where order_group_id = p_order_group_id and status = 'pending_payment';

  update order_group set status = 'cancelled' where id = p_order_group_id;

  perform set_config('app.actor_type', coalesce(v_prev, ''), true);
  return true;
end;
$$;

revoke all on function expire_checkout_group(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The same two rules, addressed to an `order`.
--
-- `OrderDetailScreen` queries `order`, not `order_group`, so without these the app would have to
-- re-derive the window in TypeScript from `placed_at` and a cutoff — a second copy of a rule
-- about money, in a different language, drifting from the first. The header of this migration
-- promised the app would read the rule rather than restate it; these are how it does.
-- ---------------------------------------------------------------------------------------------
create or replace function checkout_expires_at(o "order") returns timestamptz
language sql stable as $$
  select checkout_expires_at(og) from order_group og where og.id = o.order_group_id;
$$;

create or replace function checkout_resumable(o "order") returns boolean
language sql stable as $$
  select checkout_resumable(og) from order_group og where og.id = o.order_group_id;
$$;
