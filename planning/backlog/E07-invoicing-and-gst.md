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

- [ ] `E07-01` (risk:high) (mvp) **Gapless sequential invoice numbering** per financial year — failed payments must not burn numbers
- [ ] `E07-02` (risk:high) (mvp) Invoice PDF: GrayBag GSTIN, invoice no + date, customer, place of supply, SAC code, taxable value, **CGST 2.5% + SGST 2.5%**, total. **Rounding rule fixed and unit-tested** against worked examples — per line or per invoice, decided once
- [ ] `E07-03` Include the 4-digit **pickup code** on the invoice
- [ ] `E07-04` (mvp) Email the invoice automatically on each successful purchase
- [ ] `E07-05` (risk:critical) (mvp) Sender domain setup — SPF/DKIM/DMARC for `graybag.com`, sending as `GrayBag <orders@graybag.com>` with Reply-To `support@graybag.com` (per `U4`). **Now gates login, not just invoices**: email OTP and Google/Apple confirmation mail depend on it (`U1`), so it is on the launch critical path
- [ ] `E07-06` (mvp) Update cart and checkout to show the CGST/SGST split rather than a single tax line
- [ ] `E07-07` (mvp) Credit note / refund document for refunded orders
- [ ] `E07-08` Invoice archive: customer can re-download any past invoice from the app
- [ ] `E07-09` (risk:high) **Revenue share calculation**: 10% default, editable per school by Admin only, resolved via the config chain
- [ ] `E07-10` Monthly payout report per school: amount owed, Admin can edit before confirming, then mark paid; only then reflected as settled
- [ ] `E07-11` Razorpay MDR on refunds deducted from the school's share
- [ ] `E07-12` Kitchen payout report (monthly, for GrayBag to pay kitchens)

Appended by Q09 (`docs/gst-invoicing.md`), which is normative for `E07-01`…`E07-08`.

- [ ] `E07-13` (risk:high) (mvp) Production guard: the invoice issuer **refuses to allocate a number** while `seller_gstin` or `sac_code` still holds an `«…-PENDING-E00-10»` placeholder. Staging renders the placeholder literally
- [ ] `E07-14` (risk:high) Daily gapless-series audit per financial year — `count(*) = max(sequence_no)`, `min = 1`, `invoice_sequence.last_sequence_no = max(sequence_no)`. **Pages, does not warn**
- [ ] `E07-15` (risk:high) Guard triggers: an `invoice` row can never be `DELETE`d, and `invoice_sequence.last_sequence_no` may only increase, by exactly 1
- [ ] `E07-16` (mvp) Financial year derived from `issued_at` in the platform timezone, with tests at 05:20 IST 1 Apr and 23:50 IST 31 Mar
- [ ] `E07-17` Derive the CGST/SGST vs IGST split per invoice from `left(seller_gstin, 2)` against `place_of_supply_state_code` — never hard-coded. See `[GST-02]`
- [ ] `E07-18` The invoice PDF is rendered once and stored; `E07-08`'s archive and every support reprint serve the stored bytes and never re-render
- [ ] `E07-19` Invoice-number renderer as a pure function of `(financial_year, sequence_no)`, asserting every rendered value is ≤ 16 characters and matches `^[A-Za-z0-9/-]+$`

Added by Q15 (`docs/overnight-review.md` §2.1, §1.1).

- [ ] `E07-20` (risk:critical) (mvp) **Move the placeholder guard before the money moves.** `E07-13` as specified refuses to allocate an invoice number inside `settle_payment()` — which `docs/gst-invoicing.md` §2 itself calls "the checkout's **post-capture** step". Under auto-capture (`[OL-01]`) the customer is already charged, the settlement transaction rolls back, `PY2` returns `200` and our own 5-minute sweep retries the failure forever: every customer charged, no order created, no 5xx, no alert but a growing `payment_webhook_event` backlog. Refuse `POST /checkout` in production while `seller_gstin` or `sac_code` matches `^«.*»$`, **and** add a boot assertion on the payments Edge Functions in the same shape as `E06-14`'s key-prefix check. Keep `E07-13` as defence in depth. Test: with a placeholder in config, checkout returns a typed refusal and no Razorpay order is created
- [ ] `E07-21` (risk:high) **Derive the CGST/SGST-vs-IGST split in the cart and checkout pricing path**, not only on the invoice. `E07-17` fixes the invoice; `E07-06` and `docs/order-lifecycle.md` §8.2 step 7 compute the split "per `M2`", i.e. hard-coded intra-state. The three launch cities span three state codes (Punjab `03`, Chandigarh `04`, Haryana `06` — `docs/data-model.md` §3.1), so at most one can be intra-state under a single GSTIN and a parent at a Panchkula school would be shown CGST+SGST and invoiced IGST. `L7` requires the charged total to equal the displayed total, so this is not cosmetic. Share one pricing function between checkout and the invoice builder. See `[GST-06]`
- [ ] `E07-22` (risk:high) **`invoice.buyer_name_snapshot` is `not null` and there is no name to put in it.** Found by `E05-41`'s audit. `app_user.first_name` is null for every account in the system — `0018`'s signup trigger does not write one, and `P18`'s capture is optional and skippable by design — so the first invoice ever generated raises `23502` on its own constraint rather than printing a blank. Invoice row creation does not exist yet (nothing in the repo runs `insert into invoice` outside a test fixture), so this must be settled **as invoicing is built**, not after. `docs/gst-invoicing.md` §105 specifies no fallback. The backlog's stated intent is "falls back to the email local-part" — but `app_user.email` is **also** nullable (`0018` stores null for Apple private-relay opt-out), so a third tier is needed. Decide the chain, write it into `docs/gst-invoicing.md`, and assert it with a pgTAP case for a user with neither name nor email. Andy's `P18` instruction stands: order one has no name and that must be fine everywhere — this is a defect to fix in the invoice, never a reason to make the name required
