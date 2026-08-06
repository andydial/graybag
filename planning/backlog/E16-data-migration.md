---
id: E16
title: Data Migration from Bubble
phase: 7
risk: critical
status: not-started
depends_on: [E02, E03, E04, E05, E06]
summary: Move ~400 users, dependents and full order history off Bubble. Rehearsed at least twice before the real thing.
---

## Known constraints

- Bubble **cannot export password hashes**. Every user re-authenticates once — mitigated by phone-OTP login matched on mobile number.
- Bubble CDN image URLs die on migration; images must be re-hosted.
- Legacy role values must be mapped on **db_value**, not label: `parent`, `admin`, `kitchen`, `collegestudent`, `staff` (= school admin), `teacher` (= school staff).
- Legacy has two parallel parent-child links (`Child.Parent` list and `Guardian_Link`) that must be reconciled into one.
- Order status values map from `new / received / accepted / delivered / cancelled / refunded`.
- **Break-Start-Times db values contradict their labels** in the legacy option set (`10__00_am` renders as "10:40AM - 11:15AM"). Migrating on db_value silently puts orders in the wrong break — this needs a hand-verified lookup table.
- Legacy `mobile` is a **number** field, so leading zeros and country codes are already lost. Normalisation and de-duplication must happen before any account can be claimed by OTP.

## Tasks

- [ ] `E16-01` (risk:critical) Write the migration script: users, recipients, guardian links, schools, kitchens, menus, dishes, orders, order lines
- [ ] `E16-02` (risk:critical) Role mapping: legacy enum -> Customer + back-office grants
- [ ] `E16-03` Reconcile the two parent-child link mechanisms into a single relationship; report conflicts rather than guessing
- [ ] `E16-04` Migrate full order history with line items, preserving totals and dates
- [ ] `E16-05` Re-host all dish images; report any that cannot be sourced
- [ ] `E16-06` Data quality report: duplicates, orphans, test/junk records, users without mobile numbers
- [ ] `E16-07` Decide per-record what to leave behind (test data) vs migrate
- [ ] `E16-08` (risk:critical) **Validation suite**: row counts, financial totals, and a sample of orders compared field-by-field between Bubble and the new DB
- [ ] `E16-09` (risk:critical) **Dress rehearsal #1** into staging, timed end to end
- [ ] `E16-10` (risk:critical) **Dress rehearsal #2** after fixes, timed again; produces the cutover runbook
- [ ] `E16-11` Rollback plan: exactly what happens if validation fails mid-cutover
- [ ] `E16-12` Users without a usable mobile number — identify early and contact them before cutover
- [ ] `E16-13` (risk:critical) Dress rehearsals must run against **pseudonymised data**, or in an isolated project with mandatory teardown. Do not copy live children's names and allergies into staging and leave them there
- [ ] `E16-14` (risk:critical) Normalise all mobile numbers to **E.164**; produce a report of duplicates, unparseable and missing numbers before cutover
- [ ] `E16-15` (risk:high) Hand-verified lookup table mapping legacy break-time option values to real times (the legacy values are wrong — see constraints above)
- [ ] `E16-16` (risk:high) If any legacy prepaid / wallet balances exist (see `E00-18`), migrate them as **opening ledger credits** so nobody loses money at cutover
- [ ] `E16-17` Migrate kitchen staff from an `owner-email` string on the Kitchen record to real user accounts with scoped grants
