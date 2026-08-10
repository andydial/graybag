-- Reverses 0016_change_recipient_school.sql.
--
-- Only the function. School changes already made are ordinary `recipient` rows and are not
-- reverted: a child really did move school, and putting them back would be a data change
-- dressed up as a rollback.
drop function if exists change_recipient_school(uuid, uuid, uuid, text, text);
