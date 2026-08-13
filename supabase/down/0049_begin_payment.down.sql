-- Rollback for 0049_begin_payment.sql.
--
-- Dropping the function does not touch any `payment` row it created, which is correct: a payment
-- attempt that happened cannot be made not to have happened, and the rows are what `E06-17`'s
-- reconcilers read.
drop function if exists begin_payment(uuid, uuid, text, bigint);
