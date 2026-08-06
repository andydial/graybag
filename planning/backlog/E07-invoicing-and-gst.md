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
