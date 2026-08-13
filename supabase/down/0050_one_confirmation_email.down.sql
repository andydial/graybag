-- Rollback for 0050_one_confirmation_email.sql.
--
-- Dropping the index does not delete any `notification_delivery` row, which is correct: the log
-- of what a parent was told is a record of something that happened. What returns with the index
-- gone is the possibility of a second confirmation for one order, so this should only be run if
-- the dedup is being replaced rather than removed.
drop index if exists uq_notification_one_per_order_group;
