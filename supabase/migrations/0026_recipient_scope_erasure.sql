-- 0026_recipient_scope_erasure.sql — removing a child now erases the child. E20-30, E20-44.
--
-- ## What was wrong
--
-- `deactivate_recipient` (`0025`) set `is_active = false` and revoked every `guardian_link`,
-- and left `first_name`, `last_name`, `class_label`, `section_label`, `allergy_note` and every
-- `recipient_allergen` row exactly as they were. The guardian link ended and the tier-P/S data
-- stayed — including health data about a minor.
--
-- On 2026-08-11 Andy settled the retention rule: financial records seven years; a child's
-- name, class, section and allergy details **deleted on request, or when the guardian link
-- ends**. That is now published in the privacy policy (notice version 2, §4). This migration is
-- what makes the sentence true, and it landed *before* `E05-37` put a Remove button in front of
-- a parent, because a button that leaves a child's name in place is a promise the code does not
-- keep.
--
-- ## It matches the retention schedule that was already written
--
-- `docs/dpdp-compliance.md` §6.2 already says `recipient_allergen` and `recipient.allergy_note`
-- go **immediately** on removal, action `delete`, because no statutory basis exists for
-- retaining a child's health data. The tier-P columns it proposed to `anonymise` twelve months
-- after the last order *and* the last link; Andy's decision removes the twelve-month tail, and
-- those numbers were explicitly proposals rather than decisions (`[DP-02]`).
--
-- ## Anonymise in place, never hard-delete
--
-- `D15` and §6.1.2: `order`, `invoice` and the ledger reference this row, and an invoice whose
-- foreign key has vanished is a broken statutory record. So the row survives with its
-- identifying columns emptied and `anonymised_at` stamped — the column `0001` added for exactly
-- this, and which nothing has set until now.
--
-- `first_name` is `not null`, so it cannot be nulled. It becomes a fixed non-identifying marker
-- rather than an empty string: '' would render as a blank name on any screen that still joined
-- to this row and read as a bug, where 'Removed' reads as what happened.
--
-- ## What it deliberately does not touch
--
--   * `"order"`, `order_line`, `invoice`, `ledger_*` — every row and every reference intact.
--   * `"order".recipient_name_snapshot` / `class_label_snapshot` / `section_label_snapshot` and
--     `order_line.allergen_codes_snapshot`. These are the record of what was ordered and what
--     the kitchen was told, they sit inside a financial record retained for seven years, and
--     §6.2 gives them their own separate schedules (18 and 36 months). Sweeping them here would
--     rewrite history rather than erase a child. Their expiry is `E20-19`'s purge job.
--   * `consent_record`. §6.1.5: it is the evidence that the processing was lawful, and deleting
--     it on erasure destroys our own defence. `E20-16` writes the `withdrawn` rows in this same
--     transaction and is still open — noted rather than folded in, because a consent write has
--     its own trigger and policy surface and belongs in its own change.
--
-- ## The consequence a screen has to say out loud
--
-- This is irreversible, and it fires when **any** managing guardian removes the child, because
-- `deactivate_recipient` revokes every link — the child leaves both parents' lists, and now the
-- details go with it. `E05-37`'s confirmation copy must say so plainly.

-- `0025` created this with the same signature, so `create or replace` keeps every grant and
-- every caller. The guards below are unchanged from `0025`; only the erasure is new.
--
-- Deliberately **not** `security definer`, matching `0025` exactly. It runs with the caller's
-- rights, and the caller is the `recipients` Edge Function holding `service_role`. Adding
-- definer rights here would be a privilege change smuggled into a data-retention migration,
-- and it would change what the authorization suite is proving about this function.
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

  -- The same guard `change_recipient_school` uses, for the same reason: an undelivered order
  -- is food the kitchen is going to make. Removing the child it belongs to would leave a meal
  -- with nobody's name on the packing list, and the parent has already paid for it.
  --
  -- It matters more now than it did in `0025`. Then, removal was reversible in principle —
  -- the row still held everything. Now this guard is the only thing standing between a
  -- mistaken tap and a child's details being gone while their lunch is still on Friday's list.
  select count(*) into v_pending
    from "order" o
   where o.recipient_id = p_recipient_id
     and o.service_date >= current_date
     and o.status not in ('cancelled', 'refunded', 'delivered');

  if v_pending > 0 then
    raise exception 'recipient % has % undelivered order(s)', p_recipient_id, v_pending
      using errcode = 'P0001', hint = 'future_orders_exist';
  end if;

  -- Tier S first — health data about a minor, no statutory basis, deleted outright (§6.2).
  -- Before the tier-P update, so that a failure between the two leaves the *more* sensitive
  -- data gone rather than the less.
  delete from recipient_allergen
   where recipient_id = p_recipient_id;

  -- Tier P — anonymised in place, because `order` and `invoice` reference this row (`D15`).
  update recipient
     set first_name      = 'Removed',
         last_name       = null,
         class_label     = null,
         section_label   = null,
         school_class_id = null,
         allergy_note    = null,
         is_active       = false,
         anonymised_at   = now(),
         updated_at      = now()
   where id = p_recipient_id;

  -- And revoke the links, so the child leaves every guardian's list rather than only the one
  -- who removed them. A second parent still seeing a removed child would be a support call.
  update guardian_link
     set revoked_at = now()
   where recipient_id = p_recipient_id
     and revoked_at is null;

  return jsonb_build_object('recipient_id', p_recipient_id, 'erased', true);
end;
$$;

comment on function deactivate_recipient is
  'E05-44 + E20-30. Removes a recipient from every guardian list AND erases the child: recipient_allergen deleted, allergy_note and the tier-P name/class/section columns emptied, anonymised_at stamped. The row survives because order and invoice reference it (D15). Order and invoice snapshots are deliberately untouched — they are financial records with their own retention (dpdp-compliance.md 6.2). Implements the retention rule published in privacy policy notice version 2.';

revoke all on function deactivate_recipient(uuid, uuid) from public, anon, authenticated;
