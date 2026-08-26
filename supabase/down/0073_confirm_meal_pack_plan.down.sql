-- Down for 0073. Plans can no longer be confirmed; balances and redemptions already written are
-- untouched, because they are a record of meals a parent has spent.
drop function if exists confirm_meal_pack_plan(uuid, text, jsonb, uuid);
