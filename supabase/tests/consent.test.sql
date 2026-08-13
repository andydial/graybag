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

-- =============================================================================
-- 7. The row every authenticated policy depends on — `E05-20`, migration `0018`.
--
-- Nothing created an `app_user` row until `0018`. Every suite in this directory inserts its
-- own, which is exactly why none of them noticed: the fixtures supplied what the real
-- sign-up path never produced. `auth_is_live_user()` was therefore false for every real
-- parent, so signing in emptied the school picker and adding a child died on a foreign key.
--
-- These assert the *sign-up* path rather than the fixture path — an `auth.users` row and
-- nothing else, which is all a real email-OTP sign-in produces.
-- =============================================================================

insert into auth.users (id, email) values
  ('a0000000-7e57-0000-0000-00000000c010', 'signup-c010@example.test');

select is(
  (select count(*)::int from app_user where id = 'a0000000-7e57-0000-0000-00000000c010'),
  1,
  'E05-20: an auth.users row alone creates the app_user row. Before 0018 nothing did, and '
  'auth_is_live_user() — which every authenticated policy is gated on — was false for every '
  'real user: an empty school picker the moment they signed in');

select ok(
  (select phone_e164 is null from app_user where id = 'a0000000-7e57-0000-0000-00000000c010'),
  'and it has no phone. v1 sign-in is Google, Apple or email OTP with no phone OTP (U1), so '
  'there is no number a trigger could honestly invent — which is why phone_e164 stopped being '
  'not null rather than being filled with a placeholder');

select is(
  (select email::text from app_user where id = 'a0000000-7e57-0000-0000-00000000c010'),
  'signup-c010@example.test',
  'and the email came across, so the account is identifiable without a second write');

-- A second account with no phone must not collide with the first. The old index was total,
-- not partial — a trap left for whoever adds a phone number later.
insert into auth.users (id, email) values
  ('a0000000-7e57-0000-0000-00000000c011', 'signup-c011@example.test');

select is(
  (select count(*)::int from app_user
    where id in ('a0000000-7e57-0000-0000-00000000c010', 'a0000000-7e57-0000-0000-00000000c011')),
  2,
  'two accounts with no phone coexist — uq_app_user_phone is partial now, like the email one '
  'beside it always was');

-- =============================================================================
-- 8. An adult ordering for themselves — `P13`, `0022`, and live for the first time in
--    `E05-38`.
--
-- `p_is_self` has existed since `0022` and **nothing had ever called it with true**: the flag
-- was built ahead of the screen, deliberately, so that the privacy notice could be published
-- before any user existed to be re-prompted by it. `E05-38` is the screen, so this is the
-- point at which the path stops being theoretical and starts needing to be proved.
--
-- What is asserted here is the whole reason `0022` did not simply reuse the child branch: a
-- different notice, different purposes, and a verification method that does not claim to have
-- verified anything. Those three are what a DPDP request is answered from, and a consent
-- record that names the wrong one is indistinguishable from a correct one after the fact.
-- =============================================================================

-- A guardian with no self recipient yet. The seed deliberately ships one adult who orders for
-- themselves (`seed.test.sql`), so picking `app_user` blindly would hit the duplicate guard
-- and prove nothing about the happy path.
create temporary table c_self_ctx as
select u.id as guardian_id
  from app_user u
 where not exists (
   select 1 from guardian_link gl join recipient r on r.id = gl.recipient_id
    where gl.user_id = u.id and gl.revoked_at is null and r.is_self and r.is_active)
 limit 1;

create temporary table c_self as
select create_recipient((select guardian_id from c_self_ctx), 'Priya', 'Staffmember',
                        (select school_id from c_ctx),
                        -- No class and no section: a member of staff has neither.
                        null, null,
                        '{}'::uuid[], null, false,
                        jsonb_build_object('screen', 'add-self'),
                        true) as r;

select ok((select (r->>'recipient_id') is not null from c_self),
          'P13: an adult can be created as a recipient of their own lunch');

select is(
  (select is_self and not is_minor from recipient
    where id = ((select r->>'recipient_id' from c_self))::uuid),
  true,
  'P13: is_self is set and is_minor is NOT — create_recipient used to write is_minor => true '
  'unconditionally, which is the single defect 0022 existed to fix');

select is(
  (select relationship::text from guardian_link
    where recipient_id = ((select r->>'recipient_id' from c_self))::uuid),
  'self',
  'the link says self, not guardian — the 0001 §4.2 trigger requires it, and a self recipient '
  'linked as a guardian is an adult recorded as their own parent');

select is(
  (select purpose_code from consent_record
    where subject_id = ((select r->>'recipient_id' from c_self))::uuid),
  'self_meal_service',
  'DPDP: the SELF purpose, not child_meal_service. A request about an adult and one about a '
  'child are answered differently, and a shared code would make them indistinguishable in the '
  'one record that has to tell them apart');

select is(
  (select pv.policy_code from consent_record cr
     join policy_version pv on pv.id = cr.policy_version_id
    where cr.subject_id = ((select r->>'recipient_id' from c_self))::uuid),
  'self_data_notice',
  'and it is consented against the SELF notice — the wording an adult was actually shown');

select is(
  (select verification_method::text from consent_record
    where subject_id = ((select r->>'recipient_id' from c_self))::uuid),
  'self_declared',
  '[DM-12] does not transfer: there is no third party to verify, and calling the account '
  'holder "verified" about themselves would overstate what we checked');

select throws_ok(
  format($$ select create_recipient(%L::uuid, 'Priya', null, %L::uuid, null, null,
                                    '{}'::uuid[], null, false, '{}'::jsonb, true) $$,
         (select guardian_id from c_self_ctx), (select school_id from c_ctx)),
  'P0001',
  null,
  'E05-38: one adult cannot be two self-recipients. The app hides the entry point once one '
  'exists, but two devices can race and a stale screen can be tapped');

-- =============================================================================
-- 9. The notices state no retention period — `C18`, `C19`, `E20-48`, migration `0032`.
--
-- `self_data_notice` version 1 promised *"Order history is kept for 24 months"* while the
-- privacy policy holds invoices, ledger entries and order history to a statutory floor that is
-- certainly longer. The rows are the same rows, so one of the two was a promise we could not
-- keep. Version 2 defers to the privacy policy instead of restating a number, which is `C18`:
-- a period is stated once, in the document that publishes it.
-- =============================================================================

select is(
  (select version from policy_version
    where policy_code = 'self_data_notice' and published_at is not null
    order by effective_from desc, version desc limit 1),
  '2',
  'E20-48: version 2 of the self notice is the current one — and this is the exact ordering '
  'create_recipient uses to choose what to consent against, so it is asserted rather than assumed');

select ok(
  (select content_md !~* '[0-9]+\s*(month|year)' from policy_version
    where policy_code = 'self_data_notice' and version = '2'),
  'C18: the current self notice names NO retention period. The figure it used to carry was '
  'wrong, and the fix is not a better number — it is that prose defers to the one document '
  'that states a period');

select ok(
  (select content_md !~* '[0-9]+\s*(month|year)' from policy_version
    where policy_code = 'child_data_notice' and version = '1'),
  'and the child notice never carried one either — checked rather than assumed, because C18 is '
  'a rule about every published document and not only the one that was wrong');

select ok(
  (select published_at is not null from policy_version
    where policy_code = 'self_data_notice' and version = '1'),
  '§11.2: version 1 is left PUBLISHED and unedited. It is the record of what was published, and '
  'a record is not corrected by rewriting it — that is what a version is for');

-- The self path, end to end: an adult added today consents against version 2, not version 1.
create temporary table c_self_v2 as
select create_recipient((select u.id from app_user u
                          where not exists (
                            select 1 from guardian_link gl join recipient r on r.id = gl.recipient_id
                             where gl.user_id = u.id and gl.revoked_at is null
                               and r.is_self and r.is_active)
                          limit 1),
                        'Rohan', 'Staffmember', (select school_id from c_ctx),
                        null, null, '{}'::uuid[], null, false,
                        jsonb_build_object('screen', 'add-self'), true) as r;

select is(
  (select pv.version from consent_record cr
     join policy_version pv on pv.id = cr.policy_version_id
    where cr.subject_id = ((select r->>'recipient_id' from c_self_v2))::uuid),
  '2',
  'an adult adding themselves today consents against the CURRENT wording — the whole point of '
  'recording policy_version_id on the consent is that it answers which words were shown');

-- =============================================================================
-- 10. '9' does not come after '10' — `E20-50`, migration `0033`.
--
-- `policy_version.version` is TEXT, and the notice lookup used to sort it as text. The bug is
-- invisible when it fires: nothing errors, nothing is null, and the consent_record simply
-- points at superseded wording — on the one row whose whole job is to answer "which words did
-- this person agree to?", and which `C9` keeps after erasure as the evidence that holding the
-- data was lawful.
--
-- The assertions below **fail under the old ordering**, which is the only kind worth writing
-- for a fix: version 10 is published with the SAME `effective_from` as version 9, so the
-- timestamp cannot break the tie and the version comparison has to.
-- =============================================================================

select ok(policy_version_rank('9') < policy_version_rank('10'),
          'E20-50: 9 sorts before 10. As text it does not, and the tenth version of a notice '
          'would have been silently superseded by the ninth');

select ok(policy_version_rank('1.2') < policy_version_rank('1.10'),
          'and a dotted version compares component-wise, matching compareVersions() in '
          'packages/shared — the client and the database must not disagree about which wording '
          'is current');

-- Two versions sharing an `effective_from`, so only the version comparison can decide. This is
-- the case a backdated correction creates, and it is the one `effective_from desc` was
-- accidentally protecting us from.
insert into policy_version (policy_code, version, effective_from, published_at,
                            content_md, content_sha256, requires_acceptance, blocks_ordering,
                            summary_of_changes)
select 'child_data_notice', v.version,
       '2030-01-01T00:00:00+00'::timestamptz, '2030-01-01T00:00:00+00'::timestamptz,
       v.body, encode(sha256(v.body::bytea), 'hex'), false, false, 'ordering fixture'
  from (values ('9', 'ninth wording'), ('10', 'tenth wording')) as v(version, body);

select is(
  (select pv.version from policy_version pv
    where pv.id = current_policy_version_id('child_data_notice')),
  '10',
  'E20-50: with 9 and 10 sharing an effective_from, the CURRENT notice is 10. Under the old '
  'text sort this returned 9 — and a parent adding a child would have consented against '
  'wording we had already replaced, with nothing anywhere to show it');

select * from finish();
rollback;
