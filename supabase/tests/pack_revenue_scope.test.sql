-- =============================================================================
-- pack_revenue_scope.test.sql — `E21-63`.
--
-- Andy's constraint was one sentence: *"Aggregates and order references only — no child identity
-- through that path."* Most of this file asserts what the path **cannot** do, because that is the
-- half a working feature does not demonstrate. A view that returned the right numbers and also
-- carried `recipient_id` would pass every test about numbers.
--
-- Four properties, and the first two are the ones that matter:
--
--   1. `recipient_id` is **not a column of the view**. Not filtered, not null — absent, so no
--      query can name it.
--   2. A back-office account still reads **nothing** from `meal_pack_redemption` itself. The view
--      is not a convenience over an open table; the table stays shut, which is what makes
--      property 1 hold for every future query rather than for the ones written today.
--   3. Platform scope only. A kitchen-scoped `orders.view_financials` opens nothing.
--   4. A disabled account reads nothing. **This one is belt-and-braces and the file says so**:
--      mutation-checking proved it still passes with `auth_is_live_user()` removed, because
--      `auth_can_platform` resolves through `auth_has_permission`, which already refuses a
--      disabled account. It is asserted because the property must hold, not because this
--      predicate is the only thing holding it.
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

-- =============================================================================
-- Part 1 — the shape. Asserted before any behaviour, because the leak this prevents is a column
-- existing, not a row being returned.
-- =============================================================================

select is(
  (select count(*)::int from pg_class where relname = 'meal_pack_redemption_money' and relkind = 'v'),
  1,
  'the view exists'
);

select is_empty(
  $$select column_name from information_schema.columns
     where table_name = 'meal_pack_redemption_money' and column_name = 'recipient_id'$$,
  'THE VIEW HAS NO recipient_id COLUMN — which child ate is not reachable through this path at '
  'all, rather than being filtered out by a predicate somebody could later relax'
);

select is_empty(
  $$select column_name from information_schema.columns
     where table_name = 'meal_pack_redemption_money' and column_name = 'reversal_reason'$$,
  'and no reversal_reason — free text an operator wrote about a cancelled meal is where identity '
  'leaks back in through the one column nobody audits'
);

select is(
  (select coalesce(c.reloptions::text, '') like '%security_invoker%'
     from pg_class c where c.relname = 'meal_pack_redemption_money'),
  false,
  'it is DEFINER — an invoker view would run under policies the back office does not have and '
  'return nothing to the only audience it exists for'
);

-- =============================================================================
-- Fixtures: a parent with a pack and one redeemed meal, plus two back-office accounts.
-- =============================================================================

insert into auth.users (id) values
  ('a0000000-7e57-0000-0000-0000000000c1'),   -- the parent
  ('a0000000-7e57-0000-0000-0000000000c2'),   -- platform finance
  ('a0000000-7e57-0000-0000-0000000000c3');   -- kitchen finance, same permission, narrower scope
insert into app_user (id, email, first_name) values
  ('a0000000-7e57-0000-0000-0000000000c1', 'pack-parent@example.test', 'Parent'),
  ('a0000000-7e57-0000-0000-0000000000c2', 'platform-fin@example.test', 'Platform'),
  ('a0000000-7e57-0000-0000-0000000000c3', 'kitchen-fin@example.test', 'Kitchen')
on conflict (id) do update set email = excluded.email;

create temporary table pr as
select 'a0000000-7e57-0000-0000-0000000000c1'::uuid as parent,
       (select id from school where is_active and onboarded_at is not null order by name limit 1) as school_id,
       (select id from city limit 1) as city_id,
       (select id from dish_category limit 1) as cat_id;

create temporary table pr_kid as
select (create_recipient(
          p_guardian_user_id => (select parent from pr),
          p_first_name => 'Redeemer', p_last_name => null,
          p_school_id => (select school_id from pr),
          p_class_label => '3', p_section_label => 'C',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

create temporary table pr_offer as
with ins as (
  insert into meal_pack_offer (name, meals_count, items_per_meal, required_category_id,
                               net_price_paise, alacarte_reference_paise, validity_days, is_active)
  select 'Revenue 10-pack', 10, 2, cat_id, 300000, 337500, 60, true from pr
  returning id
) select id from ins;

create temporary table pr_pack as
with og as (
  insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise)
  select parent, 'e63-' || gen_random_uuid(), 'paid', city_id, 'meal_pack_purchase',
         300000, 15000, 315000 from pr
  returning id
), pk as (
  insert into meal_pack (customer_user_id, offer_id, order_group_id, meals_total, meals_remaining,
                         net_price_paise, tax_total_paise, cgst_paise, sgst_paise, tax_point,
                         expires_at, correlation_id)
  select parent, (select id from pr_offer), og.id, 10, 9, 300000, 15000, 7500, 7500, 'sale',
         now() + interval '60 days', gen_random_uuid()
    from pr, og
  returning id
) select id from pk;

-- One order, one redemption against it.
create temporary table pr_order as
with og as (
  insert into order_group (customer_user_id, idempotency_key, status, city_id, kind,
                           subtotal_paise, tax_total_paise, payable_paise, pack_applied_paise)
  -- payable = subtotal + tax - discount - wallet - pack_applied. A meal worth 30000 settled
  -- entirely by redeeming one meal from the pack: nothing left to pay.
  select parent, 'e63o-' || gen_random_uuid(), 'paid', city_id, 'food', 30000, 0, 0, 30000 from pr
  returning id
), o as (
  -- `pending_payment` rather than `paid`: the state machine refuses `new -> paid`, and this test
  -- is about who may READ the money, not about how an order reaches it.
  insert into "order" (order_group_id, customer_user_id, recipient_id, school_id, kitchen_id,
                       city_id, service_date, delivery_mode, cutoff_at, config_snapshot,
                       school_name_snapshot, recipient_name_snapshot, status, order_ref,
                       correlation_id, subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise)
  select og.id, pr.parent, (select id from pr_kid), pr.school_id,
         (select kitchen_id from school where id = pr.school_id), pr.city_id,
         current_date + 2, 'classroom', now() + interval '1 day', '{}'::jsonb,
         'Revenue School', 'Redeemer', 'pending_payment',
         'PR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)), gen_random_uuid(),
         30000, 0, 0, 30000
    from pr, og
  returning id
) select id from o;

insert into meal_pack_redemption (meal_pack_id, order_id, recipient_id, service_date,
                                  revenue_paise, tax_paise, correlation_id)
select (select id from pr_pack), (select id from pr_order), (select id from pr_kid),
       current_date + 2, 30000, 0, gen_random_uuid();

-- Platform scope for one, kitchen scope for the other. Same permission code.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
values ('a0000000-7e57-0000-0000-0000000000c2', 'orders.view_financials', 'platform', null,
        'a0000000-7e57-0000-0000-0000000000c2');
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
select 'a0000000-7e57-0000-0000-0000000000c3', 'orders.view_financials', 'kitchen'::scope_type,
       (select kitchen_id from school where id = (select school_id from pr)),
       'a0000000-7e57-0000-0000-0000000000c3';

grant select on pr_kid, pr_order to authenticated;

-- =============================================================================
-- Part 2 — platform finance reads the money, and only the money
-- =============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from meal_pack_redemption_money),
  1,
  'platform finance reads the redemption through the view — the split Reports could not make'
);

select is(
  (select revenue_paise from meal_pack_redemption_money),
  30000::bigint,
  'and gets the revenue recognised for that meal'
);

select isnt_empty(
  $$select order_ref from meal_pack_redemption_money where order_ref is not null$$,
  'with the order reference, so a pack-paid meal can be tied to its order'
);

/**
 * The property Andy asked for, asserted where it actually holds.
 *
 * The base table stays shut. If this ever returns a row, the view has become a convenience over
 * an open table rather than the only path, and `recipient_id` is reachable again by anyone who
 * writes a different query.
 */
select is_empty(
  $$select 1 from meal_pack_redemption$$,
  'AND STILL READS NOTHING FROM THE BASE TABLE — the table is shut, so no future query reaches '
  'which child ate. The view is the only path, not the convenient one'
);

reset role;

-- =============================================================================
-- Part 3 — platform scope only
-- =============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;

select is_empty(
  $$select 1 from meal_pack_redemption_money$$,
  'a KITCHEN-scoped orders.view_financials opens nothing — pack revenue is a whole-business '
  'figure, and the operator who holds it for one kitchen has no business reading every school'
);

reset role;

-- =============================================================================
-- Part 4 — the parent's own path is untouched, and still shows them their own child
-- =============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from meal_pack_redemption),
  1,
  'the parent still reads their own redemption on the base table — this migration took nothing '
  'away from them, which is why revoking the column was the wrong instrument'
);

select is(
  (select recipient_id from meal_pack_redemption),
  (select id from pr_kid),
  'including which of THEIR children ate, which they are entitled to know'
);

select is_empty(
  $$select 1 from meal_pack_redemption_money$$,
  'and a parent reads nothing through the back-office view — one fact, two audiences, and only '
  'one path each'
);

reset role;

-- =============================================================================
-- Part 5 — the price of being definer
-- =============================================================================

update app_user set is_disabled = true where id = 'a0000000-7e57-0000-0000-0000000000c2';

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;

select is_empty(
  $$select 1 from meal_pack_redemption_money$$,
  'a disabled account reads nothing. NOTE: this passes with auth_is_live_user() removed too — '
  'auth_can_platform already refuses a disabled account one step earlier — so it asserts the '
  'PROPERTY, not that clause. Said plainly because a comment claiming a test that cannot fail is '
  'worse than no comment'
);

reset role;
update app_user set is_disabled = false where id = 'a0000000-7e57-0000-0000-0000000000c2';

select * from finish();
rollback;
