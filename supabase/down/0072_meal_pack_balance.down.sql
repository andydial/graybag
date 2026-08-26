-- Down for 0072. The balance screen loses its numbers; `parent_has_live_meal_pack` still answers
-- whether a surface renders, so the app would show a balance screen it cannot fill.
drop function if exists meal_pack_balance(uuid);
