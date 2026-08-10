-- =============================================================================
-- 0016_change_recipient_school.sql
--
-- `E05-02` — change the school on a dependent, or on yourself.
-- =============================================================================
--
-- WHY THIS IS ITS OWN FUNCTION AND NOT AN `update recipient set school_id = …`
--
-- School lives on `recipient` rather than on `app_user` (`D2`), which is what makes a
-- teacher ordering for themselves, a university student and a parent with children at two
-- schools the same code path with no role logic. The cost of that choice is that changing
-- school is not an edit to a profile field — it moves which kitchen makes the food, which
-- cutoff applies, which menu is priced, and which packing list the child's name appears on.
--
-- Three things have to be true and none of them is enforced by a column:
--
--   1. The caller may manage this child. `guardian_link.can_manage`, never
--      `recipient.created_by_user_id` — `D10`, and the comment on that column says it in
--      as many words: it is audit only and must never appear in an authorization decision.
--   2. The destination school is one we actually serve. Same test `create_recipient` uses.
--   3. `school_class_id` is cleared. A `school_class` row belongs to one school, so
--      carrying it across is a foreign key pointing at the wrong school's class — which
--      nothing in the schema forbids, because the FK is to `school_class`, not to a pair.
--
-- -----------------------------------------------------------------------------
-- ALREADY-PLACED ORDERS: REFUSED, NOT SILENTLY MOVED
--
-- `"order"` snapshots `school_id` at creation, so an order that has already been placed
-- keeps its school no matter what happens to the recipient afterwards. That is right, and
-- it is also exactly the problem: a lunch ordered for next Tuesday at the old school will
-- be made by the old school's kitchen and put on the old school's packing list, for a child
-- who is no longer there.
--
-- The three options were to move those orders, to leave them and say nothing, or to refuse.
--
--   * **Moving them is wrong.** Prices, cutoffs and menus are per school; the dish ordered
--     may not exist at the new one, and the money has been taken against a snapshot.
--   * **Saying nothing is worse than either.** The failure lands on the day, on a child,
--     with a bag in the wrong building.
--   * **Refusing** puts the choice in front of the parent while it is still cheap: cancel
--     the affected orders (`E05-11`), then change the school. That is the action they were
--     going to have to take anyway.
--
-- So this refuses with `future_orders_exist` and the count, and the client says which days.
-- Decision `D19`.
--
-- "Undelivered" is a status test and not a date test: `delivered`, `cancelled` and
-- `refunded` are terminal, and everything else is food that has not happened yet. A date
-- test would let a paid order for today through on the grounds that today is not future.
-- =============================================================================

create function change_recipient_school(
  p_guardian_user_id uuid,
  p_recipient_id     uuid,
  p_school_id        uuid,
  p_class_label      text default null,
  p_section_label    text default null
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_old_school_id uuid;
  v_pending       int;
begin
  -- `D10`: the guardian_link is the only path from a user to a recipient. `can_manage`
  -- rather than `can_order` — a second parent who may order for a child is not necessarily
  -- the one who may move them to another school.
  select r.school_id into v_old_school_id
    from recipient r
    join guardian_link gl
      on gl.recipient_id = r.id
     and gl.user_id      = p_guardian_user_id
     and gl.can_manage
     and gl.revoked_at is null
   where r.id = p_recipient_id
     and r.is_active
     and r.deleted_at is null;

  if v_old_school_id is null then
    -- Deliberately one error for "no such child" and "not yours". Distinguishing them tells
    -- an unauthorised caller that the id exists, which is the enumeration `D10` exists to
    -- prevent.
    raise exception 'recipient % is not available to this user', p_recipient_id
      using errcode = 'P0001', hint = 'recipient_not_found';
  end if;

  if not exists (
    select 1 from school s
     where s.id = p_school_id and s.is_active
       and s.onboarded_at is not null and s.offboarded_at is null
  ) then
    raise exception 'school % is not available', p_school_id
      using errcode = 'P0001', hint = 'school_unavailable';
  end if;

  -- A no-op is success, not an error. A parent who taps the school they are already at has
  -- not done anything wrong, and a class or section correction alone arrives this way.
  if v_old_school_id <> p_school_id then
    select count(*)::int into v_pending
      from "order" o
     where o.recipient_id = p_recipient_id
       and o.status not in ('delivered', 'cancelled', 'refunded');

    if v_pending > 0 then
      raise exception
        'recipient % has % order(s) that have not been delivered', p_recipient_id, v_pending
        using errcode = 'P0001', hint = 'future_orders_exist';
    end if;
  end if;

  update recipient
     set school_id       = p_school_id,
         -- Always cleared, even when the school has not changed: if it were stale before,
         -- this is the moment it stops being.
         school_class_id = null,
         class_label     = coalesce(nullif(trim(coalesce(p_class_label, '')), ''), class_label),
         section_label   = coalesce(nullif(trim(coalesce(p_section_label, '')), ''), section_label),
         updated_at      = now()
   where id = p_recipient_id;

  return jsonb_build_object(
    'recipient_id',   p_recipient_id,
    'school_id',      p_school_id,
    'changed_school', v_old_school_id <> p_school_id,
    'from_school_id', v_old_school_id
  );
end;
$$;

revoke all on function change_recipient_school(uuid, uuid, uuid, text, text) from public;
grant execute on function change_recipient_school(uuid, uuid, uuid, text, text) to service_role;

comment on function change_recipient_school(uuid, uuid, uuid, text, text) is
  'E05-02. Changing school moves which kitchen, cutoff, menu and packing list apply, so it is a function rather than a column update. Authorization is guardian_link.can_manage (D10) — never recipient.created_by_user_id. Refuses while undelivered orders exist (D19): "order" snapshots school_id, so those would be made by the old school for a child who has left. service_role only; it takes the guardian id as a parameter, so execute permission IS the boundary.';
