-- Down for 0074. The balance screen can show only the next pack again, so a second pack's expiry
-- becomes invisible until it has passed.
drop function if exists meal_pack_balances(uuid);
