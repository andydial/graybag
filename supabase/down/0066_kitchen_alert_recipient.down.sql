-- Reverses `0066`.
--
-- Dropping the table **loses the recipient lists**, and the first symptom is silence: orders keep
-- being paid and nobody is told. Copy the rows out first if any kitchen is relying on them.

drop policy if exists kitchen_alert_recipient_read_admin on kitchen_alert_recipient;
drop table if exists kitchen_alert_recipient;

alter table "order" drop column if exists staff_alert_sent_at;
