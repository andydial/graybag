-- Down for 0070.
--
-- **Restores the assumption that every order group is food.** Applying this with any
-- `meal_pack_purchase` group present leaves those groups failing the totals assertion on their
-- next touch, because the rule they satisfy will no longer exist. Withdraw the offers first.
--
-- irreversible: `order_group_kind` cannot be dropped while any row references it, and the column
-- drop below is what makes that possible — so this is a data-losing rollback by construction. It
-- forgets which groups were pack purchases.

drop trigger if exists trg_assert_meal_pack_group_kind on meal_pack;
drop function if exists assert_meal_pack_group_kind();
drop function if exists meal_packs_available_at(uuid);

drop policy if exists meal_pack_offer_school_read_backoffice on meal_pack_offer_school;
drop policy if exists meal_pack_offer_read_backoffice on meal_pack_offer;

-- The permission row is NOT deleted: a grant already made would be left pointing at a missing
-- permission, and `permission_grant` is a record of who was trusted with what.

-- Restore the 0001 assertion verbatim: one rule, applied to every group.
create or replace function assert_order_group_totals(p_group_id uuid) returns void
language plpgsql as $$
declare
  g order_group%rowtype;
  s record;
begin
  select * into g from order_group where id = p_group_id;
  if not found then return; end if;

  select coalesce(sum(o.subtotal_paise), 0)                                       as subtotal,
         coalesce(sum(o.tax_cgst_paise + o.tax_sgst_paise + o.tax_igst_paise), 0) as tax,
         coalesce(sum(o.discount_paise), 0)                                       as discount
    into s
    from "order" o
   where o.order_group_id = p_group_id;

  if g.subtotal_paise <> s.subtotal
     or g.tax_total_paise <> s.tax
     or g.discount_paise <> s.discount then
    raise exception
      'order_group % totals do not match its orders: group (subtotal %, tax %, discount %) vs orders (subtotal %, tax %, discount %)',
      p_group_id, g.subtotal_paise, g.tax_total_paise, g.discount_paise, s.subtotal, s.tax, s.discount
      using errcode = 'check_violation';
  end if;
end;
$$;

alter table order_group drop constraint if exists order_group_purchase_pays_real_money;
alter table order_group drop constraint if exists order_group_pack_applied_non_negative;
alter table order_group drop constraint if exists order_group_payable_arithmetic;
alter table order_group add constraint order_group_payable_arithmetic check (
  payable_paise = subtotal_paise + tax_total_paise - discount_paise - wallet_applied_paise
);

alter table order_group drop column if exists pack_applied_paise;
alter table order_group drop column if exists kind;
drop type if exists order_group_kind;
