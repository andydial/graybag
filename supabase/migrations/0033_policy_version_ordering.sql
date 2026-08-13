-- =============================================================================
-- 0033_policy_version_ordering.sql — '9' does not come after '10'. `E20-50`.
-- =============================================================================
--
-- `create_recipient` chose which notice to consent against with
-- `order by pv.effective_from desc, pv.version desc limit 1`, and **`policy_version.version` is
-- TEXT**. So `'9' > '10'`, `'9' > '11'`, and from the tenth version of any notice onward the
-- ninth would win.
--
-- ## Why this is a consent-integrity bug and not a tidiness one
--
-- The failure is invisible at the moment it happens. Nothing errors, nothing is null, and the
-- `consent_record` row is perfectly well-formed — it simply points at superseded wording. The
-- one column whose whole job is to answer *"which words did this person agree to?"* answers
-- wrongly, and it does so on a record that `C9` keeps after erasure precisely because it is the
-- evidence that holding the data was lawful.
--
-- Discovering it later means auditing every consent taken after the tenth version to work out
-- which are sound. There is no repair that does not involve asking people again.
--
-- ## `effective_from desc` was saving it, accidentally
--
-- The leading sort term is the timestamp, and in practice version 10 is published after version
-- 9, so the timestamp decides and the text comparison never gets a vote. That is exactly the
-- kind of accidental protection that stops being true the first moment somebody backdates an
-- `effective_from` — which is a legitimate thing to do when a wording is corrected to take
-- effect from when it should have — and the failure it then permits is the invisible one above.
--
-- ## Matching `compareVersions`, not approximating it
--
-- `packages/shared/src/api/policy.ts` already does this properly: split on `.`, compare
-- component-wise as numbers, treat a missing component as zero. The client and the database
-- disagreeing about which version is current would be its own bug, so the SQL mirrors that
-- function rather than inventing a second rule.
--
-- `string_to_array(version, '.')::int[]` gives Postgres exactly that comparison — arrays are
-- ordered element by element — for every version string this project will ever write.
-- =============================================================================

create or replace function policy_version_rank(p_version text) returns int[]
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  -- Mirrors compareVersions() in packages/shared/src/api/policy.ts. IMMUTABLE so it can be used
  -- in an index later; STRICT so a null version sorts as null rather than as an empty array,
  -- which would make it the LOWEST version rather than an unknown one.
  select string_to_array(p_version, '.')::int[];
$$;

comment on function policy_version_rank(text) is
  'Sortable form of policy_version.version, which is TEXT — so a plain `order by version desc` puts ''9'' above ''10''. Mirrors compareVersions() in packages/shared/src/api/policy.ts: the client and the database must not disagree about which wording is current. E20-50.';

-- -----------------------------------------------------------------------------
-- The single answer to "which wording is current".
--
-- It was inline in `create_recipient` and nowhere else, which made it look like a local detail
-- rather than a rule. It is a rule: every consent record written anywhere must point at the
-- same version this returns, and a second copy of this ORDER BY is a second chance to get it
-- wrong.
-- -----------------------------------------------------------------------------
create or replace function current_policy_version_id(p_policy_code text) returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pv.id
    from policy_version pv
   where pv.policy_code = p_policy_code
     and pv.published_at is not null
   order by pv.effective_from desc, policy_version_rank(pv.version) desc
   limit 1;
$$;

comment on function current_policy_version_id(text) is
  'The published policy_version a consent should be recorded against. THE one place that decides — E20-50. Ordering is effective_from first, then a NUMERIC version comparison (policy_version_rank), never the raw TEXT.';

-- -----------------------------------------------------------------------------
-- `create_recipient`, with the inline lookup replaced by the function above and **nothing else
-- changed**. The body below was taken from `pg_get_functiondef()` on the live function and the
-- five-line lookup swapped for one call; the result was asserted to differ in nothing else
-- before being written here. Restating a 100-line function by hand is how an unrelated
-- behaviour changes in a migration whose header says it fixes a sort order.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_recipient(p_guardian_user_id uuid, p_first_name text, p_last_name text, p_school_id uuid, p_class_label text DEFAULT NULL::text, p_section_label text DEFAULT NULL::text, p_allergen_ids uuid[] DEFAULT '{}'::uuid[], p_allergy_note text DEFAULT NULL::text, p_allergen_consent boolean DEFAULT false, p_capture_context jsonb DEFAULT '{}'::jsonb, p_is_self boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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

  -- ONE place decides which wording is current (0033). This was an inline
  -- `order by ... pv.version desc` on a TEXT column, where '9' sorts above '10'.
  v_notice_id := current_policy_version_id(v_notice_code);

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
$function$;

revoke all on function policy_version_rank(text) from public;
revoke all on function current_policy_version_id(text) from public;
grant execute on function policy_version_rank(text) to authenticated, service_role;
grant execute on function current_policy_version_id(text) to authenticated, service_role;
