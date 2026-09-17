-- Down for `0094`. `E21-101`.
--
-- Restores `derive_order_group_status` to its `0044` body — `G1a` removed, every other case and
-- their order untouched, and the lock back to a bare `perform`.
--
-- **The data fix is deliberately not reverted**, like `0093`'s. Reverting it would mean deriving
-- a paid group back to `draft`, which is the defect rather than the previous state: those orders
-- are delivered, their pack items are spent and their parents have been emailed. A migration that
-- can be rolled back to a lie is worse than one that leaves a correct row behind.

begin;

create or replace function derive_order_group_status() returns trigger
language plpgsql
as $$
declare
  v_group        uuid;
  v_captured     bigint;
  v_refunded     bigint;
  v_members      int;
  v_draft        int;
  v_beyond_draft int;
  v_pending      int;
  v_cancelled    int;
  v_failed_reason int;
  v_closed       int;
  v_status       order_group_status;
begin
  v_group := coalesce(new.order_group_id, old.order_group_id);
  if v_group is null then return null; end if;

  perform 1 from order_group where id = v_group for update;

  select coalesce(sum(amount_paise) filter (where status = 'captured'), 0)
    into v_captured from payment where order_group_id = v_group;

  select coalesce(sum(amount_paise) filter (where status = 'completed'), 0)
    into v_refunded from refund where order_group_id = v_group;

  select count(*),
         count(*) filter (where status = 'draft'),
         count(*) filter (where status <> 'draft'),
         count(*) filter (where status = 'pending_payment'),
         count(*) filter (where status = 'cancelled'),
         count(*) filter (where status = 'cancelled' and cancel_reason_code = 'payment_failed'),
         count(*) filter (where status in ('cancelled', 'refunded'))
    into v_members, v_draft, v_beyond_draft, v_pending, v_cancelled, v_failed_reason, v_closed
    from "order" where order_group_id = v_group;

  if v_members = 0 then
    return null;
  end if;

  v_status :=
    case
      when v_draft > 0 and v_beyond_draft = 0 then 'draft'
      when v_captured = 0 and v_pending > 0 then 'pending_payment'
      when v_captured = 0 and v_cancelled = v_members and v_failed_reason = v_members
        then 'payment_failed'
      when v_captured = 0 and v_cancelled = v_members then 'cancelled'
      when v_captured > 0 and v_refunded = v_captured and v_closed = v_members then 'refunded'
      when v_captured > 0 and v_refunded > 0 then 'partially_refunded'
      when v_captured > 0 then 'paid'
      else 'draft'
    end;

  update order_group set status = v_status, updated_at = now()
   where id = v_group and status is distinct from v_status;

  return null;
end;
$$;

commit;
