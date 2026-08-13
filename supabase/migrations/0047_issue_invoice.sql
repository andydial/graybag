-- =============================================================================
-- 0047_issue_invoice.sql — the receipt. `E07-01`, `E07-02`, `M3`, `D14`.
-- =============================================================================
--
-- Called from inside `settle_payment`'s transaction, so the invoice and the settlement succeed
-- or fail together (`D14`). An order that is `paid` with no invoice is a customer charged with
-- no tax document; an invoice with no settlement is a number burned out of a gapless series.
-- Neither is repairable afterwards, which is why they are one transaction rather than two steps.
--
-- =============================================================================
-- GAPLESS, WHICH MEANS THE NUMBER IS ALLOCATED LAST
-- =============================================================================
--
-- `M3`/`E07-01`: the series must be consecutive within a financial year. A sequence is NOT
-- usable — `nextval` is non-transactional by design, so a rolled-back transaction burns a number
-- and leaves a hole that cannot be explained to an auditor.
--
-- So the number comes from `invoice_sequence` under a row lock, and it is taken **after** every
-- other check in this function has passed. Anything that can refuse must refuse before a number
-- is consumed.
--
-- =============================================================================
-- FIFTEEN CHARACTERS, NOT SEVENTEEN
-- =============================================================================
--
-- `GB/26-27/000417`. Rule 46 caps the serial at 16 characters, and the format in the original
-- schema comment — `GB/2026-27/000417` — is **seventeen** and would not comply. The financial
-- year is stored in full (`2026-27`) as the sequence key and rendered two-digit.
--
-- =============================================================================
-- THE SELLER IS SNAPSHOTTED, THE BUYER MAY BE ABSENT
-- =============================================================================
--
-- Seller identity is copied onto the row rather than read at render time (§13.2): a reprint must
-- be byte-identical to what was issued, so a wrong value cannot be fixed by editing config.
--
-- The buyer's name may be NULL — `E07-22`, CGST Rule 46(f): below ₹50,000 it is required only if
-- the recipient asks. Nothing is fabricated to fill it.
--
-- **Line descriptions carry the child's FIRST NAME ONLY** (§4.3, `G7`) — no surname, no class,
-- no section. The invoice is a document a parent forwards to an employer for reimbursement.
-- =============================================================================

create or replace function financial_year_at(p_at timestamptz, p_tz text default 'Asia/Kolkata')
returns text
language sql
immutable
as $$
  -- India's financial year runs April–March. April 2026 → '2026-27'; March 2027 → '2026-27'.
  select case when extract(month from (p_at at time zone p_tz)) >= 4
              then to_char((p_at at time zone p_tz), 'YYYY') || '-' ||
                   lpad(((extract(year from (p_at at time zone p_tz))::int + 1) % 100)::text, 2, '0')
              else lpad(((extract(year from (p_at at time zone p_tz))::int - 1))::text, 4, '0') || '-' ||
                   lpad((extract(year from (p_at at time zone p_tz))::int % 100)::text, 2, '0')
         end;
$$;

comment on function financial_year_at(timestamptz, text) is
  'E07-16: the Indian financial year (April-March) containing an instant, in the platform timezone. Derived from issued_at rather than stored, so an invoice cannot disagree with its own series.';

create or replace function issue_invoice(p_order_group_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_group    order_group%rowtype;
  v_cfg      platform_config%rowtype;
  v_fy       text;
  v_seq      integer;
  v_id       uuid;
  v_taxable  bigint;
  v_cgst     bigint;
  v_sgst     bigint;
  v_buyer    text;
  v_email    text;
  v_existing uuid;
begin
  select * into v_group from order_group where id = p_order_group_id;
  if not found then
    raise exception 'no such order group' using errcode = 'P0001', hint = 'group_not_found';
  end if;

  -- §7.1 layer 7. One tax invoice per group, and a re-run returns the one that exists rather
  -- than burning a second number out of the series.
  select id into v_existing from invoice
   where order_group_id = p_order_group_id and document_type = 'tax_invoice';
  if found then
    return v_existing;
  end if;

  select * into v_cfg from platform_config where id = 1;

  -- Defence in depth — §2 guard layer 3, and **production-only**, via the same function
  -- `E07-20`'s checkout guard uses so the two cannot drift on what "configured" means.
  --
  -- The first version of this refused unconditionally, which broke settlement everywhere: a
  -- placeholder seller identity is the ORDINARY state of a development database, and §2 is
  -- explicit that in staging and development the placeholder renders literally, in angle quotes,
  -- so it cannot be mistaken for a real GSTIN. An unconditional refusal would mean nobody could
  -- exercise the payment path until E00-10 returns.
  --
  -- Reaching this in production means layer 1 was bypassed or the environment changed
  -- mid-flight. Refusing then is bad for the customer — they are already charged — and better
  -- than issuing a non-compliant tax document that needs a credit note to withdraw.
  perform assert_seller_identity_configured();

  select coalesce(sum(subtotal_paise), 0), coalesce(sum(tax_cgst_paise), 0),
         coalesce(sum(tax_sgst_paise), 0)
    into v_taxable, v_cgst, v_sgst
    from "order" where order_group_id = p_order_group_id;

  -- Null when they have not told us, and nothing is invented (E07-22 / Rule 46(f)).
  select nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
         u.email::text
    into v_buyer, v_email
    from app_user u where u.id = v_group.customer_user_id;

  v_fy := financial_year_at(now());

  -- The number is taken LAST, under a row lock, after everything that could refuse has passed.
  insert into invoice_sequence (financial_year, last_sequence_no) values (v_fy, 0)
  on conflict (financial_year) do nothing;

  update invoice_sequence
     set last_sequence_no = last_sequence_no + 1, updated_at = now()
   where financial_year = v_fy
  returning last_sequence_no into v_seq;

  insert into invoice (
    invoice_number, financial_year, sequence_no, order_group_id,
    seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code, sac_code,
    buyer_name_snapshot, buyer_email_snapshot,
    taxable_value_paise, cgst_rate_bps, cgst_paise, sgst_rate_bps, sgst_paise, total_paise,
    pickup_codes
  )
  select
    -- 'GB/26-27/000417' — 15 characters. See the header.
    'GB/' || right(split_part(v_fy, '-', 1), 2) || '-' || split_part(v_fy, '-', 2)
          || '/' || lpad(v_seq::text, 6, '0'),
    v_fy, v_seq, p_order_group_id,
    v_cfg.seller_gstin, v_cfg.seller_legal_name, v_cfg.seller_address,
    (select c.gst_state_code from city c where c.id = v_group.city_id),
    v_cfg.sac_code,
    v_buyer, v_email,
    v_taxable, v_cfg.cgst_rate_bps, v_cgst, v_cfg.sgst_rate_bps, v_sgst,
    v_taxable + v_cgst + v_sgst,
    (select array_agg(o.pickup_code) from "order" o
      where o.order_group_id = p_order_group_id and o.pickup_code is not null)
  returning id into v_id;

  -- One line per order line. **First name only** (§4.3, G7): no surname, no class, no section.
  -- The invoice is a document a parent forwards to an employer.
  insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                            unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise,
                            total_paise)
  select v_id,
         row_number() over (order by o.service_date, ol.line_no),
         ol.id,
         ol.dish_name_snapshot || ' — ' || split_part(o.recipient_name_snapshot, ' ', 1),
         v_cfg.sac_code, ol.quantity, ol.unit_price_paise, ol.line_subtotal_paise,
         ol.tax_cgst_paise, ol.tax_sgst_paise, ol.line_total_paise
    from order_line ol
    join "order" o on o.id = ol.order_id
   where o.order_group_id = p_order_group_id;

  return v_id;
end;
$$;

comment on function issue_invoice(uuid) is
  'E07-01/E07-02, M3, D14. Issues the tax invoice for a settled group, inside settle_payment''s transaction so the two succeed or fail together — a paid order with no invoice is a customer charged with no tax document, and an invoice with no settlement is a hole in a gapless series. The number comes from invoice_sequence under a row lock and is taken LAST, after every refusal has had its chance; a Postgres sequence would burn numbers on rollback. Format GB/26-27/000417 — 15 characters, because Rule 46 caps the serial at 16 and the old 17-character form did not comply. Seller identity is snapshotted (§13.2, a reprint must be byte-identical); the buyer name may be NULL (Rule 46(f)) and is never fabricated; line descriptions carry a first name only (§4.3, G7).';

revoke all on function issue_invoice(uuid) from public;
grant execute on function issue_invoice(uuid) to service_role;
