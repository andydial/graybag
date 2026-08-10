-- =============================================================================
-- recipient_school.test.sql — `E05-02`, migration `0016`.
--
-- Changing school is not an edit to a profile field. It moves which kitchen makes the food,
-- which cutoff applies, which menu is priced and which packing list a child's name appears
-- on — so the properties worth asserting are the ones a column cannot enforce: who may do
-- it, where they may move to, what happens to the class that belonged to the old school,
-- and what happens to food that has already been paid for.
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
-- Fixtures. Every id carries 7e57 in its second group (`E02-24`).
-- -----------------------------------------------------------------------------
create temporary table s_ctx as
select (select id from app_user limit 1)                                  as guardian_id,
       (select id from school where is_active and onboarded_at is not null
          and offboarded_at is null order by name limit 1)                 as school_a,
       (select id from school where is_active and onboarded_at is not null
          and offboarded_at is null order by name desc limit 1)            as school_b;

select ok((select school_a <> school_b from s_ctx),
          'the fixture has two different onboarded schools, or nothing below means anything');

-- A second account, with no link to the child. This is the one that must be refused.
--
-- `auth.users` first — `app_user.id` references it, and only `id` is supplied because every
-- other column in the gotrue schema is nullable or defaulted and touching more of it would
-- couple this suite to a gotrue version. Same convention as `authorization.test.sql`.
insert into auth.users (id) values ('a0000000-7e57-0000-0000-00000000e501');
-- `0018` added a trigger on `auth.users`, so these rows already exist by the time we reach
-- here — the fixture no longer creates the account, it *describes* it.
insert into app_user (id, phone_e164, email, first_name)
values ('a0000000-7e57-0000-0000-00000000e501', '+919777000502',
        'stranger-e0502@example.test', 'Stranger')
on conflict (id) do update set
  phone_e164 = excluded.phone_e164, email = excluded.email,
  first_name = excluded.first_name;

create temporary table s_kid as
select create_recipient((select guardian_id from s_ctx), 'Ishaan', 'Movertest',
                        (select school_a from s_ctx), '4', 'C',
                        '{}'::uuid[], null, false, '{}'::jsonb) as r;

create temporary table s_id as
select ((select r->>'recipient_id' from s_kid))::uuid as recipient_id;

-- =============================================================================
-- 1. The happy path.
-- =============================================================================

select lives_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, '6', 'B') $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id),
         (select school_b from s_ctx)),
  'E05-02: a guardian who may manage the child can move them to another onboarded school');

select is(
  (select school_id from recipient where id = (select recipient_id from s_id)),
  (select school_b from s_ctx),
  'and the school is what was asked for');

select is(
  (select class_label from recipient where id = (select recipient_id from s_id)),
  '6',
  'and the class came with it — a child changing school is usually changing year too');

select ok(
  (select school_class_id is null from recipient where id = (select recipient_id from s_id)),
  'school_class_id is CLEARED. A school_class row belongs to one school, so carrying it '
  'across points at the wrong school''s class — and the FK is to school_class, not to the pair, '
  'so nothing in the schema would have caught it');

-- =============================================================================
-- 2. Authorization. `D10`: guardian_link is the only path, never created_by_user_id.
-- =============================================================================

select throws_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, null, null) $$,
         'a0000000-7e57-0000-0000-00000000e501',
         (select recipient_id from s_id),
         (select school_a from s_ctx)),
  'P0001',
  null,
  'D10: a user with no guardian_link cannot move somebody else''s child');

-- `can_manage` and `can_order` are different permissions and this is where it shows: a second
-- parent who may buy lunch is not necessarily the one who may move the child to another school.
update guardian_link set can_manage = false
 where recipient_id = (select recipient_id from s_id)
   and user_id = (select guardian_id from s_ctx);

select throws_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, null, null) $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id),
         (select school_a from s_ctx)),
  'P0001',
  null,
  'can_order is not can_manage — a link without can_manage cannot change the school');

update guardian_link set can_manage = true
 where recipient_id = (select recipient_id from s_id)
   and user_id = (select guardian_id from s_ctx);

-- A revoked link is not a link. Links are revoked rather than deleted so the audit trail
-- survives, which means every authorization test has to say `revoked_at is null` and this is
-- the one that proves it does.
update guardian_link set revoked_at = now()
 where recipient_id = (select recipient_id from s_id)
   and user_id = (select guardian_id from s_ctx);

select throws_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, null, null) $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id),
         (select school_a from s_ctx)),
  'P0001',
  null,
  'a REVOKED guardian_link is not a guardian_link — links are revoked, never deleted, so '
  'every check must test revoked_at and this is the one that proves it');

update guardian_link set revoked_at = null
 where recipient_id = (select recipient_id from s_id)
   and user_id = (select guardian_id from s_ctx);

-- =============================================================================
-- 3. Destination. Onboarded schools only (`P1`).
-- =============================================================================

select throws_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid,
                                           '00000000-7e57-0000-0000-0000000000dd'::uuid,
                                           null, null) $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id)),
  'P0001',
  null,
  'E05-02: a school we do not serve is refused — a child at a school with no kitchen cannot be fed');

-- =============================================================================
-- 4. Food already paid for. `D19`.
-- =============================================================================

-- Built by hand rather than through `create_checkout`: what is under test is the *presence*
-- of an undelivered order, not how it came to exist, and going through checkout would drag
-- cutoffs, menu versions and pricing into a test about school membership.
insert into order_group (id, customer_user_id, idempotency_key, city_id, status)
select '00000000-7e57-0000-0000-00000000e503',
       (select guardian_id from s_ctx), 'e0502-fixture-7e57', s.city_id, 'paid'
  from school s where s.id = (select school_b from s_ctx);

-- The snapshot columns are `not null` on purpose: an order records the school and the child
-- **as they were when it was placed**, which is the whole reason changing school afterwards
-- cannot retroactively move a lunch. They are filled here for the same reason they exist.
insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id,
                     recipient_id, school_id, kitchen_id, city_id, service_date,
                     delivery_mode, cutoff_at, status,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot)
select '00000000-7e57-0000-0000-00000000e502',
       '00000000-7e57-0000-0000-00000000e503', 'GB-7E57-E502', gen_random_uuid(),
       (select guardian_id from s_ctx), (select recipient_id from s_id),
       s.id, s.kitchen_id, s.city_id, current_date + 7,
       'classroom', now() + interval '6 days', 'paid',
       '{}'::jsonb, s.name, 'Ishaan Movertest'
  from school s where s.id = (select school_b from s_ctx);

select throws_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, null, null) $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id),
         (select school_a from s_ctx)),
  'P0001',
  null,
  'D19: the change is REFUSED while an undelivered order exists. "order" snapshots school_id, '
  'so that lunch would be made by the old school''s kitchen and put on its packing list for a '
  'child who has left — the failure lands on the day, on a child, with a bag in the wrong building');

select is(
  (select school_id from recipient where id = (select recipient_id from s_id)),
  (select school_b from s_ctx),
  'and nothing moved — a refusal that half-applied would be worse than either outcome');

-- The same order, delivered, is history and must not block anything.
update "order" set status = 'delivered' where id = '00000000-7e57-0000-0000-00000000e502';

select lives_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, null, null) $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id),
         (select school_a from s_ctx)),
  'a DELIVERED order is history and does not block the change — the test is the status, not '
  'the date, so a paid order for today still blocks while yesterday''s lunch does not');

-- =============================================================================
-- 5. A no-op is success.
-- =============================================================================

select lives_ok(
  format($$ select change_recipient_school(%L::uuid, %L::uuid, %L::uuid, '5', 'A') $$,
         (select guardian_id from s_ctx),
         (select recipient_id from s_id),
         (select school_a from s_ctx)),
  'choosing the school the child is already at is not an error — it is also how a class or '
  'section correction arrives');

select is(
  (select (r->>'changed_school')::boolean from
     (select change_recipient_school((select guardian_id from s_ctx),
                                     (select recipient_id from s_id),
                                     (select school_a from s_ctx), null, null) as r) x),
  false,
  'and the result says so, so the client can stay quiet rather than announcing a move that '
  'did not happen');

select is(
  (select class_label from recipient where id = (select recipient_id from s_id)),
  '5',
  'the class correction landed');

select * from finish();
rollback;
