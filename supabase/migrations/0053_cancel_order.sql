-- =============================================================================
-- 0053_cancel_order.sql — the parent cancels, in time. `E06-45`. T10, §9.2 E5.
-- =============================================================================
--
-- `0039` made `paid → cancelled` by a `customer` a legal move and said, in as many words,
-- "the clock is the caller's to check". Nothing was that caller. This is it.
--
-- =============================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO: MOVE MONEY
-- =============================================================================
--
-- Andy's instruction, 2026-08-15: **the money is refunded by hand in the Razorpay dashboard
-- for now — build the record, not the disbursement.** So this writes a `refund` row with
-- `status = 'pending'` and stops. It does not call Razorpay and **it does not post to the
-- ledger.**
--
-- Not posting is the part worth defending, because a reversal here would balance and would
-- look right. The ledger records money that moved. At this instant nothing has: there is a
-- customer who is owed a refund and a human who has not yet issued it. Posting the reversal
-- on the *request* would make `provider:razorpay:clearing` disagree with what Razorpay
-- actually holds — which is precisely the reconciliation `E06-11` exists to run, and the one
-- question the ledger is supposed to answer unambiguously.
--
-- The reversal, the credit note and `cancelled → refunded` (T13) belong to the consumer that
-- learns the refund really happened. That is `E06-46`.
--
-- =============================================================================
-- THE GROUP IS THE UNIT, BECAUSE THE SCREEN IS
-- =============================================================================
--
-- Order detail is keyed on `order_group_id` and a group is one payment (`AR8`). A parent
-- cancelling "this order" means the thing they paid for, so every `"order"` in the group
-- moves together — and **the whole call refuses if any one of them cannot move.** A partial
-- cancellation is a different feature with a different refund amount and a different
-- sentence on the screen; silently doing half of what was asked is the worst of the three.
-- =============================================================================

create or replace function cancel_order(
  p_order_group_id   uuid,
  p_customer_user_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_group    order_group%rowtype;
  v_order    "order"%rowtype;
  v_total    bigint := 0;
  v_count    int    := 0;
  v_refund   uuid;
  v_payment  uuid;
  v_dest     refund_destination;
  v_corr     uuid;
  v_actor    text;
begin
  -- ---------------------------------------------------------------------------
  -- The row lock, first, and for the same reason `E06-21` takes it: this function reads a
  -- status, decides on it, and writes it. Without the lock a settlement landing between the
  -- read and the write resolves by whichever committed last rather than by rule.
  -- ---------------------------------------------------------------------------
  select * into v_group from order_group where id = p_order_group_id for update;
  if not found then
    raise exception 'no such order group %', p_order_group_id
      using errcode = 'P0001', hint = 'not_found';
  end if;

  -- ---------------------------------------------------------------------------
  -- Ownership, from the parameter the Edge Function proved from a JWT — never from the body.
  --
  -- **This is not the RLS policy doing the work.** This function is SECURITY DEFINER and is
  -- called as `service_role`, for which RLS is not in force at all, so there is no policy
  -- underneath this check to catch it. `E06-43` is the reminder that "authorised to read"
  -- and "theirs" are different questions; here there is not even the first one.
  --
  -- Answered as `not_found`, not `not_authorized`: a parent poking at another group's id
  -- learns nothing from us about whether it exists.
  -- ---------------------------------------------------------------------------
  if v_group.customer_user_id is distinct from p_customer_user_id then
    raise exception 'order group % does not belong to the caller', p_order_group_id
      using errcode = 'P0001', hint = 'not_found';
  end if;

  -- ---------------------------------------------------------------------------
  -- Every order in the group must be cancellable. The guards are checked in the order a
  -- parent would ask them, so the FIRST failure is the most useful sentence — an order that
  -- is both already delivered and past its window should say "delivered", not "too late".
  -- ---------------------------------------------------------------------------
  for v_order in
    select * from "order" where order_group_id = p_order_group_id order by id for update
  loop
    v_count := v_count + 1;
    v_corr  := v_order.correlation_id;

    if v_order.status in ('cancelled', 'refunded') then
      raise exception 'order % is already cancelled', v_order.id
        using errcode = 'P0001', hint = 'already_cancelled';
    end if;

    if v_order.status = 'delivered' then
      raise exception 'order % has been delivered', v_order.id
        using errcode = 'P0001', hint = 'already_delivered';
    end if;

    -- T11/T12: past `paid`, only a kitchen or an admin may cancel and they are not
    -- cutoff-bound. The honest refusal is "not from here", not "too late".
    if v_order.status = 'preparing' then
      raise exception 'order % is being prepared', v_order.id
        using errcode = 'P0001', hint = 'already_preparing';
    end if;

    if v_order.status <> 'paid' then
      raise exception 'order % is not paid, so there is nothing to cancel', v_order.id
        using errcode = 'P0001', hint = 'not_paid';
    end if;

    -- **The unknown window is a refusal, and this is the guard that is easy to omit.**
    --
    -- `assert_cutoff_open` coalesces a null grace to 0, which is right for order creation
    -- (`0008` passes no grace at all) and wrong here: a snapshot that never recorded the
    -- cancellation minutes would silently become "cancellable right up to the cutoff". That
    -- is the same promise-from-missing-data that `0052` refuses to make on the screen, and
    -- refusing it there while making it here would be worse than either alone — the parent
    -- would be told "we can't tell" and the server would say yes.
    --
    -- **This is checked BEFORE `cancellation_allowed`, and the order is the point.**
    -- `cancellation_allowed` coalesces null to false (`0052`), which collapses "the snapshot
    -- says no" and "the snapshot does not say" into one answer — and they get different
    -- sentences. Checking `allowed` first told a parent with an empty snapshot "this kitchen
    -- doesn't take cancellations through the app", which is a claim about a kitchen that
    -- nothing in the data supports. Both refuse either way; only one of them is true.
    if cancellation_closes_at(v_order) is null then
      raise exception 'the cancellation window for order % is not knowable', v_order.id
        using errcode = 'P0001', hint = 'cancellation_window_unknown';
    end if;

    if not cancellation_allowed(v_order) then
      raise exception 'cancellation is not offered for order %', v_order.id
        using errcode = 'P0001', hint = 'cancellation_not_offered';
    end if;

    -- §9.2 E5, against the SNAPSHOTTED cutoff and the SNAPSHOTTED grace (`L6`, `C9`).
    -- `C1`: exactly at the boundary, cancellation is closed.
    begin
      perform assert_cutoff_open(
        v_order.cutoff_at,
        (v_order.config_snapshot->>'customer_cancellation_cutoff_minutes')::integer);
    exception when others then
      raise exception 'cancellation has closed for order %', v_order.id
        using errcode = 'P0001', hint = 'cancellation_closed';
    end;

    v_total := v_total + v_order.total_paise;
  end loop;

  if v_count = 0 then
    raise exception 'order group % has no orders', p_order_group_id
      using errcode = 'P0001', hint = 'not_found';
  end if;

  -- ---------------------------------------------------------------------------
  -- T10. The actor is part of the transition (`0039`) — a missing one is a refusal there,
  -- and `customer` is what makes this T10 rather than T11.
  --
  -- **Set, then put back.** `set_config(…, true)` is transaction-local, not function-local,
  -- so without the restore this function silently relabels every later status write in the
  -- caller's transaction as the customer's. One Edge Function call is one transaction today,
  -- which is why it would not bite in production — and it bit the pgTAP suite immediately,
  -- where the whole file is one transaction and the next fixture insert was refused as
  -- `(new) -> pending_payment by customer`. A function that only behaves when it happens to
  -- be the last thing in its transaction is a trap for whoever composes it next.
  -- ---------------------------------------------------------------------------
  v_actor := nullif(current_setting('app.actor_type', true), '');
  perform set_config('app.actor_type', 'customer', true);

  update "order"
     set status             = 'cancelled',
         cancelled_at       = now(),
         cancelled_by_user_id = p_customer_user_id,
         cancel_reason_code = 'customer_cancelled',
         updated_at         = now()
   where order_group_id = p_order_group_id;

  perform set_config('app.actor_type', coalesce(v_actor, ''), true);

  -- ---------------------------------------------------------------------------
  -- The refund REQUEST. `status = 'pending'` is the honest state: somebody owes this parent
  -- money and nobody has sent it yet.
  --
  -- `destination` comes from the order's own snapshot (`M7`), not the live config, for the
  -- same reason the window does: the terms in force when they ordered are the terms.
  -- ---------------------------------------------------------------------------
  select coalesce(
           (config_snapshot->>'refund_default_destination')::refund_destination,
           'source')
    into v_dest
    from "order" where order_group_id = p_order_group_id order by id limit 1;

  -- The captured payment, so the human working the Razorpay dashboard has the charge to
  -- reverse and `E06-46` has something to match an incoming `refund.processed` against.
  select p.id into v_payment
    from payment p
   where p.order_group_id = p_order_group_id and p.status = 'captured'
   order by p.captured_at desc
   limit 1;

  -- ---------------------------------------------------------------------------
  -- `E06-24`'s constraint, checked here so it refuses in words rather than as a `23514`.
  --
  -- A `paid` order with no captured payment should not exist — `settle_payment` writes both
  -- or neither. If it does, this is not the function to paper over it: `refund_source_requires_payment`
  -- exists because a refund to "the original payment method" that names no payment has
  -- nowhere to send the money.
  --
  -- **It deliberately does not fall back to the wallet.** Silently moving somebody's refund
  -- to a destination they did not choose is worse than telling them to get in touch — and
  -- the wallet holds refund-derived credit only (`D6`), so the fallback would also be
  -- inventing a policy decision that is Andy's, not this function's.
  -- ---------------------------------------------------------------------------
  if v_dest = 'source' and v_payment is null then
    raise exception 'order group % has no captured payment to refund to', p_order_group_id
      using errcode = 'P0001', hint = 'no_payment_to_refund';
  end if;

  insert into refund (order_group_id, payment_id, destination, amount_paise, reason_code,
                      initiated_by_user_id, status, correlation_id)
  select p_order_group_id, v_payment, v_dest, v_total, 'customer_cancelled',
         p_customer_user_id, 'pending', v_corr
   where v_total > 0
  returning id into v_refund;

  return jsonb_build_object(
    'order_group_id', p_order_group_id,
    'status', 'cancelled',
    'orders_cancelled', v_count,
    'refund_id', v_refund,
    'refund_amount_paise', coalesce(v_total, 0),
    -- What the screen tells the parent. The disbursement is manual today (`E06-46`), so
    -- this deliberately does not promise a date — `E06-33` is the open task for the figure
    -- somebody has actually confirmed, and inventing one here is what it exists to prevent.
    'refund_status', case when v_refund is null then 'none' else 'pending' end);
end;
$$;

comment on function cancel_order(uuid, uuid) is
  'E06-45 / order-lifecycle T10, §9.2 E5. The parent cancels their own paid order before the '
  'cancellation cutoff. Guards, in the order a parent would ask them: ownership (as not_found, '
  'so a probe learns nothing), then already_cancelled / already_delivered / already_preparing / '
  'not_paid / cancellation_not_offered / cancellation_window_unknown / cancellation_closed. '
  'RECORDS a pending refund and DOES NOT MOVE MONEY: the disbursement is manual in the Razorpay '
  'dashboard today, and posting a ledger reversal for money that has not moved would put '
  'provider:razorpay:clearing out of step with what Razorpay holds — the one thing E06-11 '
  'reconciles. The reversal, the credit note and T13 belong to E06-46, which learns the refund '
  'really happened. The whole group moves or none of it does; partial cancellation is a '
  'different feature. Ownership is checked HERE and not by RLS: this is SECURITY DEFINER called '
  'as service_role, for which no policy is in force.';

revoke all on function cancel_order(uuid, uuid) from public;
grant execute on function cancel_order(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
