-- =============================================================================
-- Cancelling an order tells the parent, and says why — `E09-38`.
--
-- Andy, 2026-08-20: *"the system should send the email with cancellation reason but the available
-- cancel reasons are also not enough — please add a text box where Kitchen staff should have to
-- type in reason and details. System should include that in the cancel notification email."*
--
-- Two things were missing, and the second is the one that mattered.
--
-- 1. **There was nowhere to put the detail.** `reason_code` has carried a `requires_note` column
--    since `0001` — "forces free text in admin" — and no table ever had a column to store the
--    note it was forcing. The flag has been inert since the schema was written.
--
-- 2. **No cancellation email existed at all**, on either path. Neither `kitchen-order-status`
--    (staff) nor `cancel-order` (the parent's own) sends anything. An order cancelled at 9am
--    simply stopped existing from the parent's side: no food at the break, no message, and — the
--    consequence Andy actually hit — no way for staff to tell them, because kitchen staff cannot
--    read a customer's email address and must not be able to (§13.3 rule 4, `0002`).
--
--    That last point is why the fix is a notice from the system rather than a contact detail on
--    the board. Handing kitchen staff the parent's address would solve the same problem by
--    breaking a rule this schema goes out of its way to enforce.
--
-- ## The detail is free text a member of staff typed
--
-- Which means it must be treated as **potentially containing a child's name**, whatever the box
-- says. Non-negotiable #4 applies to it in full: it is never logged, never sent to Sentry, and
-- never reaches `notification_delivery` (`E20-10` keeps rendered bodies out of that table). It
-- goes to exactly one place — the email to the person who placed that order, about their own
-- order — and it sits on the order row, under the same RLS as the rest of it.
--
-- The length cap is a data-quality bound, not a security one: it is what stops somebody pasting
-- a page of log output into an email to a parent.
-- =============================================================================

alter table "order"
  add column if not exists cancel_reason_detail text;

alter table "order"
  drop constraint if exists order_cancel_reason_detail_length;

alter table "order"
  add constraint order_cancel_reason_detail_length
  check (cancel_reason_detail is null or char_length(cancel_reason_detail) between 1 and 500);

comment on column "order".cancel_reason_detail is
  'E09-38. What the person cancelling typed, in their words, sent verbatim to the customer in the cancellation email. Free text: treat as tier-P data (non-negotiable #4) — never log it, never send it to Sentry. Nullable because every order cancelled before this migration has none, and because the parent-initiated path at cancel-order does not ask for one.';

-- -----------------------------------------------------------------------------
-- One cancellation email per order.
--
-- `uq_notification_one_per_order_group` is partial on `order_group_id is not null`, so it does
-- not dedupe anything keyed on a single order — the trap `0056` hit and documented. A
-- cancellation is per **order**: one order in a group can be cancelled while its siblings are
-- delivered, so the group is the wrong grain and the existing index would not have fired.
--
-- Same shape as `0050` otherwise, for the same reasons: the insert is the claim, `23505` reads as
-- "already sent", and it is partial on `status <> 'failed'` so a provider outage stays retryable.
-- -----------------------------------------------------------------------------

create unique index if not exists uq_notification_one_per_order
  on notification_delivery (order_id, template_code, channel)
  where order_id is not null and status <> 'failed';

comment on index uq_notification_one_per_order is
  'E09-38. Per-order equivalent of uq_notification_one_per_order_group. A cancellation is per order, not per group — one order in a group can be cancelled while the rest are delivered — and the group index is partial on order_group_id is not null, so it would never have deduped these. The insert in the notice sender is the lock.';
