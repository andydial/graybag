-- Down for 0067. Removes resume, abandon and expiry.
--
-- **Applying this strands parents again.** It restores the state in which a dismissed Razorpay
-- sheet leaves an order at `pending_payment` for ever: unpayable, uncancellable, and blocking
-- that child's erasure, under a message promising it will close by itself. Two real parents sat
-- in it for six days.
--
-- `checkout_abandoned` is deliberately NOT deleted from `reason_code`. Orders already cancelled
-- with it would be left pointing at a missing code, and a reason a customer has already been
-- shown is not ours to retract.

drop function if exists expire_checkout_group(uuid);
drop function if exists expirable_with_live_attempt(integer);
drop function if exists expire_stale_checkouts(integer);
drop function if exists abandon_checkout(uuid, uuid);
drop function if exists reusable_payment_attempt(uuid, uuid);
drop function if exists checkout_resumable(order_group);
drop function if exists checkout_expires_at(order_group);
