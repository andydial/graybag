---
title: Privacy Policy — GrayBag
status: DRAFT TEMPLATE for a lawyer to review and finalise. Every legal statement is provisional on `E20-01`, which has not been done.
sources: docs/dpdp-compliance.md (the whole document; this is the notice §2.6 of that spec calls `Q11`); docs/data-model.md §13.3 (tier S/P/A classification); docs/payments-design.md §3.7, §11 (what crosses to Razorpay); docs/decisions.md (A2, U1, A8, C1–C9, D15, G7, M7); docs/open-questions.md ([DP-01]…[DP-07], [DM-12], [DM-15])
covers: E20-06
---

# GrayBag Privacy Policy

> ## ⚠ THIS IS A DRAFT FOR LEGAL REVIEW — DO NOT PUBLISH AS-IS
>
> This document is written for GrayBag's **actual** data practice — Razorpay for payments, an
> SMS provider for OTP, Sentry and Better Stack for error reporting and logging, Supabase hosted
> in **Mumbai (AWS `ap-south-1`)** — so that a lawyer can correct specific sentences rather than
> start from a blank page. **Nothing here has been checked by a lawyer.** `E20-01` (owner: Andy)
> must confirm it before it is published.
>
> Every value in `«ANGLE-BRACKETS»` is an unresolved placeholder. A production build that still
> contains one **must fail CI** (`E20-22`, the same guard as `G3`). The retention periods, the
> statutory deadlines, and the grievance-officer identity are the ones that most need real values.

**Last updated:** «PRIVACY-POLICY-EFFECTIVE-DATE-PENDING-E20-12»
**Applies to:** the GrayBag mobile app (iOS and Android) and the GrayBag website.

---

## 1. Who we are

GrayBag («GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01», «GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»)
sells school lunches to parents and other customers, and delivers them to schools and colleges.
When we decide **why** and **how** your personal data is used, we are the **Data Fiduciary** under
India's Digital Personal Data Protection Act, 2023 ("DPDP Act"). This policy explains what we
collect, why, who we share it with, how long we keep it, and the rights you and your child have.

**This policy is about a child's data as much as your own.** If you add a child as someone you
order food for, we hold that child's name, their school, their class and section, and — only if
you choose to tell us — their food allergies. The child is the person the data is about; you act
on their behalf as their parent or guardian.

---

## 2. The personal data we collect, and why

We collect only what we need to take an order, deliver the right food to the right person, invoice
you, and run the service safely. We group it into three kinds.

### 2.1 About you (the account holder)

| Data | Why we need it | Legal basis (our reading — `[confirm in E20-01]`) |
|---|---|---|
| Your **mobile number** | You sign in with your phone number and a one-time password (OTP). It is your identity in the app | Necessary to provide the service you asked for |
| Your **name** | To address you, and it appears on your tax invoice | Necessary for the contract and for a lawful invoice |
| Your **email** (optional) | To send you receipts, invoices and the confirmation email that carries your child's pickup code | Necessary to deliver what you bought |
| Your **order and payment history** | To show you what you ordered and to keep the accounts | Necessary; and a legal obligation for tax records |
| **Wallet balance and ledger** | If money is refunded to your GrayBag wallet, we track the balance | Necessary to give you your money back |

### 2.2 About your child (or anyone you order for)

This is the most regulated data we hold, and we treat it that way.

| Data | Why we need it | How you authorise it |
|---|---|---|
| Child's **name** | So the kitchen and the delivery staff put the right meal in front of the right child | Your **consent**, given per purpose (see §4). First name only appears on your invoice |
| Child's **school, class and section** | To send the order to the right school, group it for delivery, and print the packing list | Your consent |
| Child's declared **food allergies** (**health data**) | So the app can warn you at the point of adding a dish to the cart, and so the kitchen knows | A **separate, optional** consent. If you do not give it, we simply do not warn you — the rest of the service works normally (see §4.3) |

We deliberately **do not** collect a child's date of birth or a child's photograph. `[confirm in
E20-01]` that a declared "this is a minor" is sufficient and age need not be verified (`[DM-12]`).

**For children specifically:** we do not track a child's behaviour, we do not build a profile of a
child, and we do not direct advertising at a child. You may consent to marketing about **yourself**;
you cannot consent to your child being profiled, and we do not offer it. `[confirm in E20-01]` (our
reading of DPDP s.9).

### 2.3 Collected automatically to keep the service working

| Data | Why | Notes |
|---|---|---|
| **Device push token** | To send you order notifications | Deleted when your device is inactive for a period (see §6) |
| **Error and diagnostic data** (Sentry, Better Stack) | To find and fix crashes and failures | **Scrubbed of your and your child's personal data before it leaves the app.** A child's name, class, section and allergies are never sent to Sentry or to our logs — this is enforced by an automated test (`E20-10`, `PY8`), not just a promise |
| **App analytics** | To understand which screens are used | About the adult's journey through the app only. Never keyed to a child, and a child is never a subject of it |
| **Website logs** (Netlify) | Standard access logs for the website | May contain your IP address |

---

## 3. Who we share your data with, and where it is stored

Your and your child's data is stored on **Supabase**, which runs on Amazon Web Services in
**Mumbai, India (`ap-south-1`)**. It stays in India in normal operation.

We use the following third parties. Each is a **processor** acting on our instructions, unless
noted, and each is covered by a data-processing agreement (`E20-11`).

| Who | What they do | What they receive |
|---|---|---|
| **Supabase** (AWS Mumbai) | Hosts our database, sign-in, file storage and server functions | All the data described above, stored in India |
| **Razorpay** | Processes your card / UPI / netbanking payment | The **payer's** name, phone and email, the amount, and an internal order reference. **Never** your child's name, class, section, school or allergies — this is enforced by test (`PY8`, `E06-25`). Razorpay may act as an independent controller for its own fraud, KYC and regulatory purposes — `[confirm in E20-01]`, `[DP-04]` |
| Our **SMS provider** («SMS-PROVIDER-NAME-PENDING-E20-11») | Sends the one-time password to sign you in | Your mobile number and the OTP message |
| **Sentry** | Error reporting | Diagnostic data, **scrubbed** of personal data (§2.3). Retained ~30 days |
| **Better Stack** | Log management | Application logs identified by an internal correlation id, **not** by a child's name. Retained ~30 days |
| **Expo / EAS** | Delivers app updates and push notifications | Your device push token and the notification text |
| **Netlify** | Hosts the website | Website access logs |
| Our **email provider** («EMAIL-PROVIDER-NAME-PENDING-E07-04», `[DP-05]`) | Sends receipts, invoices and the confirmation email | Your email address, and your invoice — **which carries your child's first name** (`G7`) |
| The **school** | Receives the food and hands it over | **Aggregate reports only** — counts and money, **never** a child-level record or a child's name. School staff who hand food over see the child's name for that delivery only |

Some of these providers (Sentry, Better Stack, Expo, and possibly the email provider) may process
limited **adult** data outside India. A child's name, class, section and allergies **never leave
India** by design, because they never leave the database except to reach the kitchen and delivery
staff. `[confirm in E20-01]` on cross-border transfer (`[DP-05]`).

We do **not** sell your data, and we do not share it for anyone else's advertising.

---

## 4. Consent — how we ask, and what you can turn off

Accepting this Privacy Policy is **not** the same as consenting to hold your child's data. They are
two separate things, on purpose (`C4`):

- When you first use the app, you accept the current **Terms** and this **Privacy Policy**. You
  cannot place an order until you have.
- When you **add a child**, we ask you separately, for each purpose, whether we may use that child's
  data. Each purpose is a separate choice. Nothing is pre-ticked (`C1`, `C2`).

### 4.1 The purposes we ask about

| Purpose | Required to order? | What it covers |
|---|---|---|
| **Holding your child's details** | Yes | Name, school, class, section — so we can take and deliver an order |
| **Fulfilling the order** | Yes | Giving the child's name and class to the kitchen and delivery staff for that meal |
| **Allergy warnings** (health data) | **No — optional** | Storing the child's allergies so the app warns you when you add a dish |
| **School reporting** | Yes, while you order | Your child is counted (as a number, never named) in the school's monthly aggregate report |
| **Marketing email / push** | No — optional | Offers and news, about **you**, never your child |
| **Product analytics** | No — optional | Understanding how the app is used, by adults |

### 4.2 Withdrawing consent is as easy as giving it

You can change any of these at any time in the app: **Settings → Privacy**. Each purpose can be
turned off in one action, and we tell you what turning it off does **before** you confirm:

- **Turning off allergy warnings** deletes your child's allergy information from our systems
  immediately, and we stop warning you. Everything else about your account is untouched (`C5`).
- **Turning off "holding your child's details" or "fulfilling the order"** means we can no longer
  take orders for that child, so the child is **deactivated**. We stop all future ordering for them
  straight away and delete the data we are not required by law to keep. **Some records survive — see
  §5.** We tell you exactly what survives before you confirm.
- **Turning off marketing** stops the next message.

### 4.3 Declining allergy warnings is fully supported

You never have to tell us a child's allergies. If you do not, the app simply will not show an
allergy warning when you add a dish, and it says so clearly. Declining costs you nothing else — you
can still order normally. This is deliberate: a child's allergies are health data, and we will not
make ordering conditional on giving them up (`C5`).

Withdrawing consent is never backdated: anything we did while your consent was live stays lawful.
Withdrawal stops **future** use and triggers deletion of anything that has no other lawful basis.

---

## 5. What survives when you delete your account or withdraw consent

You can delete your account in the app (**Settings → Delete account**) or ask our Grievance Officer
to do it. When you do, we **stop your access immediately** and then delete your and your child's
personal data — **except** the things the law requires us to keep. Being honest about this up front
matters, so here it is in plain words (`D15`, §6.6 of our compliance spec, `[confirm in E20-01]`):

**We delete:** your child's allergy information (immediately and outright — nothing in law requires
us to keep a child's health data); your and your child's names, your phone and email, and the
child's class and section on historical orders once they are past the retention window.

**We are required to keep, and cannot delete:**

- Your **tax invoices**, which include your name, your address, and your child's **first name** on
  the line, for the statutory retention period. This is a legal record and we may not scrub it.
- The **accounting and payment records** behind those invoices.
- The **order records** that support those invoices (with the child's name, class and section removed
  once past the window).
- The **record that you gave us consent**, which is our evidence that holding the data was lawful.

If you find this later without having been told, it feels like a broken promise — which is why we
tell you now and again at the moment you confirm deletion.

---

## 6. How long we keep things (retention)

> **These periods are PROPOSALS awaiting legal and accountant confirmation** (`[DP-02]`, `E20-05`).
> The invoice period in particular is the accountant's to set (`E00-10`). Do not treat any number
> here as final.

| Data | We propose to keep it for | Then |
|---|---|---|
| Tax invoices and accounting records | «INVOICE-RETENTION-YEARS-PENDING-E00-10» years (proposed: 8) | Deleted |
| Order records (supporting the invoice) | Same as invoices | Deleted |
| Child's name, class, section on an order | «ORDER-PII-RETENTION-PENDING-E20-05» (proposed: 18 months after service date) | Removed from the order |
| Child's **allergy information** | Only while consent is live | Deleted immediately on withdrawal, removal or account deletion |
| Your name, phone, email | «ADULT-PII-RETENTION-PENDING-E20-05» (proposed: 36 months after last activity, or on account deletion) | Removed / anonymised |
| Consent records | «CONSENT-RETENTION-PENDING-E20-01» (proposed: 3 years after account deletion) | Deleted |
| Device push token | ~12 months of inactivity | Deleted |
| Diagnostic data (Sentry) and logs (Better Stack) | ~30 days | Deleted |
| Sign-in / OTP records | ~90 days | Deleted |

---

## 7. Your rights

Under the DPDP Act you may ask us to:

- **See** a copy of the personal data we hold about you or your child;
- **Correct** anything that is wrong or out of date;
- **Delete** your account and the personal data we are not required by law to keep (§5);
- **Withdraw** any consent you have given, at any time (§4).

The fastest way is in the app: **Settings → Privacy → Raise a request** — because you are already
signed in, we can act on it without asking you for anything more. You can also email our Grievance
Officer (§8). We will acknowledge within «DSR-ACK-DAYS-PENDING-E20-01» working days and respond
within «DSR-RESPONSE-DAYS-PENDING-E20-01» days.

We may need to confirm it is really you before we hand over any data. For a request by email or
phone we will verify you against your registered number with an OTP — we will **not** ask you for a
copy of an identity document, because that would mean collecting more data than we already hold. A
parent may make a request about a child only where they are recorded as that child's guardian in the
app. Some family situations (for example a separated parent with no link to the child in the app) we
have to consider individually — `[DP-07]`, `[confirm in E20-01]`.

---

## 8. Grievance Officer

> **Copy the block below verbatim from `docs/dpdp-compliance.md` §7.2. The placeholder tokens are
> resolved by `E20-21` (owner: Andy) and by `E20-01`. A build containing one must fail CI.**

```
Grievance Officer — GrayBag

Under the Digital Personal Data Protection Act, 2023, you may contact our
Grievance Officer about how we handle your personal data, or the personal data of
a child in your care.

  Name        «GRIEVANCE-OFFICER-NAME-PENDING-E20-21»
  Designation «GRIEVANCE-OFFICER-TITLE-PENDING-E20-21»
  Email       «GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»
  Address     «GRIEVANCE-OFFICER-ADDRESS-PENDING-E20-21»

You can ask us to:
  • give you a copy of the personal data we hold about you or your child;
  • correct anything that is wrong or out of date;
  • delete your account and the personal data we are not required by law to keep;
  • withdraw a consent you have given, at any time.

The fastest way is in the app: Settings → Privacy → Raise a request. You can also
email the address above.

We will acknowledge your request within «DSR-ACK-DAYS-PENDING-E20-01» working days
and respond within «DSR-RESPONSE-DAYS-PENDING-E20-01» days.

If you are not satisfied with our response, you may complain to the Data
Protection Board of India.
```

---

## 9. Security, and telling you about a breach

We enforce access controls server-side by default-deny (`D8`) — no order and no child's record is
readable by anyone who is not entitled to it, and this is covered by a test suite that fails loudly
if a rule is removed. Card details never touch our systems; they are handled inside Razorpay's
checkout (§11 of our payments design).

If personal data is ever exposed, we follow a written breach runbook (`E20-08`). Where the law
requires, we will notify the **Data Protection Board of India** and any affected people **without
undue delay**. The exact timelines are set out in that runbook and confirmed by `E20-01`.

---

## 10. Changes to this policy

If we change this policy in a way that matters, we will ask you to accept the new version before you
next order. A change to the wording does not by itself cancel a consent you have already given; if we
want to use data for a genuinely **new** purpose, we ask you again for that purpose specifically
(`C2`).

---

## 11. Contact

Grievance Officer, GrayBag — «GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21».
For anything else: «GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01».
