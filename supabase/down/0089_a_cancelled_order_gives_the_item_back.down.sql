-- Down for `0089`. A cancelled order stops returning its pack items.
--
-- Worth saying plainly: running this does not restore a previous behaviour, it removes one. A
-- cancellation after this point silently keeps the item, which is `P24` reversed and is a change
-- to what a parent is owed — not a rollback of a mechanism.
begin;
drop trigger if exists trg_return_meal_pack_items_on_cancellation on "order";
drop function if exists return_meal_pack_items_on_cancellation();
commit;
