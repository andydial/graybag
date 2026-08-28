-- =============================================================================
-- one_owner_derived.test.sql — `E02-41`, the pgTAP `E02-39` asked to ship beside the DDL.
--
-- ## Guard 2: no test runs as the real owner
--
-- Andy set that guard because the failure has already happened once — he diagnosed the parent
-- screens holding 31 grants, and the screens looked fine because his own account could see
-- everything. An implicit superuser makes that permanent and invisible.
--
-- So every assertion below installs a **throwaway** owner inside a savepoint and rolls it back.
-- Nothing here ever impersonates `anuragdial@gmail.com`, and on a local or CI database that
-- account does not exist at all — `0081` installs an owner only on production, because zero
-- owners is a defined state meaning "nobody is owner". The rest of the suite therefore keeps
-- proving the policies themselves, not the short-circuit around them.
--
-- ## The assertion the proposal did not specify, and the one that matters most
--
-- Part 3. `E02-39`'s sharpest decision is that **owner derives permissions, never relationships**:
-- the short-circuit must not reach `auth_can_reach_recipient`, because doing so would make one
-- account the implicit guardian of every child in the system, reading every allergy note on the
-- one table whose whole design is that access follows a link somebody actually made.
--
-- A test that only proved "the owner can do things" would pass identically with that hole in it.
-- This file asserts the boundary directly: with an owner installed, a child they have no
-- guardian_link to is still unreachable.
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

-- -----------------------------------------------------------------------------------------------
-- Fixtures. `7e57` in the second group, per this suite's namespace rule (`E02-24`).
-- -----------------------------------------------------------------------------------------------

insert into auth.users (id) values
  ('a0000000-7e57-0000-0000-0000000000f1'),   -- the throwaway owner: holds NO grants
  ('a0000000-7e57-0000-0000-0000000000f2');   -- an unrelated parent, with a child
insert into app_user (id, email, first_name) values
  ('a0000000-7e57-0000-0000-0000000000f1', 'owner-probe@example.test', 'Probe'),
  ('a0000000-7e57-0000-0000-0000000000f2', 'other-parent@example.test', 'Other')
on conflict (id) do update set email = excluded.email;

-- A child belonging to the OTHER parent. The owner has no guardian_link to them, and must not
-- acquire one by being the owner.
create temporary table ow_kid as
select (create_recipient(
          p_guardian_user_id => 'a0000000-7e57-0000-0000-0000000000f2',
          p_first_name => 'Someone', p_last_name => null,
          p_school_id => (select id from school where is_active and onboarded_at is not null
                          order by name limit 1),
          p_class_label => '4', p_section_label => 'B',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

-- The boundary assertions in Part 3 read this while impersonating, and a temp table is not
-- readable by `authenticated` without it. Granting select on the fixture, not on anything real.
grant select on ow_kid to authenticated;

-- =============================================================================
-- Part 0 — the harness, before anything is trusted
-- =============================================================================

select is(
  (select count(*)::int from platform_owner),
  0,
  'no owner is installed on this database — so every assertion below is about a throwaway one'
);

-- Impersonate the probe, who holds nothing.
select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select auth.uid()),
  'a0000000-7e57-0000-0000-0000000000f1'::uuid,
  'harness: auth.uid() really is the probe, so a later "denied" means something'
);

select ok(
  not auth_can_platform('orders.view'),
  'BEFORE: the probe holds no grants and is denied — the baseline the short-circuit changes'
);

select ok(not auth_is_owner(), 'BEFORE: the probe is not the owner');

reset role;

-- =============================================================================
-- Part 1 — the short-circuit, with a throwaway owner
-- =============================================================================

savepoint owner_probe;

insert into platform_owner (only_one, user_id, reason)
values (true, 'a0000000-7e57-0000-0000-0000000000f1', 'pgTAP probe — rolled back')
on conflict (only_one) do update set user_id = excluded.user_id, reason = excluded.reason;

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;

select ok(
  auth_can_platform('orders.view'),
  'the owner passes a permission check that denied them a moment ago'
);

select ok(
  auth_can_platform('a.permission.that.does.not.exist'),
  'and passes one for a permission NOBODY was ever granted — which is what "by construction" '
  'means, and the whole point: a new permission is never something Andy has to ask for'
);

select ok(auth_is_owner(), 'auth_is_owner() is true for the owner');
select ok(auth_is_back_office(), 'the owner counts as back office, so reference reads widen');
select ok(auth_has_any_grant('orders.view'), 'and passes auth_has_any_grant');

-- =============================================================================
-- Part 2 — the owner is still an account, not an exception to being switched off
-- =============================================================================

reset role;
update app_user set is_disabled = true where id = 'a0000000-7e57-0000-0000-0000000000f1';

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;

select ok(
  not auth_can_platform('orders.view'),
  'A DISABLED OWNER HOLDS NOTHING — the short-circuit respects is_disabled exactly as a grant '
  'does, so there is no account that cannot be switched off'
);
select ok(not auth_is_owner(), 'and auth_is_owner() goes false with them');

reset role;
update app_user set is_disabled = false where id = 'a0000000-7e57-0000-0000-0000000000f1';

-- =============================================================================
-- Part 3 — THE BOUNDARY. Owner derives permissions, never relationships.
--
-- `E02-39`: extending ownership into the recipient functions "would silently make one account the
-- guardian of every child in the system: it would read every allergy note and every free-text
-- medical detail, on a table whose whole design is that access follows a link somebody actually
-- created." Andy, approving: *"convenience is not a lawful basis."*
--
-- These four are the reason this file exists. They fail the moment anyone adds the owner term to
-- `auth_can_reach_recipient` and friends — which is a change that would look like a bug fix.
-- =============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;

select ok(
  not auth_can_reach_recipient((select id from ow_kid)),
  'THE OWNER CANNOT REACH A CHILD THEY HAVE NO GUARDIAN LINK TO — reaching a child is a '
  'relationship, not a permission (non-negotiable #4)'
);

select ok(
  not auth_can_manage_recipient((select id from ow_kid)),
  'the owner cannot MANAGE somebody else’s child'
);

select ok(
  not auth_can_order_for_recipient((select id from ow_kid)),
  'the owner cannot ORDER for somebody else’s child'
);

select is_empty(
  format($$select 1 from recipient_allergen where recipient_id = %L$$, (select id from ow_kid)),
  'and reads no allergen row for that child — the tier-S data this boundary exists to protect'
);

reset role;

-- =============================================================================
-- Part 4 — changed visibly
-- =============================================================================

select isnt_empty(
  $$select 1 from platform_owner_history
     where new_user_id = 'a0000000-7e57-0000-0000-0000000000f1'$$,
  'installing an owner writes a history row, by trigger — difficulty is not visibility'
);

select throws_ok(
  $$insert into platform_owner (only_one, user_id, reason)
    values (false, 'a0000000-7e57-0000-0000-0000000000f2', 'a second owner')$$,
  '23514',
  null,
  'A SECOND OWNER IS IMPOSSIBLE AT THE STORAGE LAYER — the check constraint refuses, rather '
  'than a convention that holds until somebody forgets it'
);

rollback to savepoint owner_probe;

-- =============================================================================
-- Part 5 — after the probe, nothing is left behind
-- =============================================================================

select is(
  (select count(*)::int from platform_owner),
  0,
  'the probe left no owner behind — no test runs as an owner beyond its own savepoint'
);

-- Guard 1, asserted as a property so it keeps holding on production, where a row DOES exist.
-- Vacuous here by design: locally there is no owner, and the row that matters is the one applied
-- to production by `0081`.
select ok(
  not exists (select 1 from platform_owner where user_id::text like '%-7e57-%'),
  'no seeded test persona is ever the owner (Guard 1)'
);

select * from finish();
rollback;
