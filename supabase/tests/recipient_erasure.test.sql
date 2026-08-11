-- =============================================================================
-- recipient_erasure.test.sql — `E20-30`, `E20-44`, migration `0026`.
--
-- Removing a child now erases the child. This suite asserts the two halves of the retention
-- rule published in privacy policy notice version 2, because they pull in opposite directions
-- and a change that satisfies one while breaking the other looks like a pass:
--
--   1. A child's name, class, section and allergy details are GONE when the guardian link ends.
--   2. Every order, invoice and ledger reference SURVIVES — seven years, statutory.
--
-- The second is what makes this hard. `D15` forbids hard-deleting a row an invoice depends on,
-- so erasure is anonymise-in-place, and the temptation is to prove only that the name changed.
-- A `delete from recipient` would pass that and break the books.
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
create temporary table e_ctx as
select (select id from app_user limit 1) as guardian_id,
       (select id from school where is_active and onboarded_at is not null
          and offboarded_at is null order by name limit 1) as school_a,
       (select id from allergen order by code limit 1)     as allergen_a,
       (select id from allergen order by code desc limit 1) as allergen_b;

select ok((select allergen_a <> allergen_b from e_ctx),
          'the fixture has two different allergens, or the tier-S assertions mean nothing');

-- A child WITH health data. `create_recipient` takes the consent flag, and supplying allergens
-- without it is refused — so this fixture also proves the consent path still admits them.
create temporary table e_kid as
select create_recipient((select guardian_id from e_ctx), 'Aarav', 'Erasuretest',
                        (select school_a from e_ctx), '5', 'B',
                        (select array[allergen_a, allergen_b] from e_ctx),
                        'Carries an epipen', true, '{}'::jsonb) as r;

create temporary table e_id as
select ((select r->>'recipient_id' from e_kid))::uuid as recipient_id;

-- =============================================================================
-- 0. The fixture really does hold what we are about to claim was erased.
--
-- Without this, every assertion below passes just as well against a child who never had
-- allergies — which is the shape of a test that proves nothing.
-- =============================================================================

select is((select count(*)::int from recipient_allergen
            where recipient_id = (select recipient_id from e_id)),
          2, 'the child starts with two allergens on file');

select is((select allergy_note from recipient where id = (select recipient_id from e_id)),
          'Carries an epipen', 'and a free-text allergy note');

select is((select first_name from recipient where id = (select recipient_id from e_id)),
          'Aarav', 'and a name');

-- =============================================================================
-- 1. The erasure.
-- =============================================================================

select lives_ok(
  format($$ select deactivate_recipient(%L::uuid, %L::uuid) $$,
         (select guardian_id from e_ctx), (select recipient_id from e_id)),
  'E05-44: a guardian who may manage the child can remove them');

-- Tier S — health data about a minor. No statutory basis exists for keeping it, so it goes
-- outright rather than being anonymised (dpdp-compliance.md 6.2).
select is((select count(*)::int from recipient_allergen
            where recipient_id = (select recipient_id from e_id)),
          0, 'E20-30: every recipient_allergen row is DELETED, not soft-deleted');

select ok((select allergy_note is null from recipient
            where id = (select recipient_id from e_id)),
          'E20-30: the free-text allergy note is cleared — it is the same health data in prose');

-- Tier P — the identifying columns.
select ok((select last_name is null and class_label is null and section_label is null
             and school_class_id is null
             from recipient where id = (select recipient_id from e_id)),
          'E20-30: last name, class, section and the class reference are all cleared');

select isnt((select first_name from recipient where id = (select recipient_id from e_id)),
            'Aarav',
            'E20-30: the first name no longer identifies the child. This is the assertion the '
            'privacy policy sentence rests on — "deleted when the guardian link ends"');

select ok((select anonymised_at is not null from recipient
            where id = (select recipient_id from e_id)),
          'anonymised_at is stamped — 0001 added the column for this and nothing set it until now');

select ok((select not is_active from recipient where id = (select recipient_id from e_id)),
          'and the row is inactive, so it cannot be ordered for');

-- The links, for every guardian rather than only the one who asked.
select is((select count(*)::int from guardian_link
            where recipient_id = (select recipient_id from e_id)
              and revoked_at is null),
          0, 'every guardian_link is revoked — the child leaves both parents'' lists');

-- =============================================================================
-- 2. The half that is easy to break while making the half above pass.
--
-- `D15`: the row must SURVIVE. An invoice whose foreign key has vanished is a broken statutory
-- record, and the books are kept for seven years under GST and the Companies Act.
-- =============================================================================

select is((select count(*)::int from recipient where id = (select recipient_id from e_id)),
          1, 'D15: the recipient ROW survives. A hard delete would satisfy every assertion '
             'above and break every invoice that references it');

select ok((select deleted_at is null from recipient where id = (select recipient_id from e_id)),
          'and it is anonymised rather than soft-deleted: an anonymised row is a live financial '
          'reference, a deleted one is a dangling key waiting to be cascaded away');

select ok((select school_id is not null from recipient where id = (select recipient_id from e_id)),
          'school_id is retained — it is not personal data about the child, and the order '
          'history needs to know which kitchen made the food');

-- =============================================================================
-- 3. The guard, which now protects data rather than a packing list.
--
-- In `0025` removal was reversible in principle; the row still held everything. Now this is the
-- only thing between a mistaken tap and a child's details being gone while their lunch is still
-- on Friday's list.
-- =============================================================================

create temporary table e_kid2 as
select create_recipient((select guardian_id from e_ctx), 'Meera', 'Guardtest',
                        (select school_a from e_ctx), '3', 'A',
                        (select array[allergen_a] from e_ctx), null, true, '{}'::jsonb) as r;

create temporary table e_id2 as
select ((select r->>'recipient_id' from e_kid2))::uuid as recipient_id;

-- A paid, undelivered order. Built the same way `recipient_school.test.sql` builds one — the
-- snapshot columns are `not null` because an order records the child **as they were**, which is
-- exactly why erasing the live row afterwards does not rewrite the order.
insert into order_group (id, customer_user_id, idempotency_key, city_id, status)
select '00000000-7e57-0000-0000-00000000e603',
       (select guardian_id from e_ctx), 'e0603-fixture-7e57', s.city_id, 'paid'
  from school s where s.id = (select school_a from e_ctx);

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id,
                     recipient_id, school_id, kitchen_id, city_id, service_date,
                     delivery_mode, cutoff_at, status,
                     config_snapshot, school_name_snapshot, recipient_name_snapshot)
select '00000000-7e57-0000-0000-00000000e602',
       '00000000-7e57-0000-0000-00000000e603', 'GB-7E57-E602', gen_random_uuid(),
       (select guardian_id from e_ctx), (select recipient_id from e_id2),
       s.id, s.kitchen_id, s.city_id, current_date + 7,
       'classroom', now() + interval '6 days', 'paid',
       '{}'::jsonb, s.name, 'Meera Guardtest'
  from school s where s.id = (select school_a from e_ctx);

select throws_ok(
  format($$ select deactivate_recipient(%L::uuid, %L::uuid) $$,
         (select guardian_id from e_ctx), (select recipient_id from e_id2)),
  'P0001',
  null,
  'an undelivered order still refuses removal — and now that refusal is protecting the '
  'child''s data, not just the packing list');

select is((select count(*)::int from recipient_allergen
            where recipient_id = (select recipient_id from e_id2)),
          1, 'and nothing was erased on the way to that refusal: the transaction rolled back');

-- =============================================================================
-- 4. Authorization is unchanged by `0026`.
-- =============================================================================

insert into auth.users (id) values ('a0000000-7e57-0000-0000-00000000e601')
on conflict (id) do nothing;
insert into app_user (id, phone_e164, email, first_name)
values ('a0000000-7e57-0000-0000-00000000e601', '+919777000601',
        'stranger-e0601@example.test', 'Stranger')
on conflict (id) do update set email = excluded.email;

select throws_ok(
  format($$ select deactivate_recipient(%L::uuid, %L::uuid) $$,
         'a0000000-7e57-0000-0000-00000000e601', (select recipient_id from e_id2)),
  'P0001',
  null,
  'D10: a user with no guardian_link cannot erase somebody else''s child — which is a much '
  'worse thing to be able to do than it was before this migration');

select * from finish();
rollback;
