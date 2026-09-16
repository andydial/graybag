-- Down for `0088`. Removes buying, the dead-reservation sweep and the reporting view.
begin;
drop view if exists meal_pack_money;
drop function if exists release_dead_meal_pack_reservations(interval);
drop trigger if exists trg_assert_meal_pack_group_kind on meal_pack;
drop function if exists assert_meal_pack_group_kind();
drop function if exists start_meal_pack_purchase(uuid, uuid, uuid, text);
commit;
