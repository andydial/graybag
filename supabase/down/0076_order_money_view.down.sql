-- Down for 0080.
--
-- Safe **only while step 3 has not landed**. Once the money columns are revoked from
-- `authenticated`, this view is the only path to them and dropping it takes out every money screen
-- — `/reports`, `/admin/sales`, `/orders` and a parent's own order total. Check for the revoke
-- before running this:
--
--   select has_column_privilege('authenticated', '"order"', 'total_paise', 'select');
--
-- `true` means step 3 has not landed and this is safe. `false` means it has, and the revoke must
-- be undone first.

drop view if exists order_money;
