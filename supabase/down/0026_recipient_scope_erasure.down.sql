-- Rollback for 0026 — restores `0025`'s `deactivate_recipient`: revoke the links, keep the data.
--
-- **The function is reversible. The erasure is not.** A child removed while `0026` was live has
-- had their `recipient_allergen` rows deleted and their name, class, section and allergy note
-- emptied, and nothing here brings any of that back — that is what erasure means, and if it
-- were recoverable it would not satisfy the retention rule the privacy policy publishes.
--
-- So rolling this back does not restore data. It restores *behaviour*, for removals from that
-- point on. If you are rolling back, `docs/privacy-policy.md` §4 says a child's details are
-- deleted when the guardian link ends, and with `0025`'s function live that stops being true —
-- the policy needs a new notice version in the same change, or GrayBag is publishing a promise
-- its code no longer keeps. Which is the defect `E20-44` was filed for.
--
-- `create or replace` rather than drop-and-create, so every grant and the `revoke` below stay
-- exactly as `0025` left them.
create or replace function deactivate_recipient(
  p_guardian_user_id uuid,
  p_recipient_id     uuid
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_pending int;
begin
  if not exists (
    select 1
      from recipient r
      join guardian_link gl
        on gl.recipient_id = r.id
       and gl.user_id      = p_guardian_user_id
       and gl.can_manage
       and gl.revoked_at is null
     where r.id = p_recipient_id
       and r.is_active
       and r.deleted_at is null
  ) then
    raise exception 'recipient % is not available to this user', p_recipient_id
      using errcode = 'P0001', hint = 'recipient_not_found';
  end if;

  select count(*) into v_pending
    from "order" o
   where o.recipient_id = p_recipient_id
     and o.service_date >= current_date
     and o.status not in ('cancelled', 'refunded', 'delivered');

  if v_pending > 0 then
    raise exception 'recipient % has % undelivered order(s)', p_recipient_id, v_pending
      using errcode = 'P0001', hint = 'future_orders_exist';
  end if;

  update recipient
     set is_active = false, updated_at = now()
   where id = p_recipient_id;

  update guardian_link
     set revoked_at = now()
   where recipient_id = p_recipient_id
     and revoked_at is null;

  return jsonb_build_object('recipient_id', p_recipient_id);
end;
$$;

comment on function deactivate_recipient is
  'E05-44. Removes a recipient from every guardian list by deactivating the row and revoking its links. NOT DPDP erasure (E20-06) — order history is retained deliberately.';

revoke all on function deactivate_recipient(uuid, uuid) from public, anon, authenticated;
