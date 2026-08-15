-- Down for 0062. Restores the assertion that recognises only `deleted_at` as terminal.
--
-- **Applying this makes it impossible for a parent to delete their child again** —
-- `deactivate_recipient` will fail at COMMIT with `D10`, and the Edge Function will return a 500
-- having erased nothing. That is a DPDP obligation, not a feature, so this exists for
-- completeness rather than as something anyone should run.

create or replace function public.assert_recipient_guardian_links(p_recipient_id uuid)
returns void
language plpgsql
as $function$
declare
  r recipient%rowtype;
  v_active bigint;
  v_self   bigint;
begin
  select * into r from recipient where id = p_recipient_id;
  if not found or r.deleted_at is not null then
    return;
  end if;

  select count(*), count(*) filter (where relationship = 'self')
    into v_active, v_self
    from guardian_link
   where recipient_id = p_recipient_id and revoked_at is null;

  if v_active = 0 then
    raise exception 'recipient % has no active guardian_link; guardian_link is the only path to a recipient (D10)', p_recipient_id
      using errcode = 'check_violation';
  end if;

  if r.is_self and not (v_active = 1 and v_self = 1) then
    raise exception 'recipient % is is_self, so its sole active guardian_link must have relationship = self (% active, % self)', p_recipient_id, v_active, v_self
      using errcode = 'check_violation';
  end if;
end;
$function$;
