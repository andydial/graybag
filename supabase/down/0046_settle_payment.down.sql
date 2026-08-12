-- Rollback for 0046 — nothing can turn a capture into a confirmed order.
--
-- Webhooks still record (`E06-04` is unaffected), so no event is lost; they simply accumulate at
-- `pending` with nothing to process them, and every paid customer's order stays at
-- `pending_payment` until the sweeper cancels it. Money in, no order — which is why this
-- function exists.
drop function if exists settle_payment(text, text, bigint);
