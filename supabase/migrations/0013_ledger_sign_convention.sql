-- =============================================================================
-- 0013_ledger_sign_convention.sql
--
-- `E06-22` (the ledger cannot record anything) and `E06-31` (the sign convention is
-- undefined). Andy's ruling 2026-08-10: resolve the sign question **structurally**, not by
-- picking a convention and writing it down.
-- =============================================================================
--
-- TWO PROBLEMS, AND THE SECOND ONE IS THE DANGEROUS ONE
--
-- **1. No ledger posting can be written at all.** `ledger_transaction.reason_code` is
-- `not null references reason_code(code)`, and all eight seeded codes are cancellation or
-- refund reasons. Not a thin vocabulary — the first `insert` fails on a foreign key. This
-- blocks `E06-07` outright and is fixed below by seeding the `category = 'ledger'` set.
--
-- **2. Nothing ties an account's type to which way its balance runs.** `ledger_account`
-- already carries `normal_balance`, and `assert_ledger_transaction_balances` already
-- enforces that debits minus credits is zero per transaction — that part was never
-- missing. What was missing is that **a wallet is a liability and a provider clearing
-- account is an asset, and their balances therefore run in opposite directions**, with
-- nothing stopping a wallet account being created `normal_balance = 'debit'`.
--
-- The failure that makes this worth a migration rather than a comment: a single-signed
-- `balance()` helper produces plausible numbers for both and is wrong for one, and the
-- nightly assertion meant to catch the drift is the thing computing it wrongly. Nothing
-- about it looks like a bug. The numbers are numbers.
--
-- -----------------------------------------------------------------------------
-- HOW IT IS RESOLVED STRUCTURALLY
--
-- Three things, none of which is a convention anyone has to remember:
--
--   a. **A CHECK constraint** pins `normal_balance` per `account_type`. A wallet account
--      with a debit normal balance cannot be inserted. The mapping stops being a table in
--      a document and becomes a thing the database refuses.
--
--   b. **One balance function, which reads the account's own `normal_balance`.** There is
--      no way to write a single-signed helper, because there is only one helper and it
--      consults the account before it decides which way to add. Getting a wallet balance
--      and a clearing balance both right is not a thing the caller can get wrong.
--
--   c. **The nightly assertion checks structure, not arithmetic.** It asks "does every
--      transaction sum to zero" and "does every account's normal balance match its type" —
--      invariants that are true or false regardless of which convention anyone had in
--      mind. It does not recompute a balance and compare it with another balance, because
--      two derivations sharing one sign error agree with each other.
--
-- -----------------------------------------------------------------------------
-- WHAT IS STILL MISSING AFTER THIS
--
-- `E06-23` — `bank` is not a `ledger_account_type`, so a settlement still has nowhere to
-- land and `provider:razorpay:clearing` never clears. Left out deliberately:
-- `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, so the value
-- and its first use must be two migrations, and that pairing belongs with the settlement
-- work rather than with the sign convention.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The vocabulary. `E06-22`.
--
-- Ten money movements plus `provider_initiated` for `[PAY-07]`'s dashboard refunds. Names
-- match `docs/payments-design.md` §10 exactly — a ledger whose reason codes disagree with
-- the design document is a reconciliation report nobody can read.
--
-- `is_customer_visible` is false for all of them: these name an internal movement, not a
-- reason a parent is shown. `[DM-22]` covers what a customer sees, and it is about
-- cancellation and refund reasons, not these.
-- -----------------------------------------------------------------------------
insert into reason_code (code, category, display_name, requires_note, is_customer_visible) values
  ('sale',                  'ledger', 'Sale',                          false, false),
  ('provider_fee',          'ledger', 'Payment provider fee',          false, false),
  ('settlement',            'ledger', 'Provider settlement',           false, false),
  ('wallet_hold',           'ledger', 'Wallet hold at checkout',       false, false),
  ('wallet_hold_reversal',  'ledger', 'Wallet hold reversed',          false, false),
  ('refund_to_wallet',      'ledger', 'Refund to wallet',              false, false),
  ('refund_to_source',      'ledger', 'Refund to original method',     false, false),
  ('revenue_share',         'ledger', 'School revenue share',          false, false),
  ('refund_mdr_recovery',   'ledger', 'MDR recovered on refund',       false, false),
  ('payout',                'ledger', 'Payout to school',              false, false),
  ('provider_initiated',    'ledger', 'Raised in the provider dashboard', true, false)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. The sign convention, as a constraint. `E06-31`(a).
--
--   asset-like      -> debit normal   (a positive balance means "we hold this")
--   liability-like  -> credit normal  (a positive balance means "we owe this")
--
--   wallet             liability  credit   we owe the parent their refund credit
--   payable            liability  credit   we owe a school its share
--   tax_payable        liability  credit   we owe the government its GST
--   revenue            income     credit   income is credit-normal
--   receivable         asset      debit    somebody owes us
--   provider_clearing  asset      debit    money captured and not yet settled to bank
--   provider_fees      expense    debit    expenses are debit-normal
--   suspense           asset      debit    pinned rather than left free: an unclassified
--                                          item is held as a debit and goes negative when
--                                          it is credit-natured, which is what a suspense
--                                          account is for. Leaving it either-way would put
--                                          one hole in an otherwise total constraint.
-- -----------------------------------------------------------------------------
alter table ledger_account
  add constraint ledger_account_normal_balance_matches_type check (
    (account_type in ('wallet', 'payable', 'tax_payable', 'revenue') and normal_balance = 'credit')
    or
    (account_type in ('receivable', 'provider_clearing', 'provider_fees', 'suspense')
       and normal_balance = 'debit')
  );

comment on column ledger_account.normal_balance is
  'Which way this account runs. NOT free to choose: ledger_account_normal_balance_matches_type pins it per account_type (0013, E06-31). A wallet is a liability and runs credit; provider_clearing is an asset and runs debit.';

-- -----------------------------------------------------------------------------
-- 3. The one balance function. `E06-31`(b).
--
-- Reads `normal_balance` from the account, so a caller cannot pick a direction and cannot
-- get one account right and another wrong. A positive result always means "this account
-- holds what it is supposed to hold".
-- -----------------------------------------------------------------------------
create function ledger_balance(p_account_id uuid) returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    sum(case when e.direction = a.normal_balance then e.amount_paise else -e.amount_paise end),
    0
  )::bigint
  from ledger_entry e
  join ledger_account a on a.id = e.account_id
  where e.account_id = p_account_id;
$$;

comment on function ledger_balance(uuid) is
  'The ONLY way to read a ledger balance (E06-31). Consults the account''s normal_balance, so a single-signed helper — the failure mode that produces plausible numbers for every account and correct ones for half — cannot be written.';

-- -----------------------------------------------------------------------------
-- 4. The nightly integrity assertion. `E06-31`(c), feeding `E06-11`.
--
-- Returns one row per check with a failure count, rather than raising: the nightly job
-- wants to report everything that is wrong in one run, not stop at the first.
--
-- Every check here is STRUCTURAL — a property that is true or false without reference to
-- any convention. Deliberately absent: "recompute the clearing balance and compare it to
-- the sum of captures". Two derivations that share a sign error agree with each other, so
-- that check would pass in exactly the case it exists to catch.
--
-- The one comparison that IS included is `wallet_balance` against the ledger, and it earns
-- its place by comparing two things maintained by *different* code paths (`I8`,
-- `[DM-04]`): the maintained column is written at checkout, the entries by the posting.
-- A drift between them is real information.
-- -----------------------------------------------------------------------------
create function assert_ledger_integrity()
returns table (check_name text, failures bigint, detail text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
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
     (a.account_type in ('receivable','provider_clearing','provider_fees','suspense')
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
$$;

comment on function assert_ledger_integrity() is
  'Nightly, under E06-11. One row per check with a failure count. Structural invariants only — it never compares two derivations that could share a sign error.';
