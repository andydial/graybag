-- Rollback for 0053.
--
-- Dropping `cancel_order` removes the only path by which a parent can cancel; the
-- `cancel-order` Edge Function starts answering 500 and the button on Order detail fails.
-- Nothing is corrupted by that — no state is left half-written, because every guard and both
-- writes are inside one transaction.
--
-- **Refunds already recorded are deliberately left alone.** They are requests for money that
-- a human may already have sent from the Razorpay dashboard, and deleting the record of a
-- disbursement that happened is how a parent gets refunded twice.
drop function if exists cancel_order(uuid, uuid);

notify pgrst, 'reload schema';
