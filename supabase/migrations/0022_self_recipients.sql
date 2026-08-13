-- =============================================================================
-- 0022_self_recipients.sql
--
-- An adult can be a recipient of their own lunch. `docs/self-ordering-costing.md`,
-- DECIDED 2026-08-10 (Andy): take the model change and the recipient-neutral copy in v1;
-- the "Myself / My child" screen is fast-follow.
--
-- School staff and university students order their own lunch. The legacy export carries 13
-- `recipient_type = Staff` orders and a `CollegeStudent` role, so this is not speculative
-- demand — it is a segment the rebuild had silently dropped.
--
-- =============================================================================
-- WHY THIS IS SMALL: THE MODEL WAS ALREADY RIGHT
--
-- `recipient.is_self` and `recipient.is_minor` are both in `0001`, and the table's own comment
-- says what they are for: *"the person who eats the food: either the ordering adult themself
-- (is_self) or a dependent. This single table is what removes all the legacy role branching
-- (`D2`)"*. `guardian_relationship` has had `'self'` since `0001`. `0001` §4.2 already has a
-- trigger requiring an `is_self` recipient's sole active link to be `relationship = 'self'`.
--
-- Everything was in place except that `create_recipient` wrote `is_minor => true` and
-- `relationship => 'guardian'` unconditionally. **The model was not wrong; one function was
-- lying about it.**
--
-- -----------------------------------------------------------------------------
-- THE PRIVACY NOTICE IS PUBLISHED NOW, NOT WHEN THE SCREEN IS BUILT
--
-- This is the part that had to happen this week even though the UI does not.
--
-- A published notice that covers only parents, changed later to cover adults too, is a new
-- **policy version** — and `requires_acceptance` means every existing user is re-prompted. That
-- would land on 150 Amity parents mid-registration, as a second consent interruption during
-- onboarding, which is precisely the moment the product can least afford one (`AR7`).
--
-- So `self_data_notice` is published here, alongside `child_data_notice`, and both exist from
-- day one. Two notices rather than one covering both cases, because the wordings differ in
-- substance and not just in tone: one is a parent consenting on behalf of someone who cannot,
-- the other is an adult consenting about themselves. Collapsing them would make the parental
-- notice vaguer, and vaguer consent wording is worse consent.
--
-- -----------------------------------------------------------------------------
-- WHAT AN ADULT DOES *NOT* NEED
--
-- `[DM-12]`'s whole subject is verifying that the consenting adult is really the parent. There
-- is no third party here, so:
--
--   * `verification_method` is `self_declared`, not `authenticated_account_holder` — the
--     account holder and the data principal are the same person, and describing that as
--     "verified" would overstate it.
--   * The purposes are `self_meal_service` and `self_allergen_info`, distinct from the
--     `child_*` ones. A DPDP request about a child and one about an adult are answered
--     differently, and a single purpose code would make them indistinguishable in the record.
--   * No class or section is required. A staff member has neither.
--
-- -----------------------------------------------------------------------------
-- WHERE A STAFF LUNCH GOES — UNCONFIRMED, AND DELIBERATELY IN ONE PLACE
--
-- **Andy's working assumption, NOT confirmed with the kitchen:** staff and college students
-- collect from a canteen window rather than having it delivered to a room, which is why the
-- seed gives Chandra College a `Canteen window` break and no sections.
--
-- `recipient_collection_mode()` below is the single place that assumption lives. When the
-- kitchen answers, one function changes. It is a function rather than a comment precisely so
-- that "where does this go?" has one answer that code reads, instead of the assumption being
-- reimplemented in the packing list, the delivery sheet and the app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The notice an adult consents against. Published now; see the header.
-- -----------------------------------------------------------------------------
-- `policy_version.policy_code` is a foreign key to `policy_document`, so the document exists
-- before any version of it can. Same two-step as `0015`.
insert into policy_document (code, display_name, applies_to) values
  ('self_data_notice', 'How we use your details when you order for yourself', 'both')
on conflict (code) do nothing;

insert into policy_version (
  policy_code, version, effective_from, published_at, content_md, content_sha256,
  requires_acceptance, blocks_ordering, summary_of_changes
)
select 'self_data_notice', '1', now(), now(), v.body,
       encode(sha256(v.body::bytea), 'hex'),
       true,
       -- Not an ordering gate, for the same reason the child notice is not: it is consented
       -- to when you add yourself as a recipient, and someone who has not done that has
       -- nothing to order for.
       false,
       'First version.'
  from (select $md$
# How we use your details when you order for yourself

If you are ordering lunch for **yourself** — as a member of school staff, or as a college
student — this is what we hold and why.

## What we hold

Your name, the school or college you collect from, and the days you have ordered for. If you
choose to tell us about allergies, we hold those too, and only then.

## Why

To make the right meal and to get it to the right person at the right time. Your name appears
on the kitchen's list for the day you ordered, and nowhere else.

## Allergies are separate, and optional

Allergy information is health information, so we ask for it separately and you can use GrayBag
without giving it. If you do not, we cannot warn you when a dish contains something — we will
say so rather than leave you to assume.

## How long

Order history is kept for 24 months. Allergy details are kept until you remove them or delete
your account, and are deleted immediately when you do.

## Your rights

You can see, correct, export or delete everything we hold about you, from the app. Deleting
your account deletes your allergy details; invoices are kept because we are required to keep
them.

Questions or complaints: our grievance officer's contact details are in the app under Support.
$md$ as body) v
where not exists (
  select 1 from policy_version pv where pv.policy_code = 'self_data_notice'
);

-- -----------------------------------------------------------------------------
-- 1b. The purposes an adult consents to. `consent_record.purpose_code` is a foreign key to
--     `consent_purpose`, so these exist before any consent can reference them.
--
--     They are separate codes from the `child_*` pair rather than shared ones, because a DPDP
--     request about a child and one about an adult are answered differently — different data
--     principal, different rights-holder, different deletion consequences. One shared code
--     would make the two indistinguishable in the consent log, which is the one record that
--     has to be able to tell them apart.
--
--     `applies_to_subject = 'self'` mirrors `'dependent'` on the child purposes.
-- -----------------------------------------------------------------------------
insert into consent_purpose (code, display_name, description, is_required_for_service, applies_to_subject) values
  ('self_meal_service', 'Making and delivering your meal',
   'Your name and the school or college you collect from, so the right meal reaches you.',
   true, 'self'),
  ('self_allergen_info', 'Your allergy details',
   'Health information about you, held only if you choose to give it, so we can warn you before you order.',
   false, 'self')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Where a self recipient collects their food. UNCONFIRMED — see the header.
-- -----------------------------------------------------------------------------
create or replace function recipient_collection_mode(p_recipient_id uuid) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when r.is_self then 'canteen_window' else 'classroom' end
    from recipient r where r.id = p_recipient_id;
$$;

comment on function recipient_collection_mode(uuid) is
  'Where this recipient collects their food. UNCONFIRMED ASSUMPTION (2026-08-10, 0022): staff '
  'and college students collect at a canteen window rather than having it delivered to a room; '
  'children are served in their classroom at a break. Andy is confirming with the kitchen. '
  'This function is the ONE place that assumption lives — the packing list, the delivery sheet '
  'and the app must all read it rather than each deciding for themselves.';

-- -----------------------------------------------------------------------------
-- 3. `create_recipient` stops lying about what the model supports.
-- -----------------------------------------------------------------------------
-- DROP THE OLD SIGNATURE FIRST. `create or replace function` replaces a function with the
-- SAME argument list; adding `p_is_self` makes this a different signature, so it would create
-- an **overload** and leave the 10-argument version in place. Both would then be candidates
-- for a 10-argument call — the new one because its extra parameter is defaulted — and Postgres
-- refuses with "function create_recipient(...) is not unique".
--
-- That refusal is not theoretical: it is what the `recipients` Edge Function does on every add,
-- so the live path would have broken the moment this deployed. `consent.test.sql` caught it;
-- nothing in the migration itself would have.
drop function if exists create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb);

create or replace function create_recipient(
  p_guardian_user_id uuid,
  p_first_name       text,
  p_last_name        text,
  p_school_id        uuid,
  p_class_label      text default null,
  p_section_label    text default null,
  p_allergen_ids     uuid[] default '{}'::uuid[],
  p_allergy_note     text default null,
  p_allergen_consent boolean default false,
  p_capture_context  jsonb default '{}'::jsonb,
  -- New, and defaulted false so every existing caller keeps its exact behaviour.
  p_is_self          boolean default false
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_recipient_id uuid;
  v_notice_id    uuid;
  v_name         text;
  v_notice_code  text;
  v_meal_purpose text;
  v_allg_purpose text;
  v_verification text;
begin
  v_name := trim(coalesce(p_first_name, ''));
  if v_name = '' then
    raise exception 'a first name is required' using errcode = 'P0001', hint = 'first_name_required';
  end if;

  if not exists (
    select 1 from school s
     where s.id = p_school_id and s.is_active
       and s.onboarded_at is not null and s.offboarded_at is null
  ) then
    raise exception 'school % is not available', p_school_id
      using errcode = 'P0001', hint = 'school_unavailable';
  end if;

  -- One adult cannot be two self-recipients. The `0001` §4.2 trigger enforces the link shape;
  -- this stops the duplicate being created in the first place, with a message a screen can use.
  if p_is_self and exists (
    select 1 from recipient r
      join guardian_link gl on gl.recipient_id = r.id
     where r.is_self and r.is_active and gl.user_id = p_guardian_user_id
       and gl.revoked_at is null
  ) then
    raise exception 'this account already orders for itself'
      using errcode = 'P0001', hint = 'self_recipient_exists';
  end if;

  -- Allergy details may only be stored if they were consented to separately. Refusing
  -- here rather than silently dropping them: someone who typed an allergy and had it
  -- quietly discarded would believe the kitchen knows about it. True for a parent
  -- declaring a child's, and equally true for an adult declaring their own.
  if not p_allergen_consent and (p_allergy_note is not null or array_length(p_allergen_ids, 1) > 0) then
    raise exception 'allergy details were supplied without consent to store them'
      using errcode = 'P0001', hint = 'allergen_consent_required';
  end if;

  -- The two cases differ in which notice is consented against, under which purposes, and
  -- how the consenting person was verified. They are resolved together, once, so a future
  -- edit cannot change one and miss another.
  if p_is_self then
    v_notice_code  := 'self_data_notice';
    v_meal_purpose := 'self_meal_service';
    v_allg_purpose := 'self_allergen_info';
    -- Not `parental_verification_method()`. There is no parent to verify: the account holder
    -- and the data principal are the same person, and calling that "verified" overstates it.
    v_verification := 'self_declared';
  else
    v_notice_code  := 'child_data_notice';
    v_meal_purpose := 'child_meal_service';
    v_allg_purpose := 'child_allergen_info';
    v_verification := parental_verification_method();
  end if;

  select pv.id into v_notice_id
    from policy_version pv
   where pv.policy_code = v_notice_code and pv.published_at is not null
   order by pv.effective_from desc, pv.version desc
   limit 1;

  if v_notice_id is null then
    -- A consent record with no notice version is a record of agreeing to nothing in
    -- particular, and it cannot be repaired afterwards.
    raise exception 'no published % to consent against', v_notice_code
      using errcode = 'P0001', hint = 'no_notice_published';
  end if;

  insert into recipient (first_name, last_name, school_id, class_label, section_label,
                         allergy_note, created_by_user_id, is_minor, is_self)
  values (v_name, nullif(trim(coalesce(p_last_name, '')), ''), p_school_id,
          nullif(trim(coalesce(p_class_label, '')), ''),
          nullif(trim(coalesce(p_section_label, '')), ''),
          case when p_allergen_consent then nullif(trim(coalesce(p_allergy_note, '')), '') end,
          p_guardian_user_id,
          -- An adult ordering for themselves is not a minor. This pair is what `0015` got
          -- wrong: it hard-coded a child regardless of what the caller meant.
          not p_is_self, p_is_self)
  returning id into v_recipient_id;

  -- The ONLY path from a user to a recipient (`D10`). `created_by_user_id` above is audit
  -- only and must never appear in a policy. For a self recipient the relationship must be
  -- 'self' or the `0001` §4.2 trigger refuses the row.
  insert into guardian_link (recipient_id, user_id, relationship, can_order, can_manage, is_primary)
  values (v_recipient_id, p_guardian_user_id,
          case when p_is_self then 'self'::guardian_relationship
               else 'guardian'::guardian_relationship end,
          true, true, true);

  insert into recipient_allergen (recipient_id, allergen_id)
  select v_recipient_id, a_id from unnest(p_allergen_ids) as a_id
   where p_allergen_consent
  on conflict do nothing;

  insert into consent_record (
    user_id, subject_type, subject_id, purpose_code, action, policy_version_id,
    capture_method, verification_method, capture_context
  ) values (
    p_guardian_user_id, 'recipient', v_recipient_id, v_meal_purpose, 'granted',
    v_notice_id, 'in_app_checkbox', v_verification,
    -- Screen name, app version, the id of the wording shown. NO PII (§11.5).
    p_capture_context
  );

  if p_allergen_consent then
    insert into consent_record (
      user_id, subject_type, subject_id, purpose_code, action, policy_version_id,
      capture_method, verification_method, capture_context
    ) values (
      p_guardian_user_id, 'recipient', v_recipient_id, v_allg_purpose, 'granted',
      v_notice_id, 'in_app_checkbox', v_verification, p_capture_context
    );
  end if;

  return jsonb_build_object(
    'recipient_id', v_recipient_id,
    'first_name',   v_name,
    'school_id',    p_school_id,
    'is_self',      p_is_self,
    'notice_version_id', v_notice_id
  );
end;
$$;

comment on function create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb, boolean) is
  'Creates a recipient and its consent record in one transaction. p_is_self => an adult '
  'ordering for themselves: is_minor = false, relationship = self, and the self_data_notice '
  'rather than the parental one (0022). Defaulted false so existing callers are unchanged.';
