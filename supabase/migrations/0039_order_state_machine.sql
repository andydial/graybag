-- =============================================================================
-- 0039_order_state_machine.sql — legal transitions, enforced. `E06-05`, `E06-15`, step 3.
-- =============================================================================
--
-- `order_status` and `payment_status` are enums, and an enum says which *values* exist. It says
-- nothing at all about which **moves** are legal, so today `update "order" set status =
-- 'delivered'` on a `pending_payment` row succeeds — the kitchen cooking against money that has
-- not arrived, which `L5` exists to forbid and which nothing was enforcing.
--
-- =============================================================================
-- `L2` — THE TABLE IS IN THE FUNCTION, NOT IN A TABLE
-- =============================================================================
--
-- Which transitions are legal is **not configuration**. An `order_status_transition` table would
-- be data, and data is editable by anybody holding the right grant. The whole point of putting
-- this in a trigger is that no grant makes `pending_payment → delivered` happen — not a back
-- office bug, not a mistaken migration, not a support engineer with a psql prompt.
--
-- So the §4.1 table is written out literally below. It is long and repetitive and that is the
-- correct shape for it: every row is one line of the specification, and a reader can check the
-- two against each other without holding anything in their head.
--
-- =============================================================================
-- THE ACTOR IS PART OF THE TRANSITION, NOT A SEPARATE CHECK
-- =============================================================================
--
-- `paid → cancelled` is legal for a customer before the cancellation cutoff, and legal for
-- kitchen or admin at any time. Those are two different rows in §4.1 (`T10`, `T11`) with
-- different guards, and collapsing them into "is paid→cancelled allowed?" loses the distinction
-- that matters. The actor arrives on a transaction-local GUC that the Edge Function sets.
--
-- **A missing actor is a refusal, not a default.** `current_setting('app.actor_type', true)`
-- returns null rather than raising when unset, and null is rejected — because the alternative is
-- defaulting to `system`, and `system` is the actor with the most transitions available. A
-- migration or a console session that forgets to say who it is gets an error, which is the
-- outcome that makes somebody think.
--
-- =============================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
-- =============================================================================
--
-- **No side effects.** §4.1's right-hand column — allocate the pickup code, write the invoice,
-- post the sale to the ledger, enqueue the email — belongs to the functions that perform each
-- transition (`E06-06`, `E07`, `E08`), not to a trigger that fires on any status write from
-- anywhere. A trigger that both validated and acted would make every one of those side effects
-- impossible to test in isolation and impossible to skip when backfilling.
--
-- **No guard evaluation.** `T10`'s "before the cancellation cutoff" needs config and a clock;
-- the trigger checks that a *customer* may make that move at all, and the caller checks whether
-- this customer may make it *now*. Splitting it this way keeps the trigger a pure function of
-- (operation, from, to, actor), which is what makes it exhaustively testable.
-- =============================================================================

create or replace function assert_order_status_transition() returns trigger
language plpgsql
as $$
declare
  v_actor actor_type;
begin
  -- Not a transition. Other columns may change freely — this trigger is about status and only
  -- status, and firing on every update would make it the gatekeeper for the whole table.
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  v_actor := nullif(current_setting('app.actor_type', true), '')::actor_type;
  if v_actor is null then
    raise exception 'order status change with no app.actor_type set (order %)', new.id
      using errcode = '23514', hint = 'actor_type_missing';
  end if;

  -- §4.1, literally. `(operation, from, to, actor)`.
  if not (
    (tg_op, coalesce(old.status::text, ''), new.status::text, v_actor::text) in (
      -- T1: an admin creating an order on somebody's behalf.
      ('INSERT', '', 'draft',            'admin'),
      -- T2: the ordinary checkout.
      ('INSERT', '', 'pending_payment',  'system'),
      -- T3: a draft submitted.
      ('UPDATE', 'draft', 'pending_payment', 'admin'),
      ('UPDATE', 'draft', 'pending_payment', 'customer'),
      -- T4: a draft abandoned.
      ('UPDATE', 'draft', 'cancelled', 'admin'),
      ('UPDATE', 'draft', 'cancelled', 'customer'),
      ('UPDATE', 'draft', 'cancelled', 'system'),
      -- T5: the capture is verified. `payment_provider` is NOT here: a webhook does not move an
      -- order directly, it moves a payment, and the settlement path moves the order as `system`
      -- after checking the capture server-side (§3.6, and `R8`).
      ('UPDATE', 'pending_payment', 'paid', 'system'),
      -- T6: no capture, and every attempt terminal.
      ('UPDATE', 'pending_payment', 'cancelled', 'system'),
      ('UPDATE', 'pending_payment', 'cancelled', 'customer'),
      ('UPDATE', 'pending_payment', 'cancelled', 'admin'),
      -- T7: the kitchen starts.
      ('UPDATE', 'paid', 'preparing', 'kitchen'),
      ('UPDATE', 'paid', 'preparing', 'admin'),
      -- T8: bulk mark-delivered, straight from paid (`L8` — a kitchen clearing a class at the
      -- end of service never touched `preparing`, and forcing it to would be a lie in the data).
      ('UPDATE', 'paid', 'delivered', 'kitchen'),
      ('UPDATE', 'paid', 'delivered', 'admin'),
      -- T9: the ordinary handover.
      ('UPDATE', 'preparing', 'delivered', 'kitchen'),
      ('UPDATE', 'preparing', 'delivered', 'admin'),
      -- T10: the customer cancels in time. The clock is the caller's to check.
      ('UPDATE', 'paid', 'cancelled', 'customer'),
      -- T11 / T12: staff cancellation, no time bound.
      ('UPDATE', 'paid', 'cancelled', 'kitchen'),
      ('UPDATE', 'paid', 'cancelled', 'admin'),
      ('UPDATE', 'preparing', 'cancelled', 'kitchen'),
      ('UPDATE', 'preparing', 'cancelled', 'admin'),
      -- T13: fully refunded, after cancellation. Never straight from `paid` — a refund with no
      -- cancellation loses WHY the food was not delivered.
      ('UPDATE', 'cancelled', 'refunded', 'system')
    )
  ) then
    raise exception 'illegal order transition % -> % by % (order %)',
      coalesce(old.status::text, '(new)'), new.status, v_actor, new.id
      using errcode = '23514', hint = 'illegal_transition';
  end if;

  return new;
end;
$$;

comment on function assert_order_status_transition() is
  'E06-05 / L2: the §4.1 transition table, hard-coded. Not a table — which transitions are legal is not configuration, and the point of a trigger is that no grant can make pending_payment -> delivered happen. The actor is part of the transition (T10 vs T11), and a missing app.actor_type is a REFUSAL rather than a default to system, which is the actor with the most moves available. Validates only: side effects and time-based guards belong to the functions that perform each transition.';

-- `create or replace trigger` (PG14+): re-running a migration must be a no-op, and
-- `create trigger` alone raises on the second pass.
create or replace trigger assert_status_transition
  before insert or update of status on "order"
  for each row execute function assert_order_status_transition();

-- -----------------------------------------------------------------------------
-- The history row, written by the same trigger that allowed the move — `I2`.
--
-- AFTER, so it records what actually happened rather than what was attempted; a refused
-- transition raises in the BEFORE trigger and never reaches here.
-- -----------------------------------------------------------------------------
create or replace function write_order_event() returns trigger
language plpgsql
as $$
declare
  v_correlation uuid;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  -- The request's own id when the caller set one, so a support question — "what happened to
  -- this order?" — joins to the request that did it. Falling back to the order's own
  -- correlation_id rather than to a fresh uuid: an event that correlates to nothing is a row
  -- that can only ever be read on its own.
  v_correlation := coalesce(
    nullif(current_setting('app.correlation_id', true), '')::uuid,
    new.correlation_id);

  insert into order_event (order_id, from_status, to_status, actor_type, actor_user_id,
                           reason_code, correlation_id)
  values (new.id,
          case when tg_op = 'UPDATE' then old.status else null end,
          new.status,
          nullif(current_setting('app.actor_type', true), '')::actor_type,
          nullif(current_setting('app.actor_user_id', true), '')::uuid,
          new.cancel_reason_code,
          v_correlation);

  return null;
end;
$$;

comment on function write_order_event() is
  'I2: every status change leaves a history row, written by the same trigger pair that allowed it — so the history cannot disagree with the order. AFTER, because it records what happened rather than what was attempted. Carries the request correlation id when the caller set one, so "what happened to this order?" joins to the request that did it.';

-- `create or replace trigger` (PG14+): re-running a migration must be a no-op, and
-- `create trigger` alone raises on the second pass.
create or replace trigger write_status_event
  after insert or update of status on "order"
  for each row execute function write_order_event();

-- =============================================================================
-- `E06-15` / `L3` — payment status is monotonic on a capture rank
-- =============================================================================
--
-- **Webhook delivery is not ordered.** `payment.authorized` arriving after `payment.captured` is
-- normal, not exotic, and a handler that assigns the inbound event's status downgrades a
-- captured payment — after which the order is `paid` against a payment the database says is
-- merely authorized, and every reconciliation disagrees with every other.
--
-- The rank is `created 0 → authorized 1 → captured 2`, with `failed` terminal **from 0 or 1
-- only**. A plain rank comparison would let `captured → failed` through as 2 → 3, which is the
-- one downgrade that looks like an upgrade — so the legal moves are written out rather than
-- computed, exactly as the order table above.
--
-- The refund axis is **derived, not transitioned**: once `captured`, the status is recomputed
-- from Σ completed refunds against that payment, never from an inbound event's status string.
-- `captured → partially_refunded → refunded` are therefore legal moves here, and they are the
-- only ones that leave the capture rank behind.
create or replace function assert_payment_status_transition() returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status::text, new.status::text) in (
      ('created',            'authorized'),
      ('created',            'captured'),
      ('created',            'failed'),
      ('authorized',         'captured'),
      ('authorized',         'failed'),
      -- The refund axis. Derived from Σ completed refunds, never from an event's own string.
      ('captured',           'partially_refunded'),
      ('captured',           'refunded'),
      ('partially_refunded', 'refunded')
    )
  ) then
    raise exception 'illegal payment transition % -> % (payment %)', old.status, new.status, new.id
      using errcode = '23514', hint = 'payment_status_not_monotonic';
  end if;

  return new;
end;
$$;

comment on function assert_payment_status_transition() is
  'E06-15 / L3: payment status moves up a capture rank (created 0, authorized 1, captured 2) and never down, with failed terminal from 0 or 1 ONLY — a rank comparison would allow captured -> failed as 2 -> 3, the one downgrade that looks like an upgrade. Webhook delivery is unordered, so authorized arriving after captured is normal; a handler that assigned the inbound status would leave an order paid against a payment the database calls authorized. The refund axis (captured -> partially_refunded -> refunded) is derived from completed refunds, never from an event string.';

-- `create or replace trigger` (PG14+): re-running a migration must be a no-op, and
-- `create trigger` alone raises on the second pass.
create or replace trigger assert_payment_transition
  before update of status on payment
  for each row execute function assert_payment_status_transition();

-- =============================================================================
-- `create_checkout` DECLARES ITS ACTOR — and this must ship in the same migration
-- =============================================================================
--
-- The trigger above refuses any status write with no `app.actor_type`, and `create_checkout`
-- did not set one. So the moment the trigger exists, **every checkout fails** —
-- `checkout.test.sql` went from 27 assertions to zero on the first run.
--
-- The fix is one line and it belongs **here, not in `0040`**. A migration that breaks checkout
-- followed by a migration that repairs it means any deploy landing between the two has a
-- product that cannot take an order. They are one change.
--
-- It sets the GUC **itself** rather than requiring the Edge Function to. §4.4 describes the
-- actor arriving from the caller, and that is right for the paths where the actor varies —
-- `paid → cancelled` is `customer` or `kitchen` depending on who asked. This path has no such
-- ambiguity: `create_checkout` *is* the system performing T2, and a function that knows its own
-- actor should not be able to be called without one.
--
-- Regenerated from `pg_get_functiondef()` with one statement inserted after `begin`, the same
-- discipline `0033`, `0035` and `0037` use.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_checkout(p_customer_user_id uuid, p_idempotency_key text, p_request_hash text, p_expected_total_paise bigint, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
$function$;
