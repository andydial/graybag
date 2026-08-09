-- Reverses 0013_ledger_sign_convention.sql.
--
-- Dropping the reason codes is deliberately LAST and deliberately guarded: once a ledger
-- transaction references one, it must not vanish underneath it. `on delete restrict` on
-- ledger_transaction.reason_code means the delete simply fails if any posting exists,
-- which is the correct outcome — reverting the vocabulary under a live ledger would
-- orphan real money movements.

drop function if exists assert_ledger_integrity();
drop function if exists ledger_balance(uuid);

alter table ledger_account
  drop constraint if exists ledger_account_normal_balance_matches_type;

delete from reason_code
 where category = 'ledger'
   and code in ('sale','provider_fee','settlement','wallet_hold','wallet_hold_reversal',
                'refund_to_wallet','refund_to_source','revenue_share','refund_mdr_recovery',
                'payout','provider_initiated');
