-- Down for 0084. Restores `create_checkout` to the body that was live before the service-day
-- guard — the one that refuses a Sunday with "one of the dishes is no longer on the menu for that
-- day". Roll back only if the guard itself is refusing valid orders; the cost is that a parent
-- ordering for a non-service day is misled again, which is what `E05-55` exists to stop.

begin;

create or replace function create_checkout(
  p_customer_user_id     uuid,
  p_idempotency_key      text,
  p_request_hash         text,
  p_expected_total_paise bigint,
  p_lines                jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_group_id       uuid;
  v_correlation_id uuid;
  v_existing       record;
  v_line           record;
  v_order          record;
  v_cfg            effective_config;
  v_order_id       uuid;
  v_cutoff         timestamptz;
  v_line_no        smallint;
  v_subtotal       bigint;
  v_cgst           bigint;
  v_sgst           bigint;
  v_g_subtotal     bigint := 0;
  v_g_tax          bigint := 0;
  v_result         jsonb;
begin
  -- `0039`: this function IS the system actor performing T2 (insert -> pending_payment), so it
  -- says so rather than relying on its caller to have said it. Transaction-local (`true`), so it
  -- cannot leak into another statement on a pooled connection.
  perform set_config('app.actor_type', 'system', true);

  -- `E07-20`, and it is FIRST for a reason: this refusal has to happen before any money moves.
  -- Without it, under auto-capture the customer is charged, `settle_payment` then cannot
  -- allocate an invoice number, the settlement rolls back, `PY2` returns 200, and our own sweep
  -- retries the failure for ever — every customer charged, no order created, no 5xx, no alert.
  -- No-op outside production.
  perform assert_seller_identity_configured();
  -- `E20-55`. The ordering gate `0001` describes. Inside the transaction, so the check and
  -- the write see one snapshot; inert until a policy_version sets blocks_ordering.
  perform assert_policies_accepted(p_customer_user_id);

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'checkout has no lines' using errcode = 'P0001', hint = 'empty_cart';
  end if;

  -- ---------------------------------------------------------------------------
  -- Step 2 — idempotency (`E05-12`).
  --
  -- `order_group` already carries `unique (customer_user_id, idempotency_key)`, so this is
  -- the SECOND layer, not the only one. Checking first gives a replay the stored answer
  -- instead of a constraint violation; the constraint is what makes it true under a race.
  -- ---------------------------------------------------------------------------
  select og.id, og.correlation_id, og.payable_paise, og.status
    into v_existing
    from order_group og
   where og.customer_user_id = p_customer_user_id
     and og.idempotency_key  = p_idempotency_key;

  if found then
    -- A replay with a DIFFERENT cart is not a replay; it is a bug or an attack, and
    -- returning the first cart's answer would confirm an order the caller did not send.
    if not exists (
      select 1 from idempotency_key k
       where k.key = p_idempotency_key and k.scope = 'checkout'
         and k.request_hash = p_request_hash
    ) then
      raise exception 'idempotency key reused with a different request'
        using errcode = 'P0001', hint = 'idempotency_key_reused';
    end if;

    return jsonb_build_object(
      'order_group_id', v_existing.id,
      'correlation_id', v_existing.correlation_id,
      'payable_paise',  v_existing.payable_paise,
      'status',         v_existing.status,
      'replayed',       true
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- Steps 4-6 — revalidate, authorize and guard, per line, against live data.
  --
  -- Nothing from the client is trusted except the identifiers and the quantity. The price
  -- is the server's, the snapshots are today's, and every guard is evaluated here.
  -- ---------------------------------------------------------------------------
  create temporary table if not exists tmp_checkout_lines (
    recipient_id  uuid,
    service_date  date,
    break_time_id uuid,
    menu_item_id  uuid,
    quantity      int,
    school_id     uuid,
    kitchen_id    uuid,
    city_id       uuid,
    dish_id       uuid,
    unit_price    bigint
  ) on commit drop;
  -- `where true` is not decoration. Hosted Supabase runs `safeupdate`, which rejects an
  -- unqualified DELETE with `21000: DELETE requires a WHERE clause`; local Postgres does
  -- not load it. So this statement worked in every pgTAP run and failed on staging for
  -- every real order (`E05-21`).
  delete from tmp_checkout_lines where true;

  for v_line in
    select (l->>'recipient_id')::uuid  as recipient_id,
           (l->>'service_date')::date  as service_date,
           nullif(l->>'break_time_id','')::uuid as break_time_id,
           (l->>'menu_item_id')::uuid  as menu_item_id,
           coalesce((l->>'quantity')::int, 1) as quantity
      from jsonb_array_elements(p_lines) as l
  loop
    if v_line.quantity <= 0 then
      raise exception 'line quantity must be positive' using errcode = 'P0001', hint = 'bad_quantity';
    end if;

    -- Step 5. The ONE guard that RLS does not also enforce, because this function runs as
    -- service_role. Asserted explicitly, and explicitly tested.
    if not exists (
      select 1 from guardian_link gl
       where gl.recipient_id = v_line.recipient_id
         and gl.user_id      = p_customer_user_id
         and gl.can_order
         and gl.revoked_at is null
    ) then
      raise exception 'caller may not order for recipient %', v_line.recipient_id
        using errcode = 'P0001', hint = 'not_authorized';
    end if;

    -- Step 6, recipient half.
    if not exists (
      select 1 from recipient r
       where r.id = v_line.recipient_id and r.is_active and r.deleted_at is null
    ) then
      raise exception 'recipient % is not available', v_line.recipient_id
        using errcode = 'P0001', hint = 'recipient_unavailable';
    end if;

    -- Step 4. The menu item must still be on that school's live menu for that date, and
    -- the price is whatever the override chain says NOW — never what the client sent.
    insert into tmp_checkout_lines
    select v_line.recipient_id, v_line.service_date, v_line.break_time_id,
           v_line.menu_item_id, v_line.quantity,
           s.id, s.kitchen_id, s.city_id, d.id,
           coalesce(ovr.price_paise, mi.price_paise)
      from recipient r
      join school s          on s.id = r.school_id and s.is_active
                            and s.onboarded_at is not null and s.offboarded_at is null
      join menu_assignment ma on ma.school_id = s.id
                            and ma.revoked_at is null
                            and ma.valid_from <= v_line.service_date
                            and (ma.valid_to is null or ma.valid_to > v_line.service_date)
      join menu m            on m.id = ma.menu_id and m.status = 'active'
      join menu_item mi      on mi.menu_id = m.id and mi.id = v_line.menu_item_id and mi.is_active
      join dish d            on d.id = mi.dish_id and d.is_active
      left join menu_item_price_override ovr
             on ovr.menu_item_id = mi.id and ovr.school_id = s.id
            and ovr.valid_from <= v_line.service_date
            and (ovr.valid_to is null or ovr.valid_to > v_line.service_date)
     where r.id = v_line.recipient_id
       -- The weekday rule lives on the item, not on the calendar.
       and extract(isodow from v_line.service_date)::smallint = any (mi.available_days);

    if not found then
      raise exception 'menu item % is not available to recipient % on %',
        v_line.menu_item_id, v_line.recipient_id, v_line.service_date
        using errcode = 'P0001', hint = 'unavailable';
    end if;
  end loop;

  -- ---------------------------------------------------------------------------
  -- Step 9 (first half) — the group. Totals are filled in at the end, in ONE statement,
  -- because `order_group_payable_arithmetic` is a plain CHECK and fires immediately.
  -- ---------------------------------------------------------------------------
  v_correlation_id := gen_random_uuid();

  insert into order_group (customer_user_id, correlation_id, idempotency_key, status, city_id)
  select p_customer_user_id, v_correlation_id, p_idempotency_key, 'pending_payment', t.city_id
    from tmp_checkout_lines t limit 1
  returning id into v_group_id;

  -- `key` is the primary key and `scope` is a column, so the scope is asserted on read
  -- rather than being part of the identity. A 24-hour TTL, purged by job (§12.3).
  insert into idempotency_key (key, scope, user_id, request_hash, resource_type,
                               resource_id, response_status, expires_at)
  values (p_idempotency_key, 'checkout', p_customer_user_id, p_request_hash,
          'order_group', v_group_id, 201, now() + interval '24 hours')
  on conflict (key) do nothing;

  -- ---------------------------------------------------------------------------
  -- One "order" per recipient / service_date / break — the unit the kitchen delivers.
  -- ---------------------------------------------------------------------------
  for v_order in
    select recipient_id, service_date, break_time_id, school_id, kitchen_id, city_id
      from tmp_checkout_lines
     group by recipient_id, service_date, break_time_id, school_id, kitchen_id, city_id
  loop
    v_cfg    := resolve_effective_config(v_order.school_id);
    v_cutoff := compute_cutoff_at(v_order.school_id, v_order.service_date);

    -- Step 6. **This is `assert_cutoff_open`'s first caller.** E05-07 shipped the
    -- mechanism and its proof; enforcement becomes real here and nowhere else.
    -- It takes the resolved cutoff instant, not a school and a date: the value compared
    -- against is the one SNAPSHOTTED onto the order two statements below, so an admin
    -- moving the cutoff cannot retroactively invalidate an order placed before the change.
    begin
      perform assert_cutoff_open(v_cutoff);
    exception when others then
      raise exception 'cutoff has passed for % on %', v_order.school_id, v_order.service_date
        using errcode = 'P0001', hint = 'cutoff_passed';
    end;

    if v_order.service_date < current_date + v_cfg.min_advance_order_days
       or v_order.service_date > current_date + v_cfg.max_advance_order_days then
      raise exception 'service_date % is outside the ordering window', v_order.service_date
        using errcode = 'P0001', hint = 'not_orderable';
    end if;

    insert into "order" (
      order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
      school_id, kitchen_id, city_id, service_date, break_time_id, delivery_mode,
      status, cutoff_at, config_snapshot, school_name_snapshot, break_label_snapshot,
      recipient_name_snapshot, class_label_snapshot, section_label_snapshot, placed_at
    )
    select v_group_id, generate_order_ref(), v_correlation_id, p_customer_user_id,
           v_order.recipient_id, v_order.school_id, v_order.kitchen_id, v_order.city_id,
           v_order.service_date, v_order.break_time_id, v_cfg.default_delivery_mode,
           'pending_payment', v_cutoff, to_jsonb(v_cfg),
           s.name, bt.label,
           -- Tier P, snapshotted so the packing list stays right if the parent renames
           -- or removes the recipient (§13.3).
           trim(r.first_name || ' ' || coalesce(r.last_name, '')),
           coalesce(sc.class_label, r.class_label),
           coalesce(sc.section_label, r.section_label),
           now()
      from recipient r
      join school s on s.id = v_order.school_id
      left join school_class sc on sc.id = r.school_class_id
      left join break_time bt   on bt.id = v_order.break_time_id
     where r.id = v_order.recipient_id
    returning id into v_order_id;

    -- Step 7 — the money. `G1`/`G2`: per line, per component, half-up, and CGST and SGST
    -- each computed independently from the taxable value. NEVER 5% halved.
    v_line_no := 0;
    for v_line in
      select t.menu_item_id, t.dish_id, t.quantity, t.unit_price,
             d.name, d.description, d.portion_text, d.food_type, dc.code as category_code
        from tmp_checkout_lines t
        join dish d on d.id = t.dish_id
        left join dish_category dc on dc.id = d.category_id
       where t.recipient_id = v_order.recipient_id
         and t.service_date = v_order.service_date
         and t.break_time_id is not distinct from v_order.break_time_id
       order by d.name
    loop
      v_line_no  := v_line_no + 1;
      v_subtotal := v_line.unit_price * v_line.quantity;
      v_cgst     := round(v_subtotal::numeric * v_cfg.cgst_rate_bps / 10000)::bigint;
      v_sgst     := round(v_subtotal::numeric * v_cfg.sgst_rate_bps / 10000)::bigint;

      insert into order_line (
        order_id, line_no, menu_item_id, dish_id, quantity, unit_price_paise,
        line_subtotal_paise, tax_cgst_paise, tax_sgst_paise, line_total_paise,
        dish_name_snapshot, dish_description_snapshot, category_code_snapshot,
        portion_snapshot, food_type_snapshot, allergen_codes_snapshot
      ) values (
        v_order_id, v_line_no, v_line.menu_item_id, v_line.dish_id, v_line.quantity,
        v_line.unit_price, v_subtotal, v_cgst, v_sgst, v_subtotal + v_cgst + v_sgst,
        v_line.name, v_line.description, v_line.category_code,
        v_line.portion_text, v_line.food_type,
        -- Snapshotted because if a child reacts, the record must say what the dish was
        -- declared to contain ON THE DAY.
        coalesce((select array_agg(a.code order by a.code)
                    from dish_allergen da join allergen a on a.id = da.allergen_id
                   where da.dish_id = v_line.dish_id), '{}')
      );
    end loop;

    update "order" o
       set subtotal_paise = agg.sub, tax_cgst_paise = agg.cgst,
           tax_sgst_paise = agg.sgst, total_paise = agg.sub + agg.cgst + agg.sgst
      from (select coalesce(sum(line_subtotal_paise),0) sub,
                   coalesce(sum(tax_cgst_paise),0) cgst,
                   coalesce(sum(tax_sgst_paise),0) sgst
              from order_line where order_id = v_order_id) agg
     where o.id = v_order_id;

    select subtotal_paise, tax_cgst_paise + tax_sgst_paise
      into v_subtotal, v_cgst
      from "order" where id = v_order_id;
    v_g_subtotal := v_g_subtotal + v_subtotal;
    v_g_tax      := v_g_tax + v_cgst;
  end loop;

  -- Step 9 — group totals, one statement, because the CHECK fires immediately.
  update order_group
     set subtotal_paise = v_g_subtotal,
         tax_total_paise = v_g_tax,
         payable_paise   = v_g_subtotal + v_g_tax,
         placed_at       = now()
   where id = v_group_id;

  -- ---------------------------------------------------------------------------
  -- Step 8 — `L7` / `[OL-06]`. Abort if the server's total differs from what the customer
  -- was shown. LAST, deliberately: everything above has to have happened for there to be a
  -- server total to compare, and the whole transaction rolls back on the raise.
  --
  -- The customer is never charged an amount they were not shown, and the new total goes
  -- back in the error so the app can re-confirm rather than start again.
  -- ---------------------------------------------------------------------------
  if p_expected_total_paise is not null and p_expected_total_paise <> v_g_subtotal + v_g_tax then
    raise exception 'price changed: expected %, server says %',
      p_expected_total_paise, v_g_subtotal + v_g_tax
      using errcode = 'P0001', hint = 'price_changed';
  end if;

  select jsonb_build_object(
    'order_group_id', v_group_id,
    'correlation_id', v_correlation_id,
    'payable_paise',  v_g_subtotal + v_g_tax,
    'subtotal_paise', v_g_subtotal,
    'tax_total_paise', v_g_tax,
    'status',         'pending_payment',
    'replayed',       false,
    'orders', (select jsonb_agg(jsonb_build_object(
                        'order_id', o.id, 'order_ref', o.order_ref,
                        'service_date', o.service_date, 'total_paise', o.total_paise))
                 from "order" o where o.order_group_id = v_group_id)
  ) into v_result;

  update idempotency_key set response_body = v_result
   where scope = 'checkout' and key = p_idempotency_key;

  return v_result;
end;
$$;

commit;
