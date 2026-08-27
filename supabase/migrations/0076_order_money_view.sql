-- `E02-36`, **step 1 of four**: the view, and nothing else.
--
-- The proposal is `docs/proposals/E02-36-order-money-column-grant.md`, written by the web thread,
-- and this lands exactly its step 1. **The `revoke select` is deliberately NOT here.**
--
-- ## Why the split matters more than the SQL
--
-- The original sequencing had the client change first and the whole DDL after. The web thread
-- checked rather than reasoned, and found that a client shipped against a view that does not exist
-- 404s every money read on production at once — `/reports`, `/admin/sales`, `/orders` and a
-- parent's own order screen. The DDL is two steps, and only one of them has a blast radius:
--
--   1. **this migration** — `create view` + `grant`. Purely additive. Nobody reads it yet, every
--      existing query still works, and it is safe to land at any time.
--   2. web thread — point `admin-orders`, `admin-reports`, `admin-growth`, `orders` and `checkout`
--      at `order_money`. Works before the revoke (the view exists) and after it (the view is
--      definer).
--   3. mobile thread — the `revoke select`, once nothing reads money off the base table.
--   4. web thread — invert `kitchen-scope.test.mjs`.
--
-- **`kitchen-scope.test.mjs` still passes after this migration**, because nothing is revoked yet.
-- It fails when step 3 lands, and that failure is the intended signal rather than a regression.
--
-- ## It takes 0076, and PR #147 renumbers
--
-- `main` is at `0075`, and PR #147 (`E21-48`, unmerged) also holds `0076`–`0079`. My first
-- instinct was to number this `0080` and leave a gap, on the grounds that a gap is harmless where
-- a collision is not — and `check-migrations` refused it: versions run consecutively from `0001`
-- with no gaps, because a gap is indistinguishable from a migration someone forgot to commit.
--
-- So this takes `0076` (it ships first) and #147's four are renumbered to `0077`–`0080`. That is
-- safe precisely because #147 has not merged; the numbers only become permanent on `main`. This
-- view depends on nothing in that PR — only `"order"` and `auth_can_on_order`, both long landed.

begin;

/**
 * The only path to order money for an authenticated caller.
 *
 * **Definer, not invoker.** It has to keep the privileges that step 3 revokes from `authenticated`
 * — `security_invoker = true` would make the view hit the revoke and return nothing, which is the
 * opposite of the point.
 *
 * The predicate is the rule. RLS filters rows and cannot filter columns, and there is exactly one
 * `authenticated` role shared by parents, admins and kitchen staff — so no policy and no column
 * grant can express "this authenticated user but not that one". A `where` clause can.
 *
 * ## `auth_is_live_user()` is here because a definer view bypasses RLS entirely
 *
 * **Not in the proposal, and it needs to be.** `authorization.test.sql` asserts that every view in
 * `public` is `security_invoker`, precisely because a definer view skips the base table's
 * policies — and `"order"` carries a RESTRICTIVE `deny_dead_accounts` using `auth_is_live_user()`.
 *
 * Without this clause a disabled or deleted account would read its own order money through the
 * view, where RLS refuses it on the table. The view has to restate every restriction it bypasses,
 * not only the one it exists to work around. Restating it is the price of being definer.
 *
 * The two permissive halves below mirror `order_read_customer` and the back-office read, narrowed
 * from `orders.view` to `orders.view_financials` — which is the actual point of the ticket.
 */
create or replace view order_money as
  select o.id,
         o.order_ref,
         o.subtotal_paise,
         o.tax_cgst_paise,
         o.tax_sgst_paise,
         o.tax_igst_paise,
         o.discount_paise,
         o.total_paise,
         o.refunded_total_paise
    from "order" o
   where auth_is_live_user()
     and (o.customer_user_id = (select auth.uid())
          or auth_can_on_order(o.id, 'orders.view_financials'));

grant select on order_money to authenticated;

comment on view order_money is
  'E02-36. The only path to order money for an authenticated caller. From step 3 the money columns '
  'are revoked from `authenticated` on the base table, so a kitchen operator — who shares that role '
  'with parents and admins — cannot read them by naming them. Definer rather than invoker, because '
  'it must retain the privileges the revoke removes. service_role is unaffected and Edge Functions '
  'are unchanged.';

commit;
