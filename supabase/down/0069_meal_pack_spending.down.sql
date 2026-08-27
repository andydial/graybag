-- Down for 0069. Removes spending, returning, eligibility and the invariant check.
--
-- **Applying this leaves the tables from 0068 with no way to move a balance**, which is the
-- safe direction: meals become unspendable rather than spendable without a ledger entry. Existing
-- packs and redemptions are untouched — they are a record of money taken and food owed, and are
-- not this migration's to delete.

drop function if exists check_meal_pack_ledger_invariant();
drop function if exists return_meal_pack_meal(uuid, text);
drop function if exists spend_meal_pack_meals(uuid, int);
drop function if exists meal_pack_ineligibility_reason(uuid, uuid);
