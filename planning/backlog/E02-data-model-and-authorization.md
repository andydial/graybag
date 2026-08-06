---
id: E02
title: Data Model & Authorization
phase: 2
risk: critical
status: not-started
depends_on: [E01]
summary: The target schema and the permission model. The single biggest failure of the legacy system was authorization, so it is designed and tested first.
---

## Why this is critical

In Bubble, `Order` is readable by everyone and 10 types have no privacy rules at all — including `Child` (minors' names, class, allergies, parent email). Authorization must be enforced server-side and covered by tests before any feature is built on top of it.

## Design decisions already locked

- Two planes: **Customer** (single ordering role) and back-office **grants** (KitchenOperator, SchoolViewer, PlatformAdmin), scoped to kitchen/school ids.
- School lives on the **Recipient**, not the user. Recipient = self or a dependent.
- `Menu` is owned by a Kitchen; `MenuAssignment(school, menu, valid_from, valid_to)` decides who sees what.
- Config **resolution chain**: platform default -> kitchen -> school. Applies to cutoff time, prices, break/drop times, revenue-share %.
- Effective config is **snapshotted onto the order** at write time (correctness + performance).
- **Ledger** (append-only credits/debits with reason codes) exists from v1 even without a visible wallet.

## Tasks

- [ ] `E02-01` (risk:critical) Draft target ERD; review with Andy before any migration is written
- [ ] `E02-02` Core entities: `user`, `recipient`, `guardian_link`, `school`, `kitchen`, `city`
- [ ] `E02-03` Menu entities: `dish`, `menu`, `menu_item`, `menu_assignment`, `allergen`, `dish_allergen`
- [ ] `E02-04` Order entities: `order`, `order_line`, with dish name/price/allergens **snapshotted** at order time
- [ ] `E02-05` (risk:high) Money entities: `ledger_entry`, `payment`, `refund`, `payout`, `invoice`. **All amounts stored as integer paise** — never floats
- [ ] `E02-06` Config entities: `platform_config`, `kitchen_config`, `school_config`, `break_time`
- [ ] `E02-07` (risk:critical) Permission model: `grant(user, permission, scope_type, scope_id)`. Discrete permissions include `orders.view`, `orders.mark_delivered`, `orders.refund`, `orders.view_financials`, `menu.edit`, `school.onboard`, `reports.view`
- [ ] `E02-08` (risk:critical) Row Level Security policies on every table; **default deny**
- [ ] `E02-09` (risk:critical) Authorization test suite — for each table, assert every role can and cannot see exactly what it should. This suite must fail loudly if a policy is ever removed
- [ ] `E02-10` Resolution-chain resolver (platform -> kitchen -> school) with unit tests, plus config cache
- [ ] `E02-11` Reporting **partitioned and indexed** by city + kitchen from day one (materialised aggregates are deferred to `E18-22`)
- [ ] `E02-12` Design a `menu_item_capacity(menu_item, service_date, remaining)` table now, unused, so per-dish limits drop in later without a rewrite
- [ ] `E02-13` Correlation ID on every order, threaded through all logs and events
- [ ] `E02-14` Fix legacy modelling defects: single parent-child link (not two), single user pointer per role on order, single payment id field, real time types for break times, no denormalised date parts
- [ ] `E02-15` (risk:high) `policy_version` + `user_policy_acceptance` tables (consumed by `E20-03`)
- [ ] `E02-16` Consent records table with purpose, timestamp and policy version (consumed by `E20-02`)
- [ ] `E02-17` Mobile numbers stored normalised as **E.164** with a uniqueness constraint — the legacy field is a number type that loses leading zeros and country codes
- [ ] `E02-18` (risk:critical) **Actually run** `0002_rls_policies.sql` and `supabase/tests/authorization.test.sql` against `supabase start` and fix what falls out. Both were written offline in `Q04` and have never been executed. Until this is green, `E02-08` and `E02-09` are not done
- [ ] `E02-19` (risk:high) Wire `supabase test db` into CI as a **required** check. It cannot run against a bare `postgres:16` service container — `app_user.id` references `auth.users(id)` and the suite impersonates via `request.jwt.claims`. Constrains `E01-08` / `E01-11`
