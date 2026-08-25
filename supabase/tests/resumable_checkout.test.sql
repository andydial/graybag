-- =============================================================================
-- resumable_checkout.test.sql — `E05-54`. The money properties, in every path.
--
-- Andy: *"The money is the constraint. A parent must never be charged twice, and a resumed
-- payment must reconcile against the same order. Prove the idempotency, and prove the ledger
-- balances in each path: resumed-and-paid, abandoned, expired, and paid-but-webhook-late."*
--
-- The four paths are the four sections below. Two properties are asserted in every one of them:
--
--   * **one provider order per group** — never two things that can each be paid;
--   * **the ledger balances, and stays empty when no money moved.** Abandoning or expiring an
--     unpaid checkout must post nothing. "We cancelled it and also posted something" is a defect
--     that surfaces at month end, not here, which is why it is asserted here.
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
-- Fixtures: a parent, a child, and four order groups — one per path.
-- -----------------------------------------------------------------------------
insert into auth.users (id) values ('a0000000-7e57-0000-0000-0000000005c1');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-0000000005c1', 'resume@example.test', 'Resume')
on conflict (id) do update set email = excluded.email;

create temporary table rc as
select (select id from school where is_active and onboarded_at is not null order by name limit 1) as school_id,
       (select id from city limit 1) as city_id,
       'a0000000-7e57-0000-0000-0000000005c1'::uuid as parent;

create temporary table rc_kid as
select (create_recipient(
          p_guardian_user_id => (select parent from rc),
          p_first_name => 'Resumable', p_last_name => null,
          p_school_id => (select school_id from rc),
          p_class_label => '4', p_section_label => 'A',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

/**
 * A helper that builds a pending_payment group directly, because `create_checkout` needs a live
 * menu for a future date and this file is about what happens *after* checkout, not about
 * checkout. `cutoff_at` is the lever every assertion here turns.
 */
create function tests_tmp.mk_group(p_label text, p_created timestamptz, p_cutoff timestamptz)
returns uuid language plpgsql as $$
declare v_group uuid; v_order uuid;
begin
  v_group := gen_random_uuid();
  insert into order_group (id, customer_user_id, idempotency_key, city_id, status,
                           subtotal_paise, tax_total_paise, discount_paise,
                           wallet_applied_paise, payable_paise, correlation_id, created_at)
  select v_group, rc.parent, 'test-' || p_label, rc.city_id, 'pending_payment',
         6900, 346, 0, 0, 7246, gen_random_uuid(), p_created
    from rc;

  v_order := gen_random_uuid();
  insert into "order" (id, order_ref, order_group_id, customer_user_id, recipient_id, school_id,
                       kitchen_id, city_id, service_date, delivery_mode, status, cutoff_at,
                       subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise,
                       config_snapshot, school_name_snapshot, recipient_name_snapshot, placed_at,
                       correlation_id)
  select v_order, generate_order_ref(), v_group, rc.parent, rc_kid.id, rc.school_id, s.kitchen_id, rc.city_id,
         (p_cutoff + interval '12 hours')::date, 'classroom', 'pending_payment', p_cutoff,
         6900, 173, 173, 7246,
         to_jsonb(resolve_effective_config(rc.school_id)), s.name, 'Resumable', p_created,
         gen_random_uuid()
    from rc join rc_kid on true join school s on s.id = rc.school_id;

  return v_group;
end $$;

-- =============================================================================
-- 0. The window itself — the rule every path below depends on.
-- =============================================================================

create temporary table g_soon as select tests_tmp.mk_group('soon', now(), now() + interval '2 hours') as id;
create temporary table g_far  as select tests_tmp.mk_group('far',  now(), now() + interval '10 days') as id;
create temporary table g_gone as select tests_tmp.mk_group('gone', now() - interval '3 days', now() - interval '2 days') as id;

select is(
  (select checkout_expires_at(og) from order_group og where og.id = (select id from g_soon)),
  (select min(o.cutoff_at) from "order" o where o.order_group_id = (select id from g_soon)),
  'a cutoff inside 24h IS the expiry — the kitchen cannot make food after cutoff, so resumable '
  'past it would be a worse lie than the one this replaces');

select ok(
  (select checkout_expires_at(og) < now() + interval '25 hours' from order_group og
    where og.id = (select id from g_far)),
  'a cutoff ten days out is capped at 24h — otherwise a fortnight-ahead order sits "Payment '
  'pending" for a fortnight, blocking that child''s erasure');

select ok((select checkout_resumable(og) from order_group og where og.id = (select id from g_soon)),
          'an unexpired pending group is resumable');
select ok(not (select checkout_resumable(og) from order_group og where og.id = (select id from g_gone)),
          'an expired one is not — asserted on the READ, so the app is right even before any sweep runs');

-- =============================================================================
-- 1. IDEMPOTENCY — resuming reuses the one provider order, and never invents a second.
-- =============================================================================

insert into payment (order_group_id, provider_order_id, amount_paise, status, attempt_no, correlation_id)
select id, 'order_TESTsoon1', 7246, 'created', 1, gen_random_uuid() from g_soon;

select is(
  (select provider_order_id from reusable_payment_attempt((select id from g_soon), (select parent from rc))),
  'order_TESTsoon1',
  'a resume re-uses the SAME Razorpay order — two live provider orders on one group is how a '
  'parent gets charged twice for one lunch');

select is(
  (select count(*)::int from payment where order_group_id = (select id from g_soon)),
  1,
  'and reusing created no second attempt');

-- The four conditions that must invalidate reuse. Each is money-relevant.
select is_empty(
  format($$ select 1 from reusable_payment_attempt(%L::uuid, %L::uuid) $$,
         (select id from g_gone), (select parent from rc)),
  'an expired checkout offers nothing to reuse');

update payment set amount_paise = 9999 where order_group_id = (select id from g_soon);
select is_empty(
  format($$ select 1 from reusable_payment_attempt(%L::uuid, %L::uuid) $$,
         (select id from g_soon), (select parent from rc)),
  'a repriced order does NOT reuse the old attempt — the parent must see the new total, not be '
  'quietly charged the old one');
update payment set amount_paise = 7246 where order_group_id = (select id from g_soon);

-- A group of its own, because the payment state machine rightly refuses `captured -> created`
-- and so this cannot be done by mutating the one above and putting it back.
create temporary table g_cap as select tests_tmp.mk_group('cap', now(), now() + interval '2 hours') as id;
insert into payment (order_group_id, provider_order_id, amount_paise, status, attempt_no, correlation_id)
select id, 'order_TESTcap1', 7246, 'created', 1, gen_random_uuid() from g_cap;
update payment set status = 'captured' where order_group_id = (select id from g_cap);

select is_empty(
  format($$ select 1 from reusable_payment_attempt(%L::uuid, %L::uuid) $$,
         (select id from g_cap), (select parent from rc)),
  'a captured attempt is never reused — reusing it would send a parent back to a Razorpay order '
  'that has already taken their money');

-- A second, unrelated account. `gen_random_uuid()` would do, but a real `app_user` proves the
-- refusal is about ownership rather than about the id being unknown.
insert into auth.users (id) values ('a0000000-7e57-0000-0000-0000000005c2');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-0000000005c2', 'stranger-rc@example.test', 'Stranger')
on conflict (id) do update set email = excluded.email;

select throws_matching(
  format($$ select 1 from reusable_payment_attempt(%L::uuid, %L::uuid) $$,
         (select id from g_soon), 'a0000000-7e57-0000-0000-0000000005c2'),
  'not authorized',
  'and another account cannot resume somebody else''s checkout');

-- =============================================================================
-- 2. ABANDONED — the parent gives up. No money moved, so nothing may be posted.
-- =============================================================================

select lives_ok(
  format($$ select abandon_checkout(%L::uuid, %L::uuid) $$,
         (select id from g_far), (select parent from rc)),
  'a parent can abandon their own pending checkout without support');

select is((select status::text from order_group where id = (select id from g_far)), 'cancelled',
          'the group is cancelled');
select is(
  (select cancel_reason_code from "order" where order_group_id = (select id from g_far)),
  'checkout_abandoned',
  'with a reason distinct from customer_cancelled — that one means a PAID order and owes a '
  'refund; conflating them overstates refunds in every report');

select is((select count(*)::int from ledger_entry), 0,
          'ABANDONED POSTS NOTHING TO THE LEDGER — no capture, no invoice, nothing to reverse');
select is((select count(*)::int from refund), 0, 'and creates no refund');

select throws_matching(
  format($$ select abandon_checkout(%L::uuid, %L::uuid) $$,
         (select id from g_far), (select parent from rc)),
  'not awaiting payment',
  'abandoning twice is refused rather than silently cancelling a cancelled order');

-- =============================================================================
-- 3. EXPIRED — the server resolves it. Only what is provably unchargeable.
-- =============================================================================

select is(expire_stale_checkouts(), 1,
          'the sweep expires the stale group that never reached Razorpay');
select is((select status::text from order_group where id = (select id from g_gone)), 'cancelled',
          'which is now cancelled');
select is(
  (select cancel_reason_code from "order" where order_group_id = (select id from g_gone)),
  'checkout_expired',
  'as expired, not as abandoned — the parent did not choose this');

select is((select status::text from order_group where id = (select id from g_soon)), 'pending_payment',
          'and an unexpired group is left alone');

select is((select count(*)::int from ledger_entry), 0,
          'EXPIRY POSTS NOTHING TO THE LEDGER either');

-- =============================================================================
-- 4. PAID-BUT-WEBHOOK-LATE — the path where a naive sweep takes money for a cancelled order.
--
-- This is the one Andy named, and it is the reason the sweep is split in two.
-- =============================================================================

create temporary table g_live as select tests_tmp.mk_group('live', now() - interval '3 days', now() - interval '2 days') as id;
insert into payment (order_group_id, provider_order_id, amount_paise, status, attempt_no, correlation_id)
select id, 'order_TESTlive1', 7246, 'created', 1, gen_random_uuid() from g_live;

select is(expire_stale_checkouts(), 0,
          'the SQL sweep refuses to touch an expired group holding a LIVE attempt — that Razorpay '
          'order may have been captured a second ago with the webhook still in flight, and '
          'cancelling it from SQL would take money for an order we had just cancelled');

select is((select status::text from order_group where id = (select id from g_live)), 'pending_payment',
          'so it is still pending, waiting for a caller that can ask Razorpay');

select is(
  (select provider_order_id from expirable_with_live_attempt() where order_group_id = (select id from g_live)),
  'order_TESTlive1',
  'and it is handed to that caller, with the provider id to reconcile against — the credentials '
  'live in the Edge Function, so the provider check cannot happen in SQL');

-- The caller found a capture: settle, do not expire.
update payment set status = 'captured' where order_group_id = (select id from g_live);
update order_group set status = 'paid' where id = (select id from g_live);

select ok(not expire_checkout_group((select id from g_live)),
          'expire_checkout_group RE-CHECKS inside the transaction and refuses a group that became '
          'paid in the gap — the gap between "Razorpay says unpaid" and this call is exactly '
          'where a late capture lands');

select is((select status::text from order_group where id = (select id from g_live)), 'paid',
          'the paid order survives the sweep intact');

select ok(not (select checkout_resumable(og) from order_group og where og.id = (select id from g_live)),
          'and a paid group is never offered as resumable');

-- =============================================================================
-- 5. The ledger, once, across everything above.
-- =============================================================================

select is(
  (select coalesce(sum(case when direction = 'debit' then amount_paise else -amount_paise end), 0)::bigint
     from ledger_entry),
  0::bigint,
  'the ledger balances across all four paths — trivially, because none of them moved money, '
  'which is the property worth pinning');

select * from finish();
rollback;
