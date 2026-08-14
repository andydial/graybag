-- =============================================================================
-- policy_reacceptance.test.sql — publishing a new version re-prompts everyone who accepted
-- the old one. `E20-03`, `E20-52`.
--
-- **Andy, 2026-08-15: "that gate has never been exercised for real."** It had not. What existed
-- was `policy.test.ts`, which drives `fetchPendingPolicies` against fixtures — good coverage of
-- the *selection rule* and no evidence at all about the database underneath it. Specifically it
-- could not tell you whether:
--
--   * a parent may read `policy_version` at all under RLS, or only an admin;
--   * the acceptance embed the query depends on is visible to the parent who wrote it;
--   * `user_policy_acceptance` actually refuses a second acceptance of the same version;
--   * a published version can be edited instead of superseded, which would make the whole
--     mechanism decorative.
--
-- This runs the real cycle, as the parent, through RLS: publish v1 → accept → publish v2 →
-- **pending again** → accept v2 → clear.
--
-- The fixture publishes with `blocks_ordering = true`, which **no row in any environment sets
-- today**. That is the point: the gate cannot be exercised by observing production, because
-- production has never turned it on.
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

create temporary table pr_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as parent_a,
       (select id from app_user where deleted_at is null and not is_disabled order by id offset 1 limit 1) as parent_b;
grant select on pr_ctx to authenticated;

-- A policy of our own, so this cannot disturb — or be disturbed by — the two real notices.
insert into policy_document (code, display_name, applies_to)
values ('reacceptance_probe', 'Re-acceptance probe', 'app')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Version 1, published, blocking.
-- ---------------------------------------------------------------------------------------------
create temporary table pr_v1 as
with v as (
  insert into policy_version (policy_code, version, effective_from, published_at, content_md,
                              content_sha256, requires_acceptance, blocks_ordering,
                              summary_of_changes)
  select 'reacceptance_probe', '1', now() - interval '2 days', now() - interval '2 days',
         'v1 body', encode(sha256('v1 body'::bytea), 'hex'), true, true, 'First version'
  returning id
)
select id from v;
grant select on pr_v1 to authenticated;

-- =============================================================================
-- 1. As the parent, through RLS: v1 is pending.
-- =============================================================================

do $$
declare v uuid;
begin
  select parent_a into v from pr_ctx;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

select is((select auth.uid()), (select parent_a from pr_ctx),
          'harness: impersonating parent A, so the reads below mean something');

-- `policy_version_read_published` — a parent who cannot READ the version can never be told to
-- accept it, and the gate would be silently empty for everyone. Not covered anywhere before.
select is(
  (select count(*)::int from policy_version
    where policy_code = 'reacceptance_probe' and published_at is not null),
  1,
  'a parent may read a PUBLISHED version — otherwise the gate is empty for everyone, silently');

-- The query `fetchPendingPolicies` sends, as SQL: published, blocking, in effect, not accepted.
create temporary view pr_pending as
select pv.id, pv.version
  from policy_version pv
 where pv.policy_code = 'reacceptance_probe'
   and pv.published_at is not null
   and pv.blocks_ordering
   and pv.effective_from <= now()
   and not exists (select 1 from user_policy_acceptance a
                    where a.policy_version_id = pv.id and a.user_id = auth.uid());

select is((select count(*)::int from pr_pending), 1,
          'v1 is pending before it is accepted');

-- =============================================================================
-- 2. The parent accepts, as themselves.
-- =============================================================================

insert into user_policy_acceptance (user_id, policy_version_id, source)
select auth.uid(), id, 'app' from pr_v1;

select is((select count(*)::int from pr_pending), 0,
          'and stops being pending once accepted — the gate opens');

-- Append-only with a uniqueness constraint: accepting twice must not be an error a parent sees,
-- and must not write a second row. The api module treats a duplicate as already-accepted, which
-- is only safe if the database really refuses.
select throws_ok(
  $$ insert into user_policy_acceptance (user_id, policy_version_id, source)
     select auth.uid(), id, 'app' from pr_v1 $$,
  '23505', null,
  'accepting the same version twice is refused by the database, not merely by the client');

reset role;

-- =============================================================================
-- 3. A published version cannot be edited. If it could, none of this would mean anything.
-- =============================================================================

select throws_matching(
  format($$ update policy_version set content_md = 'tampered' where id = %L $$,
         (select id from pr_v1)),
  'immutable',
  '§11.2: a PUBLISHED version is immutable — a correction is a new version, or content_sha256 '
  'is proof of nothing');

-- =============================================================================
-- 4. THE ASSERTION ANDY ASKED FOR: version 2 re-prompts the parent who accepted version 1.
-- =============================================================================

create temporary table pr_v2 as
with v as (
  insert into policy_version (policy_code, version, effective_from, published_at, content_md,
                              content_sha256, requires_acceptance, blocks_ordering,
                              summary_of_changes)
  select 'reacceptance_probe', '2', now(), now(),
         'v2 body', encode(sha256('v2 body'::bytea), 'hex'), true, true,
         'The grievance contact is an office rather than a named individual'
  returning id
)
select id from v;
grant select on pr_v2 to authenticated;

do $$
declare v uuid;
begin
  select parent_a into v from pr_ctx;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

select is((select count(*)::int from pr_pending), 1,
          'publishing v2 makes the parent who accepted v1 PENDING AGAIN — the re-acceptance flow');

select is((select version from pr_pending), '2',
          'and it is v2 they are asked for, not v1 again');

-- The rule `fetchPendingPolicies` implements in memory, asserted against the database: only the
-- current version is required. Asking for v1 as well is a bug that looks like diligence.
select is(
  (select count(*)::int from user_policy_acceptance
    where user_id = auth.uid() and policy_version_id = (select id from pr_v1)),
  1,
  'the v1 acceptance is still on the record — append-only, and it is the evidence for the '
  'period it covered');

insert into user_policy_acceptance (user_id, policy_version_id, source)
select auth.uid(), id, 'app' from pr_v2;

select is((select count(*)::int from pr_pending), 0,
          'accepting v2 clears the gate again — the full cycle closes');

-- =============================================================================
-- 5. Scope. One parent's acceptance is not another's.
-- =============================================================================

select is(
  (select count(*)::int from user_policy_acceptance where user_id = auth.uid()),
  2,
  'parent A has exactly their own two acceptances');

reset role;

do $$
declare v uuid;
begin
  select parent_b into v from pr_ctx;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

-- The count, with a third party's rows present — the `E06-43` lesson applied to consent.
-- "Parent B sees a pending version" would pass even if acceptances leaked between users.
--
-- **Two, not one, and the difference is the whole architecture.** `pr_pending` is the SQL half:
-- every published, blocking, in-effect version this caller has not accepted. Parent B has
-- accepted neither, so both v1 and v2 come back. Narrowing to *the current version only* happens
-- in `fetchPendingPolicies`, in memory, because PostgREST cannot express "newest per group"
-- without a view or an RPC that would put the definition of "current" in a second place.
--
-- Asserting 1 here would have been asserting that the database does the client's job — and it
-- passed for parent A only because they had already accepted v1, which is a coincidence of the
-- fixture rather than a property of the query.
select is((select count(*)::int from pr_pending), 2,
          'parent B, who accepted nothing, is pending on BOTH versions at the SQL layer — the '
          'narrowing to the current one is fetchPendingPolicies'' job, not the database''s');

select is(
  (select max(version) from pr_pending), '2',
  'and the newest of them is v2, which is the one the client will actually ask for');

select is(
  (select count(*)::int from user_policy_acceptance where user_id = auth.uid()),
  0,
  'and holds NO acceptances — parent A''s do not count for them');

select is_empty(
  $$ select 1 from user_policy_acceptance where user_id <> auth.uid() $$,
  'user_policy_acceptance_read_self: parent B cannot read parent A''s consent record at all');

reset role;

select * from finish();
rollback;
