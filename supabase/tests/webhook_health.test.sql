-- =============================================================================
-- webhook_health.test.sql — `E06-28`, `E06-04`.
--
-- The failure this covers makes no noise: a wrong webhook secret fails 100% of webhooks, records
-- every one, and returns 200 to all of them. No 5xx, no retries, no error rate, no traffic gap —
-- and every capture unprocessed until a customer complains.
--
-- So the assertions below are mostly "the alert fires", written as the two scenarios that
-- actually produce it.
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
set local app.actor_type = 'system';

create temporary table wh_ctx as
select 'e1000000-7e57-0000-0000-0000000000f1'::uuid as group_id,
       (select id from school where is_active limit 1) as school_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select (select group_id from wh_ctx), (select id from app_user limit 1),
       'webhook-health-test', (select id from city limit 1), 20000, 1000, 21000;

-- =============================================================================
-- 1. A quiet night is not an outage.
-- =============================================================================

select is(
  (select sum(failures)::bigint from assert_webhook_health()),
  0::bigint,
  'E06-28: no orders and no events reports zero. A window with no traffic is a quiet night, and '
  'an alert that fires on one is an alert nobody reads by the end of the week');

-- =============================================================================
-- 2. The wrong-secret scenario. Events arriving, every one failing verification.
-- =============================================================================

insert into payment_webhook_event (provider, provider_event_id, event_type, signature_verified,
                                   payload, processing_status)
select 'razorpay', 'evt_7e57_bad_' || g, 'payment.captured', false, '{}'::jsonb, 'ignored'
  from generate_series(1, 5) g;

select is(
  (select failures from assert_webhook_health() where check_name = 'signature_failure_rate'),
  5::bigint,
  'E06-28: five events, none verified — the wrong-secret signature. Every one returned 200 and '
  'was recorded, so there is no 5xx, no retry and no traffic gap anywhere else to see this in');

select matches(
  (select detail from assert_webhook_health() where check_name = 'signature_failure_rate'),
  '5 of 5 events',
  'and the detail carries the RATE, so a caller can tell a handful of internet noise from a '
  'deploy that broke the secret — the threshold is the caller''s judgement, not this function''s');

-- =============================================================================
-- 3. The blind spot. Orders placed, and nothing arrived at all.
-- =============================================================================

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status)
select (select group_id from wh_ctx), 'WH-1', gen_random_uuid(),
       (select id from app_user limit 1), (select id from recipient limit 1),
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Test', 'pending_payment'
  from school s where s.id = (select school_id from wh_ctx);

select is(
  (select failures from assert_webhook_health() where check_name = 'no_verified_events'),
  1::bigint,
  'E06-28: an order was placed and NO verified event arrived. This is the check that catches a '
  'deleted subscription, a changed URL, a function that failed to deploy — none of which the '
  'failure-rate check can see, because with no events its rate is 0%, which reads as perfect');

-- The pair is the point: each check is the other's blind spot, and here both are firing at once
-- for different reasons.
select is(
  (select count(*)::int from assert_webhook_health() where failures > 0),
  2,
  'both checks fire together here, for different reasons — which is why neither is redundant');

-- =============================================================================
-- 4. Healthy: verified events arriving against real orders.
-- =============================================================================

insert into payment_webhook_event (provider, provider_event_id, event_type, signature_verified,
                                   payload, processing_status)
values ('razorpay', 'evt_7e57_good_1', 'payment.captured', true, '{}'::jsonb, 'pending');

select is(
  (select failures from assert_webhook_health() where check_name = 'no_verified_events'),
  0::bigint,
  'one verified event clears the second check — we are hearing from Razorpay again');

-- =============================================================================
-- 5. §7.1 layer 4 — the load-bearing idempotency for this endpoint.
-- =============================================================================

select throws_ok(
  $$ insert into payment_webhook_event (provider, provider_event_id, event_type,
                                        signature_verified, payload)
     values ('razorpay', 'evt_7e57_good_1', 'payment.captured', true, '{}'::jsonb) $$,
  '23505',
  null,
  '§7.1 layer 4: the same provider_event_id twice is refused by the database. Razorpay retries '
  'by design, and the endpoint turns this refusal into a 200 — a replay is success, not conflict');

select * from finish();
rollback;
