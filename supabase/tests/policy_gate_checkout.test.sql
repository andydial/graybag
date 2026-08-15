-- =============================================================================
-- policy_gate_checkout.test.sql — the ordering gate `0001` always claimed. `E20-55`.
--
-- Three things, and the third is the one that makes this safe to ship on a launch day:
--
--   1. A current, published, in-effect **blocking** version with no acceptance REFUSES.
--   2. Accepting it lets the order through.
--   3. **It is inert today.** Nothing in any environment sets `blocks_ordering`, so a guard
--      added the day before launch must be provably a no-op for every existing policy.
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

create temporary table pg_ctx as
select (select id from app_user where deleted_at is null and not is_disabled order by id limit 1) as parent_a,
       (select id from app_user where deleted_at is null and not is_disabled order by id offset 1 limit 1) as parent_b;

-- =============================================================================
-- 0. INERT TODAY. Asserted first, because it is the claim the launch rests on.
-- =============================================================================

select is(
  (select count(*)::int from policy_version where blocks_ordering),
  0,
  'no policy_version anywhere sets blocks_ordering — so this guard changes nothing today, '
  'which is precisely why it was safe to add on 16 August');

select lives_ok(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_a from pg_ctx)),
  'and a parent who has accepted nothing passes the guard, because nothing blocks ordering');

-- =============================================================================
-- 1. With a blocking version published, it refuses — and names the policy.
-- =============================================================================

insert into policy_document (code, display_name, applies_to)
values ('checkout_gate_probe', 'Checkout gate probe', 'app')
on conflict (code) do nothing;

create temporary table pg_v1 as
with v as (
  insert into policy_version (policy_code, version, effective_from, published_at, content_md,
                              content_sha256, requires_acceptance, blocks_ordering,
                              summary_of_changes)
  select 'checkout_gate_probe', '1', now() - interval '1 day', now() - interval '1 day',
         'v1', encode(sha256('v1'::bytea), 'hex'), true, true, 'First'
  returning id
)
select id from v;

select throws_matching(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_a from pg_ctx)),
  'policy acceptance required',
  'a published, in-effect, BLOCKING version with no acceptance refuses');

-- The hint is what the Edge Function maps to a response the app can route on.
do $$
declare v_hint text;
begin
  begin
    perform assert_policies_accepted((select parent_a from pg_ctx));
    v_hint := '(no refusal)';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  perform is(v_hint, 'policy_acceptance_required',
    'and refuses with the hint the Edge Function maps to a routable response');
end $$;

-- =============================================================================
-- 2. Accepting it opens the gate — for that parent only.
-- =============================================================================

insert into user_policy_acceptance (user_id, policy_version_id, source)
select (select parent_a from pg_ctx), id, 'app' from pg_v1;

select lives_ok(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_a from pg_ctx)),
  'accepting the current version opens the gate');

select throws_matching(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_b from pg_ctx)),
  'policy acceptance required',
  'and it is per-parent — B accepted nothing and is still refused');

-- =============================================================================
-- 3. Only the CURRENT version counts. Requiring v1 AND v2 is a bug that looks like diligence.
-- =============================================================================

create temporary table pg_v2 as
with v as (
  insert into policy_version (policy_code, version, effective_from, published_at, content_md,
                              content_sha256, requires_acceptance, blocks_ordering,
                              summary_of_changes)
  select 'checkout_gate_probe', '2', now(), now(),
         'v2', encode(sha256('v2'::bytea), 'hex'), true, true, 'Second'
  returning id
)
select id from v;

select throws_matching(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_a from pg_ctx)),
  'policy acceptance required',
  'publishing v2 re-gates the parent who had accepted v1 — the re-acceptance rule, now enforced '
  'on the ORDER rather than only in the app');

insert into user_policy_acceptance (user_id, policy_version_id, source)
select (select parent_a from pg_ctx), id, 'app' from pg_v2;

select lives_ok(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_a from pg_ctx)),
  'accepting v2 opens it again — and v1''s acceptance was never asked for a second time');

-- =============================================================================
-- 4. A version that is published but NOT YET in effect must not gate anybody.
-- =============================================================================

insert into policy_version (policy_code, version, effective_from, published_at, content_md,
                            content_sha256, requires_acceptance, blocks_ordering)
select 'checkout_gate_probe', '3', now() + interval '30 days', now(),
       'v3', encode(sha256('v3'::bytea), 'hex'), true, true;

select lives_ok(
  format($$ select assert_policies_accepted(%L::uuid) $$, (select parent_a from pg_ctx)),
  'a version whose effective_from is in the future gates nobody — publishing ahead of time is '
  'how a notice period is given, not a way to stop orders today');

-- =============================================================================
-- 5. `create_checkout` really calls it. The guard existing is not the same as it being wired —
--    which is the entire content of E20-55.
-- =============================================================================

select ok(
  (select position('assert_policies_accepted' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_checkout'),
  'create_checkout CALLS the guard — 0001 claimed this from the beginning and it was never true');

select ok(
  (select position('assert_seller_identity_configured' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_checkout'),
  'and the seller-identity guard it was patched alongside is still there — the regeneration in '
  '0060 did not drop the one 0045 added');

select ok(not has_function_privilege('authenticated', 'assert_policies_accepted(uuid)', 'execute'),
          'a signed-in caller cannot invoke the guard directly');

select * from finish();
rollback;
