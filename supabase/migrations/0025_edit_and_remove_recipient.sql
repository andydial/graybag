-- =============================================================================
-- 0025_edit_and_remove_recipient.sql — E05-33, E05-34
-- =============================================================================
--
-- Two things a parent could not do: correct a child's details, and remove a child.
--
-- Andy, from his phone: "Class changes every year and people mistype the section at signup"
-- and "Children leave school." Both are ordinary, annual, and the app had no answer to either
-- — `change_recipient_school` could carry a class only as a side effect of *moving school*,
-- which is not a thing you want to do to fix a typo.
--
-- ## Removal is deactivation, never a delete
--
-- A delete would cascade into order history, and an order that happened is a fact about money
-- — it has an invoice, a ledger entry and a GST record that must survive (`docs/gst-invoicing.md`).
-- So `is_active = false` plus revoking the guardian links. The child stops appearing everywhere
-- a parent looks, and the accounts still balance.
--
-- This is deliberately NOT the DPDP erasure path. A parent asking to *delete their data* is
-- `E20-06` (`data_subject_request`), which has a legally-defined process and retention rules.
-- Conflating "my child left school" with "erase my child" would either destroy records we are
-- required to keep or fail to honour a real erasure request. Two different asks, two paths.

-- -----------------------------------------------------------------------------
-- Correct a child's details.
-- -----------------------------------------------------------------------------
create function update_recipient_details(
  p_guardian_user_id uuid,
  p_recipient_id     uuid,
  p_first_name       text default null,
  p_last_name        text default null,
  p_class_label      text default null,
  p_section_label    text default null,
  -- Distinguishes "leave it alone" from "clear it". Without this, null means both, and a
  -- parent could never remove a section they had added by mistake — which is one of the two
  -- cases this function exists for.
  p_clear_section    boolean default false,
  p_clear_last_name  boolean default false
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_name text;
begin
  -- `can_manage`, matching `change_recipient_school`: ordering for a child does not imply the
  -- right to rename them.
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
    -- One error for "no such child" and "not yours" — `D10`, so an id cannot be enumerated.
    raise exception 'recipient % is not available to this user', p_recipient_id
      using errcode = 'P0001', hint = 'recipient_not_found';
  end if;

  v_name := nullif(trim(coalesce(p_first_name, '')), '');
  -- A blank first name is refused rather than stored. Every screen that names a child falls
  -- back to something unhelpful when this is empty, and the packing list would print a gap.
  if p_first_name is not null and v_name is null then
    raise exception 'first name cannot be blank'
      using errcode = 'P0001', hint = 'first_name_required';
  end if;

  update recipient r
     set first_name    = coalesce(v_name, r.first_name),
         last_name     = case when p_clear_last_name then null
                              else coalesce(nullif(trim(coalesce(p_last_name, '')), ''), r.last_name) end,
         class_label   = coalesce(nullif(trim(coalesce(p_class_label, '')), ''), r.class_label),
         section_label = case when p_clear_section then null
                              else coalesce(nullif(trim(coalesce(p_section_label, '')), ''), r.section_label) end,
         updated_at    = now()
   where r.id = p_recipient_id;

  return jsonb_build_object('recipient_id', p_recipient_id);
end;
$$;

comment on function update_recipient_details is
  'E05-33. Corrects a recipient''s name, class or section. can_manage only. Never moves school — that is change_recipient_school, which has its own future-order guard.';

-- -----------------------------------------------------------------------------
-- Remove a child.
-- -----------------------------------------------------------------------------
create function deactivate_recipient(
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

  -- The same guard `change_recipient_school` uses, for the same reason: an undelivered order
  -- is food the kitchen is going to make. Removing the child it belongs to would leave a meal
  -- with nobody's name on the packing list, and the parent has already paid for it.
  select count(*) into v_pending
    from "order" o
   where o.recipient_id = p_recipient_id
     and o.service_date >= current_date
     and o.status not in ('cancelled', 'refunded', 'delivered');

  if v_pending > 0 then
    raise exception 'recipient % has % undelivered order(s)', p_recipient_id, v_pending
      using errcode = 'P0001', hint = 'future_orders_exist';
  end if;

  -- Deactivate, do not delete. Order history, invoices and ledger entries reference this row
  -- and are required to survive (see the header).
  update recipient
     set is_active = false, updated_at = now()
   where id = p_recipient_id;

  -- And revoke the links, so the child leaves every guardian's list rather than only the one
  -- who removed them. A second parent still seeing a removed child would be a support call.
  update guardian_link
     set revoked_at = now()
   where recipient_id = p_recipient_id
     and revoked_at is null;

  return jsonb_build_object('recipient_id', p_recipient_id);
end;
$$;

comment on function deactivate_recipient is
  'E05-34. Removes a recipient from every guardian list by deactivating the row and revoking its links. NOT DPDP erasure (E20-06) — order history is retained deliberately.';

revoke all on function update_recipient_details(uuid, uuid, text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function deactivate_recipient(uuid, uuid) from public, anon, authenticated;
