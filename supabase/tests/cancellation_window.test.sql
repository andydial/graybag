-- =============================================================================
-- cancellation_window.test.sql — the cancellation boundary comes from the ORDER, not the
-- kitchen's current config. `E06-42`.
--
-- The defect this guards is not an arithmetic slip. It is reaching for
-- `resolve_effective_config()` instead of `order.config_snapshot` — the resolver is the
-- function every other caller wants, it type-checks, it returns a plausible number, and it is
-- wrong in exactly one circumstance: after somebody edits the config. So the fixture edits the
-- config, which is the only way this test can tell the two implementations apart.
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

create temporary table cw_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as customer_id,
       (select id from school where is_active limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from recipient limit 1) as recipient_id;

-- A fixed cutoff, so every expectation below is arithmetic on a constant rather than on the
-- hour the suite happens to run. `E05-49` is the entry in `learnings.md` about a test that
-- passes 77% of the day and reads as flakiness.
create temporary table cw_cutoff as select '2027-03-01 00:00:00+05:30'::timestamptz as cutoff_at;

create temporary table cw_orders as
with g as (
  insert into order_group (id, customer_user_id, idempotency_key, city_id,
                           subtotal_paise, tax_total_paise, payable_paise, status)
  select gen_random_uuid(), c.customer_id, 'cw-' || n, c.city_id, 0, 0, 0, 'pending_payment'
    from cw_ctx c, generate_series(1, 3) n
  returning id, idempotency_key
)
select id, idempotency_key from g;

-- Three orders, three snapshots, one cutoff. The snapshot is the whole variable under test.
insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select og.id, 'CW-' || og.idempotency_key, gen_random_uuid(), c.customer_id, c.recipient_id,
       s.id, s.kitchen_id, s.city_id, '2027-03-01'::date, 'classroom', cut.cutoff_at,
       case og.idempotency_key
         -- Cancellation closes 120 minutes before the cutoff.
         when 'cw-1' then '{"customer_cancellation_allowed": true,  "customer_cancellation_cutoff_minutes": 120}'::jsonb
         -- Allowed, but right up to the cutoff — 0 is a real configured value, distinct from absent.
         when 'cw-2' then '{"customer_cancellation_allowed": true,  "customer_cancellation_cutoff_minutes": 0}'::jsonb
         -- A snapshot that predates the keys: the `E16` backfill, and every older fixture.
         else '{}'::jsonb
       end,
       s.name, 'Window', 'pending_payment', 0, 0, 0, 0
  from cw_orders og
  cross join cw_ctx c
  cross join cw_cutoff cut
  join school s on s.id = c.school_id;

grant select on cw_ctx, cw_orders, cw_cutoff to authenticated;

-- =============================================================================
-- 1. The arithmetic.
-- =============================================================================

select is(
  (select cancellation_closes_at(o) from "order" o where o.order_ref = 'CW-cw-1'),
  (select cutoff_at - interval '120 minutes' from cw_cutoff),
  '§9.2 E5: the boundary is cutoff_at MINUS the configured minutes, not the cutoff itself');

select is(
  (select cancellation_closes_at(o) from "order" o where o.order_ref = 'CW-cw-2'),
  (select cutoff_at from cw_cutoff),
  'and 0 minutes means the boundary IS the cutoff — a configured 0 is a real answer');

-- =============================================================================
-- 2. Absent is NULL, and never 0.
--
-- This is the assertion with teeth. `coalesce(…, 0)` in the function would leave every other
-- test in this file green while telling a parent with a backfilled order that they may cancel
-- right up to the cutoff — a promise derived from a key that was never written.
-- =============================================================================

select is(
  (select cancellation_closes_at(o) from "order" o where o.order_ref = 'CW-cw-3'),
  null::timestamptz,
  'a snapshot with no cancellation keys yields NULL — "we can''t tell", never "you can"');

select isnt(
  (select cancellation_closes_at(o) from "order" o where o.order_ref = 'CW-cw-3'),
  (select cutoff_at from cw_cutoff),
  'and specifically NOT the cutoff, which is what a coalesce(…, 0) would have returned');

-- =============================================================================
-- 3. `cancellation_allowed` — false when absent, because false is what the screen wants.
-- =============================================================================

select ok((select cancellation_allowed(o) from "order" o where o.order_ref = 'CW-cw-1'),
          'an order whose snapshot allows cancellation says so');

select ok(not (select cancellation_allowed(o) from "order" o where o.order_ref = 'CW-cw-3'),
          'and one whose snapshot is silent says false, not null — T10''s other half, closed');

-- =============================================================================
-- 4. THE POINT OF THE TASK: the kitchen edits its cutoff tonight.
--
-- Everything above would pass against an implementation that called
-- `resolve_effective_config(o.school_id)`. This is the assertion that would not.
-- =============================================================================

create temporary table cw_before as
select o.order_ref, cancellation_closes_at(o) as closes_at, cancellation_allowed(o) as allowed
  from "order" o where o.order_ref like 'CW-%';

-- The kitchen changes its mind at 9pm: cancellations off, and the window widened to a day.
insert into kitchen_config (kitchen_id, customer_cancellation_allowed, customer_cancellation_cutoff_minutes)
select s.kitchen_id, false, 1440 from school s, cw_ctx c where s.id = c.school_id
on conflict (kitchen_id) do update
   set customer_cancellation_allowed        = excluded.customer_cancellation_allowed,
       customer_cancellation_cutoff_minutes = excluded.customer_cancellation_cutoff_minutes;

-- The live resolver now says something different. If it did not, the rest of this section
-- would pass vacuously — which is the failure mode of every "config changed" test that does
-- not first prove the config changed.
select is(
  (select customer_cancellation_cutoff_minutes from cw_ctx c, resolve_effective_config(c.school_id)),
  1440,
  'harness: the LIVE config now says 1440 minutes, so the two sources genuinely disagree');

select is(
  (select closes_at from cw_before where order_ref = 'CW-cw-1'),
  (select cancellation_closes_at(o) from "order" o where o.order_ref = 'CW-cw-1'),
  'C9/L6: an existing order''s boundary did NOT move — it reads its own snapshot, not the kitchen''s new terms');

select ok(
  (select cancellation_allowed(o) from "order" o where o.order_ref = 'CW-cw-1'),
  'and an order placed under "cancellation allowed" stays cancellable after the kitchen turns it off');

select isnt(
  (select cancellation_closes_at(o) from "order" o where o.order_ref = 'CW-cw-1'),
  (select cut.cutoff_at - interval '1440 minutes' from cw_cutoff cut),
  'specifically: it is not the value the live resolver would have produced');

-- =============================================================================
-- 5. Reachable as a PostgREST computed column by the parent, which is how the app reads it.
--
-- A function that works in psql and is not granted to `authenticated` fails at the first tap
-- with a 42883 that reads as a missing column.
-- =============================================================================

select ok(
  has_function_privilege('authenticated', 'cancellation_closes_at("order")', 'execute'),
  'the parent''s own role may execute it — otherwise the computed column 404s at the first tap');

select ok(
  has_function_privilege('authenticated', 'cancellation_allowed("order")', 'execute'),
  'and the same for cancellation_allowed');

-- STABLE, not VOLATILE: PostgREST refuses to expose a volatile function as a computed column,
-- and the failure is a missing column rather than an error anybody would connect to this.
select is(
  (select provolatile from pg_proc where proname = 'cancellation_closes_at'),
  's'::"char",
  'STABLE — PostgREST will not expose a volatile function as a computed column');

select * from finish();
rollback;
