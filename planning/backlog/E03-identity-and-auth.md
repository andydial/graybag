---
id: E03
title: Identity & Auth — Google / Apple / email OTP
phase: 2
risk: high
status: not-started
depends_on: [E01, E02, E00]
summary: Google / Apple / email-OTP sign-in for app users (phone OTP deferred to a fast-follow), email for back-office. No password migration is possible from Bubble. See decision U1 (revised).
---

## Context

Per decision **U1** (revised), v1 auth is Google Sign-In (primary), Sign in with Apple (iOS, required once Google is offered), and email OTP via Supabase `signInWithOtp` — no phone OTP and no passwords. Phone OTP + DLT SMS (see E00) become a fast-follow *addition*; DLT registration leaves the launch critical path but continues for future order-update SMS. Bubble does not export password hashes, so every existing user re-authenticates once regardless; migration now matches on **email** (`E03-16`), not the lossy legacy phone `number` field.

## Tasks

- [ ] `E03-01` (risk:high) Integrate SMS provider (MSG91/Gupshup) with DLT-approved templates
- [ ] `E03-02` Phone + OTP signup and login flow, with rate limiting and lockout on repeated failures
- [ ] `E03-03` Android **SMS Retriever API** — OTP auto-fills with no SMS permission and no typing
- [ ] `E03-04` iOS OTP autofill from the keyboard suggestion bar
- [ ] `E03-05` (mvp) Long-lived refresh tokens (90–180 days) with silent refresh, so returning users rarely see an OTP
- [ ] `E03-06` (mvp) Email + password login for back-office users only
- [ ] `E03-07` (mvp) Optional email capture on the customer profile, used for invoices and receipts
- [ ] `E03-08` (mvp) Account deletion flow (store policy requirement on both platforms)
- [ ] `E03-09` (mvp) Session handling across app restarts and token expiry, tested on a cold device
- [ ] `E03-10` (risk:high) OTP cost and abuse guardrails: per-number and per-IP throttles, alerting on spikes
- [ ] `E03-11` (risk:critical) ~~Migration path for the ~400 existing users: match on **normalised E.164** mobile number~~ — **superseded by `E03-16`**: migration now matches on **email** per `U1` (the legacy phone `number` field lost leading zeros/`+91`, an account-takeover vector). Kept for history; do not build the phone-match path
- [ ] `E03-12` (risk:high) (mvp) Google Sign-In via Supabase Auth on mobile and web
- [ ] `E03-13` (risk:high) (mvp) Sign in with Apple on iOS — required by Apple once Google is offered
- [ ] `E03-14` (risk:high) (mvp) Email OTP via Supabase `signInWithOtp` for non-Google addresses
- [ ] `E03-15` (mvp) Account linking — the same email arriving via Google and via email OTP must resolve to one account, never two
- [ ] `E03-16` (risk:critical) (mvp) Migrate the ~400 existing users by **email** match, not phone. Report any duplicate or missing emails before cutover
- [ ] `E03-17` (mvp) Collect mobile number as a profile field (kitchen contact, last-4 search) — not a login credential
