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
- [ ] `E07-17` **Assert the seller's state rather than deriving a split** (rewritten 2026-08-11; `G4` superseded by `SC1`). Invoicing must check `left(seller_gstin, 2) = '03'` and **refuse to issue** if it does not, with the same loudness as `E07-20`'s placeholder guard. This is the half of the old "derive the split" rule that is genuinely still unknown — the place of supply is `03` for every invoice v1 will ever issue, but GrayBag's own registered state is one fact we do not yet have (`E00-10`, `[GST-02]`), and if the GSTIN turns out to be `04` then **every** invoice is IGST and nothing about the product is correct. An assertion that fails loudly is the right shape for that; a branch is not, because the branch silently does the right thing for a case that cannot arise while growing a pricing path non-negotiable #7 forbids. Test: a config whose GSTIN starts `04` refuses to issue and says why
- [ ] `E07-18` The invoice PDF is rendered once and stored; `E07-08`'s archive and every support reprint serve the stored bytes and never re-render
- [ ] `E07-19` Invoice-number renderer as a pure function of `(financial_year, sequence_no)`, asserting every rendered value is ≤ 16 characters and matches `^[A-Za-z0-9/-]+$`

Added by Q15 (`docs/overnight-review.md` §2.1, §1.1).

- [ ] `E07-20` (risk:critical) (mvp) **Move the placeholder guard before the money moves.** `E07-13` as specified refuses to allocate an invoice number inside `settle_payment()` — which `docs/gst-invoicing.md` §2 itself calls "the checkout's **post-capture** step". Under auto-capture (`[OL-01]`) the customer is already charged, the settlement transaction rolls back, `PY2` returns `200` and our own 5-minute sweep retries the failure forever: every customer charged, no order created, no 5xx, no alert but a growing `payment_webhook_event` backlog. Refuse `POST /checkout` in production while `seller_gstin` or `sac_code` matches `^«.*»$`, **and** add a boot assertion on the payments Edge Functions in the same shape as `E06-14`'s key-prefix check. Keep `E07-13` as defence in depth. Test: with a placeholder in config, checkout returns a typed refusal and no Razorpay order is created
- [~] `E07-21` **STRUCK 2026-08-11 — do not build.** It required deriving the CGST/SGST-vs-IGST split in the cart and checkout pricing path, on the premise that "the three launch cities span three state codes (Punjab `03`, Chandigarh `04`, Haryana `06`)". **That premise was never true of v1 and is forbidden by non-negotiable #7.** `SC1` (2026-08-07) confirmed Mohali only: one city, one state code, flat 5% as CGST 2.5% + SGST 2.5%. The three-city figure came from `docs/data-model.md` §1.7's *12-month planning* column read as a statement of today; the same misreading had put "Chandigarh, SAS Nagar (Mohali) and Panchkula" into the App Store listing, which is now corrected. The task also asserted the cart was already wrong for two of three cities — under `SC1` the cart is correct. What survives is `E07-17`, rewritten below as the one-time assertion it should always have been. Struck rather than deleted: `docs/overnight-review.md` finding 2 generated it, and a reader who finds that finding needs to land here
- [ ] `E07-22` (risk:high) **`invoice.buyer_name_snapshot` is `not null` and every account has a null name.** Found by `E05-41`'s audit; **awaiting Andy's ruling, proposal below — do not build before it.** Nothing writes `app_user.first_name` (`0018`'s signup trigger does not), `P18`'s capture is optional, skippable and lands *after* payment, and `app_user.email` is nullable too because of Apple private relay. So a parent who skips the prompt cannot be invoiced, and we would find out at the first invoice in production with money already taken. **The research changed the answer: `CGST Rule 46(f)` says the recipient's name and address are required on a B2C supply below ₹50,000 only if the recipient asks for them** — so the `not null` is stricter than the law, and the constraint rather than GST would be the thing stopping an order. Proposal: make the column **nullable**, never fabricate a name, and add `check (buyer_name_snapshot is not null or total_paise < 5000000)` so the schema expresses the actual rule — required exactly when the law requires it. Rejected alternatives and the reasoning are in `docs/gst-invoicing.md` §3.3 once ruled on; the CA question is on `docs/andy-prep/professional-questions.md`
- [ ] `E07-23` **A parent can ask for their name on an invoice already issued.** `Rule 46(f)`'s condition is "and the recipient requests that such details be recorded" — so a name is not merely optional, it is optional *until asked for*. Fast-follow: a reissue path that re-renders the document with the name and supersedes the original (never edits it — `§13.2` requires a reprint to be byte-identical to what was issued). Not v1; recorded so the obligation is not discovered from a support ticket
