-- Down for 0077. Purchases can no longer be started, and a paid pack can no longer be activated.
--
-- **Any pack sitting at `pending` is stranded by this**: the money may have arrived and nothing
-- will make it spendable. Check for them before rolling back —
-- `select count(*) from meal_pack where status = 'pending'` — and settle them by hand if there
-- are any.
--
-- irreversible: the `pending` value added to `meal_pack_status` is NOT removed. PostgreSQL cannot
-- drop an enum value, and a row still using one would be orphaned by a type rewrite. It is inert
-- when unused.

drop function if exists activate_paid_meal_pack(uuid, uuid);
drop function if exists start_meal_pack_purchase(uuid, uuid, uuid, text);
