-- =============================================================================
-- 0046_settle_payment.sql — a capture becomes a confirmed order. `E06-06`, step 6/7 server half.
-- =============================================================================
--
-- The webhook records; this settles. They are deliberately separate (`E06-04`): an event storm
-- cannot become a settlement storm, and a replayed event is a no-op here rather than a second
-- attempt at the money.
--
-- **This function does not decide that money moved.** `R8`/§3.6: a verified signature proves the
-- body was not tampered with, not that a payment succeeded. The caller fetches the payment from
-- Razorpay and passes what the provider says; this function is what makes that true in our
-- database, atomically, or not at all.
--
-- =============================================================================
-- IDEMPOTENT WITHOUT A FLAG — §7.1 LAYERS 5–8
-- =============================================================================
--
-- Run it twice and the second run's every write is refused by a different constraint:
-- `uq_payment_one_capture_per_group` (5), the ledger's `idempotency_key` (6),
-- `uq_order_pickup_code` (8). So the check below is an early return for the ordinary case, not
-- the thing that makes it safe — the constraints are. That distinction matters because a flag
-- can be wrong; a unique index cannot.
--
-- =============================================================================
-- THE PICKUP CODE IS ALLOCATED HERE, ON CAPTURE
-- =============================================================================
--
-- §9.4, and `OrderPlacedScreen` already depends on it: `placedOrder()` refuses to render without
-- a four-digit code, treating its absence as a second, independent witness that money did not
-- move. Allocating it anywhere earlier would break that.
--
-- Unique per `(school_id, service_date)` — a kitchen reading codes aloud at one school on one day
-- needs them distinct there, and nowhere else. Retried on collision rather than derived from the
-- order id, because a derived code is guessable and `[DM-10]` already warns that four digits are
-- weak enough that staff must match the name as well.
-- =============================================================================

create or replace function settle_payment(
  p_provider_order_id   text,
  p_provider_payment_id text,
  p_amount_paise        bigint
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment    payment%rowtype;
  v_group      order_group%rowtype;
  v_subtotal   bigint;
  v_cgst       bigint;
  v_sgst       bigint;
  v_code       text;
  v_attempt    int := 0;
  v_order      record;
begin
  select * into v_payment from payment
   where provider = 'razorpay' and provider_order_id = p_provider_order_id;
  if not found then
    -- §10.9: almost always the other environment's account talking to us. The caller records the
    -- event and returns 200; it must not 500 and invite a retry storm for an order we will never
    -- have.
    raise exception 'no payment for provider order %', p_provider_order_id
      using errcode = 'P0001', hint = 'payment_not_found';
  end if;

  -- Everything below happens under the group lock, so two deliveries of the same event
  -- serialise rather than interleave.
  select * into v_group from order_group where id = v_payment.order_group_id for update;

  -- Already settled by an earlier delivery. Return what exists rather than raising: a duplicate
  -- webhook is success.
  if v_payment.status = 'captured' then
    return jsonb_build_object(
      'order_group_id', v_group.id,
      'already_settled', true,
      'pickup_code', (select o.pickup_code from "order" o
                       where o.order_group_id = v_group.id and o.pickup_code is not null limit 1));
  end if;

  if p_amount_paise is distinct from v_group.payable_paise then
    -- `L7`: we never record a settlement for an amount the customer was not shown. A mismatch is
    -- a reconciliation problem to be looked at by a person, not something to absorb quietly.
    raise exception 'captured % paise but group % is payable %',
      p_amount_paise, v_group.id, v_group.payable_paise
      using errcode = 'P0001', hint = 'amount_mismatch';
  end if;

  update payment
     set status = 'captured', provider_payment_id = p_provider_payment_id, captured_at = now()
   where id = v_payment.id;

  -- T5, and the actor is `system`: a webhook does not move an order, the settlement path does,
  -- after checking the capture server-side.
  perform set_config('app.actor_type', 'system', true);

  for v_order in
    select * from "order" where order_group_id = v_group.id and status = 'pending_payment'
  loop
    -- §9.4. Retry on collision; the space is 10,000 per school per day and a real day is tens.
    v_code := null;
    v_attempt := 0;
    while v_code is null and v_attempt < 50 loop
      v_attempt := v_attempt + 1;
      begin
        update "order"
           set status = 'paid',
               confirmed_at = now(),
               pickup_code = lpad((floor(random() * 10000))::int::text, 4, '0')
         where id = v_order.id
        returning pickup_code into v_code;
      exception when unique_violation then
        v_code := null;   -- taken at this school on this day; draw again
      end;
    end loop;

    if v_code is null then
      raise exception 'could not allocate a pickup code for order % after % attempts',
        v_order.id, v_attempt
        using errcode = 'P0001', hint = 'pickup_code_exhausted';
    end if;
  end loop;

  -- The sale, posted once. `idempotency_key` is the provider payment id, so a second delivery
  -- that somehow reached this point still cannot double the money.
  select coalesce(sum(subtotal_paise), 0), coalesce(sum(tax_cgst_paise), 0),
         coalesce(sum(tax_sgst_paise), 0)
    into v_subtotal, v_cgst, v_sgst
    from "order" where order_group_id = v_group.id;

  perform post_ledger_transaction(
    'sale', 'payment', v_payment.id,
    jsonb_build_array(
      jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',
                         'amount_paise', v_subtotal + v_cgst + v_sgst),
      jsonb_build_object('account', 'platform:revenue', 'direction', 'credit',
                         'amount_paise', v_subtotal),
      jsonb_build_object('account', 'platform:tax_payable:cgst', 'direction', 'credit',
                         'amount_paise', v_cgst),
      jsonb_build_object('account', 'platform:tax_payable:sgst', 'direction', 'credit',
                         'amount_paise', v_sgst)
    ),
    now(), v_group.correlation_id, null, null,
    'settle:' || p_provider_payment_id
  );

  update order_group set paid_at = now() where id = v_group.id and paid_at is null;

  return jsonb_build_object(
    'order_group_id', v_group.id,
    'already_settled', false,
    'pickup_code', (select o.pickup_code from "order" o
                     where o.order_group_id = v_group.id and o.pickup_code is not null limit 1));
end;
$$;

comment on function settle_payment(text, text, bigint) is
  'E06-06: turns a verified capture into a paid order — payment captured, orders to `paid` via T5, a §9.4 pickup code per order, the sale posted to the ledger, order_group.paid_at stamped. Idempotent WITHOUT a flag: §7.1 layers 5-8 refuse every write of a second run, and the early return is a convenience rather than the guarantee. Does NOT decide that money moved (R8/§3.6) — the caller fetches the payment from Razorpay and passes what the provider says. Refuses an amount that is not what the customer was shown (L7).';

revoke all on function settle_payment(text, text, bigint) from public;
grant execute on function settle_payment(text, text, bigint) to service_role;
