-- Down for 0075.
--
-- **Applying this removes the only thing stopping a pack offer going live on production before
-- the GST tax point is settled.** `is_active` still defaults false, so nothing sells by accident,
-- but nothing refuses a deliberate activation either.

drop trigger if exists trg_refuse_live_pack_offer_before_confirmation on meal_pack_offer;
drop function if exists refuse_live_pack_offer_before_confirmation();
alter table platform_config drop column if exists meal_packs_confirmed;
