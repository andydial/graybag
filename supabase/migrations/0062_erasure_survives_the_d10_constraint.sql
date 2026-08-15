-- =============================================================================
-- 0062_erasure_survives_the_d10_constraint.sql — `E20-56`
--
-- **A parent cannot delete their child.** `deactivate_recipient` fails at COMMIT, every time,
-- for everybody. Found on production on 2026-08-15 during the verification sweep; the Edge
-- Function returns `500 {"error":"could not save that just now"}` and nothing is erased.
--
-- ## The contradiction
--
-- `deactivate_recipient` (`0025`) does two things in one transaction:
--
--   1. anonymises the recipient in place — `first_name = 'Removed'`, allergies deleted,
--      `anonymised_at` stamped, `is_active = false`. Deliberately **not** `deleted_at`:
--      `recipient_erasure.test.sql` asserts that explicitly, because `order` and `invoice`
--      reference this row and *"an anonymised row is a live financial reference, a deleted one
--      is a dangling key waiting to be cascaded away"* (`D15`).
--   2. revokes **every** `guardian_link`, so the child leaves every guardian's list rather than
--      only the list of whoever removed them.
--
-- `guardian_link_keeps_recipient_reachable` is a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger enforcing `D10` — *guardian_link is the only path to a recipient*. Step 2 leaves zero
-- active links, so at commit the constraint refuses and the whole erasure rolls back.
--
-- Both halves are right on their own. Together they cannot both hold, and `D10` is the one that
-- has to give: **it is a rule about reachable, live recipients.** An anonymised row is not
-- reachable by anybody and is not supposed to be — it exists only so an invoice from March still
-- resolves. Requiring it to keep a guardian is requiring a deleted child to still belong to
-- someone.
--
-- `assert_recipient_guardian_links` already had exactly this escape hatch for `deleted_at`. It
-- simply never learned about the second terminal state, added later by the erasure path.
--
-- ## Why the suite could not catch it
--
-- **A DEFERRED constraint trigger fires at COMMIT. Every pgTAP file here ends in `rollback`, so
-- it never fires at all.** `recipient_erasure.test.sql` calls this exact function, asserts
-- fifteen things about the result, and passes — because the transaction it runs in is discarded
-- before the constraint is ever checked. The suite is structurally blind to every deferred
-- constraint in the schema, which is a bigger hole than this one bug.
--
-- The fix for the blind spot is one statement, and it is now used by
-- `recipient_erasure_commits.test.sql`:
--
--     set constraints all immediate;
--
-- It forces every deferred trigger to fire at that point, inside the transaction, so a
-- rollback-based test can observe what a real commit would do.
-- =============================================================================

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

  -- Two terminal states, not one. `deleted_at` was here from the start; `anonymised_at` is the
  -- state `deactivate_recipient` actually produces, and omitting it is what made erasure
  -- impossible. Neither is reachable by a guardian, which is the entire point of `D10` — so
  -- requiring a link on either is requiring a removed child to still belong to somebody.
  if not found or r.deleted_at is not null or r.anonymised_at is not null then
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
