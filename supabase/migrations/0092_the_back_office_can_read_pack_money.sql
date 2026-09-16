-- The back office can read pack money, and "per offer" means per offer. `E21-86`, `E21-87`.
--
-- Both filed by WEB against MOBILE in `planning/andy-queue.md` §3 and §4, from reading the schema
-- rather than the design document. Both are right.
--
-- =============================================================================
-- E21-86 — the view returned ZERO ROWS to the only audience it has
-- =============================================================================
--
-- `meal_pack_money` was `security_invoker = true`, and `meal_pack` carries exactly one read
-- policy: `meal_pack_read_own`. **A back-office account owns no packs**, so the view returned
-- nothing to the only people who would ever select from it, and `/admin/sales` would have printed
-- a confident **₹0 still owed in food** while the real liability sat unread.
--
-- That is a worse failure than an error. `E21-63` reached the same conclusion about
-- `meal_pack_redemption_money` and the reasoning transfers unchanged: **RLS filters rows and
-- cannot filter columns**, and one `authenticated` role is shared by the parents who may see a
-- pack and the admins who may not see a child. The shape that works is a definer view that does
-- not contain the columns at all.
--
-- **This view already has that property and did not exploit it.** It carries no `recipient_id`,
-- no `customer_user_id`, no name, no class, no section — the rebuild removed `recipient_id` from
-- `meal_pack_redemption` entirely (`0085`), so there is no child identity anywhere in its
-- lineage to keep out. It is a definer view over money and counts.
--
-- So: `security_definer`, with the permission check **inside the view's own `where`**. Not in the
-- caller, not in a policy on a base table it no longer needs one for — here, where every
-- selection passes through it and no query can route around it.
--
-- `auth_can_platform('orders.view_financials')` is the same grant `/admin/sales` already uses for
-- cash revenue. A pack liability is financial data of exactly that kind, and giving it its own
-- permission would mean an account that can see the money it has taken but not the food it owes.
--
-- **This is the third `security_definer` view in the schema and the bar has not moved.** The other
-- two are `order_money` (`E02-36`) and this one; `E21-63`'s was dropped with the old design.
-- `authorization.test.sql` §12 asserts the exact set, so a fourth cannot appear quietly.
--
-- =============================================================================
-- E21-87 — `offer_id`, so two offers sharing a name do not merge
-- =============================================================================
--
-- Andy asked for redemption rate **per offer** — the number that says whether a pack is priced
-- right. The view exposed `name_snapshot` and not `offer_id`, so the report grouped by the name a
-- pack was *sold under*. Right as a label, wrong as an identity: two offers sharing a name merge
-- into one row, and one offer renamed mid-life splits into two that look like two products.
--
-- `name_snapshot` stays, because it is what the invoice and the parent's screen say. `offer_id` is
-- what the grouping keys on. An offer is not a person and leaks nothing.

begin;

-- `drop` first: `create or replace view` cannot add a column in the middle of the list, and
-- cannot change `security_invoker`. Both are true here, and `0085`'s mutation-check note records
-- the first the hard way — a `create or replace` that silently refuses looks like a success.
drop view if exists meal_pack_money;

create view meal_pack_money
with (security_invoker = false)
as
select
  mp.id                                  as meal_pack_id,
  -- `E21-87`. The identity, not the label. Both, because they answer different questions.
  mp.offer_id,
  mp.school_id,
  mp.name_snapshot,
  mp.purchased_at,
  mp.expires_at,
  mp.status,
  mp.price_paid_paise,
  mp.cgst_paise + mp.sgst_paise          as tax_paise,
  mp.items_original,
  mp.valued_remaining,
  meal_pack_deferred_paise(mp)           as deferred_paise,

  -- The giveaway, in items and separately from everything else.
  mp.bonus_items                         as bonus_items_offered,
  (mp.bonus_granted_at is not null)      as bonus_granted,
  mp.bonus_granted_at,
  coalesce((select sum(r.bonus_used) from meal_pack_redemption r
             where r.meal_pack_id = mp.id and r.state = 'confirmed'), 0) as bonus_items_redeemed,
  mp.bonus_remaining                     as bonus_items_outstanding,

  -- Revenue recognised so far is what the money bought less what is still owed. One subtraction,
  -- not a sum over postings, so it cannot disagree with the ledger while the invariant holds.
  mp.price_paid_paise - meal_pack_deferred_paise(mp) as revenue_recognised_paise,
  coalesce((select sum(r.valued_items) from meal_pack_redemption r
             where r.meal_pack_id = mp.id and r.state = 'confirmed'), 0) as valued_items_redeemed,
  coalesce(e.breakage_paise, 0)          as breakage_paise
from meal_pack mp
left join meal_pack_expiry e on e.meal_pack_id = mp.id
where mp.status <> 'pending'
  -- `E21-86`. THE GUARD, and it is in the view because the view is the only way in. A definer
  -- view without this would hand every pack's money to any authenticated caller — which is the
  -- failure mode a definer view always risks and the reason the bar for one is high.
  and auth_can_platform('orders.view_financials');

comment on view meal_pack_money is
  'Pack money for the back office. security_definer with auth_can_platform(orders.view_financials) '
  'in its own WHERE — E21-86: as an invoker view it returned ZERO ROWS to the only audience it '
  'has, because meal_pack''s only read policy is meal_pack_read_own and a back-office account owns '
  'no packs. The screen would have printed a confident zero. Safe as a definer view for the reason '
  'E21-63 established: it carries no recipient, no customer and no name, and the rebuild removed '
  'recipient_id from meal_pack_redemption entirely, so there is no child identity in its lineage. '
  'Bonus items are reported as COUNTS because no cost basis exists in this schema to value them '
  'with, for a pack meal or a cash one (P26, E21-88).';

grant select on meal_pack_money to authenticated;

commit;
