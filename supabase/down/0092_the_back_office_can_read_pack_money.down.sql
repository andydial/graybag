-- Down for `0092`. Restores `meal_pack_money` as it stood in `0088`.
--
-- **Read this before running it.** The `0088` shape is `security_invoker = true`, which means the
-- view returns ZERO ROWS to the back office — `meal_pack`'s only read policy is
-- `meal_pack_read_own` and a back-office account owns no packs. `/admin/sales` then prints a
-- confident "₹0 still owed in food" against a real liability, which is `E21-86` exactly. It also
-- drops `offer_id`, so redemption rate groups by name again (`E21-87`).
--
-- In other words this rollback reinstates two known defects. It is here because a down migration
-- that silently does something else would be worse, not because it is a good idea.
begin;
drop view if exists meal_pack_money;

create view meal_pack_money
with (security_invoker = true)
as
select
  mp.id as meal_pack_id, mp.school_id, mp.name_snapshot, mp.purchased_at, mp.expires_at, mp.status,
  mp.price_paid_paise, mp.cgst_paise + mp.sgst_paise as tax_paise,
  mp.items_original, mp.valued_remaining, meal_pack_deferred_paise(mp) as deferred_paise,
  mp.bonus_items as bonus_items_offered, (mp.bonus_granted_at is not null) as bonus_granted,
  mp.bonus_granted_at,
  coalesce((select sum(r.bonus_used) from meal_pack_redemption r
             where r.meal_pack_id = mp.id and r.state = 'confirmed'), 0) as bonus_items_redeemed,
  mp.bonus_remaining as bonus_items_outstanding,
  mp.price_paid_paise - meal_pack_deferred_paise(mp) as revenue_recognised_paise,
  coalesce((select sum(r.valued_items) from meal_pack_redemption r
             where r.meal_pack_id = mp.id and r.state = 'confirmed'), 0) as valued_items_redeemed,
  coalesce(e.breakage_paise, 0) as breakage_paise
from meal_pack mp
left join meal_pack_expiry e on e.meal_pack_id = mp.id
where mp.status <> 'pending';

grant select on meal_pack_money to authenticated;
commit;
