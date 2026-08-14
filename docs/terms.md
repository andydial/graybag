---
title: Terms of Service — GrayBag
status: DRAFT TEMPLATE for a lawyer to review and finalise. Commercial and legal statements are provisional on `E20-01` and `E00-10`.
sources: docs/decisions.md (M1–M8 seller of record, GST, revenue share; U1 phone+OTP; P1 self-declared attendance; L5–L8 order lifecycle; G1–G10 invoicing; D15 retention); docs/order-lifecycle.md (cutoff, cancellation transitions T10–T13); docs/gst-invoicing.md; docs/refund-policy.md (companion)
covers: E20-06 (companion to the privacy notice); referenced by E20-03 policy gate
---

# GrayBag Terms of Service

> ## ⚠ DRAFT FOR LEGAL REVIEW — DO NOT PUBLISH AS-IS
>
> Written for GrayBag's real commercial model — GrayBag is the seller of record, payment is via
> Razorpay, invoices carry GST, refunds default to a GrayBag wallet — so a lawyer can edit specific
> clauses. **Nothing here has been checked by a lawyer.** `E20-01` (owner: Andy) and the accountant
> (`E00-10`) must confirm the commercial and tax statements. `«ANGLE-BRACKET»` tokens are unresolved
> and must fail CI in a production build (`E20-22`).

**Last updated:** «TERMS-EFFECTIVE-DATE-PENDING-E20-12»
**Applies to:** the GrayBag mobile app and website.

By creating an account or placing an order, you agree to these Terms and to our
[Privacy Policy](./privacy-policy.md). If you do not agree, do not use the service.

---

## 1. Who we are and what we do

GrayBag («GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01», «GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»,
GSTIN «GRAYBAG-GSTIN-PENDING-E00-10») takes orders for school lunches and arranges their delivery to
schools and colleges. **We are the seller of record** (`M1`): you buy the meal from GrayBag, we
invoice you, and we pay the kitchens separately. The kitchens prepare the food; GrayBag is
responsible to you for the order.

---

## 2. Your account

- You sign in with your **mobile number and a one-time password (OTP)** (`U1`). Keep access to your
  number secure — anyone who can receive your OTP can use your account.
- You must be **18 or older** to hold an account and to place orders. When you add a child, you
  confirm you are that child's parent or lawful guardian and are entitled to give us their details
  (see the Privacy Policy, §4).
- The information you give us — your name, your child's name, **school, class and section** — must be
  accurate. Attendance and class are **self-declared** (`P1`); we rely on what you tell us to deliver
  to the right place, and we cannot deliver correctly if it is wrong.
- You are responsible for what happens under your account.

---

## 3. Placing an order

- You choose meals from the menu shown for your child's school. The price you see at checkout is the
  price you pay; if a price or a cutoff has changed between building your cart and paying, we will
  **stop and ask you to confirm the new total** rather than charge a different amount (`L7`).
- **Cutoff.** Each order has a cutoff time, after which it can no longer be placed or changed by you.
  The cutoff is shown before you pay. Orders are for a specific **service date** (the day the food is
  eaten).
- An order is confirmed only when your **payment is captured** — not merely authorised (`L5`). Until
  then you will see a waiting state, not a confirmation.
- We may decline or cancel an order (with a refund where due) if a dish becomes unavailable, a
  kitchen or school is closed, or we reasonably believe the order is fraudulent or mistaken.

---

## 4. Prices, taxes and invoices

- All prices are in **Indian Rupees**.
- **GST applies.** For an intra-state supply this is shown as **CGST 2.5% + SGST 2.5%** (`M2`, `G2`);
  for an inter-state supply it is IGST at the same total rate. **Today every GrayBag supply is
  intra-state**, because we serve Mohali only (`SC1`).
  `[confirm in E00-10]` whether the menu price is inclusive or exclusive of GST (`[DM-20]`, `[GST-01]`).
- We issue you a **tax invoice** for each payment, with a gapless serial number for the financial
  year (`M3`, `G8`, `G9`). The invoice is the record of what you bought and what tax you paid, and we
  are required to keep it for a statutory period even after you delete your account (see the Privacy
  Policy, §5). Your child's **first name** appears on the invoice line so you can tell your children's
  orders apart (`G7`).
- Invoices are computer-generated. «SIGNATURE-TREATMENT-PENDING-E00-10» (whether a digital signature
  is required, `[GST-05]`).

---

## 5. Payment

- Payment is processed by **Razorpay** (card, UPI, netbanking). We do not see or store your card
  details; they are handled inside Razorpay's checkout. See the Privacy Policy, §3, for what Razorpay
  receives.
- **Wallet.** If we refund you to your GrayBag **wallet**, that balance can be used to pay for future
  orders. Wallet credit is **store credit** — it is not cash, it is not transferable, and (in v1) it
  cannot be topped up with cash. It arises only from refunds. `[confirm in E20-01]` on the RBI Prepaid
  Payment Instrument position for refund-only credit — cash top-up is deliberately **not** offered
  because it is regulated.

---

## 6. Cancellations and refunds

The full rules — who can cancel when, where the money goes, and how long it takes — are in the
**[Refund & Cancellation Policy](./refund-policy.md)**, which forms part of these Terms. In short:

- You may cancel an order yourself up to the **cancellation cutoff** for that order (`T10`). After
  that, only the kitchen or GrayBag can cancel it (`T11`, `T12`).
- Where a refund is due, it goes to your **GrayBag wallet by default** (instant), or to your original
  payment method on request (which takes several working days) (`M7`).
- We cancel and refund automatically if a dish is unavailable, or a kitchen or school closes.

---

## 7. Delivery

- Meals are delivered to the child's school for the chosen break time, or made available for counter
  pickup, depending on the school's arrangement.
- For counter pickup, a **4-digit pickup code** is sent in your confirmation email and printed on your
  invoice (`P4`). Staff check the child's name shown on their screen as well as the code before
  handing the food over.
- We deliver to the **school, class and section you declared**. If those details are wrong, we may not
  be able to deliver, and a refund may not be due for a failed delivery caused by wrong information
  you gave us.

---

## 8. Allergies and food information

This section describes what the system does, so you can judge what to rely on. It is a
description, not a promise.

**What you enter.** Allergies belong to a child, not to an order. On a child's profile you can
record allergens from a list, each with a severity, and add a free-text note. You enter this once
and it applies to every order for that child.

**Where it is stored.** On that child's record. It is treated as sensitive personal data about a
child under the Digital Personal Data Protection Act, 2023 — see our Privacy Policy.

**What the app does with it.** When you add a dish for a child, the app compares the allergens the
kitchen has declared for that dish against the ones recorded for that child:

- If they overlap, the app stops and asks you to confirm a second time, naming the allergen, the
  dish and the child.
- If nobody has described the dish's allergens, the app says "not provided" on the dish, every
  time, for every child. It does not treat an undescribed dish as safe.
- If you have not recorded any allergens for that child, there is nothing to compare and no
  warning appears.

**Where allergen information comes from.** The kitchens supply it. We publish what they give us.
We do not test food, inspect kitchens, or verify the declarations independently.

**The per-dish note is not an allergy record.** The note you can attach to a dish when ordering
goes to the kitchen as a request — "less spicy", "cut in half". It is not read as allergy
information, and the app will direct you to the child's profile if you type allergy language into
it.

**What the system does not do.**

- It does not prevent you from ordering a dish after you confirm the warning.
- It does not show a child's allergies to kitchen staff. The kitchen's screen shows the dish, the
  quantity, the child's name and any request you attached — not the child's allergy record.
- It does not check the food as actually prepared. Kitchens handle many ingredients, and a dish
  can pick up traces of one that was not declared.
- It does not know about an allergy you have not recorded.

**If a child has a serious or life-threatening allergy, do not rely on this app alone.** The
warning is a comparison between two lists we were given. It is not an inspection of the food.

---

## 9. Acceptable use

You agree not to: use someone else's account or add a child you have no right to add; attempt to place
orders you do not intend to pay for; probe, scrape or attack the service; or use the service for
anything unlawful. We may suspend or close an account that breaks these Terms.

---

## 10. Our responsibility to you

- We aim to deliver the right meal to the right child on the right day. If we fail to deliver an order
  you paid for, and it is our or the kitchen's fault, you are entitled to a **refund of that order**.
- **Nothing in these Terms limits liability that cannot be limited by law** — in particular,
  liability for death or personal injury caused by negligence.
- The service is provided on a best-efforts basis. Menus, prices and availability change.

---

## 11. Changes to these Terms

We may change these Terms. If a change matters, we will ask you to accept the new version before you
next order (`E20-03`). Continuing to use the service after a change means you accept it.

---

## 12. Governing law and disputes

These Terms are governed by the laws of **India**, and disputes are subject to the courts of
«JURISDICTION-CITY-PENDING-E20-01». For a complaint about how we handle your personal data, contact
our **Grievance Officer** (Privacy Policy, §8); if unresolved you may complain to the Data Protection
Board of India.

---

## 13. Contact

«GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01». Grievance Officer:
«GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21».
