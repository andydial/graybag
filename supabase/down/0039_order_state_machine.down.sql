-- Rollback for 0039 — removes the enforcement, and it is worth being plain about what that
-- means: `update "order" set status = 'delivered'` on a `pending_payment` row succeeds again.
-- That is the kitchen cooking against money that has not arrived (`L5`), and a captured payment
-- can be downgraded to `authorized` by an out-of-order webhook (`L3`).
--
-- `order_event` rows already written are left alone. They are history, and history is not
-- deleted because the thing that wrote it was removed.
drop trigger if exists assert_payment_transition on payment;
drop trigger if exists write_status_event on "order";
drop trigger if exists assert_status_transition on "order";
drop function if exists assert_payment_status_transition();
drop function if exists write_order_event();
drop function if exists assert_order_status_transition();
