-- =============================================================================
-- order_state_machine.test.sql — `E06-05`, `E06-15`, step 3.
--
-- An enum says which values exist. It says nothing about which MOVES are legal, and before
-- `0039` nothing did — `update "order" set status = 'delivered'` on a `pending_payment` row
-- succeeded, which is the kitchen cooking against money that never arrived (`L5`).
--
-- **The out-of-order webhook fixtures are the point of the second half**, not an afterthought:
-- `payment.authorized` arriving after `payment.captured` is normal delivery behaviour, and a
-- handler that assigns the inbound status downgrades a captured payment.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;

create schema if not exists tests_tmp;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin
      execute 'create extension pgtap with schema extensions';
    exception when others then
      execute 'create extension pgtap';
    end;
  end if;
end;
$$;

select * from no_plan();

-- An order to move around. Built directly rather than through `create_checkout`: this suite is
-- about the transition rules, and a fixture that runs a whole checkout to test them breaks
-- every time checkout changes.
insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select 'e1000000-7e57-0000-0000-0000000000e1', (select id from app_user limit 1),
       'state-machine-test', (select id from city limit 1), 20000, 1000, 21000;

create temporary table sm_ctx as
select 'e1000000-7e57-0000-0000-0000000000e1'::uuid as group_id,
       (select id from school where is_active limit 1) as school_id;

create or replace function tests_tmp.new_order(p_ref text, p_status order_status)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                       school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                       config_snapshot, school_name_snapshot, recipient_name_snapshot, status)
  select (select group_id from sm_ctx), p_ref, gen_random_uuid(),
         (select id from app_user limit 1), (select id from recipient limit 1),
         s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
         '{}'::jsonb, s.name, 'Test', p_status
    from school s where s.id = (select school_id from sm_ctx)
  returning id into v_id;
  return v_id;
end $$;

-- =============================================================================
-- 1. The actor is required, and it is not defaulted.
-- =============================================================================

select throws_ok(
  $$ select tests_tmp.new_order('SM-NOACTOR', 'pending_payment') $$,
  '23514', null,
  'E06-05: a status write with NO app.actor_type is refused. Defaulting to `system` would be the '
  'obvious kindness and `system` is the actor with the most transitions available — a migration '
  'or a console session that forgets to say who it is should get an error, not the widest role');

set local app.actor_type = 'system';

-- =============================================================================
-- 2. The transitions that must be impossible. This is the subject of the file.
-- =============================================================================

create temporary table sm_pending as select tests_tmp.new_order('SM-1', 'pending_payment') as id;

select throws_ok(
  format($$ update "order" set status = 'delivered' where id = %L $$, (select id from sm_pending)),
  '23514', null,
  'L5: pending_payment -> delivered is REFUSED. Before 0039 this update succeeded, and it is the '
  'kitchen handing over food against money that never arrived');

select throws_ok(
  format($$ update "order" set status = 'preparing' where id = %L $$, (select id from sm_pending)),
  '23514', null,
  'and pending_payment -> preparing likewise: never cook against an uncaptured payment');

select is(
  (select status::text from "order" where id = (select id from sm_pending)),
  'pending_payment',
  'and the row is untouched by either refusal');

-- The one people argue about. `[OL-04]`: the food was eaten; a post-delivery problem is a
-- refund, not a cancellation, and the fulfilment record must keep saying it was delivered.
update "order" set status = 'paid' where id = (select id from sm_pending);
-- The actor changes because the RULE says so: T5 (-> paid) is `system`, T8 (-> delivered) is
-- kitchen or admin. Writing this setup as one actor failed, which is the trigger working.
set local app.actor_type = 'kitchen';
update "order" set status = 'delivered' where id = (select id from sm_pending);
set local app.actor_type = 'system';

select throws_ok(
  format($$ update "order" set status = 'cancelled' where id = %L $$, (select id from sm_pending)),
  '23514', null,
  '[OL-04]: delivered -> cancelled is refused. The food was eaten — a later problem is a refund, '
  'and the kitchen''s and the school''s view of what was served stays true');

select throws_ok(
  format($$ update "order" set status = 'refunded' where id = %L $$, (select id from sm_pending)),
  '23514', null,
  'and delivered -> refunded too, for the same reason');

create temporary table sm_paid as select tests_tmp.new_order('SM-2', 'pending_payment') as id;
update "order" set status = 'paid' where id = (select id from sm_paid);

select throws_ok(
  format($$ update "order" set status = 'refunded' where id = %L $$, (select id from sm_paid)),
  '23514', null,
  'paid -> refunded direct is refused: a refund with no cancellation loses WHY the food was not '
  'delivered. It goes through cancelled, which carries the reason code');

-- =============================================================================
-- 3. The actor is part of the transition, not a separate check.
-- =============================================================================

select throws_ok(
  format($$ update "order" set status = 'preparing' where id = %L $$, (select id from sm_paid)),
  '23514', null,
  'E06-05: `system` cannot start cooking. T7 belongs to kitchen and admin, and collapsing the '
  'table to "is paid->preparing allowed?" would lose exactly this');

set local app.actor_type = 'kitchen';
select lives_ok(
  format($$ update "order" set status = 'preparing' where id = %L $$, (select id from sm_paid)),
  'and the kitchen can — same transition, different actor, different answer');

set local app.actor_type = 'customer';
select throws_ok(
  format($$ update "order" set status = 'delivered' where id = %L $$, (select id from sm_paid)),
  '23514', null,
  'a CUSTOMER cannot mark their own order delivered');

-- =============================================================================
-- 4. Every transition leaves a history row — `I2`.
-- =============================================================================

select is(
  (select count(*)::int from order_event where order_id = (select id from sm_paid)),
  3,
  'I2: insert, paid, preparing — three status changes, three events, written by the same '
  'trigger pair that allowed them, so the history cannot disagree with the order');

select is(
  (select from_status::text || '->' || to_status::text from order_event
    where order_id = (select id from sm_paid) and to_status = 'preparing'),
  'paid->preparing',
  'and the event records BOTH ends of the move, not just where it landed');

select is(
  (select actor_type::text from order_event
    where order_id = (select id from sm_paid) and to_status = 'preparing'),
  'kitchen',
  'and who did it');

-- =============================================================================
-- 5. `E06-15` / `L3` — the out-of-order webhook. This is the one that will actually happen.
-- =============================================================================

insert into payment (id, order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
values ('e3000000-7e57-0000-0000-0000000000e1', (select group_id from sm_ctx),
        'razorpay', 'order_sm_e1', 21000, 'created', gen_random_uuid());

update payment set status = 'captured' where id = 'e3000000-7e57-0000-0000-0000000000e1';

select throws_ok(
  $$ update payment set status = 'authorized'
      where id = 'e3000000-7e57-0000-0000-0000000000e1' $$,
  '23514', null,
  'E06-15 / L3: `payment.authorized` arriving AFTER `payment.captured` cannot downgrade the '
  'payment. Webhook delivery is unordered and this is normal, not exotic — a handler that '
  'assigned the inbound status would leave the order paid against a payment the database calls '
  'merely authorized, and every reconciliation disagreeing with every other');

select throws_ok(
  $$ update payment set status = 'failed'
      where id = 'e3000000-7e57-0000-0000-0000000000e1' $$,
  '23514', null,
  'L3: captured -> failed is refused. On a plain rank comparison failed (3) is ABOVE captured '
  '(2), so this is the one downgrade that looks like an upgrade — which is why the legal moves '
  'are written out rather than computed');

select throws_ok(
  $$ update payment set status = 'created'
      where id = 'e3000000-7e57-0000-0000-0000000000e1' $$,
  '23514', null,
  'and nothing returns to created');

select lives_ok(
  $$ update payment set status = 'partially_refunded'
      where id = 'e3000000-7e57-0000-0000-0000000000e1' $$,
  'the refund axis IS reachable from captured — it is derived from completed refunds rather '
  'than transitioned, and it is the only thing that leaves the capture rank behind');

select lives_ok(
  $$ update payment set status = 'refunded'
      where id = 'e3000000-7e57-0000-0000-0000000000e1' $$,
  'and on to refunded');

select throws_ok(
  $$ update payment set status = 'partially_refunded'
      where id = 'e3000000-7e57-0000-0000-0000000000e1' $$,
  '23514', null,
  'but not back: a fully refunded payment does not become partially refunded because a late '
  'webhook said so');

-- =============================================================================
-- 6. The migration actor — `E16-49`, and the assertions are all about how NARROW it is.
--
-- `E16` imports ~283 finished legacy orders and §4.1 has no legal insert into a terminal state.
-- Andy chose a named actor over walking each order through the machine (which would write an
-- `order_event` history that never happened, onto the table `I2` exists to make trustworthy) and
-- over disabling the trigger in the importer (the version that ends up in a script nobody
-- reviews — and precisely how the legacy system came to be the way it is).
--
-- So the exemption exists. What is tested here is that it cannot be used for anything else.
-- =============================================================================

set local app.actor_type = 'migration';

select lives_ok(
  $$ insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id,
       recipient_id, school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
       config_snapshot, school_name_snapshot, recipient_name_snapshot, status, legacy_bubble_id)
     select (select group_id from sm_ctx), 'SM-MIG-1', gen_random_uuid(),
            (select id from app_user limit 1), (select id from recipient limit 1),
            s.id, s.kitchen_id, s.city_id, current_date - 30, 'classroom',
            now() - interval '31 days', '{}'::jsonb, s.name, 'Legacy', 'paid',
            '1749446685836x657725915595526160'
       from school s where s.id = (select school_id from sm_ctx) $$,
  'E16-49: the migration actor can insert a finished legacy order — 281 of the 361 Bubble orders '
  'are `Paid` and there was no legal way to write one');

select throws_ok(
  $$ insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id,
       recipient_id, school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
       config_snapshot, school_name_snapshot, recipient_name_snapshot, status)
     select (select group_id from sm_ctx), 'SM-MIG-2', gen_random_uuid(),
            (select id from app_user limit 1), (select id from recipient limit 1),
            s.id, s.kitchen_id, s.city_id, current_date - 30, 'classroom',
            now() - interval '31 days', '{}'::jsonb, s.name, 'Legacy', 'paid'
       from school s where s.id = (select school_id from sm_ctx) $$,
  '23514', null,
  'E16-49, THE narrowing: the same insert with NO legacy_bubble_id is refused. Setting '
  'app.actor_type = ''migration'' is not enough — the actor and the DATA have to agree, and a '
  'new order has no legacy id and never will, so this path cannot be opened for one');

select throws_ok(
  $$ insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id,
       recipient_id, school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
       config_snapshot, school_name_snapshot, recipient_name_snapshot, status, legacy_bubble_id)
     select (select group_id from sm_ctx), 'SM-MIG-3', gen_random_uuid(),
            (select id from app_user limit 1), (select id from recipient limit 1),
            s.id, s.kitchen_id, s.city_id, current_date - 30, 'classroom',
            now() - interval '31 days', '{}'::jsonb, s.name, 'Legacy', 'delivered',
            '1749446685836x657725915595526161'
       from school s where s.id = (select school_id from sm_ctx) $$,
  '23514', null,
  'and `delivered` is refused even WITH a legacy id: the recon found only Paid, Cancelled and '
  'Draft in the export, so the exemption is sized to the states that exist. One sized for states '
  'that do not is one somebody finds a use for');

-- The sharpest one. A migration actor must never be able to touch a live order.
select throws_ok(
  format($$ update "order" set status = 'cancelled' where id = %L $$, (select id from sm_paid)),
  '23514', null,
  'E16-49: the migration actor cannot UPDATE anything. There is no UPDATE row for it anywhere in '
  'the table, so it can create history and can never cancel a real customer''s lunch');

set local app.actor_type = 'system';

select * from finish();
rollback;
