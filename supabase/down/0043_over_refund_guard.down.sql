-- Rollback for 0043 — restores the pre-lock guard.
--
-- The arithmetic is unchanged (this function always excluded `failed`); what is lost is the
-- `order_group` row lock, and with it the serialisation. Two admins refunding the same order at
-- the same time will both pass the check and both commit, and the guard will report nothing.
create or replace function trg_assert_refund_not_over_captured() returns trigger
language plpgsql
as $$
declare
  v_group uuid := new.order_group_id;
  v_captured bigint;
  v_refunded bigint;
begin
  select coalesce(sum(amount_paise), 0) into v_captured
    from payment where order_group_id = v_group and status = 'captured';

  select coalesce(sum(amount_paise), 0) into v_refunded
    from refund where order_group_id = v_group and status <> 'failed';

  if v_refunded > v_captured then
    raise exception 'refunds for order_group % total % paise but only % paise were captured', v_group, v_refunded, v_captured
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
