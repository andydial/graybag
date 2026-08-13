-- Rollback for 0031 — the buyer name becomes mandatory again.
--
-- **This can fail, and the failure is correct.** If any invoice has been issued without a buyer
-- name — which `0031` makes lawful and expected — then restoring `not null` cannot succeed
-- without either deleting a statutory record or fabricating a name on one. Both are worse than
-- a failed rollback, so neither is attempted here: the `alter` raises, and whoever ran it has to
-- decide deliberately what to do about invoices that are already in customers' hands.
--
-- Rolling this back also reinstates the defect it fixed: `create_checkout` succeeds, money is
-- taken, and the invoice write then fails `23502` for every account with no name — which is
-- every account (nothing writes `app_user.first_name`, and `P18`'s capture is optional and
-- lands after payment).
alter table invoice drop constraint if exists invoice_buyer_name_required_above_threshold;

alter table invoice alter column buyer_name_snapshot set not null;

comment on column invoice.buyer_name_snapshot is
  'Personal data tier A (§13.3). Retained on erasure because it IS the statutory record (§13.4).';
