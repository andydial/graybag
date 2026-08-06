---
id: E20
title: Compliance & Data Protection
phase: 1
risk: critical
status: not-started
depends_on: [E02]
summary: India's DPDP Act, children's data, consent records and policy versioning. The system stores minors' names, class, section and allergies (health data), so this is not an app-store checkbox.
---

## Why this is critical

GrayBag stores personal data about **children**, including **allergies**, which is health
data. India's Digital Personal Data Protection Act 2023 requires verifiable parental
consent for a child's data, a stated purpose, a grievance officer, and breach
notification to the Data Protection Board. The legacy Bubble app had none of this and
also exposed the data publicly.

## Tasks

- [ ] `E20-01` (risk:critical) (owner:andy) Confirm DPDP obligations that apply to GrayBag with a lawyer or the accountant — children's data, verifiable parental consent, grievance officer, breach reporting timelines
- [ ] `E20-02` (risk:critical) **Consent capture** at dependent creation: explicit, purpose-scoped, recorded with timestamp and policy version
- [ ] `E20-03` (risk:critical) `policy_version` and `user_policy_acceptance` tables — store which version each user accepted and when. Ordering is blocked until the current version is accepted
- [ ] `E20-04` Consent withdrawal and data deletion flow, honouring both DPDP and app-store account-deletion requirements (pairs with `E03-08`)
- [ ] `E20-05` Data retention policy: how long orders, invoices (statutory minimum), children's records and logs are kept, and automated purge for anything past it
- [ ] `E20-06` Privacy notice written for actual practice, not boilerplate — what is collected, why, who it is shared with (Razorpay, SMS provider, Sentry), and for how long
- [ ] `E20-07` Named **grievance officer** with contact details published on the website and in the app
- [ ] `E20-08` (risk:high) **Breach notification runbook** — who is told, in what order, within what deadline
- [ ] `E20-09` Purpose limitation enforced in code: kitchen staff see what they need to prepare and deliver, never more; school reports carry aggregates only
- [ ] `E20-10` Exclude children's data and PII from product analytics and from Sentry payloads (scrubbing rules, verified by test)
- [ ] `E20-11` Data-processing review of every third party touching personal data (Supabase, Razorpay, SMS provider, Sentry, Netlify, Expo) — where the data sits and what the contract says
