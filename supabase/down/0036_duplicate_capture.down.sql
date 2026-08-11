-- Rollback for 0036 — the index goes back to forbidding any second capture.
--
-- **This fails if a duplicate has been recorded, and that failure is correct.** Restoring the
-- narrower index would either refuse to build (two captured rows for one group) or, if the
-- column were dropped first, silently discard the only record that a customer was charged
-- twice. Neither is a rollback; the first is honest and the second is data loss on a financial
-- record. So the index is rebuilt first and the column dropped after: if there is a duplicate in
-- the table, this stops at the index and nothing is lost.
drop index if exists ix_payment_duplicate_of;
drop index if exists uq_payment_one_capture_per_group;

create unique index uq_payment_one_capture_per_group
  on payment (order_group_id)
  where status = 'captured';

alter table payment drop constraint if exists payment_duplicate_is_not_self;
alter table payment drop column if exists duplicate_of_payment_id;
