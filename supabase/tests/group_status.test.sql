-- =============================================================================
-- group_status.test.sql — `L1`, §5, `E06-30`. `order_group.status` is derived.
--
-- Before `0044` nothing maintained it: every group read `draft` for ever, and `payment_failed`,
-- `partially_refunded` and `refunded` were unreachable at the group level. The assertions below
-- walk one group through the rules, and two of them are about ORDERING — G6 above G7 and G3
-- above G4 — because those are the two that look like bugs and are not.
-- =============================================================================

create extension if not exists pgtap;
-- Outside the transaction, and created here rather than assumed: from a CLEAN database no other
-- suite has made it, and every suite that does makes it inside a transaction it rolls back.
create schema if not exists tests_tmp;

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
select * from no_plan();
set local app.actor_type = 'system';

create temporary table g_ctx as
select 'e1000000-7e57-0000-0000-0000000000b7'::uuid as group_id,
       (select id from school where is_active limit 1) as school_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from g_ctx), (select id from app_user limit 1),
       'group-status-test', (select id from city limit 1), 0, 0, 0;

create or replace function tests_tmp.new_order(p_ref text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                       school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                       config_snapshot, school_name_snapshot, recipient_name_snapshot, status)
  select (select group_id from g_ctx), p_ref, gen_random_uuid(),
         (select id from app_user limit 1), (select id from recipient limit 1),
         s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
         '{}'::jsonb, s.name, 'Test', 'pending_payment'
    from school s where s.id = (select school_id from g_ctx)
  returning id into v_id;
  return v_id;
end $fn$;

create temporary table g_o1 as select tests_tmp.new_order('GS-1') as id;
create temporary table g_o2 as select tests_tmp.new_order('GS-2') as id;

select is((select status::text from order_group where id = (select group_id from g_ctx)),
  'pending_payment',
  'G2: two members at pending_payment and no capture — the group is pending_payment. Before '
  '0044 nothing maintained this column and it read `draft` for ever');

-- G3, and the whole of E06-30. Both members cancelled with `payment_failed`.
update "order" set status = 'cancelled', cancel_reason_code = 'payment_failed'
 where order_group_id = (select group_id from g_ctx);

select is((select status::text from order_group where id = (select group_id from g_ctx)),
  'payment_failed',
  'E06-30 / G3: every member cancelled with reason `payment_failed` derives to payment_failed. '
  'G3 sits ABOVE G4 for exactly this — otherwise every swept checkout reads `cancelled` and '
  'payment_failed is a status the product cannot reach');

-- G4: the same shape with any other reason is an ordinary cancellation.
update "order" set cancel_reason_code = 'checkout_expired'
 where order_group_id = (select group_id from g_ctx);

select is((select status::text from order_group where id = (select group_id from g_ctx)),
  'cancelled',
  'G4: the same all-cancelled group with `checkout_expired` is just cancelled. That difference '
  'is "your card was declined" against "this checkout timed out", and it is the only thing '
  'distinguishing them at the group level');

-- The money side needs a SECOND group. A cancelled order cannot be resurrected to
-- `pending_payment` — `0039` refuses it, correctly — and the first attempt at this test did
-- exactly that, which is the transition table earning its keep on its own test suite.
create temporary table g_ctx2 as
select 'e1000000-7e57-0000-0000-0000000000b8'::uuid as group_id,
       (select id from school where is_active limit 1) as school_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from g_ctx2), (select id from app_user limit 1),
       'group-status-test-2', (select id from city limit 1), 0, 0, 0;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status)
select (select group_id from g_ctx2), 'GS-3', gen_random_uuid(),
       (select id from app_user limit 1), (select id from recipient limit 1),
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Test', 'pending_payment'
  from school s where s.id = (select school_id from g_ctx2);

insert into payment (order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
select (select group_id from g_ctx2), 'razorpay', 'order_gs_b8', 21000, 'captured',
       gen_random_uuid();
update "order" set status = 'paid' where order_group_id = (select group_id from g_ctx2);

select is((select status::text from order_group where id = (select group_id from g_ctx2)),
  'paid',
  'G7: a captured payment and nothing refunded — paid');

-- G6 above G7: a completed partial refund, while most of the group is still to be delivered.
insert into refund (order_group_id, amount_paise, destination, status, reason_code,
                    correlation_id)
select (select group_id from g_ctx2), 5000, 'wallet', 'completed',
       (select code from reason_code where category = 'refund' limit 1), gen_random_uuid();

select is((select status::text from order_group where id = (select group_id from g_ctx2)),
  'partially_refunded',
  'G6 ABOVE G7: a completed partial refund makes the group partially_refunded even though most '
  'of it is still going to be delivered. The kitchen does not read this; the order list and the '
  'reconciliation report do, and both need to know money came back');

-- An in-flight refund must not count — money has not moved yet.
insert into refund (order_group_id, amount_paise, destination, status, reason_code,
                    correlation_id)
select (select group_id from g_ctx2), 16000, 'wallet', 'pending',
       (select code from reason_code where category = 'refund' limit 1), gen_random_uuid();

select is((select status::text from order_group where id = (select group_id from g_ctx2)),
  'partially_refunded',
  'and a PENDING refund does not make it refunded — calling a group refunded before the money '
  'has gone is a claim a customer reads and acts on');

-- G5: the rest completes, and every member closes.
update refund set status = 'completed'
 where order_group_id = (select group_id from g_ctx2) and status = 'pending';
-- T10 is the customer's cancellation, not the system's — `0039` again.
set local app.actor_type = 'customer';
update "order" set status = 'cancelled', cancel_reason_code = 'customer_cancelled'
 where order_group_id = (select group_id from g_ctx2);
set local app.actor_type = 'system';
update "order" set status = 'refunded'
 where order_group_id = (select group_id from g_ctx2);

select is((select status::text from order_group where id = (select group_id from g_ctx2)),
  'refunded',
  'G5: refunds complete to exactly the captured amount and every member is closed — refunded');

select * from finish();
rollback;
