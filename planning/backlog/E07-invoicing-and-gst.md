---
id: E07
title: Invoicing & GST
phase: 5
risk: high
status: not-started
depends_on: [E06]
summary: Compliant GST invoices emailed as PDF on every purchase, plus the revenue-share and payout reporting that sits on the same numbers.
---

## Context

GrayBag is the **seller of record** and pays kitchens monthly. Cart currently shows a single "5% tax" line; a compliant invoice needs the CGST/SGST split. Place of supply is Mohali / SAS Nagar (intra-state).

Blocked on E00-10 / E00-11 for GSTIN, SAC code and the school-share GST treatment.

## Tasks

- [ ] `E07-01` (risk:high) **Gapless sequential invoice numbering** per financial year — failed payments must not burn numbers
- [ ] `E07-02` (risk:high) Invoice PDF: GrayBag GSTIN, invoice no + date, customer, place of supply, SAC code, taxable value, **CGST 2.5% + SGST 2.5%**, total. **Rounding rule fixed and unit-tested** against worked examples — per line or per invoice, decided once
- [ ] `E07-03` Include the 4-digit **pickup code** on the invoice
- [ ] `E07-04` Email the invoice automatically on each successful purchase
- [ ] `E07-05` Send from a GrayBag domain address (`info@` or `admin@graybag.com`) with SPF/DKIM/DMARC configured
- [ ] `E07-06` Update cart and checkout to show the CGST/SGST split rather than a single tax line
- [ ] `E07-07` Credit note / refund document for refunded orders
- [ ] `E07-08` Invoice archive: customer can re-download any past invoice from the app
- [ ] `E07-09` (risk:high) **Revenue share calculation**: 10% default, editable per school by Admin only, resolved via the config chain
- [ ] `E07-10` Monthly payout report per school: amount owed, Admin can edit before confirming, then mark paid; only then reflected as settled
- [ ] `E07-11` Razorpay MDR on refunds deducted from the school's share
- [ ] `E07-12` Kitchen payout report (monthly, for GrayBag to pay kitchens)

Appended by Q09 (`docs/gst-invoicing.md`), which is normative for `E07-01`…`E07-08`.

- [ ] `E07-13` (risk:high) Production guard: the invoice issuer **refuses to allocate a number** while `seller_gstin` or `sac_code` still holds an `«…-PENDING-E00-10»` placeholder. Staging renders the placeholder literally
- [ ] `E07-14` (risk:high) Daily gapless-series audit per financial year — `count(*) = max(sequence_no)`, `min = 1`, `invoice_sequence.last_sequence_no = max(sequence_no)`. **Pages, does not warn**
- [ ] `E07-15` (risk:high) Guard triggers: an `invoice` row can never be `DELETE`d, and `invoice_sequence.last_sequence_no` may only increase, by exactly 1
- [ ] `E07-16` Financial year derived from `issued_at` in the platform timezone, with tests at 05:20 IST 1 Apr and 23:50 IST 31 Mar
- [ ] `E07-17` Derive the CGST/SGST vs IGST split per invoice from `left(seller_gstin, 2)` against `place_of_supply_state_code` — never hard-coded. See `[GST-02]`
- [ ] `E07-18` The invoice PDF is rendered once and stored; `E07-08`'s archive and every support reprint serve the stored bytes and never re-render
- [ ] `E07-19` Invoice-number renderer as a pure function of `(financial_year, sequence_no)`, asserting every rendered value is ≤ 16 characters and matches `^[A-Za-z0-9/-]+$`
