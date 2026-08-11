-- =============================================================================
-- 0035_seed_ledger_accounts.sql — the chart of accounts. `E06-23`, half two of two.
-- =============================================================================
--
-- **`ledger_account` is empty.** Every account the payments design posts to —
-- `provider:razorpay:clearing`, `platform:revenue`, the two tax accounts, `platform:bank` —
-- is named in `docs/payments-design.md` §10 and exists nowhere. The first
-- `insert into ledger_entry` would fail on a foreign key, the same way the first
-- `ledger_transaction` would have failed before `0013` seeded the reason codes.
--
-- So this is the other half of "the ledger cannot record anything today": `0013` gave it a
-- vocabulary for *why* money moved, and this gives it the accounts money moves *between*.
--
-- ## The normal balance is not chosen here — it is derived
--
-- `M9` pinned `normal_balance` per `account_type` with a CHECK, so an account cannot be created
-- on the wrong side of the ledger. That CHECK is extended below to cover `bank`, and every row
-- inserted here states the balance its type requires. **This is the last moment that mapping is
-- written down by hand**; after this, `ledger_balance()` consults the account and no caller ever
-- picks a sign.
--
-- ## Why user wallets are NOT seeded
--
-- A wallet is `owner_type = 'user'` with an `owner_id`, and it belongs to a person who may not
-- exist yet. Wallets are created on demand by the code that first credits one (`E06-09`), not
-- seeded — seeding one per user would mean this migration re-runs whenever somebody registers,
-- which is not a thing migrations do.
--
-- The five below are all `owner_type in ('platform', 'provider')`, which `0001`'s
-- `ledger_account_owner_shape` CHECK requires to have a NULL `owner_id`. They are singletons:
-- there is one GrayBag, and one Razorpay.
--
-- ## Idempotent
--
-- `on conflict (code) do nothing`. Re-running changes nothing, and an environment that already
-- has these keeps its own ids — nothing references a ledger account by a constant id, because
-- postings look them up by `code`.
-- =============================================================================

-- `bank` joins the debit-normal side. An asset: money we hold goes up on the debit side, the
-- same as a receivable and the same as the provider clearing account. The CHECK is recreated
-- rather than added to, because a CHECK is replaced whole.
alter table ledger_account drop constraint if exists ledger_account_normal_balance_matches_type;

alter table ledger_account add constraint ledger_account_normal_balance_matches_type check (
  (account_type in ('wallet', 'payable', 'tax_payable', 'revenue')
     and normal_balance = 'credit')
  or
  (account_type in ('receivable', 'provider_clearing', 'provider_fees', 'suspense', 'bank')
     and normal_balance = 'debit')
);

comment on constraint ledger_account_normal_balance_matches_type on ledger_account is
  'M9: an account cannot be created on the wrong side of the ledger. A wallet is a liability (credit-normal) and a clearing account is an asset (debit-normal), so a single-signed balance helper is right for half the accounts and plausible for the rest — which is why ledger_balance() consults this column instead. `bank` joined the debit side in 0035: money we hold is an asset.';

insert into ledger_account (code, owner_type, owner_id, account_type, normal_balance) values
  -- Money Razorpay is holding on our behalf, between capture and settlement. Debited on
  -- capture, credited when a settlement lands in the bank. Tier-3 reconciliation asserts this
  -- returns to zero (`E06-27`) — which it cannot do while there is nowhere for the money to go.
  ('provider:razorpay:clearing', 'provider', null, 'provider_clearing', 'debit'),

  -- The cash account, and the reason `E06-23` exists. `0034` added the enum value; this is its
  -- first use.
  ('platform:bank', 'platform', null, 'bank', 'debit'),

  -- What Razorpay keeps. Debited with the MDR plus its GST on capture, which is the posting
  -- `docs/data-model.md` §8.4's worked example omitted and `order-lifecycle.md` §8.4 step 6 now
  -- carries — without it the clearing account is permanently overstated by the fee and tier-3
  -- can never balance.
  ('platform:provider_fees', 'platform', null, 'provider_fees', 'debit'),

  -- The sale, exclusive of tax. Credit-normal: revenue increases on the credit side.
  ('platform:revenue', 'platform', null, 'revenue', 'credit'),

  -- Tax collected and owed onward. Two accounts, not one, because `M2` shows CGST and SGST as
  -- separate lines on the invoice and a single combined account could not be reconciled back to
  -- either. There is deliberately **no IGST account**: `SC1` is Mohali only and non-negotiable
  -- #7 forbids the path (`G4` superseded). When there is a second state there is a third row.
  ('platform:tax_payable:cgst', 'platform', null, 'tax_payable', 'credit'),
  ('platform:tax_payable:sgst', 'platform', null, 'tax_payable', 'credit'),

  -- Where a payment lands when we cannot yet say what it was for — an unmatched settlement
  -- line, a webhook for an order we have no record of. `docs/payments-design.md` §10: it must
  -- be possible to record money we do not understand, because refusing to record it does not
  -- make it go away. A non-zero suspense balance is an alert, not an error.
  ('platform:suspense', 'platform', null, 'suspense', 'debit')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- The nightly check has to learn about `bank` too, and this is the whole reason it is here.
--
-- `assert_ledger_integrity()`'s `account_normal_balance` check is `M9`'s **backstop for the
-- constraint itself being removed** — `ledger.test.sql` drops the constraint, flips a wallet to
-- debit-normal and asserts the nightly job notices. Extending the CHECK without extending the
-- function would have left the guard and its backstop disagreeing: `platform:bank` satisfies the
-- constraint and the nightly job would have reported it as a broken account, every night,
-- for ever.
--
-- Which is exactly what happened for the ten minutes between writing the two halves of this
-- migration. Two assertions in `ledger.test.sql` caught it on the first clean run.
--
-- Regenerated from `pg_get_functiondef()` with one list extended and asserted to differ in
-- nothing else, the same discipline `0033` and `0037` use.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_ledger_integrity()
 RETURNS TABLE(check_name text, failures bigint, detail text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Every transaction's debits and credits cancel.
  select 'transaction_balances'::text,
         count(*)::bigint,
         'ledger_transaction rows whose entries do not sum to zero'::text
    from (
      select e.transaction_id
        from ledger_entry e
       group by e.transaction_id
      having sum(case when e.direction = 'debit' then e.amount_paise else -e.amount_paise end) <> 0
    ) bad

  union all

  -- Double-entry means at least two entries. One entry that happens to sum to zero is
  -- impossible (amounts are positive), but a transaction with NO entries is not.
  select 'transaction_has_entries',
         count(*)::bigint,
         'ledger_transaction rows with fewer than two entries'
    from (
      select t.id
        from ledger_transaction t
        left join ledger_entry e on e.transaction_id = t.id
       group by t.id
      having count(e.id) < 2
    ) bad

  union all

  -- The constraint in §2 enforces this going forward; this catches it having been dropped.
  select 'account_normal_balance',
         count(*)::bigint,
         'ledger_account rows whose normal_balance disagrees with their account_type'
    from ledger_account a
   where not (
     (a.account_type in ('wallet','payable','tax_payable','revenue') and a.normal_balance = 'credit')
     or
     (a.account_type in ('receivable','provider_clearing','provider_fees','suspense','bank')
        and a.normal_balance = 'debit')
   )

  union all

  -- Two independently maintained things, compared. I8 / [DM-04].
  select 'wallet_matches_ledger',
         count(*)::bigint,
         'wallet_balance rows that disagree with the ledger'
    from wallet_balance w
    join ledger_account a
      on a.owner_type = 'user' and a.owner_id = w.user_id and a.account_type = 'wallet'
   where w.balance_paise <> ledger_balance(a.id)

  union all

  -- A wallet is a liability: it may be zero, never negative. Cheap, and it is the one
  -- that turns into a support conversation about money that does not exist.
  select 'wallet_never_negative',
         count(*)::bigint,
         'user wallet accounts with a negative balance'
    from ledger_account a
   where a.account_type = 'wallet' and ledger_balance(a.id) < 0;
$function$;
