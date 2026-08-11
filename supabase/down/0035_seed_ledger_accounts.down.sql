-- Rollback for 0035 — removes the seeded accounts and puts the CHECK back as `0013` had it.
--
-- **The delete is guarded by the foreign key and that is deliberate.** `ledger_entry.account_id`
-- references these rows, so once anything has posted, this fails rather than deleting an account
-- out from under a transaction that references it. A ledger with a dangling account is not a
-- ledger. If that happens the right response is to reverse the postings, not to remove the
-- account they name.
delete from ledger_account
 where code in ('provider:razorpay:clearing', 'platform:bank', 'platform:provider_fees',
                'platform:revenue', 'platform:tax_payable:cgst', 'platform:tax_payable:sgst',
                'platform:suspense');

-- `bank` leaves the CHECK. The enum value itself stays — `0034` is declared irreversible and
-- says why — but with no account of that type, it is inert again.
alter table ledger_account drop constraint if exists ledger_account_normal_balance_matches_type;

alter table ledger_account add constraint ledger_account_normal_balance_matches_type check (
  (account_type in ('wallet', 'payable', 'tax_payable', 'revenue')
     and normal_balance = 'credit')
  or
  (account_type in ('receivable', 'provider_clearing', 'provider_fees', 'suspense')
     and normal_balance = 'debit')
);
