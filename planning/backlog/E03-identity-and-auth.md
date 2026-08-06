---
id: E03
title: Identity & Auth — Phone OTP
phase: 2
risk: high
status: not-started
depends_on: [E01, E02, E00]
summary: Phone + OTP as primary login for app users, email/password for back-office. No password migration is possible from Bubble.
---

## Context

Firebase Phone Auth does **not** support India, so OTP goes through an Indian SMS provider with DLT registration (see E00). Bubble does not export password hashes, so every existing user re-authenticates once regardless of approach.

## Tasks

- [ ] `E03-01` (risk:high) Integrate SMS provider (MSG91/Gupshup) with DLT-approved templates
- [ ] `E03-02` Phone + OTP signup and login flow, with rate limiting and lockout on repeated failures
- [ ] `E03-03` Android **SMS Retriever API** — OTP auto-fills with no SMS permission and no typing
- [ ] `E03-04` iOS OTP autofill from the keyboard suggestion bar
- [ ] `E03-05` Long-lived refresh tokens (90–180 days) with silent refresh, so returning users rarely see an OTP
- [ ] `E03-06` Email + password login for back-office users only
- [ ] `E03-07` Optional email capture on the customer profile, used for invoices and receipts
- [ ] `E03-08` Account deletion flow (store policy requirement on both platforms)
- [ ] `E03-09` Session handling across app restarts and token expiry, tested on a cold device
- [ ] `E03-10` (risk:high) OTP cost and abuse guardrails: per-number and per-IP throttles, alerting on spikes
- [ ] `E03-11` (risk:critical) Migration path for the ~400 existing users: match on **normalised E.164** mobile number, first login is an OTP that claims the migrated account. **Any ambiguous or duplicate match must block auto-claim** and route to manual review — otherwise one OTP can claim the wrong account and its children's records
