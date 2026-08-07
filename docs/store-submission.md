---
title: Store submission pack — App Privacy, Data Safety, listing copy, screenshot shot-list
status: DRAFT — PREPARED FOR ANDY TO SUBMIT. Every data-collection answer is provisional on two things (§0).
task: Q12 (feeds E17-03; E17-04 is Andy's submission; E20-06 feeds the data answers)
sources: docs/dpdp-compliance.md §2.2/§5.3/§6.5, docs/data-model.md §13.3/§4/§8, docs/payments-design.md §3.7/PY8, docs/decisions.md (R4, C1–C9, PY8, A2, U1), planning/backlog/E17, E20, E00
---

# Store submission pack

This document is what `E17-03` produces and what `E17-04` (`owner:andy`) submits. **Claude
prepares these answers; Andy signs them off and enters them in the Apple and Google consoles.**
Nothing here is submitted by an automated worker.

It contains four things:

1. **Apple App Privacy** ("privacy nutrition label") answers — §2.
2. **Google Play Data Safety** form answers — §3.
3. **Store listing copy** — name, subtitle, description, keywords — §4.
4. **Screenshot shot-list** — §5.

The identity and account facts (bundle IDs, listing type) are in §1.

---

## 0. Read this first — what these answers depend on

Two provisos, both load-bearing. Do not submit until both are cleared.

### 0.1 The privacy policy did not exist when these answers were written

`docs/privacy-policy.md` (`Q11`, `E20-06`) is being drafted **in parallel** and did not exist at
the point this pack was written. Every "data collected" answer below was therefore derived from
the **personal-data classification** in `docs/dpdp-compliance.md` §2.2 (the tier S / P / A model)
and `docs/data-model.md` §13.3 — the columns and purposes that actually exist in the schema —
**not** from the privacy policy.

**Both stores require the store data declarations to be consistent with the linked privacy
policy.** Apple rejects App Privacy answers that contradict the policy; Google's Data Safety form
states it must match the policy. So:

> **BLOCKER — `E17-14`.** Before submission, cross-check every answer in §2 and §3 against the
> **final** `docs/privacy-policy.md`. Where they diverge, the policy is the source of truth and
> the store answer is corrected to match it (decision SUB1 in the Q12 notes). This is a
> pre-submission gate on `E17-04`.

### 0.2 The DPDP legal position is still unconfirmed (`E20-01`)

`E20-01` (`owner:andy`, confirm DPDP obligations with a lawyer) has not been done. That does not
change *what data we collect* — that is a fact about the schema, and these answers are honest
about it. It does affect the **children's-data / consent** story that both stores now ask about
(§1.4, §2.4, §3.4). Those answers describe the mechanism that is built (verifiable parental
consent at dependent creation, purpose-scoped, `E20-02`); if `E20-01` changes what "verifiable"
means, re-read §1.4 before submitting.

### 0.3 Placeholder tokens

The privacy-policy URL and the grievance-officer block still contain
`«…-PENDING-E20-21»` tokens (`docs/dpdp-compliance.md` §7.2). `E20-22` fails CI if any reaches a
production build. The store listing links that URL, so **the tokens must be resolved
(`E20-21`, `owner:andy`) before the listing goes live.** Placeholders in this document are
written in the same `«…-PENDING-…»` form so the same guard catches them.

---

## 1. Identity and account facts

### 1.1 Bundle / package identifiers — do not change (`R4`)

| | Value | Note |
|---|---|---|
| iOS bundle ID | `com.gracord.graybag` | Owned; ship as an **update**, not a new listing |
| Android package | `com.Gracord.Graybag` | Owned |
| Typo in "gracord" | **Permanent** | `R4` — must not be "fixed"; changing it is a new app and loses the existing users and reviews |

This is an **update to the existing apps**, so the listings, ratings and install base already
exist. App Privacy / Data Safety are being (re)declared because the rebuild changes what is
collected and how, and both stores require an accurate current declaration on every submission.

### 1.2 Data region

All personal data is stored in **Supabase, AWS Mumbai (`ap-south-1`)** (`A2`). Auth is
**phone + OTP** (`U1`). Payments are **Razorpay** (`A6`). These facts drive §2/§3.

### 1.3 Audience and content rating

- Primary users are **parents/guardians ordering for children**, plus adult self-orderers
  (teachers, college students) — `D2`.
- The app is **not directed primarily at children** and children do not hold accounts; a
  parent/guardian holds the account and creates dependents. This matters for the stores'
  "apps for children" programmes.
- `E17-05` (risk:high) must confirm each store's child-audience obligations. **Provisional
  recommendation:** set the audience as **general / adult (18+ account holder)**, not the
  child-directed track (Google "Designed for Families" / Apple Kids Category), because accounts
  are held by adults and the app is a purchasing tool. Confirm in `E17-05` before submitting.
- Content rating: no objectionable content; expect **Everyone / 4+**, but the questionnaires
  (Google's IARC, Apple's age rating) are completed live in console by Andy.

### 1.4 Account creation, children's data, and account deletion

Both stores now ask these explicitly.

| Store question | Answer | Basis |
|---|---|---|
| Does the app support account creation? | **Yes** — phone + OTP | `U1` |
| Does the app collect data about children? | **Yes** — a parent/guardian declares a dependent child's name, class, section and (optionally) allergies | `data-model.md` §4.2; dpdp §2.2 tier P/S |
| Is there verifiable parental consent? | **Yes** — purpose-scoped consent captured at dependent creation, recorded with timestamp and policy version | `E20-02`, dpdp §3; `C1`–`C4` |
| Does the app support **account deletion**? | **Yes, in-app** (Settings → Privacy), plus a web request path | `E03-08`, dpdp §6.5 erasure pipeline |
| Account-deletion URL (required by both stores) | `https://graybag.com/«ACCOUNT-DELETION-URL-PENDING-E17-15»` | wire to the erasure flow, `E17-15` |

---

## 2. Apple App Privacy ("nutrition label")

Structure follows App Store Connect's App Privacy section: for each **data type** collected, we
declare the **purpose(s)**, whether it is **linked to the user's identity**, and whether it is
**used for tracking**. Apple's definition of *collect* is transmission off the device.

### 2.0 Global answers

| Question | Answer | Why |
|---|---|---|
| Do you or your third-party partners collect data from this app? | **Yes** | We collect contact, identifiers and health data |
| Is any data **used to track** the user (ATT)? | **No** | No cross-app/cross-site tracking, no ad SDK, no advertising identifier, no data broker sharing. s.9 DPDP forbids profiling a child (dpdp §3.3). Decision SUB3 |
| Therefore, is an **ATT prompt** required? | **No** | Follows from "no tracking" |

### 2.1 Data types collected — the label

Each row is a data type Apple's form recognises. "Linked" = linked to identity (Yes for
everything, because there is an `app_user` account and a `guardian_link`; there is no anonymous
collection). "Tracking" = No for everything (SUB3).

| Apple data type | Collected | Concrete field(s) | Purpose(s) | Linked | Tracking | Trace |
|---|---|---|---|---|---|---|
| **Phone Number** | Yes | `app_user.phone_e164` | App Functionality; **Account management** (OTP login) | Yes | No | `U1`; data-model §4.1 |
| **Email Address** | Yes | `app_user.email` (optional) | App Functionality (receipts, invoice PDF delivery) | Yes | No | `E07-04`; data-model §4.1 |
| **Name** | Yes | `app_user.first_name/last_name` (adult); **child** `recipient.first_name/last_name` | App Functionality (fulfilment, invoice, packing list) | Yes | No | data-model §4.1, §4.2 (tier A + tier P) |
| **Sensitive Info → Health** | Yes | child `recipient_allergen.*`, `recipient.allergy_note` (declared allergies) | App Functionality (allergen warning at add-to-cart) | Yes | No | dpdp §2.2 tier S; `D7`, `C5` |
| **Other User Content** | Yes | child `school_id`, `class_label`, `section_label`; `order_line.special_comments` | App Functionality (order routing, packing list) | Yes | No | data-model §4.2, §7.4 (tier P) |
| **Purchase History** | Yes | `order`, `order_line`, `invoice` | App Functionality; (statutory record) | Yes | No | data-model §7, §8 |
| **Payment Info** | **Not collected by the app** — handled by the Razorpay SDK | card/UPI never touches our servers (§11.1 payments) | — | — | — | `A6`, PY8; §2.3 below |
| **Customer Support** | Yes | grievance / DSR intake text, support correspondence | App Functionality (support, grievance redressal) | Yes | No | dpdp §7 |
| **Crash Data** | Yes | Sentry crash reports | App Functionality (diagnostics) | **No** | No | §2.3; `A8`, E20-10 |
| **Performance Data** | Yes | Better Stack / performance logs | App Functionality (diagnostics) | No | No | `A8` |
| **Device ID** | Yes | push `device_token` | App Functionality (push notifications) | Yes | No | data-model §12; `P9` |

Everything above is **App Functionality** (and, for phone, Account management). No row uses
Analytics, Advertising, Product Personalization, or Developer's Marketing as a purpose against
identifying data (SUB2; and marketing consent applies only to the adult and never profiles a
child — dpdp §5.1, `applies_to_subject = 'self'`).

### 2.2 Data types explicitly NOT collected

Declared "No" in the label. Their absence is deliberate and is what keeps the label short.

| Apple category | Collected? | Why not |
|---|---|---|
| **Location** (precise or coarse) | **No** | We store the *school* the child attends (self-declared), not the device's location. No GPS, no IP-geolocation feature |
| **Contacts** | No | Never accessed |
| **Browsing / Search History** | No | — |
| **Advertising Data / Advertising ID (IDFA)** | No | No ads, no ad SDK (SUB3) |
| **Child's date of birth / age** | No | Deliberately not collected — `is_minor` is *declared*, not verified (dpdp §2.2, `[DM-12]`) |
| **Child's photograph** | No | Deliberately not collected (dpdp §2.2) |
| **Biometrics, Financial account numbers, Gameplay, Audio, Photos/Videos, Fitness (non-allergy)** | No | Not in the schema |

### 2.3 Two answers that need care

- **Payment Info.** Card and UPI credentials are entered inside Razorpay's SDK and **never reach
  GrayBag** (`A6`; payments §11.1). So under Apple's "collect = leaves device *to you or your
  partners*", the payment *instrument* is collected by Razorpay, not by us. Declare **Payment
  Info as not collected by the app**, and disclose the payment processor relationship in the
  privacy policy. The paying adult's **phone + email** *are* sent to Razorpay as `prefill`
  (payments §3.7) — those are already declared above as Phone/Email; the sharing of them with the
  processor is [SS-02] and is declared under Google "shared" in §3, and described in the policy.
  **No child data ever crosses to Razorpay** (PY8, `E06-25`).
- **Crash / Performance Data — "not linked".** Sentry and Better Stack are declared **not linked
  to identity** and **not used for tracking**, and this is only truthful because §5.3 of dpdp +
  PY8 + `E20-10` scrub **all** tiers (S, P and A — including an adult's phone in a stack trace)
  out of every outbound diagnostic payload, verified by a sentinel-name test. If that scrubbing
  test is ever removed, this answer becomes false — the two are tied together.

### 2.4 Privacy-policy URL and privacy contact

- **Privacy Policy URL** (required): `https://graybag.com/privacy` → served from
  `docs/privacy-policy.md` (`Q11`). Must be publicly reachable without login (`AZ-03`: `anon`
  holds zero DB policies, so this is static/edge content, not a public table read).
- The grievance-officer block (dpdp §7.2) appears in that policy; its
  `«…-PENDING-E20-21»` tokens must be resolved first ([SS-04]).

---

## 3. Google Play Data Safety

Play's form asks, per data type: is it **collected**, is it **shared** (transferred to a third
party), is it **processed ephemerally**, is collection **required or optional**, and for **what
purpose**. It also asks about **security practices** and **deletion**.

### 3.0 Security-practices and deletion answers

| Question | Answer | Basis |
|---|---|---|
| Is data **encrypted in transit**? | **Yes** — HTTPS/TLS to Supabase and all providers | `A2`, standard |
| Can users **request deletion** of their data? | **Yes** — in-app (Settings → Privacy → Raise a request) and web | `E03-08`, dpdp §6.5/§7 |
| Data-deletion URL | `https://graybag.com/«ACCOUNT-DELETION-URL-PENDING-E17-15»` | `E17-15` |
| Does the app follow the **Families / children** policy? | See `E17-05` — accounts are held by adults; declare per that task's finding | §1.3 |
| Committed to Play's **Data safety** accuracy | Yes | must match privacy policy — `E17-14` |
| Independent security review | Not claimed for v1 | — |

**Retention note for the form / policy:** some data is retained by **statute** beyond account
deletion — the tax invoice (with the child's first name on the line, `G7`), the ledger, and the
order rows with the child's name/class/section nulled once past the retention window; and the
consent record survives as evidence (dpdp §6.6, `C9`, `D15`). Deletion removes everything else.
The proposed retention numbers are in dpdp §6.2 and are provisional on `E20-01` / the accountant
(`[DP-02]`).

### 3.1 Data collected / shared — the table

"Shared" in Play = transferred to a third party. Our processors (Supabase = our data store; SMS
provider = OTP delivery; Sentry/Better Stack = diagnostics; push provider) are declared as
processing on our behalf. **Razorpay** receives the paying adult's phone + email as prefill and
may be an independent fiduciary (`DP-04`), so the payer contact is declared **shared** ([SS-02]).

| Play data type | Collected | Shared | Required/Optional | Purpose(s) | Concrete field / trace |
|---|---|---|---|---|---|
| **Phone number** | Yes | Yes (payment processor: payer prefill) | Required | App functionality; Account management | `phone_e164` (`U1`); Razorpay prefill (payments §3.7) |
| **Email address** | Yes | Yes (payment processor: payer prefill) | Optional | App functionality | `app_user.email`; invoice delivery |
| **Name** | Yes | No | Required (adult); Required for a dependent | App functionality | adult + child `first_name/last_name` |
| **Health info** (declared allergies) | Yes | No | **Optional** | App functionality (allergen warning) | tier S; declining = no warning, not no service (`C5`) |
| **Other info** (school, class, section; order comments) | Yes | No | Required (to place an order for a child) | App functionality | tier P; `special_comments` |
| **Purchase history** | Yes | No | Required | App functionality | `order`, `invoice` |
| **App activity → other actions** (order flow) | Yes | No | Required | App functionality | order lifecycle |
| **App info & performance → Crash logs** | Yes | No | (diagnostics) | App functionality | Sentry — PII/child-data scrubbed (§5.3, E20-10) |
| **App info & performance → Diagnostics** | Yes | No | (diagnostics) | App functionality | Better Stack |
| **Device or other IDs** | Yes | No | Required (for push) | App functionality | push `device_token` |
| **Financial info → Payment info** | **No (not collected by the app)** | Handled by Razorpay SDK | — | — | card/UPI never reach us (PY8, §11.1 payments) |

### 3.2 NOT collected (Play)

Declare "No / not collected" for: **Location** (precise or approximate), **Contacts**,
**Calendar**, **SMS or call logs** (OTP is read via SMS Retriever autofill on Android, `U3`,
which does **not** grant SMS-log access — it is a one-time autofill token and is *not* "reading
SMS" in the Data Safety sense; confirm wording in `E17-14`), **Photos/Videos**, **Audio**,
**Web browsing history**, **Installed apps**, **Advertising ID** (SUB3), **child DOB/age**, and
**child photo**.

> One to double-check in `E17-14`/`E17-05`: Android **SMS Retriever** (`U3`). It receives the OTP
> via a hashed one-time message and does **not** request the `READ_SMS` permission, so we do not
> "access SMS". If any build ever requests `READ_SMS`/`RECEIVE_SMS`, Play's Permissions
> Declaration and the SMS/Call-Log policy apply and this answer changes.

### 3.3 Third-party recipients (for the policy + `E20-24`)

The Data Safety form's "shared" answers and the privacy policy must name the recipients
consistently with the processor register (dpdp §9, `E20-11`, and new task `E20-24`):

| Recipient | Role | Gets |
|---|---|---|
| Supabase (AWS Mumbai) | Processor / data store | All app data, at rest in-region (`A2`) |
| SMS provider (MSG91 / Gupshup) | Processor | Phone number, for OTP delivery (`E00-09`) |
| **Razorpay** | Payment gateway; possibly independent fiduciary (`DP-04`) | Payer phone + email (prefill), amount, our IDs. **Never child data** (PY8) |
| Sentry | Processor | Crash diagnostics, **all tiers scrubbed** (§5.3, E20-10) |
| Better Stack | Processor | Performance logs, scrubbed |
| Expo / push | Processor | Device token + notification body (no child data) |

---

## 4. Store listing copy

Draft copy for both stores. Length limits differ (App Store: name ≤30, subtitle ≤30,
promotional text ≤170, keywords field ≤100 total; Play: title ≤30, short description ≤80, full
description ≤4000). `E17-17` verifies each field against the live limits before submission.

### 4.1 App name / title

- **GrayBag** (primary — matches the owned brand and existing listing under `R4`)
- Play title option with keyword: **GrayBag: School Meal Ordering** (30 chars — verify)

### 4.2 Subtitle (App Store, ≤30) / promotional line

- **Order school meals in seconds** (28)
- Alt: **Healthy school lunches, sorted** (30)

### 4.3 Short description (Play, ≤80)

> Order and pay for your child's school meals — with allergy warnings built in. (77)

### 4.4 Full description (Play) / App Store description

> **GrayBag makes ordering your child's school meals quick, clear and safe.**
>
> Browse the day's menu for your child's school, add meals to the cart, and pay in a few taps
> with UPI, cards or netbanking. Order for more than one child, and for the days ahead, in one
> go.
>
> **Built around allergies.** Add your child's allergies once and GrayBag warns you at the
> moment you add a dish that declares one of them — so a mistake is caught before you pay, not
> after.
>
> **Made for the school day.**
> - See the exact menu and prices for your child's school
> - Choose a break time and classroom delivery, or a counter pickup code
> - Track each order from placed to delivered
> - Get a proper GST invoice for every order, by email
> - Refunds go to your in-app wallet instantly, or back to source
>
> **You are in control of your data.** GrayBag is built for India's Digital Personal Data
> Protection Act. You choose what you share about your child, you can withdraw consent or delete
> your account from inside the app at any time, and we never use your or your child's data for
> advertising or tracking.
>
> GrayBag currently serves schools in Chandigarh, SAS Nagar (Mohali) and Panchkula.
>
> Questions or a data request? Reach our Grievance Officer from Settings → Privacy, or at the
> address in our privacy policy.

*(Claims audited against decisions: multi-child/multi-day = `[DM-01]` option B; allergy warning
= `D7`/`C5`/`E05-05`; classroom vs counter pickup = `P4`/`P5`; GST invoice by email =
`E07`/`P6`; wallet-first refunds = `M7`; no ads/tracking = SUB3; DPDP controls = `E20`. Cities =
data-model §1.7. Do not add a claim here that is not backed by a shipped feature.)*

### 4.5 Keywords (App Store keyword field, ≤100 chars total, comma-separated, no spaces)

> school,meals,lunch,tiffin,canteen,food,order,kids,allergy,parents,india,upi,menu

(83 chars — verify. Do **not** repeat words already in the app name; Apple indexes those
separately. No competitor names.)

### 4.6 What's-new / release notes (update under `R4`)

> A ground-up rebuild: a faster menu, a much smoother payment experience with UPI, clearer
> allergy warnings, proper GST invoices, and full control over your data. You'll be asked to log
> in once with your phone number.

*(The one-time OTP re-login is real — `U2`: Bubble cannot export password hashes, everyone
re-authenticates once. Customer comms for it are `E17-11`.)*

---

## 5. Screenshot shot-list

Both stores need screenshots at set device sizes (App Store: 6.9"/6.5" iPhone, and iPad if the
listing is universal; Play: phone, plus 7"/10" tablet if declared). `E17-16` produces the real
assets once `E14` (app shell) and `E13` (design system) render real screens. The shot-list, in
listing order (first two carry the store; lead with value, not chrome):

| # | Screen | What it shows | Caption (draft) | Source |
|---|---|---|---|---|
| 1 | **Menu for a school** | The day's dishes with images, veg/non-veg mark, prices, category tabs | "Today's menu, ready in seconds" | `E04`, `E05`; mocks `06_App UI` |
| 2 | **Allergy warning at add-to-cart** | The warning sheet firing on a dish that declares the child's allergen | "Allergy warnings, before you pay" | `E05-05`, `D7` |
| 3 | **Cart / checkout with UPI** | Cart totals with CGST+SGST shown separately, Razorpay UPI sheet | "Pay in a tap with UPI" | `E06`, `M2` |
| 4 | **Order tracking** | An order moving placed → preparing → delivered; pickup code | "Track every order to delivery" | `E06-05`, `P4` |
| 5 | **Multiple children** | Switching between two children in different classes | "One account, every child" | `D2`, `[DM-01]` |
| 6 | **Order history + GST invoice** | Past orders and a tappable invoice PDF | "A proper invoice, every time" | `E07`, `E05-10` |
| 7 | **Privacy controls** | Settings → Privacy: per-purpose consent toggles, raise a request, delete account | "Your data, your control" | `E20-02`, dpdp §4.5, §7 |

**Hard rule for every screenshot (DPDP tier S/P, CLAUDE.md #4):** use **synthetic/sentinel**
child data only — a made-up name, class, section and allergy. Never a real child's name, class
or allergy in a store asset. `E17-16` enforces this; it is the same rule as the sentinel-name
test in `E06-25`/`E20-10`.

Design constraints for the assets: brand palette and the "500 rule" for any functional green
(`S6`, `DS-01`); no invented UI — screenshots must be of real built screens, framed but not
faked.

---

## 6. Pre-submission checklist (for Andy, `E17-04`)

- [ ] `E17-14` App Privacy (§2) and Data Safety (§3) reconciled against the final
      `docs/privacy-policy.md`. **Gate.**
- [ ] `E17-05` Child-audience obligations confirmed per store; §1.3 audience set accordingly.
- [ ] `E20-21` Grievance-officer tokens resolved; privacy-policy URL live and public with no
      `«…-PENDING-…»` token (`E20-22` guard green).
- [ ] `E17-15` Account-deletion / data-deletion URL live and wired to the erasure flow.
- [ ] `E17-16` Screenshots produced at required sizes, sentinel data only.
- [ ] `E17-17` All listing text within each store's length limits.
- [ ] `E20-24` Third-party-recipient list matches the processor register and `E20-11`.
- [ ] Payment Info declared **not collected by the app** on both stores (Razorpay SDK holds it).
- [ ] Tracking / Advertising ID declared **No** on both stores (SUB3).

Only then does Andy enter the answers in App Store Connect and the Play Console.
