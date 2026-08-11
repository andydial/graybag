# Questions for the accountant and the lawyer

**Drafts for `E00-10`, `E00-11`, `E20-01`, `E20-25`.** Each question states **our current
assumption and what the code already does**, so the professional is confirming or correcting
rather than researching from nothing. That is usually the difference between one email and three.

---

## For the accountant

### 1. GSTIN and SAC code (`E00-10`)

> We are a food-service business in Mohali, Punjab, supplying prepared meals to schools and
> colleges. **We have assumed SAC `996331`** (services provided by restaurants, cafes and similar
> eating facilities). **Please confirm the SAC**, and confirm the GSTIN registration is in hand.

### 2. The rate and the split (`E00-10`)

> We are charging **5% GST, shown as CGST 2.5% + SGST 2.5%**, on the basis that supplier and
> place of supply are both Punjab, so it is always intra-state. **Please confirm 5% is correct
> for this supply and that no ITC condition changes it.**
>
> Our menu prices are **GST-exclusive** — tax is added at checkout. Please confirm that is what
> you expect to see on the invoices.

### 3. Rounding (`E00-10`)

> Each tax component is computed **per invoice line** on that line's taxable value and rounded
> **half-up** to the nearest paisa; the invoice is the sum of its lines. We do **not** round the
> grand total to a whole rupee — no "Round Off" line. **Please confirm both**, because it is
> baked into the software and into every invoice we will issue.
> *(Implementation: `packages/shared/src/money/gst.ts`, `docs/gst-invoicing.md` §6.)*

### 4. The school's revenue share (`E00-11`)

> Schools take a **10% revenue share**. Two questions: **does that attract 18% GST on the
> school's invoice to us**, and is it a commission we receive an invoice for, or a discount that
> reduces our taxable value? The two are accounted for differently and we need to know before we
> issue the first invoice.

### 5. Invoice numbering

> Invoice numbers are **gapless per financial year**, allocated at the point money is captured.
> Please confirm gapless-per-FY is the series you expect, and tell us the prefix format you want.

---

## For the lawyer

> **Booked (Andy, 2026-08-10).** This review is not about OTP or authentication — it is about
> **holding the names, classes and allergy information of minors under the DPDP Act**, and about
> the fact that **the child-data notice is already published and was written without a lawyer**
> (`0015`, `0022`). Anything they change, we re-publish before launch rather than after.
>
> **Push hardest on question 2.** Our read is No, and Andy agrees — but it is the single answer
> that most changes what both app stores require of us, it gates `E17-04`, and "we both thought
> so" is not the standard to hold it to.

### 1. DPDP obligations (`E20-01`) — the big one

> We hold, about **children**: first name, last name, class, section, school, and — optionally —
> **allergy information, which is health data**. The account holder is an adult (a parent, or a
> staff member ordering for themselves). We do **not** hold a child's date of birth or photograph.
>
> Please advise on:
>
> 1. **Verifiable parental consent.** We currently capture consent at the point a child is added,
>    by an authenticated adult ticking a box, and record it against the exact published wording
>    (`verification_method = authenticated_account_holder`). **Is that sufficient under the DPDP
>    Act, or does it require something stronger?** This is the single answer that most changes
>    the product — it is recorded as `[DM-12]` and we have built the weaker version deliberately,
>    pending your answer.
> 2. **Are we a Significant Data Fiduciary** at our expected volume (low hundreds of families
>    initially)? If so, the DPO and audit obligations change.
> 3. **Retention.** We propose 24 months for order history, and immediate deletion of allergy
>    details on withdrawal. Reasonable?
> 4. **Children's data and the school.** Schools receive reports about their own pupils.
>    Does that make the school a joint fiduciary, and do we need a written arrangement?

### 2. "Is the app directed to children?" (`E20-01`, blocks `E17-04`)

> Apple and Google both ask this, and the answer changes what each store requires. **Our reading
> is No**: the user is an adult who supplies data about a child, no child holds an account, and
> we do not market to children. **Please confirm**, because answering Yes puts us in Apple's Kids
> Category and Google's Designed for Families programme.

### 3. Allergy liability wording (`E20-25`, `[PP-03]`)

> We warn a parent when a dish contains an allergen **they have told us about**, and we say
> plainly when we cannot check — for example when no allergy details have been given. Kitchens
> are shared and we cannot guarantee absence of cross-contamination.
>
> **Please review and approve the wording** in `docs/terms.md`, specifically that this is a
> warning service and not a guarantee of absence. Two things we want to be sure are not
> overstated: the per-line "note for the kitchen" is explicitly **not** an allergy channel, and
> a parent who declines to share allergy details gets no warnings rather than no service.

### 4. Liability cap (`E20-25`, `[PP-04]`)

> Please review the liability cap in `docs/terms.md` and tell us whether it is enforceable in
> India for a consumer contract of this kind, and if not, what it should say.

### 5. Refund and cancellation stance (`E00-19`, `[PP-01]`/`[PP-02]`)

> We propose: a customer may cancel online **until the ordering cutoff** for that day (currently
> midnight the night before), and after that they contact support. Post-delivery refunds are
> goodwill and discretionary. **Please confirm that is compatible with Indian consumer
> protection rules**, and whether it must be stated more specifically than "discretionary".

## For the CA — the buyer's name on a B2C invoice (`E07-22`)

**The question:** our tax invoices are GrayBag → a parent, unregistered, for a school lunch —
a few hundred rupees, never anywhere near ₹50,000. Reading `CGST Rule 46`, clause (f) makes the
recipient's name and address required on a supply **below ₹50,000 only where the recipient
requests** them, while clause (e) makes them mandatory at ₹50,000 or more.

**Please confirm:** may we issue a compliant tax invoice with **no buyer name at all** for these
supplies, provided everything else in Rule 46 is present (our GSTIN and address, invoice number
and date, SAC, taxable value, CGST/SGST rates and amounts, place of supply, signature)?

**Why we are asking rather than assuming.** Our schema currently makes the buyer name mandatory,
which is stricter than we read the rule to be — and being stricter is not free here. The name is
optional to collect by design (it is asked for after payment and can be skipped), so a mandatory
column means a parent who declines cannot be invoiced at all. We would rather omit a field the
law says we may omit than write a placeholder like "GrayBag customer" into a statutory record,
which is our reading of the worse option. If you disagree with either half of that, we will
collect the name before payment instead and take the conversion cost.

**Second, smaller question:** clause (f) is conditional on the recipient *requesting* the
details. If a parent asks afterwards for their name on an invoice we have already issued, is a
**superseding reissue** the correct instrument, or may the original be amended?
