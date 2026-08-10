# Apple App Privacy & Google Play Data Safety — drafted answers

**Draft for `E17-04`. Check, then submit.** Every answer cites where in the codebase it comes
from, so you can verify rather than take my word for it.

**The rule I applied throughout:** answer for what the code *does*, not what we intend. If a
draft here looks wrong, the likeliest explanation is that the code is doing something we did
not mean to, which is worth finding now rather than after a store rejection.

Source of truth for the classification: `docs/dpdp-compliance.md` §2.2 and `docs/data-model.md`
§13.3.

---

## Part 1 — What the app actually collects

| Data | Tier | Where | Why | Linked to identity? | Used for tracking? |
|---|---|---|---|---|---|
| Email address | A | `app_user.email` | Sign-in (email OTP) and order receipts | Yes | **No** |
| Adult's name | A | `app_user.first_name`, `last_name` | The invoice, and knowing who is collecting | Yes | **No** |
| **Child's first and last name** | **P** | `recipient.first_name`, `last_name` | So the right food reaches the right child | Yes | **No** |
| **Child's class and section** | **P** | `recipient.class_label`, `section_label`, `school_class_id` | Where the kitchen delivers | Yes | **No** |
| School | P | `recipient.school_id` | Which kitchen makes it | Yes | **No** |
| **Allergies** | **S — health** | `recipient_allergen`, `recipient.allergy_note` | To warn before ordering. **Optional** — declining means no warnings, not no service | Yes | **No** |
| Order history | A/P | `order`, `order_line` | Your orders, invoices, refunds | Yes | **No** |
| Payment | — | **Razorpay holds it. We store an id and a status, never a card number** | Taking payment | Razorpay's own linkage | **No** |
| Crash diagnostics | — | Sentry, **if** `EXPO_PUBLIC_SENTRY_DSN` is set | Finding faults | **Not linked** — see the note below | **No** |

**Two things we deliberately do NOT collect**, and both are worth stating on the forms because
reviewers expect them for a children's app: a child's **date of birth** and a child's
**photograph** (`dpdp-compliance.md` §2.2).

**No advertising, no analytics SDK, no location, no contacts, no device identifiers for
tracking.** There is no ad network in `package.json` and no analytics package.

> **[VERIFY BEFORE SUBMITTING] Sentry.** Non-negotiable #4 and `dpdp-compliance.md` §2.3 say
> tier P and tier S never reach Sentry, and `E20-10` is the task that enforces it. **`E20-10` is
> not done.** Until it is, "crash data contains no personal information" is an intention rather
> than a guarantee. Either finish `E20-10` first, or ship the first build with Sentry disabled.
> Do not answer "not collected" on a form while an unverified path exists — a wrong answer here
> is a compliance problem, not a paperwork one.

---

## Part 2 — Apple App Privacy questionnaire

App Store Connect → your app → App Privacy.

### "Do you or your third-party partners collect data from this app?" → **Yes**

For each category Apple lists, the answer and the three follow-ups
(*used for tracking?* / *linked to the user?* / *purpose*):

| Apple category | Collected? | Tracking? | Linked? | Purpose |
|---|---|---|---|---|
| **Contact Info → Email Address** | Yes | No | Yes | App Functionality |
| **Contact Info → Name** | Yes | No | Yes | App Functionality |
| **Contact Info → Phone Number** | **No** | — | — | No phone OTP in v1 (non-negotiable #7). `app_user.phone_e164` exists but is unused — **do not tick it** |
| **Health & Fitness → Health** | **Yes** | No | Yes | App Functionality. *This is the allergy data. It is optional to provide* |
| **Financial Info → Payment Info** | **No** | — | — | Razorpay collects it; we hold an id and a status. If Apple's tooling insists because the SDK is embedded, declare it under Razorpay as a third party, not as ours |
| **Purchases → Purchase History** | Yes | No | Yes | App Functionality |
| **Identifiers → User ID** | Yes | No | Yes | App Functionality |
| **Identifiers → Device ID** | **No** | — | — | |
| **Diagnostics → Crash Data** | Yes *(see the Sentry note)* | No | **Not Linked** | App Functionality |
| **Usage Data** | **No** | — | — | No analytics SDK |
| **Location** | **No** | — | — | |
| **Contacts** | **No** | — | — | |
| **User Content** | **Yes** | No | Yes | App Functionality. *The per-line kitchen note (`P12`) is free text a customer types* |

### Other Apple questions

- **"Is your app directed to children?"** — **[YOU DECIDE, and check with the lawyer.]** My
  read: **No.** The *user* is an adult — a parent, a staff member or a university student — who
  provides data *about* a child. The app is not designed for or marketed to children, and a
  child never holds the account. Answering Yes puts you in Apple's **Kids Category**, which
  brings extra requirements (no third-party analytics or ads at all, parental gates on external
  links) and would change the review. This is on the lawyer's list in
  `professional-questions.md`.
- **Privacy policy URL** — required, must be live before submission. `E20-07`, which is blocked
  on the grievance officer (`E20-21`).
- **Account deletion** — Apple requires an **in-app** path, not just a web one. That is
  `E20-04`, still open. **This will fail review if it is missing.**

---

## Part 3 — Google Play Data Safety form

Play Console → Policy → App content → Data safety.

### Section 1: Data collection and security

- **Does your app collect or share any of the required user data types?** → **Yes**
- **Is all of the user data collected by your app encrypted in transit?** → **Yes**
  *(HTTPS to Supabase and Razorpay; no cleartext endpoint exists)*
- **Do you provide a way for users to request that their data is deleted?** → **Yes**
  *(`E20-04`. Provide the in-app path **and** a support email as the web route.)*

### Section 2: Data types

| Play data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → **Name** | Yes | **No** | Required | App functionality |
| Personal info → **Email address** | Yes | **No** | Required | App functionality, Account management |
| Personal info → **Other info** (child's class/section, school) | Yes | **No** | Required | App functionality |
| **Health and fitness → Health info** | **Yes** | **No** | **Optional** | App functionality |
| Financial info → **Purchase history** | Yes | **No** | Required | App functionality |
| App activity → **Other user-generated content** (kitchen note) | Yes | **No** | Optional | App functionality |
| App info & performance → **Crash logs** | Yes | **No** | Required | App functionality *(see the Sentry note)* |
| App info & performance → **Diagnostics** | No | — | — | |
| Device or other IDs | **No** | — | — | |
| Location | **No** | — | — | |

**"Shared" means transferred to a third party.** Answer **No** throughout: the kitchen is not a
third party in Play's sense — it is us fulfilling the order — and Razorpay is a processor
handling payment, which Play treats as a service provider rather than sharing. *If in doubt on
the Razorpay line, the lawyer question in `professional-questions.md` covers it.*

### Section 3: Families policy — the one that decides the review

Play asks whether the app **targets children**. Same answer and same reasoning as Apple, and it
must match: **No**, the audience is adults ordering meals. Answering Yes triggers **Designed for
Families**, which requires a compliant ads SDK (we have none — fine), a published family privacy
policy, and a stricter content review.

**Answer Apple and Google identically.** A mismatch is a flag on both.

---

## Part 4 — What to do before you submit either form

1. **Finish or disable `E20-10`** (no PII in logs or Sentry). Everything above assumes it.
2. **Publish the privacy policy** (`E20-07`), which needs the grievance officer (`E20-21`).
3. **Ship in-app account deletion** (`E20-04`). Both stores require it; Apple enforces it hard.
4. Have the lawyer answer the "directed to children" question — it is the single answer that
   most changes what the stores require of us.
