-- =============================================================================
-- recipient_erasure_commits.test.sql — erasure must survive COMMIT, not just the function call.
-- `E20-56`
--
-- `recipient_erasure.test.sql` calls `deactivate_recipient`, asserts fifteen things about what it
-- did, and passes. On production the same call returns **500** and erases nothing.
--
-- Both are true, and the gap between them is this:
--
--   **A DEFERRABLE INITIALLY DEFERRED constraint trigger fires at COMMIT. Every pgTAP file in
--   this suite ends in `rollback`, so it never fires.**
--
-- `guardian_link_keeps_recipient_reachable` enforces `D10` and is deferred. `deactivate_recipient`
-- revokes every guardian_link, which violates it — at commit, after the last assertion has
-- already passed. The suite was structurally incapable of seeing it, and so was every other
-- deferred constraint in the schema.
--
-- `set constraints all immediate` closes that. It forces the deferred triggers to fire *at that
-- point*, inside the transaction, so a rollback-based test observes exactly what a real commit
-- would do. Any future test touching a deferred constraint should end this way.
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

-- A parent and a child of their own, built through the real entry point so the guardian_link is
-- exactly the one the application creates.
insert into auth.users (id) values ('a0000000-7e57-0000-0000-0000000006f1');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-0000000006f1', 'erasure-commit@example.test', 'Erasure')
on conflict (id) do update set email = excluded.email, first_name = excluded.first_name;

create temporary table ec_ctx as
select (create_recipient(
          p_guardian_user_id => 'a0000000-7e57-0000-0000-0000000006f1',
          p_first_name       => 'Erasable',
          p_last_name        => null,
          p_school_id        => (select id from school
                                  where is_active and onboarded_at is not null and offboarded_at is null
                                  order by name limit 1),
          p_class_label      => '5',
          p_section_label    => 'A',
          p_allergen_ids     => '{}',
          p_allergy_note     => null,
          p_allergen_consent => false,
          p_is_self          => false,
          p_capture_context  => '{"screen":"erasure-commit-test"}'::jsonb
        ) ->> 'recipient_id')::uuid as recipient_id;

select isnt((select recipient_id from ec_ctx), null,
            'fixture: a child exists, created through create_recipient');

select is(
  (select count(*)::int from guardian_link
    where recipient_id = (select recipient_id from ec_ctx) and revoked_at is null),
  1,
  'fixture: with exactly one active guardian_link, which is what D10 requires of a live child');

-- =============================================================================
-- 1. The erasure itself.
-- =============================================================================

select lives_ok(
  format($$ select deactivate_recipient('a0000000-7e57-0000-0000-0000000006f1'::uuid, %L::uuid) $$,
         (select recipient_id from ec_ctx)),
  'deactivate_recipient returns without error — which is as far as the original suite could see');

select is(
  (select count(*)::int from guardian_link
    where recipient_id = (select recipient_id from ec_ctx) and revoked_at is null),
  0,
  'and it revoked every guardian_link, so the child leaves every guardian''s list');

select ok(
  (select anonymised_at is not null from recipient where id = (select recipient_id from ec_ctx)),
  'and anonymised the row rather than deleting it (D15 — an invoice still references it)');

select ok(
  (select deleted_at is null from recipient where id = (select recipient_id from ec_ctx)),
  'and deliberately did NOT set deleted_at, which recipient_erasure.test.sql pins for the same '
  'reason: an anonymised row is a live financial reference, a soft-deleted one is a dangling key');

-- =============================================================================
-- 2. THE ASSERTION THE OLD SUITE COULD NOT MAKE.
--
-- Everything above passed before `0062` too. This is the line that failed — at COMMIT, on
-- production, as a 500 with nothing erased.
-- =============================================================================

select lives_ok(
  $$ set constraints all immediate $$,
  'the DEFERRED constraints hold at commit — before 0062 this raised "recipient has no active '
  'guardian_link (D10)" and rolled the entire erasure back, which is why a parent could not '
  'delete their child at all');

-- And the rule still bites where it should: a LIVE child must keep a guardian.
--
-- Back to deferred first. `set constraints all immediate` above is not a one-shot — it changes
-- the mode for the rest of the transaction, so the revoking `update` below would fire the trigger
-- on the spot, outside pgTAP's exception handler, and abort everything.
set constraints all deferred;

insert into auth.users (id) values ('a0000000-7e57-0000-0000-0000000006f2');
insert into app_user (id, email, first_name)
values ('a0000000-7e57-0000-0000-0000000006f2', 'still-live@example.test', 'Live')
on conflict (id) do update set email = excluded.email, first_name = excluded.first_name;

create temporary table ec_live as
select (create_recipient(
          p_guardian_user_id => 'a0000000-7e57-0000-0000-0000000006f2',
          p_first_name       => 'StillHere',
          p_last_name        => null,
          p_school_id        => (select id from school
                                  where is_active and onboarded_at is not null and offboarded_at is null
                                  order by name limit 1),
          p_class_label      => '6',
          p_section_label    => 'B',
          p_allergen_ids     => '{}',
          p_allergy_note     => null,
          p_allergen_consent => false,
          p_is_self          => false,
          p_capture_context  => '{"screen":"erasure-commit-test"}'::jsonb
        ) ->> 'recipient_id')::uuid as recipient_id;

update guardian_link set revoked_at = now()
 where recipient_id = (select recipient_id from ec_live) and revoked_at is null;

select throws_matching(
  $$ set constraints all immediate $$,
  'no active guardian_link',
  'D10 is NOT weakened: orphaning a live, un-anonymised child still fails at commit. 0062 '
  'exempted the terminal states only');

-- `throws_matching` catches in a subtransaction, so the outer one is still live here and the
-- plan closes normally.
select * from finish();
rollback;
