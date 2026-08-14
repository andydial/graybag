-- =============================================================================
-- 0054_record_refund.sql — a refund issued by hand in the Razorpay dashboard flows back.
-- `E06-46`. T13, §7.3, §8.3.
-- =============================================================================
--
-- `E06-45` records a refund *request* and stops, because the disbursement is manual today.
-- This is the other end: somebody opens the Razorpay dashboard, refunds the charge, and this
-- system has to find out — otherwise the ledger says we hold money we have sent back, the
-- order still reads `cancelled` rather than `refunded`, no credit note exists for a supply
-- that was reversed, and the parent is told nothing.
--
-- =============================================================================
-- DEDUPE ON THE PROVIDER'S REFUND ID. THIS IS THE WHOLE SAFETY PROPERTY.
-- =============================================================================
--
-- **Razorpay refunds are not idempotent.** The `E19` sitting proved it: two identical POSTs to
-- the refunds endpoint made two real refunds, and the customer was paid twice. That is a fact
-- about the provider and it does not change; what changes is whether we compound it.
--
-- A webhook is delivered more than once by design. `refund.processed` for one refund can arrive
-- three times, and if each delivery posted a ledger reversal and moved the order, we would have
-- tripled a refund in our own books over a single real disbursement — the mirror image of the
-- provider's defect, and harder to spot because nothing external disagrees.
--
-- So `provider_refund_id` is the identity of the event, and `uq_refund_provider_refund_id`
-- (`0001`, partial, `where provider_refund_id is not null`) is what makes it impossible rather
-- than merely unlikely. This function checks it **first**, returns `already_recorded` and does
-- nothing else. The index is the guarantee; the check is the courtesy that avoids raising.
--
-- Two refunds that are genuinely distinct have distinct ids and both land. That is correct: the
-- provider really did send money twice, and a ledger that hid the second would be wrong in the
-- more dangerous direction.
--
-- =============================================================================
-- WHY THE ACTOR IS `admin` AND NOT `system`
-- =============================================================================
--
-- A refund may arrive for an order that was never cancelled in the app — somebody just refunded
-- the charge. That order is `paid`, and it has to reach `cancelled` before T13 can make it
-- `refunded` (a refund with no cancellation loses WHY the food was not delivered — `0039`).
--
-- `('UPDATE', 'paid', 'cancelled', 'system')` is **not** in the transition table. Only
-- `kitchen` and `admin` may cancel a paid order (T11/T12), and that is not an oversight to work
-- around: a human with Razorpay dashboard access did this, deliberately, and `admin` is the
-- honest name for them. Recording it as `system` would put a person's decision in the audit log
-- as an automated one.
--
-- =============================================================================
-- PARTIAL REFUNDS ARE REFUSED, DELIBERATELY
-- =============================================================================
--
-- `reverse_ledger_transaction` reverses a whole transaction, and a credit note carries statutory
-- GST particulars. A partial refund needs a proportional reversal and a credit note for part of
-- a supply, with its own rounding rule — that is `E06-08`, and it is real work.
--
-- Recording a partial refund as though it were full would overstate the reversal and issue a
-- credit note for money we did not return: **a wrong statutory document**, which §13.2 makes
-- immutable and therefore uncorrectable. Refusing is visible, and visible is recoverable.
-- =============================================================================

-- =============================================================================
-- FIRST: `reverse_ledger_transaction` could not reverse ANY real settlement.
-- =============================================================================
--
-- Found by writing the fixture for this task, not by reading the code.
--
-- `0001` carries `constraint ledger_transaction_source_unique unique (source_type, source_id,
-- reason_code)`. `reverse_ledger_transaction` (`0038`) deliberately copies **all three** from
-- the original — the reason code because "the reversal of a `sale` is part of the story of that
-- sale", and the source because it is the same event. So the reversal collides with the
-- transaction it reverses, every time, with a `23505`.
--
-- **Every production sale is affected.** `settle_payment` posts `('sale', 'payment',
-- v_payment.id)` with a real id, so no settled order could ever have been reversed.
--
-- It was invisible because `ledger_posting.test.sql` — the one test that exercises a reversal —
-- posts its fixture sale as `('sale', 'payment', null)`, and NULLs are distinct under a unique
-- constraint. The constraint simply never applied to the only transaction anybody had ever
-- tried to reverse. A fixture that is *simpler* than production is not neutral; it is a fixture
-- that tests a different thing, and this is the second time this week that shape has cost
-- something (`E06-45`'s `paid` order with no payment row).
--
-- The fix is to exclude reversals from the uniqueness rather than to give them their own reason
-- code. **The constraint's purpose is idempotency of postings** — one `sale` per payment, so a
-- redelivered webhook cannot post it twice — and a reversal is not a second posting of the same
-- event; it is the correction of one. Renaming its reason code would have satisfied the
-- constraint by breaking what `0038` says the reason code is for, and would have separated the
-- two halves of one correction in every report that groups by it.
--
-- The pair stays bounded at two: `reverse_ledger_transaction` already refuses to reverse the
-- same transaction twice, and refuses to reverse a reversal.
-- =============================================================================

alter table ledger_transaction drop constraint if exists ledger_transaction_source_unique;

create unique index if not exists uq_ledger_transaction_source
  on ledger_transaction (source_type, source_id, reason_code)
  where reversal_of_transaction_id is null;

comment on index uq_ledger_transaction_source is
  'E06-46. Was a table constraint in 0001 and could not coexist with reverse_ledger_transaction, '
  'which copies (source_type, source_id, reason_code) from the original by design — so every '
  'reversal of a real settlement raised 23505 and no settled order could be refunded. Partial on '
  'reversal_of_transaction_id is null: the rule is "one POSTING per source event" (idempotency, '
  'so a redelivered webhook cannot post a sale twice), and a reversal is a correction rather than '
  'a second posting. Bounded at two because reverse_ledger_transaction refuses to reverse the '
  'same transaction twice, or to reverse a reversal.';

create or replace function record_refund(
  p_provider_refund_id  text,
  p_provider_payment_id text,
  p_amount_paise        bigint,
  p_notes               text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment  payment%rowtype;
  v_group    order_group%rowtype;
  v_refund   refund%rowtype;
  v_refund_id uuid;
  v_sale_tx  uuid;
  v_reversal uuid;
  v_credit   uuid;
  v_actor    text;
  v_dest     refund_destination;
begin
  -- ---------------------------------------------------------------------------
  -- 1. Dedupe. Before anything else, and before any lock — a redelivery is the common case,
  --    not the exceptional one, and it must be cheap.
  -- ---------------------------------------------------------------------------
  select * into v_refund from refund where provider_refund_id = p_provider_refund_id;
  if found then
    return jsonb_build_object(
      'already_recorded', true,
      'refund_id', v_refund.id,
      'order_group_id', v_refund.order_group_id,
      'status', v_refund.status);
  end if;

  select * into v_payment from payment
   where provider = 'razorpay' and provider_payment_id = p_provider_payment_id;
  if not found then
    -- The same `§10.9` situation `settle_payment` documents: one test-mode Razorpay account
    -- serves several things, so a refund can arrive for a charge this system never took. It is
    -- terminal, not transient — retrying for ever would bury a genuinely stuck one.
    raise exception 'no payment % in this system', p_provider_payment_id
      using errcode = 'P0001', hint = 'payment_not_found';
  end if;

  select * into v_group from order_group where id = v_payment.order_group_id for update;

  -- ---------------------------------------------------------------------------
  -- 2. Full or nothing. See the header.
  -- ---------------------------------------------------------------------------
  if p_amount_paise <> v_payment.amount_paise then
    raise exception 'partial refund % of % is not supported yet (E06-08)',
      p_amount_paise, v_payment.amount_paise
      using errcode = 'P0001', hint = 'partial_refund_unsupported';
  end if;

  -- ---------------------------------------------------------------------------
  -- 3. The refund row. Either the request `E06-45` already recorded, or a new one for a refund
  --    that was raised in the dashboard with no cancellation in the app.
  --
  --    **`for update` on the pending row**, so two deliveries racing cannot both claim it. The
  --    unique index would catch the second anyway; the lock makes it a wait rather than an
  --    error, which keeps a redelivery from showing up as a failure in the queue.
  -- ---------------------------------------------------------------------------
  select * into v_refund from refund
   where order_group_id = v_group.id
     and status = 'pending'
     and provider_refund_id is null
   order by initiated_at
   limit 1
   for update;

  if found then
    update refund
       set provider_refund_id = p_provider_refund_id,
           status             = 'completed',
           completed_at       = now(),
           updated_at         = now()
     where id = v_refund.id
    returning id into v_refund_id;
  else
    -- No request on file. `provider_initiated` (`0013`) is the reason code for exactly this:
    -- raised in the provider dashboard, `requires_note`, so `p_notes` is not decoration.
    select coalesce((config_snapshot->>'refund_default_destination')::refund_destination, 'source')
      into v_dest
      from "order" where order_group_id = v_group.id order by id limit 1;

    insert into refund (order_group_id, payment_id, destination, amount_paise, reason_code,
                        status, provider_refund_id, completed_at, correlation_id)
    select v_group.id, v_payment.id, v_dest, p_amount_paise, 'provider_initiated',
           'completed', p_provider_refund_id, now(),
           (select correlation_id from "order" where order_group_id = v_group.id limit 1)
    returning id into v_refund_id;
  end if;

  -- ---------------------------------------------------------------------------
  -- 4. The orders. Cancel first if nobody did (T11 as `admin` — see the header), then T13.
  --
  --    Save and restore `app.actor_type`, for the reason `0053` documents: it is
  --    transaction-local, not function-local, and this function is called from a drain that
  --    processes several events in one transaction.
  -- ---------------------------------------------------------------------------
  v_actor := nullif(current_setting('app.actor_type', true), '');

  perform set_config('app.actor_type', 'admin', true);
  update "order"
     set status               = 'cancelled',
         cancelled_at         = coalesce(cancelled_at, now()),
         cancel_reason_code   = coalesce(cancel_reason_code, 'provider_initiated'),
         updated_at           = now()
   where order_group_id = v_group.id
     and status in ('paid', 'preparing');

  perform set_config('app.actor_type', 'system', true);
  update "order"
     set status               = 'refunded',
         refunded_total_paise = total_paise,
         updated_at           = now()
   where order_group_id = v_group.id
     and status = 'cancelled';

  perform set_config('app.actor_type', coalesce(v_actor, ''), true);

  -- ---------------------------------------------------------------------------
  -- 5. The ledger. An append-only ledger's only correction is an equal and opposite
  --    transaction (`0038`) — never an edit, never a delete.
  --
  --    `reverse_ledger_transaction` refuses to reverse the same transaction twice, which is a
  --    second, independent guard against a redelivery getting past step 1. It is not the
  --    primary one and must not be relied on as such: it would raise, and a raise here would
  --    roll back the state change above.
  -- ---------------------------------------------------------------------------
  select id into v_sale_tx from ledger_transaction
   where source_type = 'payment' and source_id = v_payment.id
     and reason_code = 'sale' and reversal_of_transaction_id is null
   limit 1;

  if v_sale_tx is not null
     and not exists (select 1 from ledger_transaction
                      where reversal_of_transaction_id = v_sale_tx) then
    v_reversal := reverse_ledger_transaction(
      v_sale_tx,
      'Refund ' || p_provider_refund_id || coalesce(' — ' || p_notes, ''));
  end if;

  -- ---------------------------------------------------------------------------
  -- 6. The credit note. A tax invoice documents a supply; when the supply is reversed the
  --    invoice is **not** edited (§13.2 — a reprint must be byte-identical), it is withdrawn by
  --    a credit note that points at it.
  -- ---------------------------------------------------------------------------
  v_credit := issue_credit_note(v_group.id, v_refund_id);

  return jsonb_build_object(
    'already_recorded', false,
    'refund_id', v_refund_id,
    'order_group_id', v_group.id,
    'amount_paise', p_amount_paise,
    'ledger_reversal_id', v_reversal,
    'credit_note_id', v_credit,
    -- What the notifier needs, so it does not make a second round trip for it.
    'customer_user_id', v_group.customer_user_id);
end;
$$;

comment on function record_refund(text, text, bigint, text) is
  'E06-46 / T13, §7.3, §8.3. Consumes a refund issued by hand in the Razorpay dashboard: '
  'completes the refund row (or writes one with reason_code provider_initiated if nobody '
  'cancelled in the app), moves the orders to refunded, reverses the sale in the ledger and '
  'issues a credit note. DEDUPES ON provider_refund_id and returns already_recorded — Razorpay '
  'refunds are NOT idempotent (the E19 sitting made two real refunds from two identical POSTs), '
  'and a webhook is redelivered by design, so without this one disbursement would be recorded '
  'three times. uq_refund_provider_refund_id is the guarantee; this check is what stops it '
  'raising. The actor for paid -> cancelled is ADMIN, not system: system has no such transition '
  '(T11/T12), and a human with dashboard access really did do this. Partial refunds are REFUSED '
  '(E06-08): recording one as full would overstate the reversal and issue a credit note for '
  'money we did not return, and §13.2 makes that document immutable.';

-- -----------------------------------------------------------------------------
-- The credit note. `E07-07`.
--
-- Deliberately **not** a flag on `issue_invoice`: that function's contract is "one tax invoice
-- per group, and a re-run returns the one that exists", and threading a document type through
-- it would make the early return mean two different things. They share the number series and
-- nothing else.
-- -----------------------------------------------------------------------------
create or replace function issue_credit_note(
  p_order_group_id uuid,
  p_refund_id      uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_group    order_group%rowtype;
  v_cfg      platform_config%rowtype;
  v_invoice  invoice%rowtype;
  v_fy       text;
  v_seq      integer;
  v_id       uuid;
  v_existing uuid;
begin
  select * into v_group from order_group where id = p_order_group_id;
  if not found then
    raise exception 'no such order group' using errcode = 'P0001', hint = 'group_not_found';
  end if;

  -- The document this withdraws. **No tax invoice, no credit note** — a credit note that points
  -- at nothing is not a credit note, and a group that was never invoiced has no supply to
  -- reverse. Returns null rather than raising: a refund of an unsettled order is a legitimate
  -- thing that simply has no document to withdraw.
  select * into v_invoice from invoice
   where order_group_id = p_order_group_id and document_type = 'tax_invoice';
  if not found then
    return null;
  end if;

  -- Idempotent on the same terms as `issue_invoice`: one credit note per invoice, and a re-run
  -- returns it rather than burning a second number out of a gapless series.
  select id into v_existing from invoice
   where credit_note_of_invoice_id = v_invoice.id and document_type = 'credit_note';
  if found then
    return v_existing;
  end if;

  select * into v_cfg from platform_config where id = 1;
  v_fy := financial_year_at(now());

  -- **The same series as the tax invoice**, and the number is taken last. `invoice_number` is
  -- `unique` across the table, so a separate credit-note series would need its own sequence and
  -- its own gapless proof; sharing one is the smaller claim to have to defend.
  insert into invoice_sequence (financial_year, last_sequence_no) values (v_fy, 0)
  on conflict (financial_year) do nothing;

  update invoice_sequence
     set last_sequence_no = last_sequence_no + 1, updated_at = now()
   where financial_year = v_fy
  returning last_sequence_no into v_seq;

  -- **The withdrawn invoice's own figures, copied.** Not recomputed from the orders: those rows
  -- now read `refunded` and their amounts could have been touched by anything since. A credit
  -- note has to reverse exactly what was charged, and the invoice is the record of that
  -- (§13.2). Seller identity is copied for the same reason — the snapshot on the original is
  -- what was in force, and re-resolving it would produce a pair of documents that disagree.
  insert into invoice (
    invoice_number, financial_year, sequence_no, document_type, credit_note_of_invoice_id,
    order_group_id, seller_gstin, seller_legal_name, seller_address,
    place_of_supply_state_code, sac_code, buyer_name_snapshot, buyer_email_snapshot,
    taxable_value_paise, cgst_rate_bps, cgst_paise, sgst_rate_bps, sgst_paise,
    igst_rate_bps, igst_paise, round_off_paise, total_paise
  )
  values (
    'GB/' || right(split_part(v_fy, '-', 1), 2) || '-' || split_part(v_fy, '-', 2)
          || '/' || lpad(v_seq::text, 6, '0'),
    v_fy, v_seq, 'credit_note', v_invoice.id,
    p_order_group_id, v_invoice.seller_gstin, v_invoice.seller_legal_name,
    v_invoice.seller_address, v_invoice.place_of_supply_state_code, v_invoice.sac_code,
    v_invoice.buyer_name_snapshot, v_invoice.buyer_email_snapshot,
    v_invoice.taxable_value_paise, v_invoice.cgst_rate_bps, v_invoice.cgst_paise,
    v_invoice.sgst_rate_bps, v_invoice.sgst_paise, v_invoice.igst_rate_bps,
    v_invoice.igst_paise, v_invoice.round_off_paise, v_invoice.total_paise
  )
  returning id into v_id;

  -- Line for line, from the invoice rather than from the orders — same reason as the totals.
  insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                            unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise,
                            total_paise)
  select v_id, il.line_no, il.order_line_id, il.description, il.sac_code, il.quantity,
         il.unit_price_paise, il.taxable_value_paise, il.cgst_paise, il.sgst_paise, il.total_paise
    from invoice_line il
   where il.invoice_id = v_invoice.id;

  return v_id;
end;
$$;

comment on function issue_credit_note(uuid, uuid) is
  'E07-07 / E06-46. Withdraws a tax invoice when the supply is reversed. Copies the ORIGINAL '
  'invoice''s figures and seller identity rather than recomputing from the orders — those rows '
  'now read refunded, and §13.2 requires the pair to agree about what was charged. Shares the '
  'invoice_sequence series: invoice_number is unique table-wide, so a separate credit-note '
  'series would need its own gapless proof. Idempotent (one per invoice). Returns NULL when the '
  'group has no tax invoice — a refund of an unsettled order has no supply to withdraw, which '
  'is legitimate and not an error.';

revoke all on function record_refund(text, text, bigint, text) from public;
revoke all on function issue_credit_note(uuid, uuid) from public;
grant execute on function record_refund(text, text, bigint, text) to service_role;
grant execute on function issue_credit_note(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
