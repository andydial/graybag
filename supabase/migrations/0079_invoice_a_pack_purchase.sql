-- The invoice for a pack purchase. `E21-48`.
--
-- irreversible: restoring the previous `issue_invoice` would make it issue a ZERO tax invoice for
-- any meal pack purchase — against a real payment, consuming a number from a gapless series. That
-- is not a state worth returning to. Invoices already issued are unaffected either way, because
-- each stores its own amounts.
--
-- ## `issue_invoice` would have issued a ₹0 tax invoice
--
-- `settle_payment` calls it for every settled group, and it sums the totals from `"order"` and
-- builds one line per `order_line`. **A meal pack purchase has neither** (`0070`), so a ₹3,150
-- payment would have produced a tax invoice for nothing, with no lines — and consumed a number
-- from a gapless series doing it, which is not recoverable.
--
-- The same completion as `assert_order_group_totals`: each kind of group gets its rule, and the
-- food path is untouched to the paisa.
--
-- ## And settlement makes the pack spendable
--
-- `activate_paid_meal_pack` is called from `settle_payment`, so the balance and the sale's ledger
-- legs land in the transaction that makes the group `paid`. A pack is never spendable without its
-- ledger entry, and never carries an obligation we have not been paid for.

begin;

create or replace function issue_invoice(p_order_group_id uuid) returns uuid
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

  -- **A meal pack purchase has NO member orders** (`0070`), so summing them would issue a ₹0 tax
  -- invoice against a real payment — and consume a number from a gapless series doing it. The
  -- amounts come from the pack, which stamped them at sale.
  if v_group.kind = 'meal_pack_purchase' then
    select mp.net_price_paise, mp.cgst_paise, mp.sgst_paise
      into v_taxable, v_cgst, v_sgst
      from meal_pack mp where mp.order_group_id = p_order_group_id;
    if not found then
      raise exception 'a meal pack purchase with no pack cannot be invoiced (group %)',
        p_order_group_id using errcode = 'P0001', hint = 'pack_missing';
    end if;
  else
    select coalesce(sum(subtotal_paise), 0), coalesce(sum(tax_cgst_paise), 0),
           coalesce(sum(tax_sgst_paise), 0)
      into v_taxable, v_cgst, v_sgst
      from "order" where order_group_id = p_order_group_id;
  end if;

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
  if v_group.kind = 'meal_pack_purchase' then
    -- One line, the pack itself. `order_line_id` is null because there is no order line — this
    -- is a sale of meals, not of food, and the food is invoiced by being prepaid here.
    --
    -- **No child's name appears**, unlike a food line: a pack is the parent's and is not bought
    -- for anyone in particular, so there is nobody to name (§4.3, G7).
    insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                              unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise,
                              total_paise)
    select v_id, 1, null,
           o.name || ' — ' || mp.meals_total || ' meals, prepaid',
           v_cfg.sac_code, 1, mp.net_price_paise, mp.net_price_paise,
           mp.cgst_paise, mp.sgst_paise, mp.net_price_paise + mp.tax_total_paise
      from meal_pack mp
      join meal_pack_offer o on o.id = mp.offer_id
     where mp.order_group_id = p_order_group_id;
  else
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
  end if;

  return v_id;
end;

$$;

comment on function issue_invoice is
  'Issues the tax invoice for a settled group (D14). Knows two kinds: a food group invoices its '
  'order lines; a meal_pack_purchase invoices the PACK, because it has no member orders and '
  'summing them would issue a zero invoice against a real payment (E21-48).';

commit;
