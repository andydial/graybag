-- =============================================================================
-- 0057_partial_refunds.sql — a part refund reconciles. `E06-08`.
-- =============================================================================
--
-- `0054` refused a partial refund outright, on the reasoning that a full reversal of a part
-- refund overstates the ledger and issues a credit note for money we did not return — and §13.2
-- makes that document immutable, so it could never be corrected. That reasoning was right and
-- the outcome was not operable: Andy, 2026-08-15 — *"a part refund I make by hand is refused and
-- the order is stranded. That's correct over wrong, but it's not a state I can operate in."*
--
-- Three things have to become proportional: the ledger, the credit note, and the order state.
--
-- =============================================================================
-- 1. THE LEDGER: ONE PATH, AND IT IS NO LONGER A REVERSAL
-- =============================================================================
--
-- `0054` reversed the sale with `reverse_ledger_transaction`. **That is replaced here for both
-- full and partial refunds**, and the change is deliberate rather than incidental:
--
-- * `reverse_ledger_transaction`'s own comment calls it *"the only correction an append-only
--   ledger has"*. A refund is **not a correction** — the sale really happened and is not being
--   unsaid. It is a second economic event, and modelling it as a correction of the first makes
--   the ledger describe something that did not occur.
-- * It is all-or-nothing, so a partial has nothing to hand it.
-- * A partial followed by another partial that completes the total cannot be expressed as one
--   reversal at all, and two code paths that must agree about a boundary is how the boundary
--   gets crossed wrongly.
--
-- So every refund now posts its own transaction, sourced on the `refund` row, with
-- `refund_to_source` / `refund_to_wallet` (`0013`) as the reason code — which is what those
-- codes were seeded for.
--
-- **The entries mirror the sale's, scaled.** Rather than assuming the sale's shape (clearing,
-- revenue, two tax accounts — true today, and `M8`/`M5` will add more), the sale posting is read
-- and each entry is written back in the opposite direction at `amount × refunded ÷ captured`.
-- A refund of a sale we did not post is a refund we cannot describe, so it refuses.
--
-- **Rounding cannot be left to chance.** Scaling each entry independently and rounding each
-- leaves debits and credits differing by a paise or two, and `post_ledger_transaction` rejects an
-- unbalanced posting outright — correctly. The remainder is applied to the largest entry, so the
-- transaction balances exactly and the distortion lands where it is proportionally smallest.
--
-- =============================================================================
-- 2. THE CREDIT NOTE: THE AMOUNT ACTUALLY RETURNED, AND ONE LINE
-- =============================================================================
--
-- A full credit note copies the invoice line for line (`0054`). A partial one **must not**: a
-- refund issued by hand in the Razorpay dashboard carries no line information, so attributing it
-- across lines would be inventing which dish was refunded. It is one line for the amount
-- returned, described as a part refund.
--
-- The tax split is proportional to the **invoice's own** split, not recomputed from the rate:
-- the invoice is the record of what was charged (§13.2), and recomputing could disagree with it
-- by a paise on a boundary. `round_off_paise` absorbs the difference so the credit note's total equals
-- the money that actually moved — which is the column's documented purpose.
--
-- =============================================================================
-- 3. THE ORDER STATE: `partially_refunded` ALREADY EXISTS, AND IS DERIVED
-- =============================================================================
--
-- `order_group_status` has `partially_refunded` and `0044`'s G6 already derives it — *"a
-- completed partial refund shows even while most of the group is still to be delivered"*. Nothing
-- in `0044` changes.
--
-- What matters is what this function does **not** do: on a partial it leaves `order.status`
-- alone. The food is still coming. Cancelling an order because part of its money came back would
-- be the system deciding, from an amount, that a meal is not being delivered — and `order_status`
-- has no `partially_refunded` member precisely because a fulfilment status and a money status are
-- different facts (`L1`). The money moves `refunded_total_paise`; the group derives.
-- =============================================================================

-- ---------------------------------------------------------------------------------------------
-- The proportional posting. Separated out because it is the part with arithmetic in it, and a
-- function with one job can be tested on its own.
-- ---------------------------------------------------------------------------------------------
create or replace function post_refund_reversal(
  p_refund_id   uuid,
  p_payment_id  uuid,
  p_amount_paise bigint,
  p_captured_paise bigint,
  p_destination refund_destination,
  p_memo        text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale     uuid;
  v_entries  jsonb;
  v_debits   bigint;
  v_credits  bigint;
  v_delta    bigint;
  v_corr     uuid;
begin
  if p_captured_paise <= 0 then
    raise exception 'cannot apportion a refund against a zero capture'
      using errcode = 'P0001', hint = 'nothing_captured';
  end if;

  select id, correlation_id into v_sale, v_corr from ledger_transaction
   where source_type = 'payment' and source_id = p_payment_id
     and reason_code = 'sale' and reversal_of_transaction_id is null
   limit 1;

  if v_sale is null then
    -- No sale posting means the settlement never reached the ledger. Refusing is right: a
    -- refund entry with nothing to mirror would be a guess at which accounts to move.
    raise exception 'no sale posting for payment % to apportion a refund against', p_payment_id
      using errcode = 'P0001', hint = 'sale_not_posted';
  end if;

  -- Each entry, flipped and scaled. `round()` on numeric is half-up, which is `G1`'s rule and
  -- the same one `create_checkout` uses for tax.
  select jsonb_agg(jsonb_build_object(
           'account', la.code,
           'direction', case e.direction when 'debit' then 'credit' else 'debit' end,
           'amount_paise', round(e.amount_paise::numeric * p_amount_paise / p_captured_paise)::bigint))
    into v_entries
    from ledger_entry e
    join ledger_account la on la.id = e.account_id
   where e.transaction_id = v_sale;

  -- Balance, after rounding. `post_ledger_transaction` refuses an unbalanced posting — correctly
  -- — so the remainder is applied here rather than discovered there.
  select coalesce(sum((x->>'amount_paise')::bigint) filter (where x->>'direction' = 'debit'), 0),
         coalesce(sum((x->>'amount_paise')::bigint) filter (where x->>'direction' = 'credit'), 0)
    into v_debits, v_credits
    from jsonb_array_elements(v_entries) x;

  v_delta := v_debits - v_credits;

  if v_delta <> 0 then
    -- Onto the largest CREDIT, so the adjustment is proportionally smallest. Rebuilt rather than
    -- mutated in place: jsonb is immutable and a path update on an array found by value is
    -- harder to read than a rebuild.
    with ranked as (
      select x, row_number() over (
               order by case when x->>'direction' = 'credit' then (x->>'amount_paise')::bigint
                             else -1 end desc) as rn
        from jsonb_array_elements(v_entries) x
    )
    select jsonb_agg(
             case when rn = 1
               then jsonb_set(x, '{amount_paise}',
                      to_jsonb(((x->>'amount_paise')::bigint + v_delta)))
               else x end)
      into v_entries
      from ranked;
  end if;

  return post_ledger_transaction(
    case p_destination when 'wallet' then 'refund_to_wallet' else 'refund_to_source' end,
    'refund', p_refund_id, v_entries, now(), v_corr,
    coalesce(p_memo, 'Refund of ' || p_amount_paise || ' paise'), null,
    -- **The idempotency key is the refund.** `post_ledger_transaction` returns the existing
    -- transaction rather than posting a second one, so a redelivered webhook that somehow got
    -- past `record_refund`'s dedupe still cannot double-post. Belt and braces, deliberately.
    'refund:' || p_refund_id::text);
end;
$$;

comment on function post_refund_reversal(uuid, uuid, bigint, bigint, refund_destination, text) is
  'E06-08. Posts a refund as its own transaction, sourced on the refund row, with entries '
  'mirroring the sale''s at amount x refunded / captured. NOT reverse_ledger_transaction: that is '
  'for CORRECTIONS, and a refund is a second economic event rather than an unsaying of the first '
  '— and it is all-or-nothing, so a partial has nothing to hand it. Reads the sale''s entries '
  'rather than assuming its shape, so M5/M8 adding accounts does not silently mis-post. Rounding '
  'remainder goes onto the largest credit so the posting balances exactly; post_ledger_transaction '
  'refuses an unbalanced one. Idempotent on the refund id.';

-- ---------------------------------------------------------------------------------------------
-- The proportional credit note.
-- ---------------------------------------------------------------------------------------------
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
  v_invoice  invoice%rowtype;
  v_refund   refund%rowtype;
  v_fy       text;
  v_seq      integer;
  v_id       uuid;
  v_existing uuid;
  v_taxable  bigint;
  v_cgst     bigint;
  v_sgst     bigint;
  v_igst     bigint;
  v_round    bigint;
  v_full     boolean;
begin
  select * into v_group from order_group where id = p_order_group_id;
  if not found then
    raise exception 'no such order group' using errcode = 'P0001', hint = 'group_not_found';
  end if;

  select * into v_refund from refund where id = p_refund_id;
  if not found then
    raise exception 'no such refund' using errcode = 'P0001', hint = 'refund_not_found';
  end if;

  -- No tax invoice, no credit note. A group that was never invoiced has no supply to reverse,
  -- which is legitimate and not an error.
  select * into v_invoice from invoice
   where order_group_id = p_order_group_id and document_type = 'tax_invoice';
  if not found then
    return null;
  end if;

  -- **One credit note per REFUND**, not per invoice — that is the change from `0054`. Two
  -- partial refunds are two returns of money and two documents; keying on the invoice would
  -- have silently returned the first note for the second refund and left the second undocumented.
  select id into v_existing from invoice
   where credit_note_of_invoice_id = v_invoice.id
     and document_type = 'credit_note'
     and order_group_id = p_order_group_id
     and total_paise = v_refund.amount_paise
     and issued_at >= v_refund.initiated_at;
  if found then
    return v_existing;
  end if;

  v_full := v_refund.amount_paise >= v_invoice.total_paise;

  if v_full then
    v_taxable := v_invoice.taxable_value_paise;
    v_cgst    := v_invoice.cgst_paise;
    v_sgst    := v_invoice.sgst_paise;
    v_igst    := v_invoice.igst_paise;
    v_round   := v_invoice.round_off_paise;
  else
    -- Proportional to the INVOICE's own split, not recomputed from the rate: the invoice is the
    -- record of what was charged, and recomputing could disagree with it by a paise.
    v_taxable := round(v_invoice.taxable_value_paise::numeric * v_refund.amount_paise
                       / v_invoice.total_paise)::bigint;
    v_cgst    := round(v_invoice.cgst_paise::numeric * v_refund.amount_paise
                       / v_invoice.total_paise)::bigint;
    v_sgst    := round(v_invoice.sgst_paise::numeric * v_refund.amount_paise
                       / v_invoice.total_paise)::bigint;
    v_igst    := round(v_invoice.igst_paise::numeric * v_refund.amount_paise
                       / v_invoice.total_paise)::bigint;
    -- **The credit note's total is the money that actually moved.** `round_off_paise` absorbs
    -- the difference, which is the column's documented purpose ([DM-19]); it is at most a couple
    -- of paise and it must land somewhere rather than making the document disagree with the bank.
    v_round   := v_refund.amount_paise - (v_taxable + v_cgst + v_sgst + v_igst);
  end if;

  v_fy := financial_year_at(now());

  insert into invoice_sequence (financial_year, last_sequence_no) values (v_fy, 0)
  on conflict (financial_year) do nothing;

  update invoice_sequence
     set last_sequence_no = last_sequence_no + 1, updated_at = now()
   where financial_year = v_fy
  returning last_sequence_no into v_seq;

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
    v_taxable, v_invoice.cgst_rate_bps, v_cgst, v_invoice.sgst_rate_bps, v_sgst,
    v_invoice.igst_rate_bps, v_igst, v_round, v_refund.amount_paise
  )
  returning id into v_id;

  if v_full then
    -- Line for line, from the invoice. Same reason as the totals.
    insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                              unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise,
                              total_paise)
    select v_id, il.line_no, il.order_line_id, il.description, il.sac_code, il.quantity,
           il.unit_price_paise, il.taxable_value_paise, il.cgst_paise, il.sgst_paise,
           il.total_paise
      from invoice_line il
     where il.invoice_id = v_invoice.id;
  else
    -- **One line, and no `order_line_id`.** A hand-issued partial refund carries no line
    -- information, so attributing it across lines would be inventing which dish was refunded.
    -- `E06-18`'s per-line refunds will supply real attribution; until then the honest document
    -- says what came back and does not say what for.
    insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                              unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise,
                              total_paise)
    values (v_id, 1, null, 'Part refund against invoice ' || v_invoice.invoice_number,
            v_invoice.sac_code, 1, v_refund.amount_paise, v_taxable, v_cgst, v_sgst,
            v_refund.amount_paise);
  end if;

  return v_id;
end;
$$;

comment on function issue_credit_note(uuid, uuid) is
  'E07-07 / E06-08. Withdraws part or all of a tax invoice. FULL: the invoice''s figures and '
  'lines copied. PARTIAL: totals proportional to the INVOICE''s own split (not recomputed from '
  'the rate — the invoice is the record of what was charged), round_off_paise absorbing the '
  'remainder so the note''s total is the money that actually moved, and ONE line with no '
  'order_line_id, because a hand-issued refund carries no line attribution and inventing one '
  'would say which dish was refunded when nobody knows. Keyed on the REFUND, not the invoice: '
  'two partial refunds are two documents, and keying on the invoice returned the first note for '
  'the second refund. Returns NULL when the group has no tax invoice.';

-- ---------------------------------------------------------------------------------------------
-- `record_refund`, with the partial branch.
-- ---------------------------------------------------------------------------------------------
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
  v_posting  uuid;
  v_credit   uuid;
  v_actor    text;
  v_dest     refund_destination;
  v_captured bigint;
  v_prior    bigint;
  v_full     boolean;
  v_left     bigint;
  v_order    record;
  v_share    bigint;
begin
  -- 1. Dedupe, before anything else. See `0054` — Razorpay refunds are not idempotent and a
  --    webhook is redelivered by design.
  select * into v_refund from refund where provider_refund_id = p_provider_refund_id;
  if found then
    return jsonb_build_object(
      'already_recorded', true, 'refund_id', v_refund.id,
      'order_group_id', v_refund.order_group_id, 'status', v_refund.status);
  end if;

  select * into v_payment from payment
   where provider = 'razorpay' and provider_payment_id = p_provider_payment_id;
  if not found then
    raise exception 'no payment % in this system', p_provider_payment_id
      using errcode = 'P0001', hint = 'payment_not_found';
  end if;

  select * into v_group from order_group where id = v_payment.order_group_id for update;

  if p_amount_paise <= 0 then
    raise exception 'a refund of % paise is not a refund', p_amount_paise
      using errcode = 'P0001', hint = 'bad_amount';
  end if;

  -- 2. Full or partial, decided from the GROUP's totals rather than this refund alone — so two
  --    partials that together return everything close the order, which keying on
  --    `p_amount_paise = v_payment.amount_paise` would not.
  select coalesce(sum(amount_paise), 0) into v_captured
    from payment where order_group_id = v_group.id and status = 'captured';

  select coalesce(sum(amount_paise), 0) into v_prior
    from refund where order_group_id = v_group.id and status = 'completed';

  if v_prior + p_amount_paise > v_captured then
    -- The `0043` trigger would catch this at COMMIT with `over_refund`; refusing here names the
    -- numbers, and a hint the consumer can act on without parsing a trigger's message.
    raise exception 'refunds would total % paise against % captured',
      v_prior + p_amount_paise, v_captured
      using errcode = 'P0001', hint = 'over_refund';
  end if;

  v_full := (v_prior + p_amount_paise) >= v_captured;

  -- 3. The refund row: complete a pending request if one is waiting, else record a new one.
  select * into v_refund from refund
   where order_group_id = v_group.id and status = 'pending' and provider_refund_id is null
     and amount_paise = p_amount_paise
   order by initiated_at
   limit 1
   for update;

  if found then
    update refund
       set provider_refund_id = p_provider_refund_id, status = 'completed',
           completed_at = now(), updated_at = now()
     where id = v_refund.id
    returning id, destination into v_refund_id, v_dest;
  else
    -- **Matched on the amount too**, which `0054` did not. A pending request for the whole order
    -- and a hand-issued part refund are different amounts and must not be conflated: completing
    -- a 21000-paise request with a 5000-paise refund would tell a parent they had been paid four
    -- times what arrived.
    select coalesce((config_snapshot->>'refund_default_destination')::refund_destination, 'source')
      into v_dest
      from "order" where order_group_id = v_group.id order by id limit 1;

    -- `E06-24`'s constraint, in words rather than as a `23514`. `v_payment` is a found row, so
    -- its id is never null — the question is whether it is a CAPTURE. A refund against an
    -- authorised-but-uncaptured payment has nothing to send back.
    if v_dest = 'source' and v_payment.status <> 'captured' then
      raise exception 'payment % is % , not captured, so there is nothing to refund to source',
        p_provider_payment_id, v_payment.status
        using errcode = 'P0001', hint = 'no_payment_to_refund';
    end if;

    insert into refund (order_group_id, payment_id, destination, amount_paise, reason_code,
                        status, provider_refund_id, completed_at, correlation_id)
    select v_group.id, v_payment.id, v_dest, p_amount_paise, 'provider_initiated',
           'completed', p_provider_refund_id, now(),
           (select correlation_id from "order" where order_group_id = v_group.id limit 1)
    returning id into v_refund_id;
  end if;

  -- 4. The orders.
  v_actor := nullif(current_setting('app.actor_type', true), '');

  if v_full then
    -- Cancel first if nobody did (T11 as `admin` — a human with dashboard access did this), then
    -- T13. Unchanged from `0054`.
    perform set_config('app.actor_type', 'admin', true);
    update "order"
       set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
           cancel_reason_code = coalesce(cancel_reason_code, 'provider_initiated'),
           updated_at = now()
     where order_group_id = v_group.id and status in ('paid', 'preparing');

    perform set_config('app.actor_type', 'system', true);
    update "order"
       set status = 'refunded', refunded_total_paise = total_paise, updated_at = now()
     where order_group_id = v_group.id and status = 'cancelled';
  else
    -- **`order.status` is untouched.** The food is still coming. `order_status` has no
    -- `partially_refunded` member because a fulfilment status and a money status are different
    -- facts (`L1`); the money moves `refunded_total_paise` and `order_group` derives
    -- `partially_refunded` through `0044`'s G6.
    --
    -- Apportioned across the group's orders by their totals, largest remainder to the first, so
    -- the parts sum to exactly the refund and no order breaches
    -- `refunded_total_paise <= total_paise`.
    v_left := p_amount_paise;
    for v_order in
      select id, total_paise, refunded_total_paise
        from "order" where order_group_id = v_group.id order by id
    loop
      v_share := least(
        round(p_amount_paise::numeric * v_order.total_paise / nullif(v_captured, 0))::bigint,
        v_order.total_paise - v_order.refunded_total_paise,
        v_left);
      update "order"
         set refunded_total_paise = refunded_total_paise + v_share, updated_at = now()
       where id = v_order.id;
      v_left := v_left - v_share;
    end loop;

    -- Whatever rounding left over goes onto the first order with room for it. Without this the
    -- group's `refunded_total_paise` can be a paise short of the refund, which is the kind of
    -- discrepancy that surfaces months later in a reconciliation.
    if v_left > 0 then
      update "order"
         set refunded_total_paise = refunded_total_paise + v_left, updated_at = now()
       where id = (select id from "order"
                    where order_group_id = v_group.id
                      and total_paise - refunded_total_paise >= v_left
                    order by id limit 1);
    end if;
  end if;

  perform set_config('app.actor_type', coalesce(v_actor, ''), true);

  -- 5. The ledger — proportional, always. See the header.
  v_posting := post_refund_reversal(
    v_refund_id, v_payment.id, p_amount_paise, v_captured, v_dest,
    'Refund ' || p_provider_refund_id || coalesce(' — ' || p_notes, ''));

  -- 6. The credit note, for the amount actually returned.
  v_credit := issue_credit_note(v_group.id, v_refund_id);

  return jsonb_build_object(
    'already_recorded', false,
    'refund_id', v_refund_id,
    'order_group_id', v_group.id,
    'amount_paise', p_amount_paise,
    'is_full_refund', v_full,
    'refunded_total_paise', v_prior + p_amount_paise,
    'captured_paise', v_captured,
    'ledger_transaction_id', v_posting,
    'credit_note_id', v_credit,
    'customer_user_id', v_group.customer_user_id);
end;
$$;

comment on function record_refund(text, text, bigint, text) is
  'E06-46 / E06-08. Consumes a refund issued by hand in the Razorpay dashboard, FULL OR PARTIAL. '
  'Dedupes on provider_refund_id (Razorpay refunds are not idempotent and webhooks redeliver). '
  'Full or partial is decided from the GROUP''s totals, not this refund alone, so two partials '
  'that together return everything close the order. FULL: orders cancelled (as admin — a person '
  'did this) then refunded via T13, invoice fully credited. PARTIAL: order.status UNTOUCHED — the '
  'food is still coming — refunded_total_paise apportioned across the orders, and order_group '
  'derives partially_refunded through 0044 G6. The ledger posting is proportional in both cases '
  'and is NOT reverse_ledger_transaction: a refund is a second economic event, not a correction.';

revoke all on function post_refund_reversal(uuid, uuid, bigint, bigint, refund_destination, text) from public;
grant execute on function post_refund_reversal(uuid, uuid, bigint, bigint, refund_destination, text) to service_role;

notify pgrst, 'reload schema';
