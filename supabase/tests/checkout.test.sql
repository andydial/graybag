-- =============================================================================
-- checkout.test.sql — E05-09 / E05-12 / E05-13, docs/order-lifecycle.md §8.2.
--
-- Every guard in §8.2 gets a test that makes it fire, and the happy path gets a test that
-- proves it does not. A suite of refusals passes just as well on a checkout that refuses
-- everything, so the first section here is the one that stops that.
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

-- -----------------------------------------------------------------------------
-- Fixtures, resolved from the seed rather than hardcoded, so this suite survives the
-- seed being renumbered.
-- -----------------------------------------------------------------------------
create temporary table t_ctx as
select gl.user_id      as customer_id,
       gl.recipient_id as recipient_id,
       r.school_id     as school_id,
       mi.id           as menu_item_id,
       mi.price_paise  as unit_price
  from guardian_link gl
  join recipient r        on r.id = gl.recipient_id and r.is_active
  join menu_assignment ma on ma.school_id = r.school_id and ma.revoked_at is null
  join menu m             on m.id = ma.menu_id and m.status = 'active'
  join menu_item mi       on mi.menu_id = m.id and mi.is_active
  join dish d             on d.id = mi.dish_id and d.is_active
 where gl.can_order and gl.revoked_at is null
 limit 1;

create function t_line(p_days int default 3, p_qty int default 2, p_item uuid default null)
returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object(
    'recipient_id', (select recipient_id from t_ctx),
    'service_date', (current_date + p_days)::text,
    'menu_item_id', coalesce(p_item, (select menu_item_id from t_ctx)),
    'quantity',     p_qty));
$$;

-- =============================================================================
-- 1. The happy path. Without this, every refusal below is vacuous.
-- =============================================================================

create temporary table t_ok as
select create_checkout((select customer_id from t_ctx), 'k-happy', 'h1', null, t_line()) as r;

select is((select (r->>'status') from t_ok), 'pending_payment',
          '§8.2: a valid cart becomes an order_group at pending_payment');

select ok((select (r->>'order_group_id') is not null from t_ok),
          '§8.2 step 9: the group exists and its id comes back');

select is((select jsonb_array_length(r->'orders') from t_ok), 1,
          '§7.3: one recipient, one service date, one break — one "order" row');

select is(
  (select count(*)::int from order_line ol
     join "order" o on o.id = ol.order_id
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  1,
  '§8.2 step 9: the order_line rows are written');

-- E05-07 shipped assert_cutoff_open and its proof; until now nothing called it.
select ok(
  (select o.cutoff_at is not null from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid limit 1),
  'D5: cutoff_at is SNAPSHOTTED onto the order, so an admin moving the cutoff at 9pm cannot retroactively invalidate an order placed at 8pm');

-- =============================================================================
-- 2. The money. G1/G2 — per line, per component, half-up, each computed independently.
-- =============================================================================

select is(
  (select o.subtotal_paise from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  (select unit_price * 2 from t_ctx),
  'G1: the line subtotal is the SERVER''s price times quantity, never the client''s');

select is(
  (select o.tax_cgst_paise from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  (select o.tax_sgst_paise from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  'M2/G2: CGST and SGST are equal here because the rates are — but each is computed independently from the taxable value, never 5% halved');

select is(
  (select o.total_paise from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  (select o.subtotal_paise + o.tax_cgst_paise + o.tax_sgst_paise from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  'SC2: prices are GST-EXCLUSIVE — tax is added on top, so total = subtotal + cgst + sgst');

select is(
  (select og.payable_paise from order_group og
    where og.id = ((select r->>'order_group_id' from t_ok))::uuid),
  (select sum(o.total_paise)::bigint from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  'the group total equals the sum over its member orders');

-- =============================================================================
-- 3. Snapshots. The legacy defect this schema exists to prevent.
-- =============================================================================

select ok(
  (select ol.dish_name_snapshot is not null and ol.dish_name_snapshot <> ''
     from order_line ol join "order" o on o.id = ol.order_id
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid limit 1),
  'E02-04: the dish NAME is snapshotted — legacy Dish_In_Order snapshotted the price and not the name, so editing a dish rewrote the history of every order that contained it');

select ok(
  (select o.recipient_name_snapshot is not null from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  '§13.3: the recipient name is snapshotted, so the packing list stays right if the parent renames or removes the child');

select ok(
  (select o.config_snapshot ? 'cgst_rate_bps' from "order" o
    where o.order_group_id = ((select r->>'order_group_id' from t_ok))::uuid),
  'D5: the whole resolved config is snapshotted, so a report run next year reads the rates that actually applied');

-- =============================================================================
-- 4. Idempotency. E05-12.
-- =============================================================================

select is(
  (create_checkout((select customer_id from t_ctx), 'k-happy', 'h1', null, t_line()))->>'order_group_id',
  (select r->>'order_group_id' from t_ok),
  'E05-12: the same key and the same cart returns the SAME group — two devices submitting one cart do not create two orders');

select is(
  (create_checkout((select customer_id from t_ctx), 'k-happy', 'h1', null, t_line()))->>'replayed',
  'true',
  'E05-12: and it says so, so the caller can tell a replay from a new order');

select throws_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-happy', 'DIFFERENT', null, t_line()) $$,
  'P0001',
  null,
  'E05-12: the same key with a DIFFERENT cart is an error, not a replay — returning the first cart would confirm an order the caller never sent');

-- =============================================================================
-- 5. Authorization. §8.2 step 5 — the one guard RLS does not also enforce.
-- =============================================================================

select throws_ok(
  format($$ select create_checkout(%L::uuid, 'k-auth', 'h', null, t_line()) $$,
         '00000000-7e57-0000-0000-0000000000ff'),
  'P0001',
  null,
  '§8.2 step 5: a caller with no guardian_link cannot order for the recipient. This function runs as service_role, so RLS is NOT a second line of defence here — it is the only line');

-- Revoking the link revokes the ability, immediately.
update guardian_link set can_order = false
 where user_id = (select customer_id from t_ctx) and recipient_id = (select recipient_id from t_ctx);

select throws_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-revoked', 'h', null, t_line()) $$,
  'P0001',
  null,
  '§8.2 step 5: can_order = false is refused — the check is on the live link, not on a cached claim');

update guardian_link set can_order = true
 where user_id = (select customer_id from t_ctx) and recipient_id = (select recipient_id from t_ctx);

-- =============================================================================
-- 6. The window and the cutoff. §8.2 step 6.
-- =============================================================================

select throws_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-far', 'h', null, t_line(3650)) $$,
  'P0001',
  null,
  '§8.2 step 6: a service_date beyond max_advance_order_days is refused');

select throws_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-past', 'h', null, t_line(-1)) $$,
  'P0001',
  null,
  '§8.2 step 6: yesterday is refused — the cutoff for a past date has necessarily passed');

-- =============================================================================
-- 7. Availability. §8.2 step 4.
-- =============================================================================

select throws_ok(
  format($$ select create_checkout((select customer_id from t_ctx), 'k-bad-item', 'h', null,
                                   t_line(3, 1, %L::uuid)) $$,
         '00000000-7e57-0000-0000-0000000000aa'),
  'P0001',
  null,
  '§8.2 step 4: a menu item that is not on that school''s live menu is refused — the client''s cart is revalidated against live data, never trusted');

-- Retiring the menu makes every item on it unavailable, immediately.
update menu set status = 'retired'
 where id in (select ma.menu_id from menu_assignment ma
               join recipient r on r.school_id = ma.school_id
              where r.id = (select recipient_id from t_ctx) and ma.revoked_at is null);

select throws_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-retired', 'h', null, t_line()) $$,
  'P0001',
  null,
  '§8.2 step 4: retiring the menu refuses the checkout — an unpublished menu cannot be ordered from');

update menu set status = 'active'
 where id in (select ma.menu_id from menu_assignment ma
               join recipient r on r.school_id = ma.school_id
              where r.id = (select recipient_id from t_ctx) and ma.revoked_at is null);

-- =============================================================================
-- 8. L7 / [OL-06] — the price changed between building the cart and paying.
-- =============================================================================

select throws_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-price', 'h', 1::bigint, t_line()) $$,
  'P0001',
  null,
  'L7 / [OL-06]: a total that differs from what the customer was shown ABORTS. The customer is never charged an amount they were not shown');

select lives_ok(
  $$ select create_checkout((select customer_id from t_ctx), 'k-price-ok', 'h',
       (select (unit_price * 2) + round((unit_price * 2)::numeric * 250 / 10000) * 2 from t_ctx)::bigint,
       t_line()) $$,
  'L7: an expected total that MATCHES the server is accepted — the guard is a comparison, not a ban on sending one');

-- =============================================================================
-- 9. Nothing partial survives a refusal.
-- =============================================================================

select is(
  (select count(*)::int from order_group where idempotency_key in
     ('k-far','k-past','k-bad-item','k-retired','k-price','k-auth','k-revoked')),
  0,
  '§8.2 step 1/11: every refusal rolls back the whole transaction — no half-written group, no orphan order, no stranded idempotency row');

-- =============================================================================
-- 10. The join nobody was asserting — `E05-16`, migration `0017`.
--
-- Every layer of the order path was tested and every layer passed, and the app still could
-- not place an order: `create_checkout` identifies a line by `menu_item_id`, the only menu
-- the app can read is `public_menu`, and that view joined `menu_item` and never selected
-- its id. Two correct halves and an untested join between them — the same shape as `E05-16`
-- itself.
--
-- These assert the *contract between the two*, which is the thing that was missing rather
-- than any one side of it. They belong here, in the checkout's own suite, because it is the
-- checkout's requirement that makes the column load-bearing.
-- =============================================================================

select has_column('public', 'public_menu', 'menu_item_id',
  'E05-16: the menu the app reads carries the id the checkout requires. Without it there is '
  'no sequence of calls a client can make that produces a valid order line, and the failure '
  'is a menu that renders perfectly and refuses every add to cart');

select is_empty(
  $$ select pm.dish_id::text
       from public_menu pm
       left join menu_item mi on mi.id = pm.menu_item_id and mi.is_active
      where mi.id is null $$,
  'and every one of them resolves to a live menu_item — an id that does not join is worse '
  'than a missing column, because it fails at checkout instead of at the boundary');

select is_empty(
  $$ select pm.dish_id::text from public_menu pm where pm.menu_item_id = pm.dish_id $$,
  'menu_item_id is NOT the dish id. A dish is the food; a menu_item is that dish on a '
  'particular menu at a price, and ordering by dish id would mean the server choosing which '
  'price the customer had been shown');

select * from finish();
rollback;
