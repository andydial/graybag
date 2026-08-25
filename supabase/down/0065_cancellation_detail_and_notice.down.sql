-- Reverses `0065`.
--
-- Dropping the column **destroys what staff typed** on every order cancelled since it was
-- applied, and those words were sent to a parent — so the row is the only remaining record of
-- what they were told. Copy the column out before running this if the cancellations matter.

drop index if exists uq_notification_one_per_order;

alter table "order" drop constraint if exists order_cancel_reason_detail_length;
alter table "order" drop column if exists cancel_reason_detail;
