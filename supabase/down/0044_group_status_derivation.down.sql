-- Rollback for 0044 — `order_group.status` stops being maintained.
--
-- It does not revert to anything sensible: every group keeps whatever value it last derived, and
-- new groups sit at the column default for ever. `payment_failed`, `partially_refunded` and
-- `refunded` become unreachable at the group level again, and the customer's order list and the
-- reconciliation report both read a status nothing updates.
drop trigger if exists derive_group_status on refund;
drop trigger if exists derive_group_status on payment;
drop trigger if exists derive_group_status on "order";
drop function if exists derive_order_group_status();
