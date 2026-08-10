-- =============================================================================
-- consent.test.sql — [DM-12], E05-01, E05-02, E20-02.
--
-- Consent is captured at child creation. The properties that matter are not "a row was
-- written" but: the child and the consent are atomic, the notice version is recorded, and
-- health data cannot be stored without its own separate consent.
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

create temporary table c_ctx as
select (select id from app_user limit 1) as guardian_id,
       (select id from school where is_active and onboarded_at is not null
          and offboarded_at is null limit 1) as school_id,
       (select id from allergen where is_active limit 1) as allergen_id;

-- =============================================================================
-- 1. The notice exists, is published, and is hashed.
-- =============================================================================

select ok(
  (select count(*) from policy_version
    where policy_code = 'child_data_notice' and published_at is not null) = 1,
  '[DM-12]: there is exactly one published child data notice to consent against');

select ok(
  (select content_sha256 = encode(sha256(content_md::bytea), 'hex')
     from policy_version where policy_code = 'child_data_notice'),
  'E02-15: the stored hash matches the stored text — content_sha256 is what proves a parent accepted THIS wording, and is meaningless if it is not checked');

-- =============================================================================
-- 2. Purpose-scoped, not one blanket agreement.
-- =============================================================================

select set_eq(
  $$ select code from consent_purpose where applies_to_subject = 'dependent' $$,
  $$ values ('child_meal_service'), ('child_allergen_info') $$,
  'DPDP: consent is purpose-scoped. A single blanket "I agree" is what the Act exists to stop');

select is(
  (select is_required_for_service from consent_purpose where code = 'child_allergen_info'),
  false,
  'allergy information is OPTIONAL — a parent with nothing to declare must not have to consent to health-data processing to use the service');

-- =============================================================================
-- 3. Adding a child. The happy path first, so the refusals below mean something.
-- =============================================================================

create temporary table c_kid as
select create_recipient((select guardian_id from c_ctx), 'Aarav', 'Testchild',
                        (select school_id from c_ctx), '5', 'A',
                        '{}'::uuid[], null, false,
                        jsonb_build_object('screen', 'add-child')) as r;

select ok((select (r->>'recipient_id') is not null from c_kid),
          'E05-01: a child is created');

select is(
  (select count(*)::int from guardian_link
    where recipient_id = ((select r->>'recipient_id' from c_kid))::uuid
      and user_id = (select guardian_id from c_ctx) and can_order),
  1,
  'D10: the guardian_link is written and can_order is true — this is the ONLY path from a user to a child, and without it create_checkout refuses');

select is(
  (select count(*)::int from consent_record
    where subject_id = ((select r->>'recipient_id' from c_kid))::uuid),
  1,
  'E20-02: exactly one consent record for a child added without allergies — the required purpose only');

select is(
  (select purpose_code from consent_record
    where subject_id = ((select r->>'recipient_id' from c_kid))::uuid),
  'child_meal_service',
  'and it is the meal-service purpose');

select ok(
  (select policy_version_id is not null from consent_record
    where subject_id = ((select r->>'recipient_id' from c_kid))::uuid),
  '[DM-12]: the NOTICE VERSION is recorded against the consent, so changing the wording later creates a new version and does not invalidate this one');

select is(
  (select verification_method from consent_record
    where subject_id = ((select r->>'recipient_id' from c_kid))::uuid),
  'authenticated_account_holder',
  '[DM-12]: the v1 verification bar is recorded, not assumed. E20-01 may raise it, and this column is what makes the old records still say what they were');

select is(
  (select verification_method from consent_record
    where subject_id = ((select r->>'recipient_id' from c_kid))::uuid),
  parental_verification_method(),
  '[DM-12]: and it comes from the ONE function that decides it — raising the bar is a one-function change, not a rebuild');

-- =============================================================================
-- 4. Health data needs its own consent. This is the assertion with teeth.
-- =============================================================================

select throws_ok(
  format($$ select create_recipient(%L::uuid, 'NoConsent', null, %L::uuid, '5', 'A',
                                    '{}'::uuid[], 'Peanut allergy', false, '{}'::jsonb) $$,
         (select guardian_id from c_ctx), (select school_id from c_ctx)),
  'P0001',
  null,
  '§13.3: allergy details supplied WITHOUT the separate consent are REFUSED, not silently dropped — a parent who typed an allergy and had it quietly discarded would believe the kitchen knows about it');

create temporary table c_kid2 as
select create_recipient((select guardian_id from c_ctx), 'Bela', null,
                        (select school_id from c_ctx), '6', 'B',
                        array[(select allergen_id from c_ctx)], 'Peanut allergy', true,
                        '{}'::jsonb) as r;

select is(
  (select count(*)::int from consent_record
    where subject_id = ((select r->>'recipient_id' from c_kid2))::uuid),
  2,
  'E20-02: consenting to allergy storage writes a SECOND, separate consent record');

select is(
  (select count(*)::int from recipient_allergen
    where recipient_id = ((select r->>'recipient_id' from c_kid2))::uuid),
  1,
  'and the allergen is stored, because it was consented to');

select ok(
  (select allergy_note is not null from recipient
    where id = ((select r->>'recipient_id' from c_kid2))::uuid),
  'and the free-text allergy note with it');

-- =============================================================================
-- 5. Atomicity. "If the consent write fails, the recipient does not exist."
-- =============================================================================

select throws_ok(
  format($$ select create_recipient(%L::uuid, '', null, %L::uuid, null, null,
                                    '{}'::uuid[], null, false, '{}'::jsonb) $$,
         (select guardian_id from c_ctx), (select school_id from c_ctx)),
  'P0001',
  null,
  'a child with no first name is refused — the packing list is read aloud by a member of staff');

select is(
  (select count(*)::int from recipient where first_name = ''),
  0,
  'and nothing partial survives it');

select throws_ok(
  format($$ select create_recipient(%L::uuid, 'Ghost', null,
                                    '00000000-7e57-0000-0000-0000000000dd'::uuid,
                                    null, null, '{}'::uuid[], null, false, '{}'::jsonb) $$,
         (select guardian_id from c_ctx)),
  'P0001',
  null,
  'a school that is not onboarded is refused — P1, and a child at a school we do not serve cannot be fed');

-- =============================================================================
-- 6. The consent record carries no PII in its context blob.
-- =============================================================================

select is_empty(
  $$ select id::text from consent_record
      where capture_context::text ilike '%aarav%'
         or capture_context::text ilike '%bela%'
         or capture_context::text ilike '%peanut%' $$,
  '§11.5 / non-negotiable #4: capture_context records the screen and the app version, never the child. A consent record is evidence, not a second copy of the data');

select * from finish();
rollback;
