-- Rollback for 0048 — settlement stops issuing invoices.
--
-- Orders are still confirmed and money still recorded; customers simply receive no tax document,
-- which is the state the product was in before today. Restores `settle_payment` exactly as `0046`
-- left it, taken from `pg_get_functiondef()` before `0048` replaced it rather than retyped.
CREATE OR REPLACE FUNCTION public.settle_payment(p_provider_order_id text, p_provider_payment_id text, p_amount_paise bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$

;
