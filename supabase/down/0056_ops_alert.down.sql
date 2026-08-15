-- Rollback for 0056.
--
-- The table only records that an alert was sent. Dropping it loses that history and, more
-- importantly, loses the dedupe — so if `money-alert.ts` is still deployed it will fail its claim
-- insert, log, and return `failed` on every call. Loud, and not silent, which is the right
-- direction for a rollback of an alerting mechanism.
drop table if exists ops_alert;
