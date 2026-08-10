# TRAI DLT — entity, header and the five content templates

**Draft for `E00-06`, `E00-07`, `E00-08`.** Start this today: entity approval alone can take
about a week, header approval sits behind it, and template approval behind that. Everything
SMS-shaped in the product is downstream of all three.

> **Note the scope tension.** v1 is **email only** — no SMS, no push (non-negotiable #7), and
> sign-in is email OTP. So nothing in v1 *needs* DLT. It is on the list because the approval
> chain is measured in weeks and starting it costs an afternoon; if SMS is genuinely never
> wanted, say so and I will take `E00-06`–`E00-09` out rather than leave you doing paperwork for
> a channel we do not use. **[YOU DECIDE]**

## Step 1 — Principal Entity registration (`E00-06`)

Any one operator portal (Jio, Airtel, VI, BSNL) — registration propagates to the others.
Have ready:

| Field | Value |
|---|---|
| Entity name | **[YOUR REGISTERED COMPANY NAME]** — must match the PAN and GST certificate exactly |
| PAN | **[YOU]** |
| GST certificate | **[YOU]** — the same registration the accountant is confirming (`E00-10`) |
| CIN | **[YOU]** |
| Authorised signatory | Name, designation, mobile, email — the mobile receives an OTP |
| Letter of authorisation | On company letterhead. `docs/../03_LetterHead/` has the template |
| Entity type | **Enterprise** |

You receive a **Principal Entity ID (PEID)** — a 19-digit number. Everything below needs it.

## Step 2 — Header / Sender ID (`E00-07`)

| Field | Value |
|---|---|
| Header | **`GRYBAG`** — six characters, alphabetical |
| Type | **Transactional / Service Implicit** |
| Category | Food & Beverages |

**Not Promotional.** Service Implicit is what carries an OTP or an order confirmation to someone
who asked for it; promotional headers are blocked on DND numbers, which would silently lose
messages to a fraction of customers.

## Step 3 — The five content templates (`E00-08`)

DLT templates use `{#var#}` for variables. Each is capped at 30 characters at submission time,
so keep dynamic parts short. **Every template ends with the header in brackets** — several
operators reject templates that do not identify the sender in the body.

### 1. Sign-in OTP

```
{#var#} is your GrayBag verification code. It expires in 10 minutes. Do not share it with anyone. [GRYBAG]
```
*Variables: 1 (the six-digit code). Category: Service Implicit.*

### 2. Order confirmation

```
Order confirmed for {#var#} on {#var#}. Pickup code {#var#}. Total Rs {#var#}. [GRYBAG]
```
*Variables: 4 (first name, date, four-digit pickup code, amount).*
**First name only — never a full name, never a class or section** (non-negotiable #4: tier P
does not leave for a channel that is not the kitchen).

### 3. Pickup code reminder

```
Todays GrayBag lunch for {#var#}: pickup code {#var#}. Show it at collection. [GRYBAG]
```
*Variables: 2.*

### 4. Refund confirmation

```
Refund of Rs {#var#} for your GrayBag order on {#var#} has been processed. It reaches your account in 5-7 working days. [GRYBAG]
```
*Variables: 2.*

### 5. Order cancelled

```
Your GrayBag order for {#var#} on {#var#} has been cancelled. {#var#} [GRYBAG]
```
*Variables: 3 (first name, date, reason). Keep the reason short — "School holiday", "Kitchen
closed", "Cancelled by you".*

## Step 4 — SMS provider (`E00-09`)

MSG91 or Gupshup. They need the **PEID**, the **Header**, and each approved **Template ID**.
Send me the template ids when they come back and I will wire them behind a feature flag so
nothing sends until you say so.

## Rejections to expect

- **Header rejected as too close to an existing one.** Have a second choice ready — `GRYBGB`.
- **Template rejected for a variable at the very start.** Template 1 starts with `{#var#}`;
  if it bounces, use `Your GrayBag code is {#var#}...`.
- **Category mismatch.** If any template is filed as Promotional it will be delivered only to
  non-DND numbers, and you will discover that as "some customers never get the OTP".
