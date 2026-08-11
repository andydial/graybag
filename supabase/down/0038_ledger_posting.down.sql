-- Rollback for 0038 — removes the posting API. The ledger's guarantees are untouched: they live
-- in the append-only trigger, the deferred zero-sum trigger and `ledger_balance()`, none of
-- which this migration added.
--
-- What goes with it is the *ergonomics* — the balance check that names both totals, the account
-- lookup by code, the reason-category guard, and idempotency. Callers would go back to
-- assembling transactions by hand, and the zero-sum trigger would go back to being the only
-- thing that notices, at COMMIT.
--
-- `idempotency_key` is dropped last. Any value in it is a record that a posting was made once
-- rather than twice, which has no meaning without the function that reads it.
drop function if exists reverse_ledger_transaction(uuid, text, uuid);
drop function if exists post_ledger_transaction(text, ledger_source_type, uuid, jsonb, timestamptz, uuid, text, uuid, text);
drop index if exists uq_ledger_transaction_idempotency;
alter table ledger_transaction drop column if exists idempotency_key;
