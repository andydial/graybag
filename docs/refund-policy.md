---
title: Refund & Cancellation Policy — GrayBag
status: DRAFT TEMPLATE for a lawyer to review. Refund mechanics are grounded in the built system; the customer-facing terms need Andy's sign-off on a few open values.
sources: docs/order-lifecycle.md §4 (transitions T10–T13), §7 (refund_status); docs/payments-design.md §9 (refund shapes, destination, amount arithmetic, MDR), §7.1 wallet; docs/decisions.md (M5 MDR from school share, M7 wallet default, PY3 refund speed, PY6 refund arithmetic, D15 retention); docs/open-questions.md ([OL-02] cutoff-in-flight, [PAY-02] wallet/source split, [PAY-03] speed, [PAY-04] MDR)
covers: E20-06 (companion to Terms); refund mechanics in E06-08, E06-09
---

# GrayBag Refund & Cancellation Policy

> ## ⚠ DRAFT FOR LEGAL REVIEW — DO NOT PUBLISH AS-IS
>
> The **mechanics** below (how a refund is computed, where it goes, how long it takes) are grounded
> in the built order lifecycle and payments design and are accurate to the system. The **customer-facing
> terms** — how long before cutoff you may cancel, whether a late-but-paid order is honoured, whether
> instant refunds are ever offered — depend on open decisions marked below. **Nothing here is legal
> advice.** `«ANGLE-BRACKET»` tokens must fail CI in a production build (`E20-22`).

**Last updated:** «REFUND-POLICY-EFFECTIVE-DATE-PENDING-E20-12»
This policy forms part of the [Terms of Service](./terms.md).

---

## 1. The short version

- Cancel your own order in the app up to its **cancellation cutoff** and get a full refund.
- After the cutoff, only the kitchen or GrayBag can cancel — for example if a dish runs out.
- Refunds go to your **GrayBag wallet by default** (instant, free) or back to your original payment
  method on request (a few working days).
- If we can't deliver a meal you paid for and it's our fault, you get a refund.

---

## 2. Cancelling an order

### 2.1 You cancel it (before the cancellation cutoff)

You can cancel an order yourself, in the app, up to the **cancellation cutoff** for that order —
which is «CUSTOMER-CANCELLATION-CUTOFF-PENDING-ANDY» before the kitchen's ordering cutoff (`T10`,
config `customer_cancellation_cutoff_minutes`). When you do, we cancel the order and refund it in
full. Self-cancellation can be switched off per kitchen (`customer_cancellation_allowed`); where it
is off, you contact us to cancel and §2.2 applies.

### 2.2 We cancel it (any time)

The kitchen or GrayBag can cancel an order at any time up to delivery — most commonly because a dish
became unavailable, or a kitchen or school closed unexpectedly (`T11`, `T12`). When this happens we
cancel and refund the affected part automatically, and tell you why.

- If **one dish of several** is unavailable, we refund just that dish and deliver the rest (`E06-08`).
- If a **whole order** cannot be fulfilled, we refund the whole order.

### 2.3 After delivery

Once a meal has been **delivered**, it has been provided, so it is not normally refundable. If
something was wrong with a delivered order, contact us — GrayBag can issue a **goodwill refund** at
its discretion (`T` goodwill path). This is not an automatic right. «POST-DELIVERY-REFUND-POLICY-PENDING-ANDY»
— Andy to confirm the customer-facing stance (e.g. window to report a problem).

### 2.4 If your payment lands just after the cutoff

If you pay right before the cutoff but your bank confirms the payment a few minutes later (this can
happen with UPI), we honour the order if it was paid within a short grace window; past that, the
order is automatically cancelled and refunded (`[OL-02]`). The grace window is
«PAYMENT-GRACE-MINUTES-PENDING-ANDY» minutes and is a kitchen-operations decision.

---

## 3. Where your refund goes

| Situation | Default destination | You can request |
|---|---|---|
| Any refund | **GrayBag wallet** — instant, free (`M7`) | Refund to your **original payment method** |
| You were **charged twice** for the same order | Back to your **original payment method** automatically | — |

- **Wallet refunds are instant.** The balance is available to spend on your next order straight away.
  Wallet credit is store credit (see Terms §5).
- **Refunds to your original payment method** are sent at Razorpay's normal speed and typically reach
  your bank in **T+5 to T+7 working days** (`PY3`, refund speed `normal`). We do not offer a paid
  instant-to-bank option, because the wallet already gives you an instant, free alternative.
  `[PAY-03]` — Andy may decide to offer instant refunds for specific cases (e.g. a double charge).

### 3.1 If you paid partly from your wallet and partly by card

Only the part you paid by card exists at Razorpay to send back. So a refund on such an order is split:
the **wallet-funded part goes back to your wallet**, and the **card-funded part goes back to your
card** — never more than what actually went to your card (`[PAY-02]`, `PY5`). You get every rupee
back; some of it simply returns the way it came.

---

## 4. How much you get back

- A refund **includes the GST you paid** — you get the tax back too, and we issue a **credit note**
  for it (`E07-07`).
- A **full order** refund returns exactly what that order's invoice recorded (`PY6`).
- A **single-dish** refund returns exactly that line's amount; refunding **some** of a quantity (say
  1 of 3 sandwiches) returns that fraction, and refunding a line unit by unit always adds up to the
  exact line total — you never lose or gain a paisa to rounding (`PY6`, §9.3 of the payments design).
- Every amount is calculated in exact paise. We never round a refund down.

Any card-processing fee Razorpay charged on the original payment is **not** deducted from your
refund — you get the full amount back. (Internally, that fee is absorbed by GrayBag or the kitchen,
not by you — `M5`, `[PAY-04]`.)

---

## 5. How long a refund takes

| Destination | Time |
|---|---|
| GrayBag wallet | Instant |
| Original payment method (card / UPI / netbanking) | Usually **T+5 to T+7 working days** after we process it |

We process refunds promptly once an order is cancelled. The time to reach your bank is set by your
bank and the payment network, not by us. If a refund has not arrived after «REFUND-CHASE-DAYS-PENDING-ANDY»
working days, contact us with your order reference (shown on your invoice and in the app).

---

## 6. Orders that never completed

If your payment failed, or the app closed before payment finished, no charge stands — and if any
money was taken for a checkout that did not complete, it is refunded automatically once our systems
reconcile it against Razorpay (usually within a day). You do not need to do anything, but you can
contact us with the order reference if you have any doubt.

---

## 7. Getting help

Contact us at «GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01» with your **order reference** (on your invoice
and in the app). For a complaint about how we handle your personal data, contact our **Grievance
Officer** (Privacy Policy, §8).
