-- =============================================================================
-- 0049_begin_payment.sql — a Razorpay order exists, so record the attempt. `E06-02`.
-- =============================================================================
--
-- The client half of checkout needs a **provider order id** before it can open the Razorpay
-- sheet, and nothing in this repository created one. `create_checkout` (`0014`) prices and places
-- the orders; this is the step between that and the customer seeing a payment sheet.
--
-- The Edge Function calls Razorpay's Orders API — that is an HTTP call and cannot live in SQL —
-- and then calls this to record what it got. So this function's job is **not** to be a writer
-- that trusts its caller. It is the guard that makes the write safe:
--
--   * the group must belong to the caller,
--   * it must be in a state where paying is meaningful,
--   * and the amount recorded must be the amount WE priced, not the amount the caller says.
--
-- =============================================================================
-- WHY THE AMOUNT IS CHECKED RATHER THAN STORED FROM THE ARGUMENT
-- =============================================================================
--
-- `p_amount_paise` is what the Edge Function actually asked Razorpay for. It is passed in so that
-- this function can **refuse if it disagrees with `order_group.payable_paise`**, and it is then
-- discarded — the row stores our own figure.
--
-- If the two ever differ, the customer is being charged something other than what we priced, and
-- the correct outcome is that no payment row exists at all. Recording the provider's figure would
-- make the ledger agree with Razorpay and disagree with the order, which is the shape of an
-- error nobody finds until reconciliation months later. `L7` is the same rule one layer up.
--
-- =============================================================================
-- IDEMPOTENCY: THE SECOND TAP ON PAY
-- =============================================================================
--
-- `payment_provider_order_unique` already makes a given `provider_order_id` insertable once. But
-- the ordinary case is not a duplicate id — it is a customer tapping Pay twice and the Edge
-- Function creating **two** Razorpay orders, which are two different ids and both insertable.
--
-- That is legitimate and is what `attempt_no` is for: a payment attempt that was abandoned is not
-- an error, and §10 requires the abandoned row to survive so the reconcilers can see it. So a
-- second attempt is allowed, numbered, and returns its own id. What is NOT allowed is a second
-- attempt on a group that is already paid — checked below, and the reason the status check is not
-- merely `<> 'cancelled'`.
--
-- =============================================================================
-- SECURITY
-- =============================================================================
--
-- `security definer` with an explicit `p_customer_user_id`, exactly like `create_checkout`: the
-- Edge Function proves identity from the caller's JWT and passes the id, never taking it from the
-- request body. Callable by `service_role` only, so that the parameter cannot be an escalation
-- route for a signed-in user (`0030` learned this the hard way).
-- =============================================================================

create or replace function begin_payment(
  p_customer_user_id uuid,
  p_order_group_id   uuid,
  p_provider_order_id text,
  p_amount_paise     bigint
) returns table (payment_id uuid, correlation_id uuid, attempt_no smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group order_group%rowtype;
  v_attempt smallint;
begin
  if p_provider_order_id is null or btrim(p_provider_order_id) = '' then
    raise exception 'provider_order_id is required' using hint = 'invalid_request';
  end if;

  -- The row lock matters: two taps on Pay race here, and `attempt_no` is derived from a count.
  select * into v_group from order_group where id = p_order_group_id for update;

  if not found then
    raise exception 'no such order group' using hint = 'not_found';
  end if;

  -- Ownership before anything else, and it is a refusal rather than a filtered result: a caller
  -- who names somebody else's group must not learn whether it exists.
  if v_group.customer_user_id is distinct from p_customer_user_id then
    raise exception 'not authorized' using hint = 'not_authorized';
  end if;

  -- `paid` is the one that matters. A group that has already settled must never acquire a second
  -- provider order — that is how a customer gets charged twice for one lunch.
  if v_group.status = 'paid' then
    raise exception 'this order is already paid' using hint = 'already_paid';
  end if;

  -- Refunded in either degree is also settled money, and a new provider order against it would
  -- be a fresh charge on an order the customer has already been given money back for.
  if v_group.status in ('cancelled', 'refunded', 'partially_refunded') then
    raise exception 'this order can no longer be paid' using hint = 'not_payable';
  end if;

  -- Everything else — `draft`, `pending_payment`, `payment_failed` — may proceed. `payment_failed`
  -- is deliberately payable: a declined card is the commonest reason a parent taps Pay again, and
  -- refusing the retry would strand the order with no way forward but a new cart. The previous
  -- attempt keeps its row and its `attempt_no`, which is what §10's reconcilers read.

  -- See the header. The argument is checked and then discarded.
  if p_amount_paise is distinct from v_group.payable_paise then
    raise exception 'amount disagrees with the priced order (asked %, priced %)',
      p_amount_paise, v_group.payable_paise
      using hint = 'amount_mismatch';
  end if;

  -- `payable_paise` of zero would mean asking Razorpay for nothing. Wallet-only checkout
  -- (`E06-10`) is the case that produces it, and it must not reach a payment sheet at all.
  if v_group.payable_paise <= 0 then
    raise exception 'nothing to pay' using hint = 'nothing_payable';
  end if;

  select coalesce(max(p.attempt_no), 0) + 1 into v_attempt
  from payment p where p.order_group_id = p_order_group_id;

  return query
  insert into payment (
    order_group_id, provider, provider_order_id, amount_paise, currency,
    status, attempt_no, correlation_id
  )
  values (
    p_order_group_id, 'razorpay', p_provider_order_id, v_group.payable_paise, v_group.currency,
    'created', v_attempt, v_group.correlation_id
  )
  returning payment.id, payment.correlation_id, payment.attempt_no;
end;
$$;

revoke all on function begin_payment(uuid, uuid, text, bigint) from public, anon, authenticated;
grant execute on function begin_payment(uuid, uuid, text, bigint) to service_role;

comment on function begin_payment(uuid, uuid, text, bigint) is
  'E06-02. Records a Razorpay order against a priced order_group, after checking ownership, that the group is still payable, and that the amount asked of Razorpay equals what we priced (the argument is checked and discarded; the row stores our figure). service_role only — the Edge Function proves identity from the JWT and passes p_customer_user_id, exactly as create_checkout does.';
