-- =============================================================================
-- 0015_consent_at_child_creation.sql
--
-- `[DM-12]` DECIDED 2026-08-10 (Andy): **capture consent at child creation in v1. Do not
-- defer it.** `E05-01`, `E05-02`, `E20-02`.
-- =============================================================================
--
-- THE RULING, AND WHY IT UNBLOCKS SOMETHING THAT LOOKED BLOCKED
--
-- `consent_record.verification_method` carries the comment "DO NOT BUILD THE CONSENT UI
-- UNTIL E20-01 RETURNS", and that comment was reading one question as two. Separating them
-- is what makes this buildable now:
--
--   * **Recording consent** — what was consented to, when, by whom, and against which
--     version of the notice. Every answer `E20-01` could return still requires this exact
--     record. It is not blocked on a lawyer and never was.
--   * **Verifying the consenting adult is really the parent** — a tick box by an
--     authenticated account holder, a payment-instrument check, a government-ID check.
--     *This* is the legal question, and the three answers differ enormously in build cost.
--
-- So verification is built as **one swappable step**. `parental_verification_method()`
-- returns the v1 answer and nothing else in the system decides it. If `E20-01` raises the
-- bar, that function changes and the flow around it does not — which is the difference
-- between a one-step change and a rebuild.
--
-- The `verification_method` column stays untyped text, deliberately, for the same reason
-- it always was: it has to be able to record whichever answer comes back.
--
-- -----------------------------------------------------------------------------
-- PURPOSE-SCOPED, BECAUSE THAT IS THE POINT OF THE ACT
--
-- Two purposes, not one. A single blanket "I agree" is exactly what DPDP is designed to
-- stop, and it is also worse product: a parent who is told precisely what a name is for
-- and precisely what an allergy is for is being asked something answerable.
--
--   child_meal_service    required. Name, class and section, so the right food reaches
--                         the right child. Without it there is no service to provide.
--   child_allergen_info   OPTIONAL, and separate because it is health data about a minor —
--                         special category under §13.3. A parent may use GrayBag without
--                         telling us about allergies; they simply get no allergen warnings.
--
-- Making the second one required would be the easy thing and the wrong one: it would mean
-- a parent with nothing to declare has to consent to health-data processing anyway.
--
-- -----------------------------------------------------------------------------
-- THE NOTICE IS WRITTEN FOR A PARENT, NOT FOR A REGULATOR
--
-- Andy's instruction, and it is the right one: ~150 Amity parents are about to do this
-- from scratch, and a wall of legalese behind a checkbox costs registrations. The text
-- below is the whole notice — short enough to read on a phone, specific enough to be
-- consent to something.
--
-- It is versioned and hashed, so a later wording change creates a NEW version and does not
-- invalidate consents already given against this one. `consent_record.policy_version_id`
-- is what makes that true.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The notice.
--
-- **THIS WORDING HAS NOT BEEN READ BY A LAWYER** (`C13`, `[DP-10]`). It is version `1`;
-- `E20-12` publishes the approved wording as version `2`, and that is not a rewrite of this
-- one — `policy_version_id` and `content_sha256` mean a consent given today records exactly
-- what was on the screen when it was given, and stays true afterwards.
--
-- What that does NOT cover is the gap in between: if this reaches production before `E20-01`
-- returns, real parents consent to unreviewed wording.
--
-- `[DP-10]` RESOLVED 2026-08-10 (Andy): nothing gates this out of production, because
-- production has no users and **will not open before `E20-01` returns**. That premise is a
-- commitment rather than an observation — if it changes, we are told. Decision `C14`.
--
-- The lever, if it ever does change: set `published_at` to null on version `1` in production
-- and `create_recipient` refuses with `no_notice_published` until approved wording lands.
-- One `update`, and that refusal path is tested (`consent.test.sql`). Written down rather
-- than built, which is the point.
-- -----------------------------------------------------------------------------
insert into policy_document (code, display_name, applies_to) values
  ('child_data_notice', 'How we use your child''s details', 'both')
on conflict (code) do nothing;

insert into policy_version (
  policy_code, version, effective_from, published_at, content_md, content_sha256,
  requires_acceptance, blocks_ordering, summary_of_changes
)
select 'child_data_notice', '1', now(), now(), v.body,
       encode(sha256(v.body::bytea), 'hex'),
       true,
       -- Not an ordering gate: this is consented to at child creation, and a parent who
       -- has no child has nothing to order for. Making it block ordering as well would put
       -- a second wall on the path AR7 exists to keep clear.
       false,
       'First version.'
  from (select $md$
### What we need, and why

To give your child lunch we need their **first name**, their **class and section**, and the
**school** they attend. The kitchen packs by class, and a member of staff hands the bag to
your child by name. That is the whole reason we ask.

### Allergies — only if you want to tell us

You can add allergies. If you do, we show a warning whenever a dish contains something you
have told us about, and the kitchen sees it on the packing list.

This is health information about a child, so we treat it separately and we ask you
separately. **You can use GrayBag without telling us.** You just will not get the warnings.

### What we do not do

We do not sell this. We do not use it for advertising. We do not send it to the school
except where it is needed to deliver the food. Your child's name never appears in the
reports we give schools.

### You can change your mind

You can edit or remove your child at any time from the app. Removing them stops us using
their details for anything new, and we delete what we are not legally required to keep.
$md$::text as body) v
on conflict (policy_code, version) do nothing;

-- -----------------------------------------------------------------------------
-- 2. The purposes.
-- -----------------------------------------------------------------------------
insert into consent_purpose (code, display_name, description, is_required_for_service, applies_to_subject) values
  ('child_meal_service',
   'Making and delivering your child''s meals',
   'Your child''s first name, class and section, so the kitchen packs correctly and staff hand the right bag to the right child.',
   true,  'dependent'),
  ('child_allergen_info',
   'Allergy warnings',
   'Any allergies you tell us about, so we can warn you before you order and tell the kitchen. Health information about a child, asked for separately, and optional.',
   false, 'dependent')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Verification — the one swappable step.
--
-- v1: the consenting adult is the authenticated account holder. That is a real check, not
-- a placeholder — the session is established by Google, Apple or an email OTP (`U1`), so
-- the person ticking the box has demonstrated control of that account.
--
-- It is also, deliberately, the weakest of the three plausible bars. `E20-01` may raise it
-- to a payment-instrument check or an ID check. When it does, **this function is the only
-- thing that changes.**
-- -----------------------------------------------------------------------------
create function parental_verification_method() returns text
language sql
immutable
as $$ select 'authenticated_account_holder'::text $$;

comment on function parental_verification_method() is
  '[DM-12] / E20-01. The v1 bar for "verifiable parental consent": the consenting adult is the authenticated account holder. Deliberately the ONLY place this is decided, so raising the bar is a one-function change rather than a rebuild.';

-- Supersede the column comment. The instruction it carried is spent.
comment on column consent_record.verification_method is
  'How the consenting adult was verified. [DM-12] DECIDED 2026-08-10: consent is captured at child creation in v1, and the v1 method is parental_verification_method() = authenticated_account_holder. Still untyped text, because E20-01 may raise the bar and this column must be able to record whatever it returns.';

-- -----------------------------------------------------------------------------
-- 4. Adding a child — recipient, guardian_link and consent, in ONE transaction.
--
-- The table comment on `consent_record` already required this: "adding a dependent writes
-- the recipient, the guardian_link and the consent_record rows in ONE transaction. If the
-- consent write fails, the recipient does not exist." This is that function.
--
-- Not `SECURITY DEFINER`, for the reason `create_checkout` is not: it takes the guardian's
-- id as a parameter, so execute permission IS the authorization boundary. `service_role`
-- only, called by an Edge Function that has established the caller's identity first.
-- -----------------------------------------------------------------------------
create function create_recipient(
  p_guardian_user_id uuid,
  p_first_name       text,
  p_last_name        text,
  p_school_id        uuid,
  p_class_label      text default null,
  p_section_label    text default null,
  p_allergen_ids     uuid[] default '{}',
  p_allergy_note     text default null,
  p_allergen_consent boolean default false,
  p_capture_context  jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_recipient_id uuid;
  v_notice_id    uuid;
  v_name         text;
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

  -- Allergy details may only be stored if they were consented to separately. Refusing
  -- here rather than silently dropping them: a parent who typed an allergy and had it
  -- quietly discarded would believe the kitchen knows about it.
  if not p_allergen_consent and (p_allergy_note is not null or array_length(p_allergen_ids, 1) > 0) then
    raise exception 'allergy details were supplied without consent to store them'
      using errcode = 'P0001', hint = 'allergen_consent_required';
  end if;

  select pv.id into v_notice_id
    from policy_version pv
   where pv.policy_code = 'child_data_notice' and pv.published_at is not null
   order by pv.effective_from desc, pv.version desc
   limit 1;

  if v_notice_id is null then
    -- A consent record with no notice version is a record of agreeing to nothing in
    -- particular, and it cannot be repaired afterwards.
    raise exception 'no published child data notice to consent against'
      using errcode = 'P0001', hint = 'no_notice_published';
  end if;

  insert into recipient (first_name, last_name, school_id, class_label, section_label,
                         allergy_note, created_by_user_id, is_minor)
  values (v_name, nullif(trim(coalesce(p_last_name, '')), ''), p_school_id,
          nullif(trim(coalesce(p_class_label, '')), ''),
          nullif(trim(coalesce(p_section_label, '')), ''),
          case when p_allergen_consent then nullif(trim(coalesce(p_allergy_note, '')), '') end,
          p_guardian_user_id, true)
  returning id into v_recipient_id;

  -- The ONLY path from a user to a recipient (`D10`). `created_by_user_id` above is audit
  -- only and must never appear in a policy.
  insert into guardian_link (recipient_id, user_id, relationship, can_order, can_manage, is_primary)
  values (v_recipient_id, p_guardian_user_id, 'guardian', true, true, true);

  insert into recipient_allergen (recipient_id, allergen_id)
  select v_recipient_id, a_id from unnest(p_allergen_ids) as a_id
   where p_allergen_consent
  on conflict do nothing;

  insert into consent_record (
    user_id, subject_type, subject_id, purpose_code, action, policy_version_id,
    capture_method, verification_method, capture_context
  ) values (
    p_guardian_user_id, 'recipient', v_recipient_id, 'child_meal_service', 'granted',
    v_notice_id, 'in_app_checkbox', parental_verification_method(),
    -- Screen name, app version, the id of the wording shown. NO PII (§11.5).
    p_capture_context
  );

  if p_allergen_consent then
    insert into consent_record (
      user_id, subject_type, subject_id, purpose_code, action, policy_version_id,
      capture_method, verification_method, capture_context
    ) values (
      p_guardian_user_id, 'recipient', v_recipient_id, 'child_allergen_info', 'granted',
      v_notice_id, 'in_app_checkbox', parental_verification_method(), p_capture_context
    );
  end if;

  return jsonb_build_object(
    'recipient_id', v_recipient_id,
    'first_name',   v_name,
    'school_id',    p_school_id,
    'notice_version_id', v_notice_id
  );
end;
$$;

revoke all on function create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb) from public;
grant execute on function create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb) to service_role;
revoke all on function parental_verification_method() from public;
grant execute on function parental_verification_method() to authenticated, service_role;

comment on function create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb) is
  'E05-01/E05-02/E20-02. Recipient + guardian_link + consent, one transaction: if the consent write fails, the child does not exist. service_role only — it takes the guardian id as a parameter, so execute permission IS the authorization boundary.';
