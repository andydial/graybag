-- Down for `0086`. Drops the redemption machine; `0085`'s tables survive.
--
-- `assert_order_group_totals` is NOT restored to its old body here, deliberately: the old body
-- reads `meal_pack.net_price_paise` and `tax_total_paise`, which do not exist after `0085`, so
-- restoring it would break every pack purchase rather than un-break anything. If `0085` is being
-- reverted too, git is the route (see its header).
begin;
drop function if exists check_meal_pack_ledger_invariant();
drop function if exists expire_meal_packs();
drop function if exists reverse_meal_pack_redemptions(uuid, text, uuid);
drop function if exists release_meal_pack_reservations(uuid, text);
drop function if exists grant_meal_pack_bonus_if_earned(uuid);
drop function if exists confirm_meal_pack_redemptions(uuid, uuid);
drop function if exists reserve_meal_pack_items(uuid, uuid, uuid);
drop function if exists meal_pack_balances(uuid);
drop function if exists meal_pack_surface(uuid, uuid);
drop function if exists meal_pack_offers_for_school(uuid);
drop function if exists meal_pack_deferred_paise(meal_pack);
commit;
