-- Down for 0082. Drops the back-office view of pack revenue.
--
-- Purely additive to undo: the base table gained no policy and no grant changed, so dropping the
-- view returns the database to a state where the back office cannot read `meal_pack_redemption`
-- at all — which is where `E21-63` found it. Reports lose the pack/cash split and should say so
-- rather than render a zero.
begin;
drop view if exists meal_pack_redemption_money;
commit;
