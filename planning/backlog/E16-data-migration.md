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

- [ ] `E16-01` (risk:critical) (mvp) Write the migration script: users, recipients, guardian links, schools, kitchens, menus, dishes, orders, order lines
- [ ] `E16-02` (risk:critical) (mvp) Role mapping: legacy enum -> Customer + back-office grants
- [ ] `E16-03` (mvp) Reconcile the two parent-child link mechanisms into a single relationship; report conflicts rather than guessing
- [ ] `E16-04` (mvp) Migrate full order history with line items, preserving totals and dates
- [ ] `E16-05` (mvp) Re-host all dish images; report any that cannot be sourced
- [ ] `E16-06` (mvp) Data quality report: duplicates, orphans, test/junk records, users without mobile numbers
- [ ] `E16-07` (mvp) Decide per-record what to leave behind (test data) vs migrate
- [ ] `E16-08` (risk:critical) (mvp) **Validation suite**: row counts, financial totals, and a sample of orders compared field-by-field between Bubble and the new DB
- [ ] `E16-09` (risk:critical) (mvp) **Dress rehearsal #1** into staging, timed end to end
- [ ] `E16-10` (risk:critical) (mvp) **Dress rehearsal #2** after fixes, timed again; produces the cutover runbook
- [ ] `E16-11` (mvp) Rollback plan: exactly what happens if validation fails mid-cutover
- [ ] `E16-12` (mvp) Users without a usable mobile number — identify early and contact them before cutover
- [ ] `E16-13` (risk:critical) (mvp) Dress rehearsals must run against **pseudonymised data**, or in an isolated project with mandatory teardown. Do not copy live children's names and allergies into staging and leave them there
- [ ] `E16-14` (risk:critical) (mvp) Normalise all mobile numbers to **E.164**; produce a report of duplicates, unparseable and missing numbers before cutover
- [ ] `E16-15` (risk:high) (mvp) Hand-verified lookup table mapping legacy break-time option values to real times (the legacy values are wrong — see constraints above)
- [ ] `E16-16` (risk:high) (mvp) If any legacy prepaid / wallet balances exist (see `E00-18`), migrate them as **opening ledger credits** so nobody loses money at cutover
- [ ] `E16-17` (mvp) Migrate kitchen staff from an `owner-email` string on the Kitchen record to real user accounts with scoped grants
- [ ] `E16-18` (risk:critical) (mvp) **Point-in-time restore rehearsal**: prove the new Supabase project can be restored to the pre-cutover snapshot within the rollback SLA the `docs/cutover-runbook.md` assumes. Feeds the runbook's rollback plan
- [ ] `E16-19` (risk:high) (mvp) **The migration status map must target only statuses reachable by the `system` backfill actor — never `draft`.** `docs/cutover-runbook.md` §5.D.5 previously mapped legacy `new→draft`; `draft` is unreachable in v1 (`order-lifecycle.md` §3.2, invariant I12) and the §4.4 trigger only allows `NULL→draft` for an admin with `orders.create_on_behalf`, so a system backfill row is rejected at insert or trips I12 on the first nightly run. The runbook spec is now corrected; the migration code must implement the legal mapping (paid/cancelled/pending_payment) and assert no draft rows are produced (review finding #9)
