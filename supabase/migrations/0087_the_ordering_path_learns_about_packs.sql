-- The ordering path learns about packs, and `E21-65` is fixed at its root. `E21-71`.
--
-- Kept apart from `0085`/`0086` on purpose: those build a feature nobody can reach yet, this one
-- edits the two functions that take roughly fifty real orders a day. It can be reverted on its
-- own, and `ordering_path_characterisation.test.sql` — written and green BEFORE any of this — is
-- what says whether it changed anything it should not have.
--
-- =============================================================================
-- E21-65: A REDEEMED MEAL NEVER REACHED THE KITCHEN
-- =============================================================================
--
-- WEB's audit, 2026-09-16, risk:critical. `confirm_meal_pack_plan` inserted the day's order with
-- `status = 'pending_payment'` — correct for a food order, which a payment then settles, and
-- wrong for a pack meal, which has no payment to settle. The only `pending_payment -> paid`
-- transition in the schema was the loop inside `settle_payment`, driven by a capture webhook,
-- which had already run once when the pack *purchase* settled and would never run again. So the
-- balance decremented, the ledger recognised the revenue, and **the child got no food** — the
-- kitchen board filters to `['paid','preparing','delivered','cancelled']` and the order sat
-- outside it for ever, with no `pickup_code`, silently.
--
-- **The fix is not a second place that sets `paid`. It is making there be exactly one.**
--
-- `confirm_order_as_paid()` is that place: status, `confirmed_at` and the pickup code move
-- together or not at all, and both callers — the webhook and the zero-cash redemption — go
-- through it. A future third caller cannot reintroduce the defect without deleting this function,
-- because there is no other route to `paid` and no other place a code is drawn.
--
-- Found while mutation-checking the characterisation suite, and NOT in the audit: the
-- `derive_group_status` trigger recomputes a group's status from its orders, so the old code also
-- **demoted the settled pack-purchase group back to `pending_payment`** on the first redemption,
-- while `paid_at` stayed set. Moot here — a redemption is now an ordinary checkout in its own
-- group and nothing is ever inserted into a settled one — but it is why the suite's universal is
-- keyed on `paid_at`.
--
-- `E21-66` is fixed by the same change of shape: a redemption is an ordinary order created by
-- `create_checkout`, so it is minted by `generate_order_ref()` like everything else. There is no
-- `PK-` prefix to leak how it was paid for, and no second ref-minting path to forget the
-- collision retry.
--
-- =============================================================================
-- HOW create_checkout CHANGES, AND HOW LITTLE
-- =============================================================================
--
-- The body below is `0084`'s, verbatim, with ONE block inserted between the per-order loop and
-- the group totals, and the `L7` comparison retargeted. That placement is the whole design:
--
--   * AFTER the lines are written, so the pack is applied to the order as PERSISTED. A client
--     claiming its cart qualifies proves nothing, and there is no request field it could set.
--   * BEFORE the group totals, so `payable_paise` comes out as the cash due.
--
-- **For a parent with no pack, `reserve_meal_pack_items` finds no pack, writes nothing, returns
-- zero, and every number downstream is identical.** That is the property the characterisation
-- suite pins.
--
-- `L7` now compares the expected total against `payable`, not against `subtotal + tax`. For every
-- cart that has ever existed those are the same number, because `pack_applied_paise` is zero —
-- but it is the parent's cash due that was shown on the screen, and `L7` exists to say the
-- customer is never charged an amount they were not shown.
--
-- When the two disagree AND the pack coverage is why, the refusal is `pack_coverage_changed`
-- rather than `price_changed`. Same guard, honest sentence: nothing about the food got dearer,
-- their pack covers fewer items than it did a minute ago.
--
-- =============================================================================
-- THE ZERO-CASH EXCEPTION, WHICH IS NOT REALLY ONE
-- =============================================================================
--
-- Andy: *"if cash due is ₹0 (the pack covers the whole cart), confirm the order immediately,
-- since there is no payment to wait for."*
--
-- There is no Razorpay order, no webhook, and therefore no later event that could ever confirm
-- it. So the same two steps — confirm the redemptions, then confirm the orders as paid — run now
-- instead of later, through the same two functions the webhook calls. It is not a second code
-- path; it is the same one, invoked at a different moment.
--
-- A zero-cash order **consumes no invoice number**. The tax was charged and documented when the
-- pack was sold, so there is no taxable supply here to document, and `invoice_sequence` numbers
-- are gapless and not recoverable (`D14`). It still gets a pickup code and still reaches the
-- kitchen, because the kitchen does not care how a meal was paid for.

begin;

-- =============================================================================
-- 1. The one and only way an order becomes paid.
-- =============================================================================

create or replace function confirm_order_as_paid(p_order_id uuid)
returns text
language plpgsql
volatile
as $$
declare
  v_code    text := null;
  v_attempt int  := 0;
begin
  -- §9.4. Retry on collision; the space is 10,000 per school per day and a real day is tens.
  while v_code is null and v_attempt < 50 loop
    v_attempt := v_attempt + 1;
    begin
      update "order"
         set status       = 'paid',
             confirmed_at = now(),
             pickup_code  = lpad((floor(random() * 10000))::int::text, 4, '0')
       where id = p_order_id
         and status = 'pending_payment'
      returning pickup_code into v_code;
    exception when unique_violation then
      v_code := null;   -- taken at this school on this day; draw again
    end;
    -- The order was not pending_payment: already paid by an earlier delivery, or cancelled.
    -- Not an error, and not something to retry fifty times.
    exit when not found;
  end loop;

  if v_code is null and v_attempt >= 50 then
    raise exception 'could not allocate a pickup code for order % after % attempts',
      p_order_id, v_attempt
      using errcode = 'P0001', hint = 'pickup_code_exhausted';
  end if;

  return v_code;
end;
$$;

comment on function confirm_order_as_paid is
  'E21-65. THE ONE PLACE an order becomes paid. Status, confirmed_at and the pickup code move '
  'together or not at all, so a paid order without a code — invisible to the kitchen, '
  'uncollectable by the parent — is not a state this schema can reach. Both callers use it: the '
  'capture webhook, and the zero-cash pack redemption that has no webhook to wait for. A third '
  'caller cannot reintroduce the defect without deleting this function.';

-- =============================================================================
-- 2. create_checkout — 0084's body, one block inserted, L7 retargeted.
-- =============================================================================

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
  -- `E21`: the three the pack block needs. Declared here so the inserted block adds no `declare`.
  v_pack_applied   bigint := 0;
  v_payable        bigint;
  v_status         text := 'pending_payment';
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

    /**
     * `E05-55`. The SCHOOL's service day, asked before the menu item's weekday rule.
     *
     * Order matters and is the whole fix. The join below fails for a Sunday because no menu item
     * lists Sunday in `available_days`, and it reports `unavailable` — "one of the dishes is no
     * longer on the menu for that day". A parent reads that as being about the dish, changes the
     * dish, and fails identically. Verified on production 2026-08-16, and again by a real parent
     * on Sunday 2026-08-30 who then stopped and did not come back.
     *
     * Two different facts were arriving as one sentence: *this school does not serve that day*
     * and *this dish came off the menu*. Asking the school first separates them, and
     * `not_a_service_day` lets the app say which — and name the next day that does work.
     *
     * A BACKSTOP, not the primary defence. `E05-52` makes the calendar readable so the day is
     * never offered in the first place; this catches a day closing while a cart is open.
     */
    -- `coalesce(..., '{}')` is not defensiveness, it is syntax: `= any (SELECT ...)` is the
    -- SUBQUERY form, which compares the scalar against each ROW and fails with
    -- `operator does not exist: smallint = smallint[]`. Wrapping the scalar subquery in a
    -- function call forces the ARRAY form, which is the one meant here. Caught by the test.
    if not (
      extract(isodow from v_line.service_date)::smallint = any (
        coalesce(
          (select c.service_days
             from resolve_effective_config(
                    (select r.school_id from recipient r where r.id = v_line.recipient_id)
                  ) c),
          '{}'::smallint[]
        )
      )
    ) then
      raise exception 'school does not serve on %', v_line.service_date
        using errcode = 'P0001', hint = 'not_a_service_day';
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


  -- ---------------------------------------------------------------------------
  -- `E21`. THE ONE INSERTED BLOCK. Everything above this line is `0084`, unchanged.
  --
  -- Here because it is the only place that is both after the order lines exist and before the
  -- group totals are computed. Eligibility is decided from the lines as PERSISTED, never from a
  -- flag on the request — there is no request field a client could set to claim coverage.
  --
  -- A parent with no pack: `reserve_meal_pack_items` finds no pack, writes nothing, returns 0,
  -- and every number from here down is what it has always been.
  -- ---------------------------------------------------------------------------
  v_pack_applied := reserve_meal_pack_items(v_group_id, p_customer_user_id, v_correlation_id);

  if v_pack_applied > 0 then
    -- The pack changed the tax, because a covered item is not a taxable supply on this invoice.
    -- Re-read it rather than adjusting `v_g_tax` by arithmetic: the numbers on the rows are the
    -- ones the invoice and the ledger will use, and a second calculation is a second chance to
    -- disagree with them.
    select coalesce(sum(o.subtotal_paise), 0),
           coalesce(sum(o.tax_cgst_paise + o.tax_sgst_paise), 0)
      into v_g_subtotal, v_g_tax
      from "order" o where o.order_group_id = v_group_id;
  end if;

  v_payable := v_g_subtotal + v_g_tax - v_pack_applied;

  -- Step 9 — group totals, one statement, because the CHECK fires immediately.
  -- `order_group_payable_arithmetic` requires
  --   payable = subtotal + tax - discount - wallet_applied - pack_applied
  -- which is the column this feature was waiting for. No new money mechanism is introduced here.
  update order_group
     set subtotal_paise    = v_g_subtotal,
         tax_total_paise   = v_g_tax,
         pack_applied_paise = v_pack_applied,
         payable_paise     = v_payable,
         placed_at         = now()
   where id = v_group_id;

  -- ---------------------------------------------------------------------------
  -- Step 8 — `L7` / `[OL-06]`. Abort if the server's total differs from what the customer was
  -- shown. LAST, deliberately: everything above has to have happened for there to be a server
  -- total to compare, and the whole transaction rolls back on the raise.
  --
  -- Compared against PAYABLE, which is what the parent saw. For every cart with no pack that is
  -- identical to `subtotal + tax`, because `pack_applied_paise` is zero.
  -- ---------------------------------------------------------------------------
  if p_expected_total_paise is not null and p_expected_total_paise <> v_payable then
    if v_pack_applied > 0 then
      -- Nothing about the food got dearer. Their pack covers fewer items than it did a minute
      -- ago — a different fact, and one the app can say honestly.
      raise exception 'pack coverage changed: expected %, server says %',
        p_expected_total_paise, v_payable
        using errcode = 'P0001', hint = 'pack_coverage_changed';
    end if;
    raise exception 'price changed: expected %, server says %',
      p_expected_total_paise, v_payable
      using errcode = 'P0001', hint = 'price_changed';
  end if;

  -- ---------------------------------------------------------------------------
  -- The zero-cash case. The pack covers the whole cart, so there is no payment and no webhook
  -- that could ever confirm this. The SAME two functions the webhook calls run now instead.
  -- ---------------------------------------------------------------------------
  if v_payable = 0 and v_pack_applied > 0 then
    perform set_config('app.actor_type', 'system', true);
    perform confirm_meal_pack_redemptions(v_group_id, v_correlation_id);

    for v_order in select id from "order" where order_group_id = v_group_id loop
      perform confirm_order_as_paid(v_order.id);
    end loop;

    update order_group set paid_at = now() where id = v_group_id and paid_at is null;
    v_status := 'paid';
    -- Deliberately NO issue_invoice(). The tax was charged and documented when the pack was
    -- sold; there is no taxable supply here, and invoice numbers are gapless and unrecoverable.
  end if;

  select jsonb_build_object(
    'order_group_id', v_group_id,
    'correlation_id', v_correlation_id,
    'payable_paise',  v_payable,
    'subtotal_paise', v_g_subtotal,
    'tax_total_paise', v_g_tax,
    'pack_applied_paise', v_pack_applied,
    'status',         v_status,
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

comment on function create_checkout(uuid, text, text, bigint, jsonb) is
  'Checkout, as one transaction (E05-06). E05-55 added the school service-day guard BEFORE the '
  'menu-item weekday rule. E21 added ONE block after the order lines and before the group '
  'totals: it reserves meal-pack items against the persisted lines, retargets L7 at payable, and '
  'confirms immediately when the pack covers everything and no payment will ever arrive. For a '
  'parent with no pack every number is unchanged, which ordering_path_characterisation.test.sql '
  'pins.';

-- =============================================================================
-- 3. settle_payment — the loop body becomes one call, and packs are confirmed.
--
-- Two changes, both narrowing:
--
--   * the inline pickup-code loop becomes `confirm_order_as_paid()`, so there is exactly one
--     place an order becomes paid (`E21-65`);
--   * `confirm_meal_pack_redemptions()` runs BEFORE `issue_invoice`, for the same reason
--     `activate_paid_meal_pack` already did: if the pack cannot be confirmed, no tax document is
--     issued for a sale that did not complete.
--
-- Everything else — the amount guard, the idempotent replay, the ledger legs, the invoice — is
-- untouched, and `settle_payment.test.sql` and the characterisation suite both still pass.
-- =============================================================================

create or replace function settle_payment(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment  payment%rowtype;
  v_group    order_group%rowtype;
  v_subtotal bigint;
  v_cgst     bigint;
  v_sgst     bigint;
  v_order    record;
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

  -- `E21`. BEFORE the orders are confirmed and before the invoice, so a pack that cannot be
  -- confirmed stops the whole settlement rather than producing a paid order drawing on a balance
  -- that was not there. Returns 0 and writes nothing for a group with no reservations, which is
  -- what lets this be called unconditionally.
  perform confirm_meal_pack_redemptions(v_group.id, v_group.correlation_id);

  -- `E21-65`: one call, one place, and the pickup code cannot be forgotten because it is not a
  -- separate step any more.
  for v_order in
    select id from "order" where order_group_id = v_group.id and status = 'pending_payment'
  loop
    perform confirm_order_as_paid(v_order.id);
  end loop;

  -- The sale, posted once. `idempotency_key` is the provider payment id, so a second delivery
  -- that somehow reached this point still cannot double the money.
  --
  -- Read from the ORDERS, which for a partly-covered cart hold the cash amounts: the pack's own
  -- recognition is deferred-revenue to revenue and was posted by confirm_meal_pack_redemptions.
  -- The two never overlap, which is what stops a redeemed item being counted as revenue twice.
  select coalesce(sum(subtotal_paise), 0), coalesce(sum(tax_cgst_paise), 0),
         coalesce(sum(tax_sgst_paise), 0)
    into v_subtotal, v_cgst, v_sgst
    from "order" where order_group_id = v_group.id;

  -- A pack purchase has no member orders, so the amounts come from the group itself.
  if v_group.kind = 'meal_pack_purchase' then
    v_subtotal := v_group.subtotal_paise;
    v_cgst     := (select cgst_paise from meal_pack where order_group_id = v_group.id);
    v_sgst     := (select sgst_paise from meal_pack where order_group_id = v_group.id);

    -- The pack sale: cash in, an OBLIGATION created, tax due now. Not revenue — treating it as
    -- revenue here and again at redemption is precisely the double count.
    perform post_ledger_transaction(
      'meal_pack_sale', 'payment', v_payment.id,
      jsonb_build_array(
        jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',
                           'amount_paise', v_subtotal + v_cgst + v_sgst),
        jsonb_build_object('account', 'platform:deferred_revenue:meal_packs', 'direction', 'credit',
                           'amount_paise', v_subtotal),
        jsonb_build_object('account', 'platform:tax_payable:cgst', 'direction', 'credit',
                           'amount_paise', v_cgst),
        jsonb_build_object('account', 'platform:tax_payable:sgst', 'direction', 'credit',
                           'amount_paise', v_sgst)
      ),
      now(), v_group.correlation_id, null, null,
      'settle:' || p_provider_payment_id
    );

    -- The pack becomes spendable in the SAME transaction that takes the money. A pack is never
    -- spendable without its ledger entry, and never carries an obligation we have not been paid
    -- for.
    update meal_pack set status = 'active'
     where order_group_id = v_group.id and status = 'pending';
  else
    -- The food sale, exactly as before. For a partly-covered cart these are the cash amounts,
    -- and `payable_paise` — which `L7` above has already matched against the capture — is
    -- subtotal + tax - pack_applied.
    perform post_ledger_transaction(
      'sale', 'payment', v_payment.id,
      jsonb_build_array(
        jsonb_build_object('account', 'provider:razorpay:clearing', 'direction', 'debit',
                           'amount_paise', v_group.payable_paise),
        jsonb_build_object('account', 'platform:revenue', 'direction', 'credit',
                           'amount_paise', v_subtotal - v_group.pack_applied_paise),
        jsonb_build_object('account', 'platform:tax_payable:cgst', 'direction', 'credit',
                           'amount_paise', v_cgst),
        jsonb_build_object('account', 'platform:tax_payable:sgst', 'direction', 'credit',
                           'amount_paise', v_sgst)
      ),
      now(), v_group.correlation_id, null, null,
      'settle:' || p_provider_payment_id
    );
  end if;

  -- `D14`: the invoice is issued in THIS transaction. A paid order with no invoice is a customer
  -- charged with no tax document, and an invoice with no settlement is a hole in a gapless
  -- series — neither is repairable afterwards, so they succeed or fail together.
  perform issue_invoice(v_group.id);

  update order_group set paid_at = now() where id = v_group.id and paid_at is null;

  return jsonb_build_object(
    'order_group_id', v_group.id,
    'already_settled', false,
    'pickup_code', (select o.pickup_code from "order" o
                     where o.order_group_id = v_group.id and o.pickup_code is not null limit 1));
end;
$$;

comment on function settle_payment is
  'The one place a group becomes paid (E06). Since E21 it confirms meal-pack redemptions first — '
  'so a pack that cannot be confirmed stops the settlement rather than producing a paid order '
  'drawing on a balance that was not there — and delegates the paid transition to '
  'confirm_order_as_paid(), which is the whole fix for E21-65.';

commit;
