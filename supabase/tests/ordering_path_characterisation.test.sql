-- =============================================================================
-- ordering_path_characterisation.test.sql — the regression bar for the pack rebuild. `E21-68`.
--
-- Andy, 2026-09-16: *"the thing that must not break is the existing ordering flow — cart,
-- checkout, the Razorpay webhook and order confirmation — which is carrying real orders right
-- now. Packs are new and can be imperfect; those paths cannot regress. Cover them in your tests
-- before you touch them, not after."*
--
-- ## Why this file exists when checkout.test.sql and settle_payment.test.sql already do
--
-- They test those functions. This tests the **properties that hold across all of them**, which is
-- a different job and the one the rebuild threatens. The pack work adds a reservation step inside
-- `create_checkout`, a confirmation step inside `settle_payment`, and a second route by which an
-- order reaches `paid` — the zero-cash redemption, which has no payment to settle. Each of those
-- is a seam, and a seam is where a per-function test looks in the wrong place.
--
-- **This file is written and green BEFORE any of that lands**, and is then re-run unchanged after
-- every pack commit. An assertion here that has to be edited to pass is the alarm: it means the
-- ordering path changed, and the edit is the thing to explain rather than the thing to do.
--
-- ## The invariants, and the defect that proves they were needed
--
-- `E21-65` is why three of these are stated as properties of **every** order rather than of one
-- function's return value. The old design inserted redemption orders as `pending_payment` into an
-- already-settled group; the only transition to `paid` is the loop inside `settle_payment`, which
-- had already run and would never run again. So the balance decremented, the ledger recognised
-- revenue, and the child was never cooked for — silently, because the kitchen board filters to
-- `['paid','preparing','delivered','cancelled']` and the order sat outside it for ever.
--
-- Every test in the old suite passed. They asserted that `settle_payment` allocates a pickup code,
-- which was true, and never that **an order that is paid has one** — which is the property that
-- was false. Stated as a universal, the defect cannot hide:
--
--   1. a `paid` order has a `pickup_code`
--   2. a `paid` order has a `confirmed_at`
--   3. a `paid` order is in the set the kitchen board reads
--   4. every `order_ref` is minted the same way, so none of them says how it was paid (`E21-66`)
--
-- These are cheap, they are true today, and they are the four that the rebuild could break.
--
-- ## All four are mutation-checked, and one of them was hollow
--
-- Each was run against a hand-built replica of the defect before being trusted. Three fired.
-- **The kitchen-visibility one did not**, and the reason is worth keeping: written as
-- `order_group.status = 'paid'` it can never match, because the `derive_group_status` trigger
-- recomputes a group's status from its orders — so inserting the `pending_payment` redemption
-- order **demotes the whole group back to `pending_payment`**, and the assertion stops looking
-- at exactly the moment it should fire. Rewritten against `paid_at`, which `P17` fixes as set
-- once and never cleared, it fires.
--
-- That trigger behaviour is a second consequence of `E21-65` that the audit did not record:
-- the pack purchase's own group reverts to `pending_payment` on the first redemption while its
-- `paid_at` stays set, so status and paid_at disagree on a row that represents money taken. It
-- is moot under the rebuild — a redemption is an ordinary checkout in its own group, and nothing
-- is ever inserted into a settled one — but it is why this file asserts on `paid_at`.
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

-- -----------------------------------------------------------------------------
-- A cash order, taken all the way through the path exactly as a parent's is.
-- Deliberately NOT via a helper: the point is to exercise the real functions.
-- -----------------------------------------------------------------------------

create temporary table c_ctx as
select 'e1000000-7e57-0000-0000-00000000c001'::uuid as group_id,
       (select id from school where is_active limit 1)   as school_id,
       (select id from app_user limit 1)                 as user_id,
       (select id from recipient limit 1)                as recipient_id,
       (select id from city limit 1)                     as city_id;

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select group_id, user_id, 'characterisation-cash', city_id, 20000, 1000, 21000 from c_ctx;

insert into "order" (order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
select c.group_id, generate_order_ref(), gen_random_uuid(), c.user_id, c.recipient_id,
       s.id, s.kitchen_id, s.city_id, current_date + 1, 'classroom', now() + interval '1 day',
       '{}'::jsonb, s.name, 'Test', 'pending_payment', 20000, 500, 500, 21000
  from c_ctx c join school s on s.id = c.school_id;

insert into payment (order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
select group_id, 'razorpay', 'order_char_c001', 21000, 'created', gen_random_uuid() from c_ctx;

-- =============================================================================
-- 1. Before settlement: nothing has happened, and that is visible.
-- =============================================================================

select is((select status::text from "order" where order_group_id = (select group_id from c_ctx)),
  'pending_payment', 'characterisation: an unpaid order starts pending_payment');

select ok((select pickup_code is null from "order"
            where order_group_id = (select group_id from c_ctx)),
  'characterisation: an unpaid order has NO pickup code — the code is the mark of settlement');

-- =============================================================================
-- 2. Settlement. The exact behaviour the rebuild must preserve.
-- =============================================================================

create temporary table c_settled as
select settle_payment('order_char_c001', 'pay_char_c001', 21000) as r;

select is((select status::text from "order" where order_group_id = (select group_id from c_ctx)),
  'paid', 'characterisation: settlement makes the order paid');

select is((select status::text from order_group where id = (select group_id from c_ctx)),
  'paid', 'characterisation: settlement makes the group paid');

select ok((select paid_at is not null from order_group where id = (select group_id from c_ctx)),
  'characterisation: paid_at is stamped, and it is what the reports count on');

select matches((select pickup_code from "order" where order_group_id = (select group_id from c_ctx)),
  '^[0-9]{4}$', 'characterisation: the pickup code is four digits');

select ok((select confirmed_at is not null from "order"
            where order_group_id = (select group_id from c_ctx)),
  'characterisation: confirmed_at is stamped in the same transaction');

-- The invoice. `D14`: issued in THIS transaction or not at all.
select is((select count(*)::int from invoice where order_group_id = (select group_id from c_ctx)),
  1, 'characterisation: settlement issues exactly one invoice (D14)');

-- =============================================================================
-- 3. THE FOUR UNIVERSALS. `E21-65` and `E21-66` are both invisible without these.
--
-- Stated over every row in the table rather than over this test's own order, so that a future
-- path which creates a paid order some other way is caught by the same four lines.
-- =============================================================================

select is((select count(*)::int from "order" where status = 'paid' and pickup_code is null), 0,
  'E21-65 UNIVERSAL: every paid order has a pickup code. A paid order without one cannot be '
  'collected, and is the exact shape of the defect that made a redeemed meal invisible.');

select is((select count(*)::int from "order" where status = 'paid' and confirmed_at is null), 0,
  'E21-65 UNIVERSAL: every paid order has a confirmed_at.');

-- Keyed on `paid_at`, NOT on `order_group.status`, and the difference is the whole assertion.
--
-- The first version of this line read `g.status = 'paid'` and was hollow — it could not fail.
-- Mutation-checking it against a hand-built replica of `E21-65` is what found that out: the
-- `derive_group_status` trigger recomputes a group's status from its orders on every insert, so
-- adding a `pending_payment` order to a settled group **demotes the group to `pending_payment`
-- too**, and the WHERE clause stops matching at exactly the moment it should fire.
--
-- `paid_at` does not move — `P17` requires it set once and never cleared, and it is what the
-- revenue reports count on. So it is the one column that still remembers the money arrived.
select is((select count(*)::int from "order" o
            join order_group g on g.id = o.order_group_id
           where g.paid_at is not null
             and o.status::text <> all (array['paid','preparing','delivered','cancelled'])), 0,
  'E21-65 UNIVERSAL: no order sits inside a group that has been PAID FOR in a status the kitchen '
  'board cannot read (packages/shared/src/api/kitchen.ts KITCHEN_STATUSES). This is the defect '
  'exactly: a redemption order inserted as pending_payment into an already-settled group, which '
  'nothing will ever transition again. An order the kitchen cannot see is a child who is not '
  'cooked for. Mutation-checked — it fires against a replica of the defect.');

select is((select count(*)::int from "order" where order_ref !~ '^GB-'), 0,
  'E21-66 UNIVERSAL: every order_ref is minted by generate_order_ref(). order_ref crosses the '
  'wire to the kitchen client, so a second prefix would tell the kitchen how an order was paid '
  'for — which is exactly what a column-absence test cannot catch.');

-- =============================================================================
-- 4. Idempotency. A replayed webhook changes nothing — §7.1 layers 5-8, no flag.
-- =============================================================================

create temporary table c_again as
select settle_payment('order_char_c001', 'pay_char_c001', 21000) as r;

select is((select (r->>'already_settled')::boolean from c_again), true,
  'characterisation: a replayed settlement reports itself as a replay');

select is((select (r->>'pickup_code') from c_again), (select (r->>'pickup_code') from c_settled),
  'characterisation: a replay returns the SAME pickup code — it does not redraw one');

select is((select count(*)::int from invoice where order_group_id = (select group_id from c_ctx)),
  1, 'characterisation: a replay does not consume a second invoice number. Invoice numbers are '
     'gapless and not recoverable (D14).');

-- =============================================================================
-- 5. The money guard. `L7`: never record a settlement for an amount the customer was not shown.
-- =============================================================================

insert into order_group (id, customer_user_id, idempotency_key, city_id,
                         subtotal_paise, tax_total_paise, payable_paise)
select 'e1000000-7e57-0000-0000-00000000c002'::uuid, user_id, 'characterisation-mismatch',
       city_id, 20000, 1000, 21000 from c_ctx;

insert into payment (order_group_id, provider, provider_order_id, amount_paise, status,
                     correlation_id)
values ('e1000000-7e57-0000-0000-00000000c002', 'razorpay', 'order_char_c002', 21000, 'created',
        gen_random_uuid());

select throws_ok(
  $$ select settle_payment('order_char_c002', 'pay_char_c002', 19900) $$,
  'P0001', null,
  'L7 characterisation: a capture for an amount the group is not payable is REFUSED, not '
  'absorbed. Partial pack coverage changes payable_paise, so this guard is directly in the '
  'rebuild''s path.');

select throws_ok(
  $$ select settle_payment('order_char_does_not_exist', 'pay_x', 21000) $$,
  'P0001', null,
  'characterisation: an unknown provider order raises payment_not_found rather than settling '
  'something. The caller turns this into a 200 so Razorpay does not retry for ever (§10.9).');

-- =============================================================================
-- 6. The ledger legs, by balance rather than by row count.
--
-- A balance is the assertion that survives the rebuild: it stays true however the postings are
-- split up, and goes false the moment an amount is counted twice or lost.
-- =============================================================================

select is((select count(*)::int from ledger_transaction
            where reason_code = 'sale'
              and idempotency_key = 'settle:pay_char_c001'), 1,
  'characterisation: exactly one sale transaction for this payment, keyed on the provider '
  'payment id — so a second delivery cannot double the money even if it reached this far');

select is((select coalesce(sum(failures), 0)::int from assert_ledger_integrity()), 0,
  'characterisation: assert_ledger_integrity() reports zero failures across every check after '
  'the whole path has run');

select * from finish();
rollback;
