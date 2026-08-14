---
title: Privacy Policy — GrayBag
status: PUBLISHED. Notice version 3 — the lawyer-approved baseline plus four tracked changes.
baseline: docs/legal/privacy-policy-baseline.md (verbatim, unedited)
notice_version: 3
covers: E20-06, E20-38
---

# GrayBag Privacy Policy

**Notice version 3** · Effective 2026-08-15

> **What this document is.** Sections 1–8 are the privacy policy drafted by GrayBag's Indian
> lawyer and published for the legacy application, held verbatim in
> `docs/legal/privacy-policy-baseline.md`. Three changes have been made on top of it since,
> each listed in the change log below with the reason. Nothing else has been altered — the
> baseline file is the record of what the lawyer approved, and this file is the record of what
> we changed after.
>
> **Any further change is a new notice version**, not an edit to this one. `policy_version`
> rows are immutable once published for exactly this reason: a parent's consent points at the
> wording they were shown.

## Change log

### Version 3 — 2026-08-15

| # | Section | Change | Why |
|---|---|---|---|
| 4 | §7A Grievance Officer | The named individual and their personal address are replaced by the **role** at the named company: **Grievance Officer, GrayBag Solutions Private Limited, `support@graybag.com`** | Andy's decision, 2026-08-15. A published contact that is one person's name and one person's mailbox is unanswerable when that person is away, cannot be handed over without republishing the notice, and makes an individual the public face of every data complaint. The office is what the Act makes responsible; naming the office and the company identifies the responsible party without pinning it to one employee. **The legal question is open and is `E20-01`'s**: whether the DPDP Act requires a natural person's name here, or whether a titled office at a named company satisfies it. Version 2 asserted the former without a lawyer having said so. If the lawyer says a name is required, that is version 4 and the name goes back — this change does not foreclose it |

**Why this was safe to make today, and would not have been next month.** A published version is
immutable and `requires_acceptance` re-prompts everyone who accepted the previous one. Today that
is **nobody** — `user_policy_acceptance` holds zero rows, because no parent has registered. After
cutover the same correction becomes a consent interruption for every family. This is the same
reasoning, and the same window, that `0032` used for the self notice on 2026-08-11.

### Version 2 — 2026-08-11

| # | Section | Change | Why |
|---|---|---|---|
| 1 | §6 Children's Privacy | "children under 13" → **"children under 18"** | 13 is COPPA's threshold, which is United States law. India's **DPDP Act 2023 defines a child as under 18**, and that is the law GrayBag operates under. The lower number would have understated the protection owed to most of the children in the system |
| 2 | §7A Grievance Officer *(new)* | Named **Vivek**, `vivek@graybag.com`, as the published contact for data complaints | The DPDP Act requires a Data Fiduciary to **publish** the contact details of a person who answers questions and complaints about personal data processing. The baseline had a general `info@` address, which does not satisfy a named-officer requirement |
| 3 | §4 Data Retention | Split into **financial records (kept for as long as Indian tax and company law requires)** and **a child's personal data (deleted on request, or when the guardian link ends)** | "As long as necessary for business and legal purposes" cannot serve both. Financial records are held under a statutory floor and cannot be deleted on request; a child's name, class, section and allergy details are under no such floor, and holding them to a tax rule would be the opposite of data minimisation. One period could not honestly describe both, so it is two |
| 3a | §4 Data Retention *(corrected 2026-08-11)* | The financial-records period **no longer states a number**. Version 2 as first published said **seven years** | That figure was not verified against the statutes. Andy, who supplied it, withdrew it: the **Companies Act 2013 requires books of account for eight years**, and the **GST record period runs 72 months from the annual return** — so seven years may be *below* the floor, and a published commitment shorter than the law requires is worse than one that does not commit to a number. The binding period, and whether the GST record period differs from the Companies Act one, is on the accountant's list (`E00-10`, `docs/andy-prep/professional-questions.md`). **When the number comes back we state it once, correctly.** Until then the wording defers to the law, which is both accurate and safe in either direction |

Also corrected in the refund policy, as a typo rather than a decision: `info@graybag.in` →
`info@graybag.com`.

---

## 1. Information We Collect

We may collect the following types of information:

- **Personal Information:** Name, email address, child's name/class, and other contact details.
- **Payment Information:** Processed securely via third-party payment gateways (we do not store payment details).
- **Device Information:** Device ID, operating system, and usage data to improve functionality.

## 2. How We Use Your Information

We use your information to:

- Process and manage food orders
- Communicate with parents and canteen staff
- Improve app functionality
- Comply with legal obligations

## 3. Sharing of Information

We do not sell or rent personal data. We may share data with:

- The school or canteen administrators (for order fulfilment)
- Trusted third-party services (e.g., payment processors)
- Legal authorities if required by law

## 4. Data Retention

*Changed in version 2 — see the change log.*

We keep different kinds of information for different lengths of time, because the law requires
one and forbids the other.

**Financial records — for as long as Indian tax and company law requires.** Invoices, ledger
entries and order history are retained for as long as Indian tax and company law requires us to
keep them. We cannot delete them on request. They record a transaction, not a child.

**A child's personal data — deleted on request, or when the guardian link ends.** A child's
name, class, section and any allergy details you have given us are deleted when you ask us to
delete them, or when your link to that child ends — whichever happens first. You do not have to
wait for a tax retention period to run out, and we do not keep a child's details because a tax
rule applies to an invoice.

Where an invoice must survive, it survives as a financial record. It does not carry a child's
details forward.

## 5. Security

We use industry-standard security protocols and encrypt sensitive data where applicable.

## 6. Children's Privacy

*Changed in version 2 — see the change log.*

The app is designed for use by parents, not children. We do not knowingly collect personal
data from children under 18.

## 7. Your Rights

You can access, update, or delete your personal information by contacting us at:
info@graybag.com

## 7A. Grievance Officer

*Added in version 2, changed in version 3 — see the change log.*

In accordance with the Digital Personal Data Protection Act 2023, the following is responsible
for answering questions and complaints about how we handle personal data:

**Grievance Officer**
GrayBag Solutions Private Limited
support@graybag.com

You may write to the Grievance Officer about anything we hold about you or your child — to see
it, correct it, or have it deleted.

## 8. Contact Us

If you have questions about this policy, contact:

Email: info@graybag.com
