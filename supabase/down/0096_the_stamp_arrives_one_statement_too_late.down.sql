-- Down for `0096`. `E21-104`.
--
-- Restores `0094`'s body — `G1a` reading `order_group.paid_at` again. **This reinstates a defect**,
-- and the note is here so nobody runs it expecting a neutral rollback: with `paid_at` in the
-- condition the rule never fires for a real checkout, because `create_checkout` writes that column
-- one statement AFTER confirming the orders that trigger the derivation. A pack-covered group goes
-- back to deriving `draft`, `checkout-status` goes back to answering `unpaid`, and the app goes
-- back to polling for ever with the cart full.
--
-- It exists because `docs/migrations.md` requires a rollback or a stated reason, and the honest
-- rollback of this change is "the previous, broken rule". If you need to undo `0096`, prefer going
-- forward to a corrected `0096`.
--
-- **The data fix is not reverted**, as in `0093` and `0094`. Those groups' orders are confirmed and
-- their pack items are spent; deriving them back to `draft` would restore the disagreement rather
-- than a previous truth.

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
  v_pack_settled boolean;
  v_status       order_group_status;
begin
  v_group := coalesce(new.order_group_id, old.order_group_id);
  if v_group is null then return null; end if;

  select (og.payable_paise = 0 and og.pack_applied_paise > 0 and og.paid_at is not null)
    into v_pack_settled
    from order_group og where og.id = v_group for update;

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
      when v_pack_settled and v_beyond_draft > 0 and v_pending = 0 and v_cancelled = 0 then 'paid'
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
