-- =============================================================================
-- cancel_order.test.sql — the parent cancels in time. `E06-45`, T10, §9.2 E5.
--
-- Three properties, in descending order of what it would cost to get wrong:
--
--   1. **It does not move money.** The refund is a REQUEST. A ledger reversal posted here
--      would balance, would look right, and would put `provider:razorpay:clearing` out of
--      step with what Razorpay actually holds — the one question `E06-11` reconciles.
--   2. **Every guard refuses, with the right hint.** The hint is what the parent reads;
--      a guard that refuses with the wrong one is a wrong sentence on a phone.
--   3. **The window comes from the order's snapshot**, so it survives the kitchen changing
--      its mind — the same property `0052` proves for the read, asserted again for the write
--      because they are two implementations of one rule.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin execute 'create extension pgtap with schema extensions';
    exception when others then execute 'create extension pgtap'; end;
  end if;
end;
$$;
create schema if not exists tests_tmp;
select * from no_plan();
set local app.actor_type = 'system';

create temporary table co_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as parent_a,
       (select id from app_user where deleted_at is null and not is_disabled order by id offset 1 limit 1) as parent_b,
       (select id from school where is_active limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from recipient limit 1) as recipient_id;

-- A cutoff comfortably in the future, so "open" is open regardless of the hour the suite runs
-- (`E05-49`). The closed cases move the CUTOFF into the past rather than the clock forward,
-- which is the only way to test a boundary against `now()` deterministically.
create temporary table co_cfg as select
  '{"customer_cancellation_allowed": true, "customer_cancellation_cutoff_minutes": 120, "refund_default_destination": "source"}'::jsonb as open_cfg;

-- One helper, so each case differs only in the two things under test.
create or replace function tests_tmp.mk_order(
  p_key text, p_owner uuid, p_status order_status, p_cutoff timestamptz, p_cfg jsonb,
  p_total bigint default 20000
) returns uuid
language plpgsql as $$
declare v_group uuid; v_school record;
begin
  select s.id, s.kitchen_id, s.city_id, s.name into v_school
    from school s, co_ctx c where s.id = c.school_id;

  insert into order_group (customer_user_id, idempotency_key, city_id, subtotal_paise,
                           tax_total_paise, payable_paise, status)
  select p_owner, 'co-' || p_key, v_school.city_id, p_total, 0, p_total, 'pending_payment'
  returning id into v_group;

  insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                       school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                       config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                       subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
  select v_group, 'CO-' || p_key, gen_random_uuid(), p_owner, c.recipient_id,
         v_school.id, v_school.kitchen_id, v_school.city_id, current_date + 30, 'classroom',
         p_cutoff, p_cfg, v_school.name, 'Cancel', 'pending_payment',
         p_total, 0, 0, p_total
    from co_ctx c;

  -- Walk the state machine rather than inserting the end state: `0039` refuses
  -- INSERT -> 'paid' outright, and a fixture that bypassed the trigger would be testing a
  -- row that cannot exist.
  --
  -- **The captured payment comes with the `paid` status, not separately.** `E06-24`'s
  -- `refund_source_requires_payment` found the first version of this fixture, which moved an
  -- order to `paid` with no payment row — a state `settle_payment` cannot produce, and one
  -- that made a refund to `source` impossible to write. A fixture that can reach a state
  -- production cannot is testing something that will never happen.
  if p_status <> 'pending_payment' then
    insert into payment (order_group_id, provider, provider_order_id, provider_payment_id,
                         amount_paise, status, captured_at, correlation_id)
    select v_group, 'razorpay', 'order_' || p_key, 'pay_' || p_key, p_total, 'captured', now(),
           (select correlation_id from "order" where order_group_id = v_group limit 1);

    update "order" set status = 'paid' where order_group_id = v_group;
  end if;
  if p_status not in ('pending_payment', 'paid') then
    perform set_config('app.actor_type', 'kitchen', true);
    update "order" set status = p_status where order_group_id = v_group;
    perform set_config('app.actor_type', 'system', true);
  end if;

  return v_group;
end;
$$;

-- =============================================================================
-- 1. The happy path.
-- =============================================================================

create temporary table co_happy as
select tests_tmp.mk_order('happy', (select parent_a from co_ctx), 'paid',
                          now() + interval '3 days', (select open_cfg from co_cfg)) as id;

create temporary table co_result as
select cancel_order((select id from co_happy), (select parent_a from co_ctx)) as r;

select is(
  (select (r->>'status') from co_result), 'cancelled',
  'a paid order inside its window cancels');

select is(
  (select o.status::text from "order" o where o.order_group_id = (select id from co_happy)),
  'cancelled',
  'and the order really moved — T10, by a customer');

select is(
  (select o.cancel_reason_code from "order" o where o.order_group_id = (select id from co_happy)),
  'customer_cancelled',
  'with a customer-visible reason, so "cancelled" does not read as us cancelling on them');

select is(
  (select o.cancelled_by_user_id from "order" o where o.order_group_id = (select id from co_happy)),
  (select parent_a from co_ctx),
  'and who did it is recorded');

-- `I2`: the history row the trigger writes. The move is auditable as the CUSTOMER's, which is
-- the whole distinction between T10 and T11.
select is(
  (select oe.actor_type::text from order_event oe
     join "order" o on o.id = oe.order_id
    where o.order_group_id = (select id from co_happy)
      and oe.to_status = 'cancelled' limit 1),
  'customer',
  'the event records a CUSTOMER cancellation — T10, not a staff one');

-- =============================================================================
-- 2. The refund is a REQUEST, and no money moved. The most expensive thing to get wrong.
-- =============================================================================

select is(
  (select r.status::text from refund r where r.order_group_id = (select id from co_happy)),
  'pending',
  'a refund is RECORDED as pending — somebody is owed money and nobody has sent it');

select is(
  (select r.amount_paise from refund r where r.order_group_id = (select id from co_happy)),
  20000::bigint,
  'for the whole order total');

select is(
  (select r.initiated_by_user_id from refund r where r.order_group_id = (select id from co_happy)),
  (select parent_a from co_ctx),
  'attributed to the parent who asked, not to the system');

select is(
  (select r.destination::text from refund r where r.order_group_id = (select id from co_happy)),
  'source',
  'M7: the destination comes from the order''s own snapshot, not the live config');

-- THE assertion. A reversal posted here would balance and would be wrong.
select is_empty(
  $$ select 1 from ledger_transaction lt
      join refund r on r.id::text = lt.source_id::text
     where r.order_group_id = (select id from co_happy) $$,
  'NOTHING was posted to the ledger — the money has not moved, and the ledger records money that moved');

select is(
  (select o.refunded_total_paise from "order" o where o.order_group_id = (select id from co_happy)),
  0::bigint,
  'and refunded_total_paise is still 0: a REQUEST is not a refund');

select is(
  (select o.status::text from "order" o where o.order_group_id = (select id from co_happy)),
  'cancelled',
  'the order is cancelled and NOT refunded — T13 belongs to whoever learns the money arrived');

-- `app.actor_type` is transaction-local, not function-local. Without the restore in `0053`,
-- `cancel_order` relabels every later status write in the caller's transaction as the
-- customer's — which is how this suite first failed, on `(new) -> pending_payment by customer`
-- three fixtures later. One Edge Function call is one transaction today, so it would not have
-- bitten in production until somebody composed this with anything else.
select is(
  current_setting('app.actor_type', true), 'system',
  'cancel_order put the caller''s actor back — it does not leak `customer` into the transaction');

-- =============================================================================
-- 3. Ownership. Answered as `not_found`, so a probe learns nothing.
--
-- Worth its own case because this function is SECURITY DEFINER called as service_role: there
-- is no RLS policy underneath it to catch a missing check.
-- =============================================================================

create temporary table co_other as
select tests_tmp.mk_order('other', (select parent_a from co_ctx), 'paid',
                          now() + interval '3 days', (select open_cfg from co_cfg)) as id;

select throws_matching(
  format($$ select cancel_order(%L::uuid, %L::uuid) $$,
         (select id from co_other), (select parent_b from co_ctx)),
  'does not belong to the caller',
  'another parent cannot cancel this order — checked HERE, because service_role has no RLS');

select is(
  (select o.status::text from "order" o where o.order_group_id = (select id from co_other)),
  'paid',
  'and the refusal changed nothing');

select is(
  (select count(*)::int from refund r where r.order_group_id = (select id from co_other)),
  0,
  'and recorded no refund — a refused cancel must not leave a claim on money behind it');

-- =============================================================================
-- 4. Each guard, with the hint the parent will read.
-- =============================================================================

create temporary table co_cases (label text, id uuid, expect text);

insert into co_cases
select 'preparing',
       tests_tmp.mk_order('prep', (select parent_a from co_ctx), 'preparing',
                          now() + interval '3 days', (select open_cfg from co_cfg)),
       'already_preparing';
insert into co_cases
select 'delivered',
       tests_tmp.mk_order('deliv', (select parent_a from co_ctx), 'delivered',
                          now() + interval '3 days', (select open_cfg from co_cfg)),
       'already_delivered';
insert into co_cases
select 'unpaid',
       tests_tmp.mk_order('unpaid', (select parent_a from co_ctx), 'pending_payment',
                          now() + interval '3 days', (select open_cfg from co_cfg)),
       'not_paid';
insert into co_cases
select 'not offered',
       tests_tmp.mk_order('nooffer', (select parent_a from co_ctx), 'paid',
                          now() + interval '3 days',
                          '{"customer_cancellation_allowed": false, "customer_cancellation_cutoff_minutes": 120}'::jsonb),
       'cancellation_not_offered';
-- The snapshot that cannot answer. `assert_cutoff_open` would coalesce the null grace to 0 and
-- let this through as "cancellable right up to the cutoff" — a promise from missing data, and
-- the one the screen already refuses to make.
insert into co_cases
select 'window unknown',
       tests_tmp.mk_order('unknown', (select parent_a from co_ctx), 'paid',
                          now() + interval '3 days', '{}'::jsonb),
       'cancellation_window_unknown';
-- Past the boundary: the cutoff is 1 hour away and cancelling closes 120 minutes before it,
-- so the window shut an hour ago.
insert into co_cases
select 'too late',
       tests_tmp.mk_order('late', (select parent_a from co_ctx), 'paid',
                          now() + interval '1 hour', (select open_cfg from co_cfg)),
       'cancellation_closed';

-- The refusal is *collected* here and *asserted* below, rather than asserted inside the loop.
-- `perform is(…)` registers the assertion but discards pgTAP's TAP line, so a failure shows up
-- only as "Looks like you failed 2 tests of 28" with no indication of which — verified by
-- deliberately breaking one. It still fails the build, which is the property that matters, but
-- a test that cannot say what broke costs its own diagnosis time later.
create temporary table co_actual (label text, expect text, actual text);

do $$
declare c record; v_hint text;
begin
  for c in select * from co_cases loop
    begin
      perform cancel_order(c.id, (select parent_a from co_ctx));
      v_hint := '(no refusal at all)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    insert into co_actual values (c.label, c.expect, v_hint);
  end loop;
end $$;

select is(a.actual, a.expect,
          format('%s refuses with hint %L — the hint IS the sentence the parent reads',
                 a.label, a.expect))
  from co_actual a order by a.label;

-- Not one of them left a claim on money behind it.
select is(
  (select count(*)::int from refund r where r.order_group_id in (select id from co_cases)),
  0,
  'no refused cancellation recorded a refund');

-- =============================================================================
-- 5. The boundary is the ORDER's, not the kitchen's current mind — asserted for the WRITE.
--
-- `0052` proves this for the read. It is proved again here because they are two
-- implementations of one rule, and the write is the one that moves money.
-- =============================================================================

create temporary table co_frozen as
select tests_tmp.mk_order('frozen', (select parent_a from co_ctx), 'paid',
                          now() + interval '3 days', (select open_cfg from co_cfg)) as id;

-- The kitchen turns cancellations off and widens the window to a day, at 9pm.
insert into kitchen_config (kitchen_id, customer_cancellation_allowed, customer_cancellation_cutoff_minutes)
select s.kitchen_id, false, 1440 from school s, co_ctx c where s.id = c.school_id
on conflict (kitchen_id) do update
   set customer_cancellation_allowed        = excluded.customer_cancellation_allowed,
       customer_cancellation_cutoff_minutes = excluded.customer_cancellation_cutoff_minutes;

select is(
  (select customer_cancellation_allowed from co_ctx c, resolve_effective_config(c.school_id)),
  false,
  'harness: the LIVE config now refuses cancellations, so the two sources genuinely disagree');

select is(
  (select (cancel_order((select id from co_frozen), (select parent_a from co_ctx))->>'status')),
  'cancelled',
  'C9/L6: an order placed under "cancellation allowed" still cancels after the kitchen turns it off');

-- =============================================================================
-- 6. Grants. A function nobody may execute fails at the first tap.
-- =============================================================================

select ok(has_function_privilege('service_role', 'cancel_order(uuid,uuid)', 'execute'),
          'service_role — the Edge Function''s client — may execute it');

select ok(not has_function_privilege('anon', 'cancel_order(uuid,uuid)', 'execute'),
          'anon may NOT: cancelling is a write and every write proves identity first');

select ok(not has_function_privilege('authenticated', 'cancel_order(uuid,uuid)', 'execute'),
          'and neither may a signed-in caller directly — writes go through the Edge Function (A4)');

drop function tests_tmp.mk_order(text, uuid, order_status, timestamptz, jsonb, bigint);
select * from finish();
rollback;
