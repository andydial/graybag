-- =============================================================================
-- seller_identity.test.sql — `E07-20`. Production cannot take money it cannot invoice.
--
-- The sequence this prevents is the worst one in the product: under auto-capture the customer is
-- **already charged**, then `settle_payment` cannot allocate an invoice number against a
-- placeholder GSTIN, the settlement rolls back, `PY2` returns 200, and our own sweep retries for
-- ever. Every customer charged, no order created, no 5xx, no alert.
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

-- Inside the transaction, so it rolls back — see over_refund.test.sql for what committing it does.
create schema if not exists tests_tmp;
select * from no_plan();

-- =============================================================================
-- 1. Which fields are unset, and the default is the safe direction.
-- =============================================================================

select is(
  (select environment from platform_config where id = 1),
  'local',
  'E07-20: `environment` defaults to `local`. A new database is a developer''s, and an '
  'environment that enforces production rules has to say so deliberately — the safe direction '
  'is the one you get by doing nothing');

select ok(
  'seller_gstin' = any (seller_identity_placeholders()),
  'the GSTIN is still a «placeholder», which is the state E00-10 ends');

select ok(
  not ('sac_code' = any (seller_identity_placeholders())),
  'and `sac_code` is NOT reported — it has a real value (996331), so this is detecting '
  'placeholders rather than merely listing config');

-- =============================================================================
-- 2. Outside production it is a no-op. This is what stops it being a guard people switch off.
-- =============================================================================

select lives_ok(
  $$ select assert_seller_identity_configured() $$,
  'E07-20: in `local` the guard does nothing. An unconfigured seller is the ordinary state of a '
  'database nobody has finished setting up, and refusing there would make this a guard people '
  'disable rather than satisfy');

update platform_config set environment = 'staging' where id = 1;
select lives_ok(
  $$ select assert_seller_identity_configured() $$,
  'and staging likewise');

-- =============================================================================
-- 3. Production, with placeholders. The refusal, and it names the fields.
-- =============================================================================

update platform_config set environment = 'production' where id = 1;

select throws_ok(
  $$ select assert_seller_identity_configured() $$,
  'P0001', null,
  'E07-20: production with a placeholder GSTIN REFUSES. Without this the customer is charged '
  'first and the invoice fails afterwards — with no 5xx and no alert, because PY2 returns 200 '
  'and the sweep retries the failure for ever');

select throws_matching(
  $$ select assert_seller_identity_configured() $$,
  'seller_gstin',
  'and it names the fields. "Configuration is incomplete" sends somebody to read four columns');

-- The whole point: checkout refuses BEFORE money moves.
select throws_ok(
  $$ select create_checkout(
       (select id from app_user limit 1),
       'e07-20-test', 'hash-e0720', 0::bigint, '[]'::jsonb) $$,
  'P0001', null,
  'E07-20: and `create_checkout` itself refuses in production, which is the point — the guard '
  'is upstream of the charge. E07-13''s refusal inside settle_payment stays as defence in '
  'depth, but that one fires after the money has gone');

-- =============================================================================
-- 4. Configured, in production: everything proceeds.
-- =============================================================================

update platform_config
   set seller_gstin      = '03AABCG1234M1Z5',
       seller_legal_name = 'GrayBag Foods Private Limited',
       seller_address    = 'Sector 82, Mohali, Punjab 160055'
 where id = 1;

select is(
  seller_identity_placeholders(),
  '{}'::text[],
  'with real values nothing is reported as a placeholder');

select lives_ok(
  $$ select assert_seller_identity_configured() $$,
  'and production with a configured seller identity proceeds — the guard is about being unset, '
  'not about being production');

select * from finish();
rollback;
