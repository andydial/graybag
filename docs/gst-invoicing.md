---
title: GST invoicing — fields, gapless numbering, rounding
status: specification — this is what E07-01 … E07-08 are built from
sources: docs/data-model.md §8.6, supabase/migrations/0001_initial_schema.sql, docs/payments-design.md §9, docs/order-lifecycle.md, docs/decisions.md (M1–M8, D13, D14, D15)
---

# GST invoicing

`docs/payments-design.md` specifies how money crosses the Razorpay boundary.
`docs/order-lifecycle.md` specifies when it is allowed to move. This document specifies the
**document that records it**: what a GrayBag tax invoice must contain, how its number is
allocated so that the series has no holes, exactly how CGST and SGST are computed and rounded,
and what the finished thing looks like.

**This document is normative for `E07-01`, `E07-02`, `E07-03`, `E07-06`, `E07-07` and
`E07-08`.** If the implementation needs to diverge from it, change this file in the same PR.

**Two things in it are placeholders and one arithmetic path is contingent.** The GSTIN and the
SAC code are unknown until `E00-10` returns (§2). Whether the menu `Price` is GST-inclusive or
exclusive is `[DM-20]`, and §6.6 shows that the two answers are not equally cheap. Everything
else here is decidable now and is decided.

---

## 1. Scope

**In scope.** The invoice field list and its mapping to the schema; the number format and the
16-character statutory limit; gapless allocation and every way a gap can appear; financial-year
derivation; cancellation versus credit note; the CGST/SGST computation and rounding rule with
test vectors; the tax-inclusive variant; what `round_off_paise` is actually for; the rendered
layout.

**Out of scope, and where it lives instead.**

| Thing | Where |
|---|---|
| Refund amount arithmetic (full group, full line, partial quantity) | `docs/payments-design.md` §9.3 (`PY6`) |
| Ledger postings for a sale, a refund, GST payable | `docs/payments-design.md` §10, blocked on `[PAY-05]` |
| Revenue share and payouts to schools and kitchens | `E07-09` … `E07-12`, blocked on `[DM-18]` |
| Retention of invoices under DPDP erasure | `D15`, `[DM-15]`, `E20-05` |
| Emailing the PDF and the sending domain | `E07-04`, `E07-05` |
| Wallet as a payment method at checkout | `E06-10`, blocked on the RBI PPI question |

---

## 2. The placeholders, and the guard that stops them shipping

Three values on every invoice are unknown until `E00-10` returns. They are **snapshotted onto
the `invoice` row** (`seller_gstin`, `seller_legal_name`, `seller_address`, `sac_code`) rather
than read from config at render time, because a reprint must be byte-identical to the document
that was issued (`docs/data-model.md` §13.2). That means a wrong value cannot be fixed by
editing config — it is baked into every invoice issued before the fix.

| Placeholder token | Resolved by | What it feeds |
|---|---|---|
| `«GSTIN-PENDING-E00-10»` | Accountant | `invoice.seller_gstin`. **Its first two digits are the seller's state code**, which is what decides CGST+SGST versus IGST (§3.2) |
| `«SAC-PENDING-E00-10»` | Accountant | `invoice.sac_code`, `invoice_line.sac_code`. `996331` is assumed and seeded as the `platform_config` default; it is **not** confirmed |
| `«LEGAL-NAME-PENDING-E00-10»`, `«ADDRESS-PENDING-E00-10»` | Andy | `seller_legal_name`, `seller_address` |

**The guard.** In staging and development the placeholder renders literally, in angle quotes,
so it is impossible to mistake for a real GSTIN. The refusal is deliberately loud and
deliberately early, and it fires **before any money moves**, because an invoice issued with a
placeholder GSTIN is a non-compliant tax document that cannot be corrected without a credit
note and a reissue. Being unable to *start* a purchase on day one is a smaller problem than a
month of invalid invoices — and a much smaller problem than charging the customer and then
being unable to issue the order, which is what a post-capture guard produces.

The guard has three layers, primary first:

1. **Primary — refuse `POST /checkout` in production** while `seller_gstin` matches `^«.*»$`
   or `sac_code` does. This fails the checkout **before authorization or capture**, so no money
   is ever taken against an order that cannot be invoiced. The resolved seller config is read at
   checkout for exactly this test; a placeholder is a `503`-shaped "not open for business yet"
   refusal, not a customer-visible error mid-payment.
2. **Boot assertion** on every payments Edge Function, in the same shape as `E06-14`'s
   key-prefix check (`docs/payments-design.md` §2.2): in production, refuse to start if the
   resolved `seller_gstin` or `sac_code` is still a placeholder. A misconfigured deploy is a
   hard boot failure, not a per-request surprise, so a placeholder can never reach a live
   checkout at all.
3. **Defence in depth — the invoice issuer still refuses to allocate a number** while either
   placeholder stands, so a code path that ever reached settlement without passing layer 1
   (a support-composed order, a future job) cannot mint a non-compliant document. This layer
   must never be the *only* one that fires: by the time it does, `settle_payment()` is already
   inside the settlement transaction after the money was captured (`docs/order-lifecycle.md`
   §8.4), so it rolls the settlement back and strands a captured payment — the failure the
   primary guard exists to prevent.

`E07-13` owns the allocation-time check; `E07-20` owns the primary checkout guard and the boot
assertion.

The same reasoning applies to the state code: with a placeholder GSTIN we do not know whether
the supply is intra-state, so we cannot know whether to charge CGST+SGST or IGST. §3.2.

---

## 3. Who is supplying what, to whom

### 3.1 GrayBag is the supplier

`M1`. GrayBag is the seller of record; kitchens are paid monthly against a separate payout
(`E07-12`). So the tax invoice is **GrayBag → the paying adult**. The kitchen does not invoice
the parent and does not appear on the document. The school does not appear either; its 10%
share is a separate transaction in the other direction (`E07-09`, `[DM-18]`, `[GST-04]`).

The buyer is the **paying adult**, never the child. `invoice.buyer_name_snapshot` is the
`app_user`, and §4.3 covers what may and may not be said about the recipient on a line.

### 3.2 The split is asserted, not derived — `SC1`

**Revised 2026-08-11.** This section used to require the CGST/SGST-vs-IGST split to be computed
per invoice from `left(seller_gstin, 2)` against `place_of_supply_state_code`, and `G4` recorded
that as a decision. `SC1` supersedes it, and `G4` is archived.

The old reasoning was sound and half of its premise expired. GST is intra-state when the
supplier's registered state equals the place of supply — that is still true. But a *derivation*
needs two variables, and v1 has one:

- **Place of supply is `03` for every invoice v1 will ever issue.** One city (`SC1`), one state
  code, asserted by `seed.test.sql` (*"every city is Punjab — no IGST path is reachable"*).
- **The seller's own registered state is unknown**, because we do not have the GSTIN
  (`E00-10`, `[GST-02]`). That is one fact with one answer, not a per-invoice question.

So the rule is:

```
assert left(seller_gstin, 2) = '03'   -- else refuse to issue, loudly
cgst_rate_bps = 250, sgst_rate_bps = 250, igst_rate_bps = 0
```

**Why an assertion and not a branch.** A branch would silently do the right thing for a case
that cannot arise, while growing the cart and checkout pricing path that non-negotiable #7
forbids — which is exactly what `E07-21` had become before it was struck. An assertion does the
one thing that actually matters: if the GSTIN turns out to start `04`, **every** invoice is
IGST and nothing about the product's pricing is correct, and we find that out at the boot
assertion rather than in a parent's inbox. It pairs with `E07-20`'s placeholder guard and fails
the same way.

`igst_rate_bps` and `igst_paise` stay on the schema, defaulted to zero and written by nothing.
They cost nothing and `D9` expects a second city eventually; when there is one, `G4` comes back
out of the archive.

### 4.1 Statutory fields

Rule 46 of the CGST Rules, 2017 lists the particulars a tax invoice must contain. The mapping
below is our reading of it and **is one of the things `E00-10`'s accountant should sign off**
(§10) — it is not legal advice.

| # | Rule 46 particular | Where it comes from | Notes |
|---|---|---|---|
| a | Supplier name, address, GSTIN | `invoice.seller_legal_name`, `seller_address`, `seller_gstin` | Snapshotted. §2 |
| b | Consecutive serial number, ≤ 16 characters, unique per financial year | `invoice.invoice_number`, rendered from `(financial_year, sequence_no)` | §5. **The example format in `docs/data-model.md` was 17 characters and has been corrected** |
| c | Date of issue | `invoice.issued_at` | Rendered in the platform timezone, `13 Apr 2026` |
| d | Recipient name, address, GSTIN — *if registered* | `invoice.buyer_gstin` | B2B is not expected. The column exists and prints only when non-null |
| e | Recipient name and address with state and code — *if unregistered and the supply is ≥ ₹50,000* | `buyer_name_snapshot` | A school lunch order will not approach ₹50,000, so the address is not required. We print the **name** anyway, because the buyer expects it |
| f | HSN / SAC | `invoice.sac_code`, `invoice_line.sac_code` | `«SAC-PENDING-E00-10»`. On both the header and each line — the line-level column is what lets a future mixed-SAC invoice work |
| g | Description of the service | `invoice_line.description` | §4.3 |
| h | Quantity | `invoice_line.quantity` | |
| i | Total value of supply | `invoice_line.total_paise`, `invoice.total_paise` | |
| j | Taxable value, **after** discount | `invoice_line.taxable_value_paise` | §6.7 — discount reduces the tax base, it is not applied after tax |
| k | Rate of tax, per component | `invoice.cgst_rate_bps` / `sgst_rate_bps` / `igst_rate_bps` | Rendered `2.5%`. Basis points per `D13` |
| l | Amount of tax charged, per component | `invoice_line.cgst_paise` / `sgst_paise`, and the invoice totals | Never a single "5% tax" line. `M2`, `E07-06` |
| m | Place of supply with state name | `invoice.place_of_supply_state_code` + the name | Printed always, not only for inter-state — it costs nothing and it is what makes §3.2 auditable |
| n | Address of delivery, where different from the place of supply | — | Not applicable: the food is delivered where the service is performed |
| o | Whether tax is payable on reverse charge | — | Always `No`. Printed as a literal, not omitted |
| p | Signature or digital signature | — | `«SIGNATURE-TREATMENT-PENDING-E00-10»`. §10 item 5 |

### 4.2 GrayBag additions

Not statutory; they are there because the invoice is also the document the customer actually
uses.

| Field | Source | Why |
|---|---|---|
| Pickup codes | `invoice.pickup_codes text[]` | `P4` / `E07-03`. Children without phones collect at a counter with a 4-digit code, and the invoice is the copy the parent can find. One code per member order |
| Order reference | `order_group` → `order.order_ref` | `E02-13`. The customer quotes this to support, who resolve it to `correlation_id` |
| Wallet applied / paid online | `order_group.wallet_applied_paise`, `payable_paise` | §6.8. **Below the total, never inside it** |
| Amount in words | Derived | Universal expectation on an Indian invoice |

### 4.3 What a line may say about the child

The line description has to distinguish "Veg Sandwich for Aarav on Monday" from "Veg Sandwich
for Ishaan on Monday", or a parent ordering for two children on one day gets two identical
lines and cannot check their own invoice. So the recipient has to appear.

**The rule: first name only. No surname, no class, no section.** `E07-02`.

- The parent is the buyer and already knows who the food was for, so the first name is the
  minimum that makes the document legible.
- `order.class_label_snapshot` and `section_label_snapshot` exist for the packing list
  (`E09-03`) and the kitchen. They have **no purpose on a tax document**, and non-negotiable
  #4 is that a child's school context does not travel further than it has to.
- This matters more than it looks, because of `D15`: an invoice is retained through erasure.
  Whatever goes into `invoice_line.description` is retained for the statutory period and
  **cannot be scrubbed by a DPDP erasure request** — it is the statutory record. A first name
  is defensible in that position; a name-class-section triple is a school roster preserved
  indefinitely inside the accounts.

Rendered form: `Veg Sandwich — Aarav, Mon 13 Apr`. The dish name comes from
`order_line.dish_name_snapshot`, not from `dish`, for the reason in §7.4 of the data model.

---

## 5. Gapless numbering

`M3` and `E07-01`: the invoice number series must be consecutive within a financial year, and a
failed payment must not burn a number. `D14` fixes the mechanism. This section fixes everything
around it.

### 5.1 What gaplessness actually requires

A gap is a `sequence_no` that was allocated and never appears on an issued document. There are
exactly five ways to produce one, and each needs its own control:

| # | How a gap appears | Control |
|---|---|---|
| 1 | A `SEQUENCE` or `identity` column is used | Forbidden. Sequences are non-transactional by design: a rollback consumes the value permanently. `docs/learnings.md`, 2026-08-06 |
| 2 | The number is allocated before the money is certain | Allocate **only after capture**, in the same transaction as the capture (§5.3). An abandoned checkout never reaches the statement |
| 3 | The transaction rolls back after allocating | Safe by construction — the allocation is a row `UPDATE`, so it rolls back with everything else. This is the whole reason for the counter row |
| 4 | An invoice row is deleted | **Forbidden by trigger.** `E07-15`. An invoice that must be withdrawn is `status = 'cancelled'`, keeping its number (§5.5) |
| 5 | The counter is edited by hand — reset, skipped forward, seeded wrong | **Forbidden by trigger.** `last_sequence_no` may only increase, and only by exactly 1. `E07-15` |

Controls 4 and 5 exist because gaplessness is a property of the *rendered series* and not of the
counter. The counter being correct proves nothing if a row can vanish from under it.

### 5.2 The number format, and the 16-character limit

Rule 46(b) caps the serial number at **sixteen characters**, drawn from letters, digits, `-`
and `/`. The illustrative format previously carried in `docs/data-model.md` §8.6 and in the
schema comment was `GB/2026-27/000417`, which is **seventeen characters** and would not comply.

The format is therefore:

```
GB/26-27/000417        15 characters
│  │     └── sequence_no, zero-padded to 6 → 999,999 invoices per financial year
│  └──────── financial year, two-digit form
└─────────── fixed prefix
```

If `[PAY-06]` is answered as a separate credit-note series, its prefix is `GBC`, giving
`GBC/26-27/000417` at exactly sixteen characters — which is the reason the invoice prefix is
two letters and not three. Do not lengthen either prefix without recounting.

`invoice_number` is stored, but `(financial_year, sequence_no)` is the truth; the renderer is a
pure function of the pair and is asserted to produce ≤ 16 characters from the permitted
character set. `E07-19`.

### 5.3 Allocation

One statement, inside the transaction that records the capture and inserts the invoice:

```sql
insert into invoice_sequence (financial_year, last_sequence_no)
values ($fy, 1)
on conflict (financial_year) do update
   set last_sequence_no = invoice_sequence.last_sequence_no + 1,
       updated_at       = now()
returning last_sequence_no;
```

This is a refinement of the two-statement form in `docs/data-model.md` §8.6 and replaces it.
The refinement is not stylistic: the two-statement version has to answer "what if the row for
this financial year does not exist yet", and the obvious answer — check, then insert, then
update — is a race that two concurrent first-invoices-of-the-year both lose. `ON CONFLICT DO
UPDATE` takes the row lock and re-reads the committed value, so the first invoice of a new
financial year and the four-hundredth are the same statement.

The row lock serialises invoice creation. **That is correct, not a defect** — gapless numbering
is inherently serial, and at a few thousand invoices a month the contention is irrelevant. Do
not "optimise" it later; the optimisation is the bug.

### 5.4 Which financial year

The Indian financial year runs 1 April to 31 March. The year is derived from `issued_at`
**in the platform timezone**, using `now()` from Postgres — never from a client clock (`L6`),
never from `service_date`, and never from UTC.

The UTC point is not hypothetical. An invoice issued at 05:20 IST on 1 April 2026 is 23:50 UTC
on 31 March 2026. Deriving the year in UTC files it under `2025-26` and puts it *after* invoices
already numbered in `2026-27` — a hole in one series and an out-of-order number in the other,
discovered a year later by an auditor. `E07-16` requires a test at that exact boundary in both
directions.

```
financial_year(ts) = let d = ts at time zone platform_config.timezone in
                     if month(d) >= 4 then f"{yy(d)}-{yy(d)+1}" else f"{yy(d)-1}-{yy(d)}"
```

`service_date` is deliberately not used: an order paid on 30 March for food served on 2 April is
invoiced in the year the supply was paid for, and the invoice date is what the return is filed
against.

### 5.5 Cancellation, never deletion

`invoice_status` is `issued | cancelled`. Under `D14` the number is allocated only after capture,
so the ordinary "we issued that by mistake" case barely exists — the money moved.

**The customer-facing reversal of an issued invoice is always a credit note, never a
cancellation.** A cancelled invoice tells the customer nothing and reverses no tax; a credit
note does both, and it is what the GST return expects. `E07-07`.

`status = 'cancelled'` is reserved for the case where a document was created that never should
have existed at all — a data-fix or a migration artefact — and it **keeps its number**. The row
stays, the number stays in the series, and the document renders as a cancelled invoice of zero
value with the reason on it. Cancelling requires a note. Deleting is impossible (§5.1 control 4).

### 5.6 The audit

Gaplessness that is not checked is gaplessness that is assumed. A daily job, riding alongside
the reconciliation clocks in `docs/payments-design.md` §11, asserts per financial year:

```sql
select financial_year,
       count(*)                     as issued,
       min(sequence_no)             as lo,
       max(sequence_no)             as hi,
       max(sequence_no) - count(*)  as missing        -- must be 0
  from invoice
 group by financial_year;
-- and, per row: lo = 1, and hi = invoice_sequence.last_sequence_no
```

Non-zero `missing`, `lo <> 1`, or a counter ahead of `max(sequence_no)` **pages**, it does not
warn. A hole in a statutory series does not self-heal and does not get better by being noticed
next month. `E07-14`.

### 5.7 Credit notes share the series, for now

`invoice_fy_sequence_unique (financial_year, sequence_no)` spans both document types, so a
credit note allocated from `invoice_sequence` consumes an invoice number and the two document
types interleave in one series. That is `[PAY-06]`, already open and unanswered: one shared
series satisfies the letter of the requirement, a separate series per document type is the more
common practice. The prefix design in §5.2 assumes the answer may be "separate" and reserves
room for it. Ask before `E07-07` is built — the migration is cheap now and awkward once real
credit notes exist.

---

## 6. The rounding rule

This section resolves `[DM-19]`.

### 6.1 Two roundings that must not be confused

| | What it is | Our answer |
|---|---|---|
| **Tax rounding** | A tax component computed on a taxable value is a fraction of a paise. It must become an integer | **Half-up, per line, per component.** §6.2 |
| **Grand-total rounding** | The classic Indian invoice "Round Off ₹0.40" that brings the payable to a whole rupee | **Not done.** We charge exact paise. §6.9, `[GST-03]` |

`[DM-19]` is about the first. The schema comment on `round_off_paise` describes the second. §6.9
reconciles them.

### 6.2 The rule

**Each tax component is computed independently from the line's taxable value, and rounded
half-up to integer paise. The invoice is the sum of its lines.**

For each `invoice_line`:

```
taxable      = unit_price_paise × quantity − line_discount_paise
cgst_paise   = half_up(taxable × cgst_rate_bps / 10000)
sgst_paise   = half_up(taxable × sgst_rate_bps / 10000)
total_paise  = taxable + cgst_paise + sgst_paise
```

and for the invoice, by summation only:

```
taxable_value_paise = Σ line.taxable
cgst_paise          = Σ line.cgst_paise
sgst_paise          = Σ line.sgst_paise
total_paise         = Σ line.total_paise
round_off_paise     = 0                      -- under exclusive pricing; see §6.6 and §6.9
```

`half_up` is implemented in **integer arithmetic only** — no float, no `numeric` round-trip,
non-negotiable #3 has no exception for a proportion:

```
half_up(n / d)  ==  (n × 2 + d) div (d × 2)          for n, d ≥ 0
```

At 250 bps this collapses to `cgst_paise = (taxable + 20) div 40`, which is worth writing in
the test as an independent second implementation.

**Half-up, not banker's rounding.** Half-up is the Indian convention, it is what an accountant
checking a line by hand will do, and — unlike half-even — it produces the same answer for the
same taxable value every time regardless of what the value happens to be, which is what makes
the test vectors in §6.5 stable.

### 6.3 Why per line, and not per invoice

`[DM-19]` presented per-line and per-invoice as an even choice. It is not, and the reason is not
about tax at all — it is that **the schema already computes tax per line at checkout, and the
invoice must equal what was charged.**

`order_line.tax_cgst_paise` is an integer column. `order.tax_cgst_paise` is asserted to be the
sum over its lines, and `assert_order_group_totals()` asserts the group's `tax_total_paise` is
the sum over its orders. `order_group.payable_paise` is then `subtotal + tax − discount −
wallet`, and **that is the number handed to Razorpay**. The money moved on a per-line-rounded
figure before the invoice existed.

An invoice that rounded per invoice would therefore disagree with the amount actually charged.
On the worked example in §6.5.3 the disagreement is 2 paise:

| | Taxable | CGST | SGST | Total |
|---|---|---|---|---|
| Per line (charged, and what the invoice says) | 65,550 | 1,640 | 1,640 | **68,830** |
| Per invoice (2.5% of 65,550 = 1,638.75 → 1,639) | 65,550 | 1,639 | 1,639 | **68,828** |

Two paise is not a rounding preference. It is an invoice that does not match the bank statement,
and it would have to be papered over by `round_off_paise` on every invoice with an odd number of
fractional lines — turning a column meant for an exceptional residual into a permanent fudge
factor whose value nobody could explain.

**So: per line. `round_off_paise` is zero under exclusive pricing, and that is an invariant
worth asserting rather than a coincidence.**

The corollary, which is the part that will be got wrong: **the invoice never computes tax. It
transcribes `order_line.tax_cgst_paise` and `tax_sgst_paise`.** The formula in §6.2 belongs to
the checkout pricing function; the invoice builder copies. Any invoice-side recomputation is a
second implementation of the rule, and a second implementation is a future divergence.

### 6.4 Why each component is computed independently

The tempting alternative is to compute 5% once and halve it. Do not.

- CGST at 2.5% of the taxable value and SGST at 2.5% of the taxable value are **two separate
  levies on the same base**, and the GST return is filed with the two figures separately. There
  is no statutory "5%" to halve; 5% is a display convenience.
- Halving a rounded 5% produces **unequal halves**. On a ₹125 line, 5% of 12,500 is 625 paise,
  which splits as CGST 312 and SGST 313. An invoice showing CGST ₹3.12 and SGST ₹3.13 at
  identical rates on an identical base is visibly wrong and will be queried.
- Computing each independently produces equal halves — CGST 313 and SGST 313 — whose sum is
  626, a paise more than 5% of the base. **That is correct, not a bug.** It is the arithmetic
  consequence of two independent levies, and it is what the return will show.

So: while `cgst_rate_bps = sgst_rate_bps`, **CGST always equals SGST on every line and on the
invoice**. That is a one-line assertion and it is the cheapest possible test of this whole
section.

Do not define `tax_total` anywhere as `half_up(taxable × 500 / 10000)`. It is
`cgst + sgst + igst`, always, everywhere.

### 6.5 Worked examples

These are test vectors for `E07-02`. All values are integer paise. Rates are CGST 250 bps,
SGST 250 bps, IGST 0 (§3.2). The `5% of taxable` column exists only to show where the
independent-component rule diverges from the naive one — **it is not a value the system ever
computes**.

#### 6.5.1 Single line, no discount

| # | Line | Taxable | CGST | SGST | Tax | Line total | 5% of taxable | Diverges? |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 × ₹120.00 | 12,000 | 300 | 300 | 600 | 12,600 | 600 | no |
| 2 | 2 × ₹120.00 | 24,000 | 600 | 600 | 1,200 | 25,200 | 1,200 | no |
| 3 | 1 × ₹150.00 | 15,000 | 375 | 375 | 750 | 15,750 | 750 | no — exact eighth of a rupee |
| 4 | 1 × ₹125.00 | 12,500 | 313 | 313 | 626 | 13,126 | 625 | **+1** — the half-paise case, rounds up |
| 5 | 3 × ₹125.00 | 37,500 | 938 | 938 | 1,876 | 39,376 | 1,875 | **+1** |
| 6 | 1 × ₹99.00 | 9,900 | 248 | 248 | 496 | 10,396 | 495 | **+1** |
| 7 | 7 × ₹45.00 | 31,500 | 788 | 788 | 1,576 | 33,076 | 1,575 | **+1** |
| 8 | 1 × ₹62.50 | 6,250 | 156 | 156 | 312 | 6,562 | 313 | **−1** — components round *down*, the naive 5% rounds up |
| 9 | 1 × ₹85.50 | 8,550 | 214 | 214 | 428 | 8,978 | 428 | no |
| 10 | 1 × ₹0.10 | 10 | 0 | 0 | 0 | 10 | 1 | **−1** — degenerate, and the reason the tax columns are nullable-free with a `>= 0` check rather than a `> 0` one |

Row 4 is the headline case: `12,500 × 250 / 10,000 = 312.5`, half-up to 313. Row 8 is its
mirror: `6,250 × 250 / 10,000 = 156.25`, half-up to 156, while `6,250 × 500 / 10,000 = 312.5`
rounds up to 313. **The divergence goes both ways**, which is why "just compute 5% and halve it"
cannot be patched with a sign.

#### 6.5.2 With a line discount

`[DM-21]` requires a discount to be distributed onto lines, so the discount reduces the tax base
(Rule 46(j)) before any tax is computed. Nothing in v1 issues a discount; this is the vector for
when promo codes are built.

| # | Line | Gross | Discount | Taxable | CGST | SGST | Line total |
|---|---|---|---|---|---|---|---|
| 11 | 1 × ₹125.00 less ₹12.50 | 12,500 | 1,250 | 11,250 | 281 | 281 | 11,812 |

`11,250 × 250 / 10,000 = 281.25`, half-up to 281.

#### 6.5.3 A full invoice — two children, two days

One `order_group`, three member orders, five lines. This is the document rendered in §8.

| # | Description | Qty | Unit | Taxable | CGST | SGST | Line total |
|---|---|---|---|---|---|---|---|
| 1 | Veg Sandwich — Aarav, Mon 13 Apr | 1 | 12,500 | 12,500 | 313 | 313 | 13,126 |
| 2 | Fresh Lime Soda — Aarav, Mon 13 Apr | 1 | 4,500 | 4,500 | 113 | 113 | 4,726 |
| 3 | Rajma Chawal — Aarav, Tue 14 Apr | 1 | 15,000 | 15,000 | 375 | 375 | 15,750 |
| 4 | Veg Sandwich — Ishaan, Mon 13 Apr | 2 | 12,500 | 25,000 | 625 | 625 | 26,250 |
| 5 | Fruit Bowl — Ishaan, Mon 13 Apr | 1 | 8,550 | 8,550 | 214 | 214 | 8,978 |
| | **Invoice** | | | **65,550** | **1,640** | **1,640** | **68,830** |

Checks the test should make, all of which are independent of the arithmetic above:

- `Σ line.total_paise = invoice.total_paise` → 68,830 ✓
- `invoice.taxable + invoice.cgst + invoice.sgst + invoice.round_off = invoice.total` →
  65,550 + 1,640 + 1,640 + 0 = 68,830 ✓
- `invoice.cgst_paise = invoice.sgst_paise` (§6.4) ✓
- `invoice.round_off_paise = 0` (exclusive pricing) ✓
- `invoice.total_paise = order_group.subtotal_paise + order_group.tax_total_paise −
  order_group.discount_paise` → 65,550 + 3,280 − 0 = 68,830 ✓ — note **wallet is not
  subtracted** (§6.8)
- Line 2 checks the second rounding case in the same invoice: `4,500 × 250 / 10,000 = 112.5`,
  half-up to 113, so the tax on ₹45.00 is ₹2.26 and not ₹2.25.

### 6.6 If `Price` turns out to be tax-inclusive

`[DM-20]` is open and `platform_config.price_is_tax_inclusive` is deliberately `NULL`, so **the
tax calculation must refuse to run** until it is answered. Everything above is the
`price_is_tax_inclusive = false` path. This section specifies the other path so that answering
`[DM-20]` is a config flip rather than a redesign — and so that the cost of the "inclusive"
answer is visible before it is chosen.

**Reverse derivation.** With `R = cgst_bps + sgst_bps + igst_bps` and a gross amount `G`:

```
taxable = half_up(G × 10000 / (10000 + R))
cgst    = half_up(taxable × cgst_rate_bps / 10000)
sgst    = half_up(taxable × sgst_rate_bps / 10000)
residual ρ = G − (taxable + cgst + sgst)
```

`ρ ∈ {−1, 0, +1}` always, and this is provable rather than observed. Writing `taxable =
20G/21 + e₀` with `|e₀| ≤ ½`, and each component as `taxable/40 + eᵢ` with `|eᵢ| ≤ ½`:

```
taxable + cgst + sgst = (21/20)·taxable + e₁ + e₂ = G + (21/20)e₀ + e₁ + e₂
⇒ |ρ| ≤ 21/40 + ½ + ½ = 1.525,  and ρ is an integer  ⇒  ρ ∈ {−1, 0, +1}
```

The residual is where `round_off_paise` earns its signed type: the line total stays at the
displayed gross `G`, and `invoice.round_off_paise = Σρ` over the lines. On a ₹125.00 inclusive
dish: `taxable = 11,905`, `cgst = sgst = 298`, `11,905 + 596 = 12,501`, so `ρ = −1` and the
invoice shows taxable ₹119.05 + CGST ₹2.98 + SGST ₹2.98, round off −₹0.01, total ₹125.00.

**And here is the problem, which is `[GST-01]`.** `order_line` carries a hard constraint:

```sql
constraint order_line_subtotal_arithmetic check (line_subtotal_paise = unit_price_paise * quantity)
```

Under inclusive pricing, `unit_price_paise` must be the *derived exclusive* unit price, or
`subtotal + tax` double-counts the tax and `order_group_payable_arithmetic` is wrong. But
deriving per unit and then multiplying **multiplies the per-unit rounding error by the
quantity**, which line-level derivation does not:

| Displayed inclusive price | Qty | Gross expected | Derived unit (excl) | Subtotal | CGST | SGST | Line total | Drift |
|---|---|---|---|---|---|---|---|---|
| ₹120.00 | 2 | 24,000 | 11,429 | 22,858 | 571 | 571 | 24,000 | 0 |
| ₹125.00 | 3 | 37,500 | 11,905 | 35,715 | 893 | 893 | 37,501 | **+1** |
| ₹99.00 | 4 | 39,600 | 9,429 | 37,716 | 943 | 943 | 39,602 | **+2** |

So four ₹99.00 dishes, priced inclusive of GST, cost ₹396.02 — and there is no arrangement of
integers that makes it ₹396.00 while `line_subtotal = unit_price × quantity` holds. The options
are laid out in `[GST-01]`; the short version is that an "inclusive" answer to `[DM-20]` costs a
migration to relax that constraint, and it should be costed before it is chosen rather than
discovered in `E05`.

### 6.7 Discount

Distributed onto lines (`[DM-21]`), applied **before** tax, and the tax base is the discounted
taxable value (Rule 46(j)). Nothing in v1 issues one. When promo codes are built, the
distribution rule must floor per line and give the remainder to the last line, exactly as
`PY6` rule 3 does for partial refunds, so that the distributed amounts sum to the discount
without a residual.

### 6.8 The wallet is a payment method, not a discount

`order_group.payable_paise = subtotal + tax − discount − wallet_applied`. The wallet term is in
that formula because it reduces what Razorpay is asked for. **It does not reduce the supply, and
it must not appear above the invoice total.**

- The supply happened at its full value; how the buyer settled it is not a tax question.
- Under `M7` wallet credit usually originates from a refund, which already carried a credit note
  reversing its tax. Reducing the taxable value again would relieve the same tax twice.

So on the invoice: `total_paise` is the full value of the supply, and `Paid from wallet` /
`Paid online` sit **below** it as a settlement summary. §8.

`invoice.total_paise = order_group.subtotal + tax − discount`, and the Razorpay charge is
`invoice.total_paise − order_group.wallet_applied_paise`. A test should assert both halves,
because getting this backwards is a plausible one-line mistake that under-reports GST.

### 6.9 What `round_off_paise` is for

| Situation | `round_off_paise` |
|---|---|
| Exclusive pricing (`[DM-20]` = exclusive) | **Always 0.** Assert it |
| Inclusive pricing (`[DM-20]` = inclusive) | `Σρ` over the lines, §6.6. Bounded by ±1 per line |
| Grand-total rupee rounding | **Not used.** `[GST-03]` |

We do **not** round the payable to the nearest rupee. Razorpay charges exact paise, the customer
sees exactly what the arithmetic produced, and a rupee round-off is a second adjustment on top
of a number that is already correct. If the accountant wants the conventional round-off line,
the column supports it and `[GST-03]` is where that gets decided — but it changes the amount
charged, so it is not a rendering-time change and cannot be added after invoices exist without a
dated cutover.

---

## 7. Credit notes

Every completed refund produces a credit note (`E07-07`): `document_type = 'credit_note'`,
`credit_note_of_invoice_id` pointing at the tax invoice, allocated from `invoice_sequence` by
the same statement as §5.3, subject to `[PAY-06]`.

**The credit note never re-derives tax.** `PY6` is normative for the amounts:

- Full-group refund = `invoice.total_paise` exactly, including `round_off_paise`.
- Full-line refund = `invoice_line.total_paise` exactly.
- Partial-quantity refund of *k* of *n* on a line: `floor(line_total × k / n)` per unit, with the
  last unit refunded carrying the remainder.

The credit note's taxable value and CGST/SGST are the corresponding figures from the invoice or
the invoice line, not a recomputation. This is what makes a later change to the rounding rule
unable to alter the refundable amount on a historical order.

Worked example against §6.5.3: a full refund of line 4 (2 × Veg Sandwich for Ishaan) produces a
credit note of taxable 25,000, CGST 625, SGST 625, total 26,250 — copied, not computed. Refunding
that line one unit at a time gives 13,125 then 13,125 — and against line 5 of §6.5.1 (3 × ₹125,
line total 39,376) one unit at a time gives 13,125 + 13,125 + **13,126**, summing to exactly the
line total.

Wallet refunds get a credit note too: the supply was reversed, and how the money came back is
not a tax question — the mirror of §6.8.

---

## 8. Sample invoice layout

Values from §6.5.3, with ₹50.00 of wallet credit applied. Placeholders in `«…»` are §2.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  [GRAYBAG LOGO]                                                  TAX INVOICE   │
│                                                                                │
│  «LEGAL-NAME-PENDING-E00-10»                                                   │
│  «ADDRESS-PENDING-E00-10»                                                      │
│  GSTIN  «GSTIN-PENDING-E00-10»                                                 │
│                                                                                │
│  Invoice No.   GB/26-27/000417          Invoice Date   13 Apr 2026             │
│  Place of Supply  03 — Punjab           Reverse Charge  No                     │
│  SAC  «SAC-PENDING-E00-10»              Order Ref   GB-8F3K2Q                  │
├────────────────────────────────────────────────────────────────────────────────┤
│  Billed to                                                                     │
│    Priya Sharma                                                                │
│    +91 98xxx xx210    priya@example.com                                        │
│    GSTIN  —                                                                    │
├────────────────────────────────────────────────────────────────────────────────┤
│   #  Description                        Qty     Rate   Taxable   CGST    SGST  │
│                                                    ₹         ₹   2.5%    2.5%  │
│  ────────────────────────────────────────────────────────────────────────────  │
│   1  Veg Sandwich — Aarav, Mon 13 Apr     1   125.00    125.00   3.13    3.13  │
│   2  Fresh Lime Soda — Aarav, Mon 13 Apr  1    45.00     45.00   1.13    1.13  │
│   3  Rajma Chawal — Aarav, Tue 14 Apr     1   150.00    150.00   3.75    3.75  │
│   4  Veg Sandwich — Ishaan, Mon 13 Apr    2   125.00    250.00   6.25    6.25  │
│   5  Fruit Bowl — Ishaan, Mon 13 Apr      1    85.50     85.50   2.14    2.14  │
│  ────────────────────────────────────────────────────────────────────────────  │
│                                          Taxable value           655.50        │
│                                          CGST @ 2.5%              16.40        │
│                                          SGST @ 2.5%              16.40        │
│                                          Round off                 0.00        │
│                                          ──────────────────────────────        │
│                                          TOTAL                   688.30        │
│                                                                                │
│                                          Paid from wallet        −50.00        │
│                                          Paid online             638.30        │
├────────────────────────────────────────────────────────────────────────────────┤
│  Amount in words:  Six hundred eighty-eight rupees and thirty paise only        │
│                                                                                │
│  Pickup codes                                                                  │
│    Aarav   Mon 13 Apr   4821          Ishaan  Mon 13 Apr   1907                │
│    Aarav   Tue 14 Apr   4822                                                   │
│                                                                                │
│  «SIGNATURE-TREATMENT-PENDING-E00-10»                                          │
└────────────────────────────────────────────────────────────────────────────────┘
```

Notes on the layout that are requirements, not taste:

1. **`TOTAL` is the value of the supply.** The two settlement lines sit below the rule under it
   and are visually subordinate (§6.8). A designer who moves `Paid online` above `TOTAL`, or
   relabels `TOTAL` as "Amount due", has broken a tax document.
2. **`Round off` prints even when it is `0.00`.** A field that only appears when non-zero is a
   field nobody notices is missing.
3. **CGST and SGST are separate columns and separate summary lines.** Never a combined "GST 5%"
   or "Tax". `M2`, `E07-06`. **Two columns, always** — §3.2 asserts intra-state rather than
   resolving it, so there is no inter-state rendering to build and no IGST column in v1. The
   renderer must not grow a branch for a case that cannot reach it; if `D9`'s second city ever
   arrives, the branch arrives with it.
4. **Line descriptions carry a first name only** (§4.3).
5. **The phone is masked, the email is not.** The invoice goes to that email, so masking it is
   theatre; the phone appears only for identification.
6. **The PDF is rendered once and stored** as `invoice.pdf_asset_id` in the private bucket. Any
   later download — `E07-08`'s archive, a support reprint, an accountant's export — serves the
   stored bytes and **never re-renders**. A template change six months from now must not alter a
   historical tax document. `E07-18`.

---

## 9. e-invoicing and the dynamic QR code — not applicable, and when that changes

Neither obligation applies to GrayBag today, and both have turnover triggers rather than being
optional, so they are recorded here with the trigger rather than being left out:

| Obligation | Applies to | GrayBag |
|---|---|---|
| **e-invoicing** — an IRN and signed QR obtained from the Invoice Registration Portal before the invoice is valid | B2B supplies by registered persons above an aggregate-turnover threshold that has been reduced repeatedly since 2020 | Not applicable. Our supplies are B2C, and the turnover is far below any threshold in force. **Re-check if a school ever buys in bulk as a registered entity** — that is a B2B supply, and it interacts with `[GST-04]` |
| **Dynamic QR on B2C invoices** — a scannable payment QR on the invoice | Registered persons above a much higher turnover threshold | Not applicable |

Both thresholds move. `E00-10`'s accountant should state the current figures and GrayBag's
distance from them, so this section can be dated rather than assumed (§10 item 6).

---

## 10. What the accountant needs to answer (`E00-10` hand-over)

This is a checklist Andy can hand over as-is. Items 1–3 are `E00-10` as already written; 4–7
were raised by this document.

1. **GSTIN**, in full — including which state it is registered in, because the first two digits
   decide CGST+SGST versus IGST (§3.2).
2. **SAC code.** `996331` is assumed. Confirm, and confirm it is right for meals supplied to
   schoolchildren under a monthly arrangement rather than a restaurant sale.
3. **Registered legal name and address** exactly as they must appear.
4. **Is the split intra-state?** Follows from 1, but ask directly, because `M2` and the entire
   cart change in `E07-06` depend on the answer. `[GST-02]`.
5. **Signature.** Is "This is a computer-generated invoice and does not require a signature"
   acceptable for an electronically issued invoice, or does the PDF need a digital signature
   certificate? The answer changes the PDF pipeline, not the data. `[GST-05]`.
6. **e-invoicing / QR thresholds** in force, and GrayBag's distance from them (§9).
7. **Rounding.** Do you want the invoice grand total rounded to the nearest rupee with a round
   off line, or charged in exact paise? We recommend exact paise. `[GST-03]`.
8. **Field list.** Confirm §4.1 is complete for our supply type, and confirm the 16-character
   serial-number limit and the format in §5.2.
9. **Credit note series** — shared with invoices or separate? `[PAY-06]`, already open.
10. **Catering supplied to a school rather than to a parent** — is it exempt? `[GST-04]`. This
    one is not needed for launch but it should be asked at the same time, because it may decide
    the shape of `E18`.

---

## 11. Open questions raised here

Full text in `docs/open-questions.md`. Summary:

| Q | Question | Recommendation | Blocks |
|---|---|---|---|
| `[GST-01]` | Tax-inclusive pricing cannot satisfy `line_subtotal = unit_price × quantity` **and** charge exactly `quantity × displayed price` | Answer `[DM-20]` as exclusive; if inclusive, derive at line level and relax the constraint in `0003` before `E05` builds pricing | `E04-04`, `E05-04`, `E07-02`, `E07-06` |
| `[GST-02]` | Is the supply intra-state? Depends on GrayBag's registered state, which is inside the unknown GSTIN | Derive per invoice (§3.2); never hard-code the split | `E07-02`, `E07-06` |
| `[GST-03]` | Round the grand total to the nearest rupee, or charge exact paise? | Exact paise | `E07-02` |
| `[GST-04]` | Is catering supplied **to a school** exempt, where catering supplied to a parent is taxable? | Ask now; it may decide whether `E18-01`'s school-bulk model is viable | `E18-01`, `E07-09` |
| `[GST-05]` | Does the invoice PDF need a digital signature? | Ask; assume the computer-generated wording until told otherwise | `E07-02`, `E07-04` |

Resolved here: **`[DM-19]` — rounding is per line, per component, half-up** (§6.2, §6.3).

---

## 12. What `E07` must test

`E07-02` says the rounding rule is "fixed and unit-tested". These are the tests.

| # | Test | Source |
|---|---|---|
| 1 | Every vector in §6.5.1 and §6.5.2, exact integer match | §6.5 |
| 2 | `half_up` implemented twice — the general form and `(taxable + 20) div 40` — agree for every taxable value 0…1,000,000 | §6.2 |
| 3 | No float appears anywhere in the tax path — a lint rule, not a test | Non-negotiable #3 |
| 4 | `invoice.cgst_paise = invoice.sgst_paise` whenever the two rates are equal | §6.4 |
| 5 | `Σ line.total_paise = invoice.total_paise` and `taxable + cgst + sgst + igst + round_off = total` | §6.5.3 |
| 6 | `invoice.round_off_paise = 0` under exclusive pricing | §6.9 |
| 7 | `invoice.total_paise = group.subtotal + group.tax_total − group.discount`, and the Razorpay charge equals `invoice.total − group.wallet_applied` | §6.8 |
| 8 | The invoice transcribes `order_line` tax values rather than recomputing — assert by mutating an `order_line` tax figure to a deliberately wrong value and checking the invoice carries the wrong value through | §6.3 |
| 9 | A rolled-back capture transaction leaves `invoice_sequence.last_sequence_no` unchanged | §5.1 control 3 |
| 10 | Two concurrent first-invoices-of-a-financial-year produce 1 and 2, never two 1s and never a 1 and a 3 | §5.3 |
| 11 | Financial year at 05:20 IST on 1 Apr 2026 is `2026-27`; at 23:50 IST on 31 Mar 2026 is `2025-26` | §5.4 |
| 12 | `DELETE FROM invoice` is rejected; `UPDATE invoice_sequence SET last_sequence_no = last_sequence_no - 1` is rejected; setting it forward by 2 is rejected | §5.1 controls 4 and 5 |
| 13 | The gap audit query returns `missing = 0`, `lo = 1`, counter = `max(sequence_no)` on a seeded year, and detects an injected hole | §5.6 |
| 14 | Every rendered `invoice_number` is ≤ 16 characters and matches `^[A-Za-z0-9/-]+$` | §5.2 |
| 15 | In production, a placeholder GSTIN or SAC (a) refuses `POST /checkout` before any capture, (b) fails a payments Edge Function's boot assertion, and (c) as defence in depth allocates no invoice number if settlement is ever reached | §2 |
| 16 | No `invoice_line.description` contains a class or section label | §4.3 |
| 17 | Credit note amounts equal the invoice figures exactly and are not recomputed; three single-unit refunds of a 3-unit line sum to `invoice_line.total_paise` | §7, `PY6` |
| 18 | The §6.6 inclusive vectors, marked skipped until `[DM-20]` returns — present so the flip is a config change and not a build | §6.6 |
