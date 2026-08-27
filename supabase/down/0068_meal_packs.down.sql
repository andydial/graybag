-- Down for 0068.
--
-- **This drops money records.** `meal_pack` is what a parent paid for and `meal_pack_redemption`
-- is what they consumed; dropping them destroys the only record of an obligation the business
-- still owes. Do not run it anywhere a pack has been sold — on production, prefer deactivating
-- every offer, which stops sales without erasing history.
--
-- `on delete restrict` on `order_group_id` and `order_id` means these drops will refuse anyway if
-- rows exist, which is the intended friction rather than an obstacle to work around.
--
-- irreversible: the two `ledger_account_type` values added by 0068 ('deferred_revenue',
-- 'deferred_tax') are NOT removed. PostgreSQL cannot drop an enum value, and any ledger_account
-- row already using one would be orphaned by a type rewrite. They are inert when unused.

drop trigger if exists trg_refuse_refund_of_meal_pack_purchase on refund;
drop function if exists refuse_refund_of_meal_pack_purchase();

drop function if exists meal_pack_deferred_tax_paise();
drop function if exists meal_pack_deferred_revenue_paise();
drop function if exists pack_liability_paise(bigint, int, int);

alter table platform_config drop column if exists pack_tax_point;

-- Reason codes are NOT deleted: a ledger transaction already posted with one would be left
-- pointing at a missing code, and the ledger is append-only history.

drop table if exists meal_pack_plan;
drop table if exists meal_pack_redemption;
drop table if exists meal_pack;
drop table if exists meal_pack_offer_school;
drop table if exists meal_pack_offer;

drop type if exists pack_tax_point;
drop type if exists meal_pack_status;
