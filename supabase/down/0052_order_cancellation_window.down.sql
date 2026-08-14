-- Rollback for 0052.
--
-- Both functions are pure projections of a row that already exists, so dropping them removes
-- two computed columns and nothing else. Order detail returns to rendering "we can't tell when
-- cancelling closes", which is where `E06-42` found it — the safe direction, and the reason
-- this rollback is harmless rather than an incident.
--
-- `0053`'s `cancel_order` calls both, so it must go first if it is present.
drop function if exists cancellation_closes_at("order");
drop function if exists cancellation_allowed("order");

notify pgrst, 'reload schema';
