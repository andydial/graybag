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
- [x] `E07-20` (risk:critical) (mvp) **Production cannot take money it cannot invoice.** `0045`. Building it found the reason it matters: **the seller's identity had no home in configuration at all** — `seller_gstin`, `seller_legal_name` and `seller_address` existed only as snapshot columns on `invoice`, so the invoice builder had nowhere to read them from. They are now on `platform_config` with `«ANGLE-BRACKET»` defaults, the convention `E20-22` already fails a production build on. `assert_seller_identity_configured()` is called by `create_checkout` **before any money moves**, because the sequence without it is the worst in the product: under auto-capture the customer is already charged, `settle_payment` then cannot allocate an invoice number, the settlement rolls back, `PY2` returns 200 and our own sweep retries for ever — every customer charged, no order created, no 5xx, no alert. `E07-13`'s refusal inside `settle_payment` stays as defence in depth; it is the one that fires after the charge. A new `platform_config.environment` defaults to **`local`**, so the safe direction is the one you get by doing nothing and this cannot become a guard people switch off; `E06-14` has somewhere to key off now too. 10 assertions
- [ ] `E07-18` The invoice PDF is rendered once and stored; `E07-08`'s archive and every support reprint serve the stored bytes and never re-render
- [ ] `E07-19` Invoice-number renderer as a pure function of `(financial_year, sequence_no)`, asserting every rendered value is ≤ 16 characters and matches `^[A-Za-z0-9/-]+$`

Added by Q15 (`docs/overnight-review.md` §2.1, §1.1).

- [x] `E07-20` (risk:critical) (mvp) **Move the placeholder guard before the money moves.** `E07-13` as specified refuses to allocate an invoice number inside `settle_payment()` — which `docs/gst-invoicing.md` §2 itself calls "the checkout's **post-capture** step". Under auto-capture (`[OL-01]`) the customer is already charged, the settlement transaction rolls back, `PY2` returns `200` and our own 5-minute sweep retries the failure forever: every customer charged, no order created, no 5xx, no alert but a growing `payment_webhook_event` backlog. Refuse `POST /checkout` in production while `seller_gstin` or `sac_code` matches `^«.*»$`, **and** add a boot assertion on the payments Edge Functions in the same shape as `E06-14`'s key-prefix check. Keep `E07-13` as defence in depth. Test: with a placeholder in config, checkout returns a typed refusal and no Razorpay order is created
- [~] `E07-21` **STRUCK 2026-08-11 — do not build.** It required deriving the CGST/SGST-vs-IGST split in the cart and checkout pricing path, on the premise that "the three launch cities span three state codes (Punjab `03`, Chandigarh `04`, Haryana `06`)". **That premise was never true of v1 and is forbidden by non-negotiable #7.** `SC1` (2026-08-07) confirmed Mohali only: one city, one state code, flat 5% as CGST 2.5% + SGST 2.5%. The three-city figure came from `docs/data-model.md` §1.7's *12-month planning* column read as a statement of today; the same misreading had put "Chandigarh, SAS Nagar (Mohali) and Panchkula" into the App Store listing, which is now corrected. The task also asserted the cart was already wrong for two of three cities — under `SC1` the cart is correct. What survives is `E07-17`, rewritten below as the one-time assertion it should always have been. Struck rather than deleted: `docs/overnight-review.md` finding 2 generated it, and a reader who finds that finding needs to land here
- [x] `E07-22` (risk:high) **`invoice.buyer_name_snapshot` is nullable, and the CHECK carries the real rule.** `0031`. It was `not null` while every account in the system has a null name — nothing writes `app_user.first_name`, and `P18`'s capture is optional, skippable and lands after payment — so the first invoice ever issued would have raised `23502` in production with money already taken. **CGST Rule 46(f)**: on a supply to an unregistered recipient below ₹50,000 the buyer's name is required only where the recipient asks for it, so the constraint was stricter than the law and would have been the thing stopping the order. Now nullable, with `check (buyer_name_snapshot is not null or total_paise < 5000000)` — required exactly when Rule 46(e) requires it, and a loud failure at write time if we ever issue at ₹50,000 or more without one. **Nothing is fabricated**: not the email local-part (a username, and email is nullable too), not "GrayBag customer" (a label), and never the recipient's name (the child is not the buyer, and it would put a minor in the buyer field of a record kept after erasure). 6 pgTAP assertions including both sides of the threshold. CA sign-off is a follow-up, not a blocker (Andy) — `docs/andy-prep/professional-questions.md`
- [ ] `E07-23` **A parent can ask for their name on an invoice already issued.** `Rule 46(f)`'s condition is "and the recipient requests that such details be recorded" — so a name is not merely optional, it is optional *until asked for*. Fast-follow: a reissue path that re-renders the document with the name and supersedes the original (never edits it — `§13.2` requires a reprint to be byte-identical to what was issued). Not v1; recorded so the obligation is not discovered from a support ticket
