-- =============================================================================
-- 0036_duplicate_capture.sql — a genuine double charge can be written down. `[OL-05]`, `E06-20`.
-- =============================================================================
--
-- `uq_payment_one_capture_per_group` — `unique (order_group_id) where status = 'captured'` — is
-- `D16`'s guarantee that two payments never settle one checkout. It is right, and it stays.
--
-- **Its unwritten consequence is the defect.** When a customer really is charged twice — attempt
-- 1 sits pending on a UPI collect, they give up and pay by card, and attempt 1 then succeeds —
-- the second capture **cannot be written to the database at all**. So the one correct response,
-- *record it and then refund it*, is the single thing the schema forbids. The money has already
-- left their account; refusing the INSERT does not put it back.
--
-- The general rule this is an instance of, worth keeping because it will recur:
--
--   **A uniqueness constraint that protects an internal invariant must not also prevent
--   recording something the outside world has already done.**
--
-- Razorpay is the system of record for whether money moved. Our schema has to be able to write
-- down whatever it says, including the things we wish it had not said.
--
-- ## What changes
--
-- `duplicate_of_payment_id` points at the capture this one duplicates, and the partial index
-- gains `and duplicate_of_payment_id is null`. The invariant becomes **"one *primary* capture
-- per group"**, which is what `D16` always meant — a group still cannot have two payments that
-- both count, and now it can have the true record of one that should not have happened.
--
-- `[OL-05]` option (a). Option (b) — parking the duplicate on a synthetic `order_group` — would
-- put a fictional checkout in somebody's order history to protect an index. Option (c),
-- refusing a new attempt while an earlier one is non-terminal, is a **real mitigation and is
-- still wanted** (`E06-18`), but it narrows the race rather than closing it and it cannot help
-- once the money is gone.
--
-- ## The self-reference is the point
--
-- A duplicate names the capture it duplicates, so "which one do we keep" is answered by the row
-- rather than by a timestamp comparison at refund time. `on delete restrict`: the primary
-- capture cannot be deleted while something points at it as the original, and `payment` is
-- append-only in practice anyway.
--
-- The CHECK stops a row naming itself. A payment that is its own duplicate would satisfy the
-- index — `duplicate_of_payment_id is not null` — and mean nothing.
-- =============================================================================

alter table payment
  add column if not exists duplicate_of_payment_id uuid
    references payment(id) on delete restrict;

comment on column payment.duplicate_of_payment_id is
  'The capture this payment duplicates. NULL for every ordinary payment. Set only when the provider really did take the money twice for one checkout ([OL-05]) — attempt 1 pending on UPI, the customer pays by card, attempt 1 then succeeds. uq_payment_one_capture_per_group excludes these rows, so the invariant is "one PRIMARY capture per group", which is what D16 always meant. Recording the duplicate is what makes it refundable and reconcilable; refusing the insert does not un-charge anyone.';

alter table payment add constraint payment_duplicate_is_not_self
  check (duplicate_of_payment_id is null or duplicate_of_payment_id <> id);

comment on constraint payment_duplicate_is_not_self on payment is
  'A payment cannot be its own duplicate. Such a row would satisfy the partial index (the column is not null) and describe nothing.';

-- The index, with the duplicates excluded. Dropped and recreated rather than altered: a partial
-- index''s predicate cannot be changed in place.
drop index if exists uq_payment_one_capture_per_group;

create unique index uq_payment_one_capture_per_group
  on payment (order_group_id)
  where status = 'captured' and duplicate_of_payment_id is null;

comment on index uq_payment_one_capture_per_group is
  'D16, as amended by [OL-05] in 0036: one PRIMARY capture per order group. Rows marked as duplicates are excluded so that a real double charge can be recorded, refunded and reconciled — a uniqueness constraint protecting an internal invariant must not also prevent recording something the outside world has already done.';

-- Finding the duplicates of a capture, which is what a refund path and a reconciliation both
-- need. Partial, because the column is null on essentially every row.
create index ix_payment_duplicate_of on payment (duplicate_of_payment_id)
  where duplicate_of_payment_id is not null;
