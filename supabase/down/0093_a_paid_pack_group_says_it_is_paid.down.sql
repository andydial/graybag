-- Down for `0093`. A paid pack purchase goes back to disagreeing with itself.
--
-- The data fix is NOT reverted, deliberately: setting a paid group back to `pending_payment`
-- would be re-introducing the defect into rows rather than removing a mechanism.
begin;
drop trigger if exists trg_derive_pack_group_status on order_group;
drop function if exists derive_pack_group_status();
commit;
