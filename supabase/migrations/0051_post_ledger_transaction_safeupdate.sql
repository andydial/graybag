-- =============================================================================
-- 0051_post_ledger_transaction_safeupdate.sql
--
-- **Every settlement through an Edge Function failed with `21000: DELETE requires a WHERE
-- clause`.** `E06-38`.
-- =============================================================================
--
-- `post_ledger_transaction` clears its per-call temp table with `delete from tmp_posting;`.
-- Hosted Supabase loads **`safeupdate`**, which rejects an unqualified DELETE. A local
-- `supabase start` does not load it. So the statement passed every pgTAP run and raised on every
-- real payment — `settle_payment` calls this, so a captured payment never became a paid order.
--
-- Introduced in `0038`, on 2026-08-12. Not `0050`.
--
-- =============================================================================
-- WHY A REAL PAYMENT APPEARED TO SETTLE EARLIER THIS WEEK
-- =============================================================================
--
-- It did not settle through the product. `pay_TPS11fCrkq0WpF` was settled by me, by hand, with
-- `psql` — and `safeupdate` is not enforced on that connection. The app path has **never**
-- worked. My report that the order settled was true about the row and wrong about how it got
-- there, and this is the correction.
--
-- =============================================================================
-- THE BLAST RADIUS, MEASURED RATHER THAN ASSUMED
-- =============================================================================
--
-- `tmp_posting` is `create temporary table … on commit drop`. A temp table lives in a
-- per-session schema and is invisible to every other session, so this statement could only ever
-- have cleared **this** call's own rows. It could not have deleted another user's data, with or
-- without the guard.
--
-- That is worth stating precisely because the alarming reading is the reasonable one: an
-- unqualified DELETE in a settlement function is exactly where a data-loss bug would live, and
-- checking is cheaper than assuming. `\d tmp_posting` and `0038` line 134 are the evidence.
--
-- **The guard is still right, and stays on.** It is the only thing that caught this, and it
-- caught it in the one environment that matters. What was wrong is the statement.
--
-- The whole function is restated because `create or replace` takes a body, not a patch. The only
-- change is `where true` and the comment above it.
-- =============================================================================

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
  -- **`where true`, and it is load-bearing.** `E05-21`/`0019` is the same bug in
  -- `create_checkout`: hosted Supabase loads **`safeupdate`**, which rejects a DELETE with no
  -- WHERE, and a local `supabase start` does not. So an unqualified clear passes every pgTAP
  -- assertion locally and raises `21000` for every real settlement through PostgREST.
  --
  -- This is the second occurrence. `scripts/check-unqualified-writes.mjs` now fails the smoke
  -- test on the pattern, because the reason it recurred is that nothing in the repository could
  -- see it — the only environment that enforces the rule is the one we do not run tests in.
  delete from tmp_posting where true;

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

