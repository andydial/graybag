-- =============================================================================
-- 0038_ledger_posting.sql — the one way to write to the ledger. `E06-07`, step 2.
-- =============================================================================
--
-- Everything the ledger needs to be *trustworthy* already exists: `ledger_entry` is append-only
-- (`0001`), a deferred constraint trigger refuses a transaction whose entries do not sum to zero
-- (`I10`), `ledger_balance()` consults each account's `normal_balance` so no caller picks a sign
-- (`M9`), the reason codes exist (`0013`) and the accounts exist (`0035`).
--
-- **What is missing is the way in.** Without it every caller assembles a transaction and its
-- entries by hand, in its own order, with its own idea of what a valid posting is. The zero-sum
-- trigger would catch the worst of it — at COMMIT, having already run the rest of the
-- transaction — and nothing at all would catch a posting that balances and is wrong.
--
-- `docs/e06-build-plan.md` step 2: build the ledger before anything that posts to it. *A ledger
-- retrofitted under a working payment flow is a ledger whose invariants were negotiated against
-- code that already existed.* No Razorpay appears in this file and none should.
--
-- =============================================================================
-- WHAT `post_ledger_transaction` GUARANTEES
-- =============================================================================
--
-- 1. **Two entries or more.** A single-entry "transaction" is not double-entry bookkeeping; it
--    is a note. `transaction_has_entries` catches an empty one nightly; this refuses it outright.
-- 2. **Every amount strictly positive.** Direction carries the sign, and it is the only thing
--    that does. A negative credit is a debit written by someone who did not know that, and it
--    would balance — which is exactly why it must be refused here rather than found later.
-- 3. **Debits equal credits.** Checked in the function so the caller gets a usable error naming
--    both totals, rather than a deferred trigger firing at COMMIT with the statement long gone.
--    The trigger stays: this is the ergonomic check, that is the guarantee.
-- 4. **Accounts exist, are active, and are named by CODE.** A posting says
--    `provider:razorpay:clearing`, never a uuid — the ids are environment-specific, the codes
--    are not, and a payments handler holding an account uuid is a payments handler that breaks
--    when the seed is re-run.
-- 5. **The reason code is a LEDGER reason.** `ledger_transaction.reason_code` references
--    `reason_code(code)` generally, so `customer_request` — a refund reason — would satisfy the
--    foreign key and put a cancellation vocabulary on a money movement. The category is checked.
-- 6. **Idempotent when given a key.** See below.
--
-- =============================================================================
-- IDEMPOTENCY, AND WHY IT IS HERE RATHER THAN IN THE WEBHOOK
-- =============================================================================
--
-- A webhook is delivered more than once. That is normal, documented, and §7.1 answers it in four
-- layers — but every one of those layers is upstream of this function, and the failure they are
-- protecting against is **money counted twice in the ledger**. A guard at the point of harm costs
-- one partial unique index.
--
-- `p_idempotency_key` is optional because not every posting has a natural one (a manual
-- adjustment does not). When supplied, a second call with the same key **returns the existing
-- transaction id and writes nothing**. It does not raise: a retried webhook is not an error, and
-- a handler forced to distinguish "already done" from "failed" will get it wrong.
--
-- **It deliberately does not compare the entries.** If the same key arrives with different
-- amounts, that is a bug upstream and this returns the first posting — the alternative, posting
-- the second, would mean a retry could change history in an append-only ledger. The nightly
-- checks and tier-2 reconciliation are what find a wrong amount; nothing here can.
--
-- =============================================================================
-- CORRECTIONS ARE REVERSALS
-- =============================================================================
--
-- `ledger_entry` is append-only, so a mistaken posting is not edited or deleted — it is answered
-- by an equal and opposite transaction. `reverse_ledger_transaction()` writes that, links it
-- through `reversal_of_transaction_id`, and refuses to reverse the same transaction twice.
--
-- The reversal keeps the original's `reason_code`, which reads oddly for about a second and is
-- right: the reversal of a `sale` is part of the story of that sale, and giving it its own
-- vocabulary would mean the two halves of one correction could not be found together.
-- =============================================================================

alter table ledger_transaction
  add column if not exists idempotency_key text;

comment on column ledger_transaction.idempotency_key is
  'Optional. When supplied, post_ledger_transaction() returns the existing transaction instead of posting a second one — a webhook is delivered more than once and the failure that matters is money counted twice. NOT compared against the entries: a repeat with different amounts returns the FIRST posting, because a retry must never rewrite an append-only ledger. E06-07.';

create unique index if not exists uq_ledger_transaction_idempotency
  on ledger_transaction (idempotency_key)
  where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- The only way to write a ledger transaction.
-- -----------------------------------------------------------------------------
create or replace function post_ledger_transaction(
  p_reason_code       text,
  p_source_type       ledger_source_type,
  p_source_id         uuid,
  -- `[{"account": "platform:revenue", "direction": "credit", "amount_paise": 10000}, …]`
  p_entries           jsonb,
  p_occurred_at       timestamptz default now(),
  p_correlation_id    uuid        default null,
  p_memo              text        default null,
  p_created_by_user_id uuid       default null,
  p_idempotency_key   text        default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid;
  v_existing       uuid;
  v_count          int;
  v_debits         bigint;
  v_credits        bigint;
  v_unknown        text;
begin
  -- Already posted? Return it and write nothing. Before any validation: a retry of a posting we
  -- accepted must not start failing because the vocabulary changed underneath it.
  if p_idempotency_key is not null then
    select id into v_existing
      from ledger_transaction where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'entries must be a JSON array'
      using errcode = 'P0001', hint = 'entries_malformed';
  end if;

  -- A ledger reason, not a cancellation one. The foreign key alone would accept `customer_request`.
  if not exists (
    select 1 from reason_code
     where code = p_reason_code and category = 'ledger'
  ) then
    raise exception 'reason code % is not a ledger reason', p_reason_code
      using errcode = 'P0001', hint = 'reason_code_not_ledger';
  end if;

  create temporary table if not exists tmp_posting (
    account_id   uuid,
    direction    ledger_direction,
    amount_paise bigint
  ) on commit drop;
  delete from tmp_posting;

  insert into tmp_posting (account_id, direction, amount_paise)
  select a.id, (e->>'direction')::ledger_direction, (e->>'amount_paise')::bigint
    from jsonb_array_elements(p_entries) e
    left join ledger_account a
      on a.code = (e->>'account') and a.is_active;

  select count(*) into v_count from tmp_posting;
  if v_count < 2 then
    raise exception 'a ledger transaction needs at least two entries, got %', v_count
      using errcode = 'P0001', hint = 'entries_too_few';
  end if;

  -- Named, so the error says WHICH account. "one of your accounts does not exist" is a message
  -- that sends somebody to read the whole payload.
  select string_agg(e->>'account', ', ') into v_unknown
    from jsonb_array_elements(p_entries) e
   where not exists (
     select 1 from ledger_account a where a.code = (e->>'account') and a.is_active);
  if v_unknown is not null then
    raise exception 'no active ledger account: %', v_unknown
      using errcode = 'P0001', hint = 'account_unknown';
  end if;

  if exists (select 1 from tmp_posting where amount_paise is null or amount_paise <= 0) then
    -- Direction carries the sign and is the only thing that does. A negative credit is a debit
    -- written by somebody who did not know that — and it would BALANCE, which is why it cannot
    -- be left to the zero-sum trigger.
    raise exception 'every entry amount must be a positive integer number of paise'
      using errcode = 'P0001', hint = 'amount_not_positive';
  end if;

  select coalesce(sum(amount_paise) filter (where direction = 'debit'), 0),
         coalesce(sum(amount_paise) filter (where direction = 'credit'), 0)
    into v_debits, v_credits
    from tmp_posting;

  if v_debits <> v_credits then
    -- The deferred trigger would catch this at COMMIT, by which point the statement that caused
    -- it is long gone. Raising here names both totals while the caller can still act on it.
    raise exception 'ledger transaction does not balance: debits %, credits %', v_debits, v_credits
      using errcode = 'P0001', hint = 'unbalanced';
  end if;

  insert into ledger_transaction (reason_code, source_type, source_id, occurred_at,
                                  correlation_id, memo, created_by_user_id, idempotency_key)
  values (p_reason_code, p_source_type, p_source_id, p_occurred_at,
          p_correlation_id, p_memo, p_created_by_user_id, p_idempotency_key)
  returning id into v_transaction_id;

  insert into ledger_entry (transaction_id, account_id, direction, amount_paise)
  select v_transaction_id, account_id, direction, amount_paise from tmp_posting;

  return v_transaction_id;
end;
$$;

comment on function post_ledger_transaction(text, ledger_source_type, uuid, jsonb, timestamptz, uuid, text, uuid, text) is
  'THE way to write to the ledger (E06-07). Refuses fewer than two entries, a non-positive amount, an unbalanced posting, an unknown or inactive account, and a reason code that is not category=ledger. Accounts are named by CODE, never by uuid — ids are environment-specific and codes are not. With an idempotency key, a repeat returns the existing transaction and writes nothing, because a webhook is delivered more than once and money counted twice is the failure that matters.';

-- -----------------------------------------------------------------------------
-- A correction is a new transaction, never an edit.
-- -----------------------------------------------------------------------------
create or replace function reverse_ledger_transaction(
  p_transaction_id     uuid,
  p_memo               text default null,
  p_created_by_user_id uuid default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_original ledger_transaction%rowtype;
  v_new_id   uuid;
begin
  select * into v_original from ledger_transaction where id = p_transaction_id;
  if not found then
    raise exception 'no such ledger transaction'
      using errcode = 'P0001', hint = 'transaction_not_found';
  end if;

  if v_original.reversal_of_transaction_id is not null then
    -- Reversing a reversal is a re-posting, and it should be written as one so the intent is
    -- legible. Two entries that cancel and then uncancel are three transactions telling a story
    -- nobody can read.
    raise exception 'that transaction is itself a reversal'
      using errcode = 'P0001', hint = 'already_a_reversal';
  end if;

  if exists (select 1 from ledger_transaction
              where reversal_of_transaction_id = p_transaction_id) then
    raise exception 'that transaction has already been reversed'
      using errcode = 'P0001', hint = 'already_reversed';
  end if;

  -- The original's reason code, deliberately: the reversal of a `sale` is part of the story of
  -- that sale, and its own vocabulary would mean the two halves of one correction could not be
  -- found together. `occurred_at` is NOW, not the original's — the money moved back today, and
  -- back-dating it would misstate every balance-as-at query between the two dates.
  insert into ledger_transaction (reason_code, source_type, source_id, occurred_at,
                                  correlation_id, memo, created_by_user_id,
                                  reversal_of_transaction_id)
  values (v_original.reason_code, v_original.source_type, v_original.source_id, now(),
          v_original.correlation_id,
          coalesce(p_memo, 'Reversal of ' || p_transaction_id::text), p_created_by_user_id,
          p_transaction_id)
  returning id into v_new_id;

  insert into ledger_entry (transaction_id, account_id, direction, amount_paise)
  select v_new_id, e.account_id,
         case e.direction when 'debit' then 'credit'::ledger_direction
                          else 'debit'::ledger_direction end,
         e.amount_paise
    from ledger_entry e
   where e.transaction_id = p_transaction_id;

  return v_new_id;
end;
$$;

comment on function reverse_ledger_transaction(uuid, text, uuid) is
  'The only correction an append-only ledger has: an equal and opposite transaction, linked by reversal_of_transaction_id. Keeps the original reason code so both halves of one correction are found together, and stamps occurred_at with NOW rather than the original date — the money moved back today, and back-dating would misstate every balance-as-at query between the two. Refuses to reverse a reversal, or to reverse the same transaction twice.';

revoke all on function post_ledger_transaction(text, ledger_source_type, uuid, jsonb, timestamptz, uuid, text, uuid, text) from public;
revoke all on function reverse_ledger_transaction(uuid, text, uuid) from public;
grant execute on function post_ledger_transaction(text, ledger_source_type, uuid, jsonb, timestamptz, uuid, text, uuid, text) to service_role;
grant execute on function reverse_ledger_transaction(uuid, text, uuid) to service_role;
