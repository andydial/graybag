-- =============================================================================
-- 0050_one_confirmation_email.sql — a parent is told once. `E08-03`.
-- =============================================================================
--
-- There are now **two independent routes to settlement**, and that is deliberate: the webhook
-- (push, from Razorpay) and `checkout-status` (pull, from the app polling). Their failure modes do
-- not overlap, which is the whole point — a parent whose process was killed mid-payment is
-- rescued by the second when the first never arrives.
--
-- The cost of two routes is that both reach the "order is paid, tell them" step, and on a normal
-- payment **both run within a second or two of each other**. `settle_payment` is idempotent, so
-- the money is safe; an email is not a database write and has no such protection. Two identical
-- confirmations for one lunch is the kind of defect a parent notices immediately and trusts less
-- afterwards.
--
-- =============================================================================
-- WHY A CONSTRAINT RATHER THAN A CHECK IN THE SENDER
-- =============================================================================
--
-- The obvious fix is "look for an existing row before sending". That is a read followed by a
-- write with no lock between them, and the two routes are racing by construction — the window is
-- exactly as wide as the provider call. Both would read "nothing sent", both would send.
--
-- A unique index makes the second insert fail instead, and the sender treats `23505` as **success
-- already achieved by somebody else** rather than as an error. The wrong state is unreachable
-- rather than merely unlikely, which is the standing preference here.
--
-- Partial on `status <> 'failed'`: a delivery that genuinely failed must be retryable, or a
-- transient provider outage silently costs a parent their only confirmation.
-- =============================================================================

create unique index uq_notification_one_per_order_group
  on notification_delivery (order_group_id, template_code, channel)
  where order_group_id is not null and status <> 'failed';

comment on index uq_notification_one_per_order_group is
  'E08-03. Settlement can be reached twice — by the payments-webhook (push) and by checkout-status (pull) — and on a normal payment both fire within seconds. settle_payment is idempotent; an email is not. This makes the second send fail on 23505, which the sender reads as "already done". Partial on status <> failed so a genuine delivery failure stays retryable.';
