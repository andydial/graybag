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
- [ ] `E03-14` (risk:high) (mvp) Email OTP via Supabase `signInWithOtp` for non-Google addresses. **No separate email-verification step is needed or wanted** (`AR4`): Google verifies the address as part of its flow, and an OTP cannot succeed on an address the user cannot read — verification is a property of both mechanisms, not a step to add. Adding one would put a blocking screen on the signup path that `AR7` exists to protect
- [ ] `E03-15` (mvp) Account linking — the same email arriving via Google and via email OTP must resolve to one account, never two
- [ ] `E03-16` (risk:critical) (mvp) Migrate the ~400 existing users by **email** match, not phone. Report any duplicate or missing emails before cutover **Post-cutover as of `SC3` (2026-08-09)** — Amity's ~150 users re-register from scratch and the rest migrate after cutover, so this is no longer a launch task. Moved to Block 13
- [ ] `E03-17` (mvp) Collect mobile number as a profile field (kitchen contact, last-4 search) — not a login credential
- [ ] `E03-18` (risk:high) (owner:andy) Decide the **support policy for the ~15 people who appear to hold two accounts** under different spellings of the same school domain (`ais.amity.edu` vs `ais.amity.edu.in` vs `aismohali.amity.edu`) — found by `E19-04`. As email strings they are distinct and will migrate to distinct accounts, which is correct; but each of those parents will see their children and order history split across two logins. This is a support-model decision, not a data fix: **do not merge them automatically** — `ais.amity.edu` and `ais.amity.edu.in` may be genuinely separate mailboxes, and a wrong merge shows one parent another family's child **Post-cutover (`SC3`)** — only migrated accounts can hold two
- [ ] `E03-19` Produce the two-account list for `E03-18` as a support artefact and build the merge-on-request path (user confirms, then histories combine) rather than a bulk merge at cutover **Post-cutover (`SC3`)** — follows `E03-18`
- [ ] `E03-20` (risk:high) (mvp) **Session persistence across app restarts.** `E03-14` shipped sign-in, but the Supabase client is constructed with no storage adapter, so a session lives in memory and is gone when the app is killed — every cold start is a fresh OTP. Needs a native key/value store (`@react-native-async-storage/async-storage`, or `expo-secure-store` if the refresh token should sit in the keychain, which is the stronger option and the one to prefer). Deliberately not added on 2026-08-09: it is a native dependency and adding one unattended, hours after the last verified build, risked leaving Andy with no installable APK at all. `packages/shared/src/menu/cache.ts` already defines the storage interface this should satisfy. **Closes `E03-09` with it**
- [ ] `E03-21` **Decide whether Supabase identity linking on verified email is actually on** for the staging and production projects, and assert it. `api/auth.ts`'s `linkingPolicy` documents the requirement `E03-15` depends on: one `auth.users` row per verified address across Google, Apple and OTP. **No client code can detect it being off** — from the app, two accounts look exactly like one person signing in twice. The failure is two carts, two children lists and two order histories for one parent, discovered by them rather than by us. It is a project setting plus a test that signs in both ways and compares ids, which needs a real project and rides with `E03-12`

