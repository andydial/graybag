---
title: Authorization model
status: draft — needs review before `0002_rls_policies.sql` is written
produced_by: Q03
implements: E02-07, E02-08 (E02-09 / Q04 is the test suite)
---

# GrayBag — authorization model

Every table in `supabase/migrations/0001_initial_schema.sql`, and exactly who may read and
write it, expressed as the Row Level Security policies that will become
`supabase/migrations/0002_rls_policies.sql` (Q04).

**Why this document is separate from the migration.** The legacy Bubble app's single worst
failure was authorization: `Order` was readable and searchable by any visitor, and ten types
including `Child` — minors' names, class, allergies, parent email — had no privacy rules at
all. D8 and CLAUDE.md non-negotiable #2 say that must be impossible to regress. Impossible to
regress means the rules have to be written down somewhere a human can check them against the
SQL, and somewhere a test suite can be generated from. That is this file.

**Where this file and `docs/data-model.md` disagree, the data model is right and this file is
a bug.** Where this file *tightens* the data model it says so explicitly, in a callout.
Where a question is genuinely open it is marked `[AZ-nn]`, listed in
`docs/open-questions.md`, and the schema is written the recommended way with a label — never
silently.

---

## Contents

1. [The model in one page](#1-the-model-in-one-page)
2. [Database roles versus personas](#2-database-roles-versus-personas)
3. [What RLS can and cannot do](#3-what-rls-can-and-cannot-do)
4. [The helper functions every policy is built from](#4-the-helper-functions-every-policy-is-built-from)
5. [The nine rules that generate every policy](#5-the-nine-rules-that-generate-every-policy)
6. [The column problem, and the guard triggers that solve it](#6-the-column-problem-and-the-guard-triggers-that-solve-it)
7. [Per-table specification](#7-per-table-specification)
8. [The full matrix](#8-the-full-matrix)
9. [The denials that must be tested](#9-the-denials-that-must-be-tested)
10. [Table privileges — the layer underneath RLS](#10-table-privileges--the-layer-underneath-rls)
11. [Storage buckets](#11-storage-buckets)
12. [Test obligations for Q04 / E02-09](#12-test-obligations-for-q04--e02-09)
13. [Open decisions](#13-open-decisions)
14. [Work this document creates](#14-work-this-document-creates)

---

## 1. The model in one page

There are **two authorization planes** and they never mix (D1, D3).

**Plane 1 — the Customer.** One ordering role. A customer reaches data through exactly two
paths and no others:

| Path | Predicate |
|---|---|
| It is mine | `<table>.<owner column> = auth.uid()` |
| It is my dependant's | an active `guardian_link` from `auth.uid()` to the recipient |

`guardian_link` is the **only** path from a user to a recipient (D10).
`recipient.created_by_user_id` exists for audit and **must never appear in a policy**. The
legacy model had two parallel parent→child links, so there were two answers to "may this user
see this child" and they could disagree.

**Plane 2 — back office.** No role column exists anywhere. A back-office capability is a
`permission_grant` row — *this user, this discrete permission, over this scope* — and every
back-office policy predicate is a call to `auth_has_permission()`. Scope widening (§10.4 of
the data model) means a grant at a wider scope satisfies a check at a narrower one:

```
platform   -> everything
city C     -> any kitchen in C, any school in C
kitchen K  -> kitchen K, and any school whose kitchen_id = K
school S   -> school S only
```

That widening is why almost every back-office policy on an order-shaped table is one call at
**school** scope: `auth_can('orders.view', 'school', o.school_id)`. A platform admin, a
city manager, the kitchen that serves the school, and the school itself all resolve through
that single predicate.

**The resting state is deny.** `0001` enables RLS on every table in `public` and `migration`
with no policies at all. If `0002` is missing, delayed, half-applied or rolled back, nobody
can read anything. Every policy added below is an explicit, named, tested exception to that.

---

## 2. Database roles versus personas

These are different things and conflating them is the most common way to misread this
document.

### 2.1 The four Postgres roles that actually exist

| Role | Who it is | RLS |
|---|---|---|
| `anon` | An unauthenticated request to PostgREST — the marketing site, a scraper, anyone with the publishable key | Applies. **Zero policies. Gets nothing, anywhere.** |
| `authenticated` | Any request carrying a valid Supabase Auth JWT — a customer, a kitchen operator, a platform admin. **They are all the same Postgres role.** | Applies. Everything below is a policy `TO authenticated`. |
| `service_role` | An Edge Function using the service key | **Bypasses RLS entirely** (`BYPASSRLS`). No policy constrains it. |
| `postgres` | Migrations, the dashboard | Owns the tables, therefore bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set. |

The consequence that matters: **a kitchen operator and a customer are the same Postgres
role.** The difference between them is entirely in the policy predicate — one matches on
`auth.uid()`, the other on a `permission_grant`. There is no `SET ROLE` anywhere.

The other consequence: **`service_role` is not authorized by RLS.** Anything an Edge Function
does with the service key is authorized only by the code in that Edge Function. That is the
subject of `[AZ-01]` and it is the single biggest decision in this document.

### 2.2 The five personas in the matrix

The task asks for a matrix over Customer, KitchenOperator, SchoolViewer, PlatformAdmin and
anonymous. Those are **role templates** (D11) — bundles that expand into grants at assignment
time. They are not stored on the user. The matrix reads them as shorthand:

| Persona | Means, precisely |
|---|---|
| **anonymous** | The `anon` role. No JWT. |
| **Customer** | `authenticated`, has a live `app_user` row, holds **no** active `permission_grant`. |
| **KitchenOperator** | `authenticated` + grants at `kitchen` scope for `orders.view`, `orders.view_pii`, `orders.mark_delivered`, `orders.cancel`, `menu.view`, `menu.edit`, `dish.edit`, `reports.view`. **Not** `orders.refund`, **not** `orders.view_financials`. |
| **SchoolViewer** | `authenticated` + grants at `school` scope for `reports.view`, `school.view`, `payouts.view`. Nothing else. |
| **PlatformAdmin** | `authenticated` + every permission at `platform` scope. |

Two things follow that the matrix cannot show and this paragraph must:

- **A person can be more than one persona at once.** A kitchen manager who also buys lunch for
  their own child is a Customer *and* a KitchenOperator, and the policies OR together — they
  see their own orders through `customer_user_id = auth.uid()` and their kitchen's orders
  through the grant. This is by design and is why D2 puts the school on the recipient.
- **The personas are not the unit of enforcement; the permissions are.** `delivery_agent`
  (defined, granted to nobody in v1 — E18-14) needs no new policy: it is `orders.view`,
  `orders.view_pii` and `orders.mark_delivered` at `school` scope, which the policies below
  already express. That is the entire payoff of D3.

---

## 3. What RLS can and cannot do

Read this before writing a policy, and before believing a promise made elsewhere in the repo.

**RLS filters rows. It cannot hide a column.** There is no way to write a policy that says
"this user may see the order but not `recipient_name_snapshot`". This directly limits how far
`orders.view_pii` can be enforced in the database — see `[AZ-02]` and §6.

**Policies are permissive and OR together.** Two `SELECT` policies on one table mean a row is
visible if *either* matches. Adding a policy can only ever widen access, never narrow it. A
`RESTRICTIVE` policy ANDs instead, and is used below in exactly one place (the soft-delete
gate).

**A policy with no `TO` clause is granted to `PUBLIC`, which includes `anon`.** This is the
easiest catastrophic mistake available. **Every policy in `0002` must name its role
explicitly** — `TO authenticated` — and Q04's test suite must assert that no policy in
`public` names `anon` or `PUBLIC`.

**`FOR ALL` uses `USING` for both visibility and write-checks.** Avoid it. Write one policy
per command so each is separately named, separately readable and separately testable.

**A view runs with the *owner's* privileges unless created `WITH (security_invoker = true)`.**
Already recorded in `docs/learnings.md` and already applied to `current_consent`. Every view
added by `0002` inherits the rule.

**An invoker-rights function that reads an RLS-protected table returns whatever the caller can
see — including nothing, silently.** `resolve_effective_config()` is `STABLE` and *not*
`SECURITY DEFINER` (deliberately, so it can be inlined). It joins `platform_config`,
`kitchen_config` and `school_config`, none of which a customer may read. Once `0002` is
applied it returns a null row for every customer, with no error. §7.6 fixes this with
`effective_config_public()`; the trap is recorded in `docs/learnings.md`.

**`auth.uid()` is `STABLE`, not `IMMUTABLE`, and is re-evaluated per row unless wrapped.**
Write `(select auth.uid())`, not `auth.uid()`, in every predicate. The scalar subquery is
hoisted to an InitPlan and evaluated once per statement instead of once per row. On the
`order` table this is the difference between a policy that costs nothing and one that costs a
function call per candidate row.

**Any policy that needs to consult the table it is defined on must go through a
`SECURITY DEFINER` helper**, or it recurses. Already recorded for `permission_grant` and
`auth_has_permission()`; §4 applies the same rule to `app_user`, `guardian_link` and
`"order"`.

---

## 4. The helper functions every policy is built from

`0002` opens by defining these. They are the whole vocabulary — no policy below reaches
directly into another table.

Every one is `STABLE`. Every `SECURITY DEFINER` one pins `search_path` (mandatory, or it is a
privilege-escalation vector — `docs/learnings.md`). None of the non-definer ones carry a `SET`
clause, because that would block inlining for no benefit.

```sql
-- ---------------------------------------------------------------------------
-- 4.1 Identity
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER: app_user's own policies call this, so an invoker-rights
-- version would recurse.
create function auth_is_live_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user u
     where u.id = (select auth.uid())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 4.2 The customer plane — guardian_link is the only path (D10)
-- ---------------------------------------------------------------------------

create function auth_can_reach_recipient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.recipient_id = p_recipient
       and gl.user_id      = (select auth.uid())
       and gl.revoked_at is null
       and r.deleted_at is null
  );
$$;

-- Editing details and allergies.
create function auth_can_manage_recipient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.recipient_id = p_recipient
       and gl.user_id      = (select auth.uid())
       and gl.revoked_at is null
       and gl.can_manage
       and r.deleted_at is null
  );
$$;

-- Ordering for them. Used by the checkout Edge Function, not by a policy —
-- order writes are class 3 (§5).
create function auth_can_order_for_recipient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.recipient_id = p_recipient
       and gl.user_id      = (select auth.uid())
       and gl.revoked_at is null
       and gl.can_order
       and r.deleted_at is null
       and r.is_active
  );
$$;

-- "Do I have a live recipient at this school" — the gate on menu visibility.
create function auth_can_reach_school(p_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from guardian_link gl
      join recipient r on r.id = gl.recipient_id
     where gl.user_id = (select auth.uid())
       and gl.revoked_at is null
       and r.deleted_at is null
       and r.is_active
       and r.school_id = p_school
  );
$$;

-- ---------------------------------------------------------------------------
-- 4.3 The back-office plane — thin wrappers over auth_has_permission (0001)
-- ---------------------------------------------------------------------------

create function auth_can(p_permission text, p_scope_type scope_type, p_scope_id uuid)
returns boolean language sql stable as $$
  select auth_has_permission((select auth.uid()), p_permission, p_scope_type, p_scope_id);
$$;

create function auth_can_platform(p_permission text) returns boolean
language sql stable as $$
  select auth_has_permission((select auth.uid()), p_permission, 'platform', null);
$$;

-- "Does the caller hold this permission at ANY live scope." For reference tables
-- where the scope is irrelevant (the reason-code list, the allergen list).
-- SECURITY DEFINER for the same reason auth_has_permission is.
create function auth_has_any_grant(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from permission_grant g join app_user u on u.id = g.user_id
     where g.user_id         = (select auth.uid())
       and g.permission_code = p_permission
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

-- "Is the caller back office at all." Used only to widen reference-data reads.
create function auth_is_back_office() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from permission_grant g join app_user u on u.id = g.user_id
     where g.user_id = (select auth.uid())
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 4.4 Order reachability — SECURITY DEFINER so a child table's policy never
--     depends on the parent's policy having been written correctly. A policy
--     that reads "order" as the invoker would silently inherit "order"'s RLS,
--     which is a correct-by-accident coupling nobody should rely on.
-- ---------------------------------------------------------------------------

create function auth_owns_order(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from "order" o
                  where o.id = p_order and o.customer_user_id = (select auth.uid()));
$$;

create function auth_can_on_order(p_order uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "order" o
     where o.id = p_order
       and auth_has_permission((select auth.uid()), p_permission, 'school', o.school_id));
$$;

create function auth_owns_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from order_group g
                  where g.id = p_group and g.customer_user_id = (select auth.uid()));
$$;

-- A group can span schools (three-level shape, [DM-01]). The permission is
-- required on at least one member order, which is correct: a kitchen that
-- prepares one of the four orders in a checkout legitimately needs to see the
-- payment status of that checkout.
create function auth_can_on_group(p_group uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from "order" o
     where o.order_group_id = p_group
       and auth_has_permission((select auth.uid()), p_permission, 'school', o.school_id));
$$;

-- ---------------------------------------------------------------------------
-- 4.5 Menu reachability for a customer
-- ---------------------------------------------------------------------------

create function auth_customer_can_see_menu(p_menu uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from menu_assignment ma
      join guardian_link  gl on gl.user_id = (select auth.uid()) and gl.revoked_at is null
      join recipient       r on r.id = gl.recipient_id
                            and r.school_id = ma.school_id
                            and r.is_active and r.deleted_at is null
     where ma.menu_id = p_menu
       and ma.revoked_at is null
       and ma.valid_from <= current_date
       and (ma.valid_to is null or ma.valid_to > current_date)
  );
$$;

create function auth_customer_can_see_dish(p_dish uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from menu_item mi
     where mi.dish_id = p_dish
       and mi.is_active
       and auth_customer_can_see_menu(mi.menu_id)
  );
$$;
```

```sql
-- ---------------------------------------------------------------------------
-- 4.6 The remaining reachability helpers, used by exactly one table each.
--     All SECURITY DEFINER, all pinning search_path, all the same shape as
--     4.4: resolve the row to its owning school or kitchen, then delegate to
--     auth_has_permission(). Written out in full in 0002.
-- ---------------------------------------------------------------------------

--  auth_school_is_public(p_school uuid)
--      school is_active, onboarded_at not null, offboarded_at null.
--      Gates school_class / break_time / break_time_class for a parent who is
--      still filling in the add-a-child form and has no guardian_link yet.
--
--  auth_recipient_has_visible_order(p_recipient uuid, p_permission text)
--      exists an "order" for that recipient at a school the caller holds
--      p_permission for. Rule 8 — need-to-know on children's data.
--
--  auth_can_on_menu(p_menu uuid, p_permission text)
--      menu.kitchen_id -> auth_has_permission(..., 'kitchen', kitchen_id).
--      Used by menu_item, menu_assignment.
--
--  auth_can_on_dish(p_dish uuid, p_permission text)
--      dish.kitchen_id -> same. Used by dish_allergen.
--
--  auth_can_on_menu_item(p_menu_item uuid, p_permission text)
--      menu_item -> menu.kitchen_id -> same. Used by menu_item_price_override
--      and menu_item_capacity, neither of which carries a kitchen_id.
--
--  auth_owns_refund(p_refund uuid)          -> refund.order_group_id -> auth_owns_group
--  auth_can_on_refund(p_refund uuid, text)  -> refund.order_group_id -> auth_can_on_group
--  auth_owns_invoice(p_invoice uuid)        -> invoice.order_group_id -> auth_owns_group
--  auth_can_see_report_asset(p_asset uuid)
--      school_report.pdf_asset_id -> auth_can('reports.view','school', school_id).
```

That is **25 functions** in total: 15 in §4.1–§4.5, 9 here, plus `effective_config_public()`
in §7.6. Every one of them is a named, testable unit — which is the point. A policy that
inlines its own `EXISTS` is a policy nobody can assert about in isolation.

**Grants on the helpers.** Every `SECURITY DEFINER` function is a privilege boundary, so
`revoke all ... from public` then `grant execute ... to authenticated, service_role`, exactly
as `0001` already does for `auth_has_permission()`. `anon` gets execute on nothing.

---

## 5. The nine rules that generate every policy

Every policy in §7 is an application of one of these. If a policy in `0002` cannot be
justified by a rule here, it is either a bug or this list is incomplete — and either way it
must be resolved before merge.

**Rule 1 — Deny is the resting state.** RLS is already on for every table (0001 §18). A table
with no policy in §7 is denied to `anon` and to `authenticated`, for every command. That is a
deliberate specification, not an omission, and Q04 asserts it table by table.

**Rule 2 — `anon` gets nothing.** No policy in `public` names `anon` or omits its `TO` clause.
Consequences are handled outside the database — see `[AZ-03]`.

**Rule 3 — Every policy names its command.** `FOR SELECT`, `FOR INSERT`, `FOR UPDATE`,
`FOR DELETE`. Never `FOR ALL`. Every `UPDATE` policy carries both `USING` and `WITH CHECK`,
and they are usually the same expression — omitting `WITH CHECK` lets a user move a row *out*
of their own visibility, which is how "I edited my child's school to yours" becomes possible.

**Rule 4 — Writes are classified, and the class decides who performs them.** A4 says every
backend call goes through the `api/` module and writes go through Edge Functions. It does not
say *which database identity* the Edge Function uses. This document splits writes three ways:

| Class | Tables | Who writes | Why |
|---|---|---|---|
| **1 — customer-owned** | `recipient`, `recipient_allergen`, `guardian_link`, `device_token`, `notification_preference`, `consent_record`, `user_policy_acceptance`, `data_subject_request`, `app_user` (own row) | The **caller** (`authenticated`), constrained by a `WITH CHECK` policy + a column guard trigger (§6) | Every field is one the customer is entitled to choose. RLS is the authorization, so a bug in an Edge Function cannot escalate. |
| **2 — back-office catalogue and configuration** | `dish`, `dish_allergen`, `menu`, `menu_item`, `menu_assignment`, `menu_item_price_override`, `school`, `school_class`, `break_time`, `break_time_class`, `kitchen`, `allergen`, `dish_category`, `asset` | The **caller**, constrained by `WITH CHECK (auth_can(...))` | Same argument. A kitchen operator editing a menu is choosing values they are entitled to choose. |
| **3 — money, order state, access control, evidence** | `order_group`, `"order"`, `order_line`, `order_event`, `payment`, `payment_webhook_event`, `refund`, `refund_line`, `ledger_*`, `wallet_balance`, `invoice*`, `payout*`, `permission_grant`, `permission`, `role_template*`, `platform_config`, `kitchen_config`, `school_config`, `config_change_log`, `policy_document`, `policy_version`, `consent_purpose`, `retention_policy`, `purge_run`, `audit_log`, `idempotency_key`, `school_report`, `notification_delivery`, `school_menu_version`, `menu_item_capacity`, `invoice_sequence`, `reason_code` | **`service_role` only.** No write policy exists for `authenticated` at all | Every one of these has at least one field whose value must be *computed* rather than *supplied*: a total, a tax split, a status transition, an invoice number, a grant. RLS cannot constrain a column, so a write policy here would let a customer insert an order with `total_paise = 0`. |

  Class 3 is where "default deny" does the work: there is no policy to get wrong, and the
  test is "`authenticated` cannot insert, ever".

  `[AZ-01]` records the alternative (everything through `service_role`) and why it is worse.

**Rule 5 — A soft-deleted or disabled user has no access.** `auth_has_permission()` already
checks `is_disabled` and `deleted_at` for the back-office plane. The customer plane needs the
same, and gets it from a **restrictive** policy applied to every table that carries a customer
policy:

```sql
create policy deny_dead_accounts on <table>
  as restrictive for all to authenticated
  using (auth_is_live_user());
```

Restrictive, so it ANDs with everything else and cannot be defeated by adding a permissive
policy later. This is the only restrictive policy in the schema and it is why "account
deletion stops access immediately" (§13.4, D15) is true rather than aspirational.

**Rule 6 — Soft-deleted rows are invisible.** Every customer-facing predicate on a table with
`deleted_at` includes `deleted_at is null`. Back-office policies do **not**: a platform admin
investigating an erasure request must be able to see that the row exists.

**Rule 7 — Back-office order access is checked at `school` scope.** Not kitchen, not city.
Scope widening resolves platform, city and kitchen grants through the same predicate, and
`"order"` carries `school_id` denormalised precisely so the check is a column compare.

**Rule 8 — Need-to-know beats scope on children's data.** A grant of `orders.view_pii` at
school scope does **not** open every `recipient` row at that school. It opens the recipients
who have an order the grantee can already see. §7.2 states this as a deliberate tightening of
§13.7 of the data model.

**Rule 9 — Impersonation is never a JWT.** `users.impersonate` (E10-13) must be implemented as
an Edge Function that acts with `service_role` and writes `audit_log.impersonated_user_id` on
every call. Minting or borrowing a customer's JWT would make the audit trail a lie and would
make every policy in this document unable to tell the difference. View-as-user is never
silent, and never invisible to the policies.

---

## 6. The column problem, and the guard triggers that solve it

RLS filters rows. Three requirements in this repo are column-level, and each needs a
different answer.

### 6.1 Customers must not edit their own privileged columns

A class-1 `UPDATE` policy lets a customer update their own `app_user` row. It cannot stop them
setting `is_disabled = false` after an admin disabled them, or clearing `deleted_at`, or
rewriting `phone_e164` without re-verifying by OTP.

**Answer: a `BEFORE UPDATE` guard trigger per class-1 table**, rejecting any change to a named
protected column unless the caller holds the matching permission. These are exhaustive:

| Table | Protected columns | Released by |
|---|---|---|
| `app_user` | `id`, `phone_e164`, `phone_verified_at`, `email_verified_at`, `is_disabled`, `disabled_reason`, `deleted_at`, `anonymised_at`, `migration_source`, `claimed_at`, `legacy_bubble_id` | `users.manage` at platform, or `service_role` |
| `recipient` | `is_self`, `created_by_user_id`, `deleted_at`, `anonymised_at`, `legacy_bubble_id` | `service_role` |
| `guardian_link` | `recipient_id`, `user_id`, `created_by_user_id` | `service_role` |
| `data_subject_request` | `status`, `due_at`, `assigned_to_user_id`, `completed_at`, `resolution_note` | `consent.view` + `users.manage` at platform, or `service_role` |

`device_token` and `notification_preference` have no protected columns — every field is the
user's to set.

The guard is a trigger and not a policy on purpose: it fires for `service_role` too unless the
trigger explicitly exempts it, which makes the exemption a visible, greppable decision rather
than an accident of which key the caller used.

### 6.2 `orders.view_pii` cannot be enforced by RLS — `[AZ-02]`

`orders.view_pii` is meant to be separable from `orders.view`, so that E20-09's future analyst
grant can see orders without children's names. Those names are columns on `"order"`
(`recipient_name_snapshot`, `class_label_snapshot`, `section_label_snapshot`) and on
`recipient`. No policy can hide them from someone who can see the row.

**Written as:** in v1, `orders.view` at a scope grants row access including the tier-P
snapshot columns; `orders.view_pii` is enforced by the `api/` layer and by which UI is served.
**This is safe in v1 and only in v1**, because every template that holds `orders.view`
(`kitchen_operator`, `delivery_agent`, `platform_admin`) also holds `orders.view_pii`, and the
one that holds neither (`school_viewer`) sees no orders at all. The gap is currently
theoretical.

**It stops being theoretical the moment a grant of `orders.view` without `orders.view_pii` is
issued.** The recommended fix, and the options, are in `[AZ-02]`.

### 6.3 A school must not see internal commentary on its own payout — `[AZ-04]`

Same shape: `payout.notes` and `payout.adjustment_paise` sit on a row a school-scoped
`payouts.view` grant can read. Written as: schools see `payout` rows at status `confirmed` or
`paid` only, never `draft`, and `notes` is treated by rule as school-visible text. `[AZ-04]`
asks Andy whether that is the commercial relationship he wants.

---

## 7. Per-table specification

Notation: policies are named `<table>_<persona>_<command>`. Every one is `to authenticated`.
Rule 5's restrictive `deny_dead_accounts` policy is assumed present on every table listed here
that has a customer policy, and is not repeated.

### 7.1 Reference and geography

#### `city`
Read by any live user — the school picker groups schools by city. No PII.

```sql
create policy city_read_all on city for select to authenticated
  using (auth_is_live_user() and (is_active or auth_is_back_office()));
```
Write: class 3. Cities are created by migration and by platform admin through an Edge
Function.

#### `dish_category`, `allergen`
Read by any live user. The allergen list is needed client-side to render the add-to-cart
warning (E05-05) and to let a parent record a child's allergies.

```sql
create policy dish_category_read_all on dish_category for select to authenticated
  using (auth_is_live_user());
create policy allergen_read_all on allergen for select to authenticated
  using (auth_is_live_user());
```
Write: class 2, gated on `dish.edit` at any scope — the allergen and category vocabularies are
platform-wide, so the check is `auth_can_platform('dish.edit')`.

#### `reason_code`
Split. Customers see only what is meant for them; back office sees the working vocabulary.

```sql
create policy reason_code_read_customer on reason_code for select to authenticated
  using (auth_is_live_user() and is_active and is_customer_visible);

create policy reason_code_read_backoffice on reason_code for select to authenticated
  using (auth_has_any_grant('orders.cancel')
      or auth_has_any_grant('orders.refund')
      or auth_can_platform('audit.view'));
```
Write: class 3 (`config.platform_edit`). `[DM-22]` decides which codes are customer-visible;
this policy is what makes that flag mean something.

#### `asset`
Four kinds, three audiences.

```sql
-- Images. No PII, and the dish-image bucket is public anyway.
create policy asset_read_images on asset for select to authenticated
  using (auth_is_live_user() and kind in ('dish_image','category_image') and deleted_at is null);

create policy asset_read_invoice_pdf on asset for select to authenticated
  using (kind = 'invoice_pdf' and auth_can_platform('invoices.view'));

create policy asset_read_report_pdf on asset for select to authenticated
  using (kind = 'report_pdf' and auth_can_see_report_asset(id));

create policy asset_read_import_file on asset for select to authenticated
  using (kind = 'import_file' and auth_has_any_grant('menu.import'));
```

`auth_can_see_report_asset(uuid)` is a `SECURITY DEFINER` helper resolving
`school_report.pdf_asset_id → school_report.school_id → auth_can('reports.view','school',…)`.

A **customer never reads an `asset` row for their invoice.** The bucket is private, so
bucket/path is useless without a signature; the invoice PDF reaches them as a signed URL
minted by an Edge Function after it has checked `auth_owns_group()`. §11.

Write: class 2 for images, class 3 for PDFs and import files. `asset` carries no `kitchen_id`,
so the image write check is `auth_has_any_grant('dish.edit')` — scope is not expressible here
and an image is not scoped data.

### 7.2 Identity and people

#### `app_user`

```sql
create policy app_user_read_self on app_user for select to authenticated
  using (id = (select auth.uid()));

create policy app_user_read_admin on app_user for select to authenticated
  using (auth_can_platform('users.view'));

create policy app_user_update_self on app_user for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null)
  with check (id = (select auth.uid()));
```
Plus the §6.1 guard trigger. No `INSERT` policy: the row is created by the signup Edge
Function alongside the `auth.users` row, and by migration.

> **KitchenOperator gets nothing here, deliberately.** §13.3 rule 4 says kitchen staff need no
> tier A data beyond the last four digits of a phone number for the E09-07 fallback search.
> That search must therefore be an **Edge Function** that takes four digits and returns
> matching *orders*, never a table read. If `app_user` is ever opened to kitchen scope, rule 4
> is broken and E20-09 fails.

#### `recipient` — tier P, and `allergy_note` is tier S

```sql
create policy recipient_read_guardian on recipient for select to authenticated
  using (auth_can_reach_recipient(id) and deleted_at is null);

create policy recipient_insert_guardian on recipient for insert to authenticated
  with check (auth_is_live_user());   -- the guardian_link written in the same
                                      -- transaction is what makes it theirs;
                                      -- the deferred constraint trigger in 0001
                                      -- rejects a recipient with no live link

create policy recipient_update_guardian on recipient for update to authenticated
  using (auth_can_manage_recipient(id) and deleted_at is null)
  with check (auth_can_manage_recipient(id));

-- Need-to-know, not scope (Rule 8).
create policy recipient_read_fulfilment on recipient for select to authenticated
  using (auth_recipient_has_visible_order(id, 'orders.view_pii'));

create policy recipient_read_admin on recipient for select to authenticated
  using (auth_can_platform('users.view'));
```

> **Tightening of `docs/data-model.md` §13.7.** The data model says recipients are reached in
> back office by "`orders.view_pii` scoped to the school/kitchen". Taken literally that opens
> every enrolled child at a school to anyone with the grant, including children who have never
> ordered. `auth_recipient_has_visible_order(p_recipient, p_permission)` is a `SECURITY
> DEFINER` helper returning true only where an `"order"` row exists for that recipient at a
> school the caller holds the permission for. Kitchen staff get exactly the children they are
> cooking for. This is narrower than §13.7, never wider, and is recorded here rather than
> changed silently.

No `DELETE` policy. Removing a child is a soft delete performed by an Edge Function, because
`recipient` is referenced by orders and invoices (§13.4, D15).

#### `guardian_link`

```sql
create policy guardian_link_read_self on guardian_link for select to authenticated
  using (user_id = (select auth.uid()));

-- Co-guardians. See [AZ-05].
create policy guardian_link_read_co_guardian on guardian_link for select to authenticated
  using (auth_can_reach_recipient(recipient_id));

create policy guardian_link_insert_manager on guardian_link for insert to authenticated
  with check (auth_can_manage_recipient(recipient_id));

-- Revocation is an UPDATE (links are revoked, never deleted).
create policy guardian_link_update_manager on guardian_link for update to authenticated
  using (auth_can_manage_recipient(recipient_id))
  with check (auth_can_manage_recipient(recipient_id));

create policy guardian_link_read_admin on guardian_link for select to authenticated
  using (auth_can_platform('users.view'));
```
Plus the §6.1 guard trigger — `recipient_id` and `user_id` are immutable, or a manager could
re-point a link at someone else's child.

No back-office read below platform. A kitchen operator has no business knowing who a child's
parents are.

#### `recipient_allergen` — tier S, the most sensitive table in the system

```sql
create policy recipient_allergen_read_guardian on recipient_allergen for select to authenticated
  using (auth_can_reach_recipient(recipient_id));

create policy recipient_allergen_write_guardian on recipient_allergen for insert to authenticated
  with check (auth_can_manage_recipient(recipient_id));
create policy recipient_allergen_update_guardian on recipient_allergen for update to authenticated
  using (auth_can_manage_recipient(recipient_id))
  with check (auth_can_manage_recipient(recipient_id));
create policy recipient_allergen_delete_guardian on recipient_allergen for delete to authenticated
  using (auth_can_manage_recipient(recipient_id));

-- Fulfilment. A kitchen must not send a peanut dish to an allergic child.
create policy recipient_allergen_read_fulfilment on recipient_allergen for select to authenticated
  using (auth_recipient_has_visible_order(recipient_id, 'orders.view_pii'));
```

`DELETE` is permitted here and nowhere else in the customer plane, because §13.4 says a
child's health data is deleted outright on erasure — there is no statutory reason to retain
it.

**PlatformAdmin has no read policy on this table.** `users.view` does not open it and
`consent.view` does not open it. Reading a child's health record requires `service_role`
through a named, audited Edge Function. If that turns out to be operationally impossible, it
becomes a new permission (`recipient.view_health`) rather than a widening of `users.view`.

### 7.3 Organisations

#### `school`

```sql
-- The picker (P1: attendance is self-declared, so every onboarded school is offered).
create policy school_read_picker on school for select to authenticated
  using (auth_is_live_user()
         and is_active and onboarded_at is not null and offboarded_at is null);

create policy school_read_backoffice on school for select to authenticated
  using (auth_can('school.view', 'school', id) or auth_can('orders.view', 'school', id));

create policy school_update_backoffice on school for update to authenticated
  using (auth_can('school.edit', 'school', id))
  with check (auth_can('school.edit', 'school', id));
```
`INSERT` is class 3 — `school.onboard` is platform-only and creating a school also creates its
`school_menu_version` row and its config.

#### `kitchen`

```sql
create policy kitchen_read_backoffice on kitchen for select to authenticated
  using (auth_can('kitchen.view', 'kitchen', id));
create policy kitchen_update_backoffice on kitchen for update to authenticated
  using (auth_can('kitchen.edit', 'kitchen', id))
  with check (auth_can('kitchen.edit', 'kitchen', id));
```
No customer access. The app never displays which kitchen cooks the food.

#### `school_class`, `break_time`, `break_time_class`

Readable by any live user for a school in the picker. This is deliberate and solves a
chicken-and-egg: a parent must choose a class *while creating the recipient*, before any
`guardian_link` exists, so a policy keyed on `auth_can_reach_school()` would make the form
unfillable. Class labels and break times are not personal data.

```sql
create policy school_class_read_all on school_class for select to authenticated
  using (auth_is_live_user() and is_active and auth_school_is_public(school_id));

create policy break_time_read_all on break_time for select to authenticated
  using (auth_is_live_user() and is_active and auth_school_is_public(school_id));

-- Empty in v1; readable alongside break_time so switching E05-06 on is data, not a
-- policy change nothing would have caught.
create policy break_time_class_read_all on break_time_class for select to authenticated
  using (auth_is_live_user()
         and exists (select 1 from break_time bt
                      where bt.id = break_time_id and auth_school_is_public(bt.school_id)));

create policy school_class_read_backoffice on school_class for select to authenticated
  using (auth_can('school.view', 'school', school_id)
      or auth_can('orders.view', 'school', school_id));
create policy break_time_read_backoffice on break_time for select to authenticated
  using (auth_can('school.view', 'school', school_id)
      or auth_can('orders.view', 'school', school_id));
```
`auth_school_is_public(uuid)` is a `SECURITY DEFINER` helper: active, onboarded, not
offboarded. Writes are class 2 under `school.edit`.

> **`orders.view` is in those predicates on purpose.** The `kitchen_operator` template holds
> `orders.view` but **not** `school.view`, and the packing list (E09-03) groups by class and by
> break — so a policy keyed on `school.view` alone would leave a kitchen operator unable to read
> the class list and break times for the orders they are packing. See the note at the end of
> §7.3 about what else that template is missing.

> **Finding — the `kitchen_operator` seed template is probably missing `kitchen.view`.**
> The template seeded in `0001` is `orders.view`, `orders.view_pii`, `orders.mark_delivered`,
> `orders.cancel`, `menu.view`, `menu.edit`, `dish.edit`, `reports.view`. It contains neither
> `kitchen.view` nor `school.view`, so under the policies above a kitchen operator **cannot read
> the `kitchen` row for their own kitchen**, and reaches `school`, `school_class` and
> `break_time` only through the `orders.view` disjunct added above. That is workable but
> accidental. This is seed *data*, not schema (D11), so it is a one-row insert to fix and needs
> no migration — but somebody should decide it rather than discover it. Raised for E10-02.
> It is **not** an `[AZ-nn]`: nothing about the model is open, the seed row is just probably
> wrong.

### 7.4 Menu

The customer's view of the menu is: **the dishes on the menu currently assigned to a school
where I have a live recipient.** Everything below is that sentence in SQL.

```sql
create policy menu_read_customer on menu for select to authenticated
  using (status = 'active' and auth_customer_can_see_menu(id));

create policy menu_item_read_customer on menu_item for select to authenticated
  using (is_active and auth_customer_can_see_menu(menu_id));

create policy dish_read_customer on dish for select to authenticated
  using (is_active and auth_customer_can_see_dish(id));

create policy dish_allergen_read_customer on dish_allergen for select to authenticated
  using (auth_customer_can_see_dish(dish_id));

create policy menu_assignment_read_customer on menu_assignment for select to authenticated
  using (revoked_at is null and auth_can_reach_school(school_id));

-- Without this the app reads the base price and shows the wrong number at a school
-- with an override. Scoped, because one school's negotiated price is not another's
-- business.
create policy menu_item_price_override_read_customer on menu_item_price_override
  for select to authenticated using (auth_can_reach_school(school_id));

create policy school_menu_version_read_customer on school_menu_version
  for select to authenticated using (auth_can_reach_school(school_id));
```

Back office, all keyed on the owning kitchen except the two school-keyed tables:

```sql
create policy menu_read_backoffice on menu for select to authenticated
  using (auth_can('menu.view', 'kitchen', kitchen_id));
create policy menu_write_backoffice on menu for insert to authenticated
  with check (auth_can('menu.edit', 'kitchen', kitchen_id));
create policy menu_update_backoffice on menu for update to authenticated
  using (auth_can('menu.edit', 'kitchen', kitchen_id))
  with check (auth_can('menu.edit', 'kitchen', kitchen_id));

create policy dish_read_backoffice on dish for select to authenticated
  using (auth_can('menu.view', 'kitchen', kitchen_id));
create policy dish_write_backoffice on dish for insert to authenticated
  with check (auth_can('dish.edit', 'kitchen', kitchen_id));
create policy dish_update_backoffice on dish for update to authenticated
  using (auth_can('dish.edit', 'kitchen', kitchen_id))
  with check (auth_can('dish.edit', 'kitchen', kitchen_id));

-- menu_item, dish_allergen: same shape, resolved through the parent's kitchen_id
-- by a SECURITY DEFINER helper (auth_can_on_menu / auth_can_on_dish).

create policy menu_assignment_read_backoffice on menu_assignment for select to authenticated
  using (auth_can('school.view', 'school', school_id) or auth_can_on_menu(menu_id, 'menu.view'));
create policy menu_assignment_write_backoffice on menu_assignment for insert to authenticated
  with check (auth_can_platform('menu.publish'));

create policy menu_item_price_override_read_backoffice on menu_item_price_override
  for select to authenticated
  using (auth_can_on_menu_item(menu_item_id, 'menu.view'));
create policy menu_item_price_override_write_backoffice on menu_item_price_override
  for insert to authenticated
  with check (auth_can_on_menu_item(menu_item_id, 'menu.edit'));
create policy menu_item_price_override_update_backoffice on menu_item_price_override
  for update to authenticated
  using (auth_can_on_menu_item(menu_item_id, 'menu.edit'))
  with check (auth_can_on_menu_item(menu_item_id, 'menu.edit'));

create policy menu_item_capacity_read_backoffice on menu_item_capacity
  for select to authenticated
  using (auth_can_on_menu_item(menu_item_id, 'menu.view'));
```

> **`menu.publish` is checked at platform, not kitchen, for `menu_assignment`.** Assigning a
> menu to a school decides what a school's parents are charged. `menu.publish` is valid at
> kitchen scope for flipping a menu to `active`; deciding *which school sees it* stays with
> platform in v1. If a kitchen should own its own assignments, that is a one-line change and a
> deliberate one.

`menu_item_capacity` — designed, unused (P3, E02-12). Write is class 3; nothing writes in v1.
**A customer cannot read it**, which means "sold out" is not expressible client-side until
E18-12 adds a policy — noted so it is a known gap rather than a surprise.

```sql
create policy school_menu_version_read_backoffice on school_menu_version
  for select to authenticated
  using (auth_can('school.view', 'school', school_id)
      or auth_can('orders.view', 'school', school_id));
```

### 7.5 Ordering

The hottest policies in the system. Both predicates are column compares on the row itself,
which is exactly why `"order"` denormalises `customer_user_id` and `school_id` from its parent.

```sql
-- order_group
create policy order_group_read_customer on order_group for select to authenticated
  using (customer_user_id = (select auth.uid()));
create policy order_group_read_backoffice on order_group for select to authenticated
  using (auth_can_on_group(id, 'orders.view'));

-- "order"
create policy order_read_customer on "order" for select to authenticated
  using (customer_user_id = (select auth.uid()));
create policy order_read_backoffice on "order" for select to authenticated
  using (auth_can('orders.view', 'school', school_id));

-- order_line
create policy order_line_read_customer on order_line for select to authenticated
  using (auth_owns_order(order_id));
create policy order_line_read_backoffice on order_line for select to authenticated
  using (auth_can_on_order(order_id, 'orders.view'));

-- order_event: back office only.
create policy order_event_read_backoffice on order_event for select to authenticated
  using (auth_can_on_order(order_id, 'orders.view'));
```

**No write policy on any of these four.** Class 3. Order creation, status transitions,
delivery marking, cancellation and refund are all Edge Functions running as `service_role`,
each of which checks `auth_can_order_for_recipient()` or `auth_can(...)` explicitly before it
writes, and each of which is covered by the Q04 suite. The reason is Rule 4: an `INSERT`
policy on `"order"` would let a customer supply `total_paise`.

**`order_event` is invisible to customers** — `[AZ-06]`. The table carries `note` and
`metadata` written by staff and by the payment provider, and `reason_code.is_customer_visible`
exists precisely because not every reason is for the parent. The customer-facing timeline is
built from `"order"`'s own timestamp columns plus `cancel_reason_code` joined to the
customer-visible subset of `reason_code`.

### 7.6 Configuration

Config is **not** readable by customers or by kitchen staff. `school_config.revenue_share_bps`
is commercially sensitive (M4) and it is a column on the same row as the cutoff time, which
everyone needs. Rather than fight §6's column problem again, the resolved, customer-safe
subset is exposed through one function.

```sql
create policy platform_config_read on platform_config for select to authenticated
  using (auth_can_platform('config.platform_edit'));
create policy kitchen_config_read on kitchen_config for select to authenticated
  using (auth_can_platform('kitchen.config_edit'));
create policy school_config_read on school_config for select to authenticated
  using (auth_can_platform('school.config_edit'));
create policy config_change_log_read on config_change_log for select to authenticated
  using (auth_can_platform('audit.view'));
```
All writes class 3.

```sql
-- The customer-safe resolved config. SECURITY DEFINER because
-- resolve_effective_config() is invoker-rights by design and would return a null
-- row for every customer once RLS is on — silently.
--
-- Deliberately omits revenue_share_bps and sac_code. Everything else on
-- effective_config is either statutory (the tax rates, which the cart must show)
-- or a rule the app has to render.
create function effective_config_public(p_school_id uuid)
returns table (
  timezone text, order_cutoff_time time, order_cutoff_days_before smallint,
  max_advance_order_days smallint, min_advance_order_days smallint,
  default_delivery_mode delivery_mode, allow_classroom_delivery boolean,
  allow_counter_pickup boolean, pickup_code_enabled boolean,
  price_is_tax_inclusive boolean, cgst_rate_bps integer, sgst_rate_bps integer,
  igst_rate_bps integer, refund_default_destination refund_destination,
  wallet_at_checkout_enabled boolean, allergen_warning_enabled boolean,
  customer_cancellation_allowed boolean, customer_cancellation_cutoff_minutes integer
)
language sql stable security definer set search_path = public as $$
  select c.timezone, c.order_cutoff_time, c.order_cutoff_days_before,
         c.max_advance_order_days, c.min_advance_order_days,
         c.default_delivery_mode, c.allow_classroom_delivery,
         c.allow_counter_pickup, c.pickup_code_enabled,
         c.price_is_tax_inclusive, c.cgst_rate_bps, c.sgst_rate_bps,
         c.igst_rate_bps, c.refund_default_destination,
         c.wallet_at_checkout_enabled, c.allergen_warning_enabled,
         c.customer_cancellation_allowed, c.customer_cancellation_cutoff_minutes
    from resolve_effective_config(p_school_id) c
   where auth_can_reach_school(p_school_id)
      or auth_school_is_public(p_school_id)
      or auth_can('orders.view', 'school', p_school_id);
$$;
```

`[DM-20]` interacts with this: `price_is_tax_inclusive` is `NULL` until Andy answers, and this
function will faithfully return `NULL`. The client must treat a null there as "tax display
unavailable", not as `false`.

### 7.7 Money

Nothing in this section is writable by `authenticated`. All of it is class 3.

```sql
-- payment
create policy payment_read_customer on payment for select to authenticated
  using (auth_owns_group(order_group_id));
create policy payment_read_backoffice on payment for select to authenticated
  using (auth_can_on_group(order_group_id, 'orders.view_financials'));

-- refund / refund_line
create policy refund_read_customer on refund for select to authenticated
  using (auth_owns_group(order_group_id));
create policy refund_read_backoffice on refund for select to authenticated
  using (auth_can_on_group(order_group_id, 'orders.view_financials')
      or auth_can_on_group(order_group_id, 'orders.refund'));
create policy refund_line_read_customer on refund_line for select to authenticated
  using (auth_owns_refund(refund_id));
create policy refund_line_read_backoffice on refund_line for select to authenticated
  using (auth_can_on_refund(refund_id, 'orders.view_financials'));

-- invoice / invoice_line
create policy invoice_read_customer on invoice for select to authenticated
  using (auth_owns_group(order_group_id));
create policy invoice_read_admin on invoice for select to authenticated
  using (auth_can_platform('invoices.view'));
create policy invoice_line_read_customer on invoice_line for select to authenticated
  using (auth_owns_invoice(invoice_id));
create policy invoice_line_read_admin on invoice_line for select to authenticated
  using (auth_can_platform('invoices.view'));

-- wallet_balance: own row only.
create policy wallet_balance_read_self on wallet_balance for select to authenticated
  using (user_id = (select auth.uid()));
create policy wallet_balance_read_admin on wallet_balance for select to authenticated
  using (auth_can_platform('orders.view_financials'));

-- The ledger. No customer access at all (§13.7). Platform financials only.
create policy ledger_account_read_admin on ledger_account for select to authenticated
  using (auth_can_platform('orders.view_financials'));
create policy ledger_transaction_read_admin on ledger_transaction for select to authenticated
  using (auth_can_platform('orders.view_financials'));
create policy ledger_entry_read_admin on ledger_entry for select to authenticated
  using (auth_can_platform('orders.view_financials'));

-- payout
create policy payout_read_admin on payout for select to authenticated
  using (auth_can_platform('payouts.view'));
create policy payout_read_school on payout for select to authenticated
  using (payee_type = 'school'
         and status in ('confirmed', 'paid')            -- [AZ-04]
         and auth_can('payouts.view', 'school', payee_id));
create policy payout_line_read_admin on payout_line for select to authenticated
  using (auth_can_platform('payouts.view'));

-- payment_webhook_event: support and reconciliation only.
create policy payment_webhook_event_read_admin on payment_webhook_event
  for select to authenticated using (auth_can_platform('orders.view_financials'));
```

**`invoice_sequence` and `idempotency_key` have no policies at all.** The first is a counter
whose only correct reader is the transaction allocating a number (D14); the second holds
replayed response bodies that may contain the caller's own data and nobody else's business.
`service_role` only, permanently.

**`payout_line` is not opened to school scope**, even though `payout` is. A payout line names
an `order_id` and its share, which is order-level detail; E11-03 and §13.3 rule 5 say a school
gets aggregates. `[AZ-04]`.

> **`wallet_balance` and §13.7.** The data model says the wallet balance is "read through a
> function". Allowing a direct `SELECT` on the caller's own single row is equivalent and
> simpler — the row contains a user id, a paise integer and a ledger pointer, and nothing
> else. The `api/` module still exposes it as one call. Recorded here so it is not a silent
> divergence.

### 7.8 Permissions and grants

```sql
-- A back-office user may see their own access. Nothing else.
create policy permission_grant_read_self on permission_grant for select to authenticated
  using (user_id = (select auth.uid()));
create policy permission_grant_read_admin on permission_grant for select to authenticated
  using (auth_can_platform('grants.manage'));

create policy permission_read_admin on permission for select to authenticated
  using (auth_can_platform('grants.manage'));
create policy role_template_read_admin on role_template for select to authenticated
  using (auth_can_platform('grants.manage'));
create policy role_template_permission_read_admin on role_template_permission
  for select to authenticated using (auth_can_platform('grants.manage'));
```

**No write policy on `permission_grant`, ever.** Granting and revoking is class 3: an Edge
Function running as `service_role` that checks `grants.manage` at platform, writes the grant,
and writes an `audit_log` row in the same transaction. A write policy here would mean the only
thing between a compromised session and self-granting `orders.refund` is a `WITH CHECK`
expression, and the recursion hazard (`docs/learnings.md`) makes that expression harder to
reason about than the Edge Function.

These are the tables where a mistake is unrecoverable, so they get the most conservative
treatment in the schema.

### 7.9 Policy, consent and data-subject rights

```sql
create policy policy_document_read_all on policy_document for select to authenticated
  using (auth_is_live_user());

create policy policy_version_read_published on policy_version for select to authenticated
  using (auth_is_live_user() and published_at is not null);
create policy policy_version_read_admin on policy_version for select to authenticated
  using (auth_can_platform('config.platform_edit'));

create policy consent_purpose_read_all on consent_purpose for select to authenticated
  using (auth_is_live_user() and is_active);

-- Append-only. UPDATE and DELETE are already revoked at the privilege level and
-- blocked by trigger (0001 §16); there is deliberately no policy for them either.
create policy user_policy_acceptance_read_self on user_policy_acceptance
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_policy_acceptance_insert_self on user_policy_acceptance
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_policy_acceptance_read_admin on user_policy_acceptance
  for select to authenticated using (auth_can_platform('consent.view'));

create policy consent_record_read_self on consent_record for select to authenticated
  using (user_id = (select auth.uid()));
create policy consent_record_insert_self on consent_record for insert to authenticated
  with check (user_id = (select auth.uid())
              and (subject_type = 'user' and subject_id = (select auth.uid())
                   or subject_type = 'recipient' and auth_can_manage_recipient(subject_id)));
create policy consent_record_read_admin on consent_record for select to authenticated
  using (auth_can_platform('consent.view'));

create policy dsr_read_self on data_subject_request for select to authenticated
  using (user_id = (select auth.uid()));
create policy dsr_insert_self on data_subject_request for insert to authenticated
  with check (user_id = (select auth.uid())
              and (subject_recipient_id is null
                   or auth_can_manage_recipient(subject_recipient_id)));
create policy dsr_read_admin on data_subject_request for select to authenticated
  using (auth_can_platform('consent.view'));
create policy dsr_update_admin on data_subject_request for update to authenticated
  using (auth_can_platform('consent.view'))
  with check (auth_can_platform('consent.view'));
```

The `WITH CHECK` on `consent_record` is the load-bearing one: it makes it structurally
impossible to record consent *about* a child you have no `guardian_link` to. That is the
DPDP-relevant property, and it is a database constraint rather than an Edge Function
convention.

`current_consent` (the view) inherits `consent_record`'s policies, because it was created
`WITH (security_invoker = true)`. Q04 must assert that for every view in `public`.

`retention_policy` and `purge_run`: read on `auth_can_platform('audit.view')`, writes class 3.

### 7.10 Operational

```sql
create policy device_token_rw_self on device_token for select to authenticated
  using (user_id = (select auth.uid()));
create policy device_token_insert_self on device_token for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy device_token_update_self on device_token for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy device_token_delete_self on device_token for delete to authenticated
  using (user_id = (select auth.uid()));

-- notification_preference: identical four policies on user_id.

create policy notification_delivery_read_self on notification_delivery
  for select to authenticated using (user_id = (select auth.uid()));
create policy notification_delivery_read_admin on notification_delivery
  for select to authenticated using (auth_can_platform('audit.view'));

create policy school_report_read_backoffice on school_report for select to authenticated
  using (auth_can('reports.view', 'school', school_id));

create policy audit_log_read_admin on audit_log for select to authenticated
  using (auth_can_platform('audit.view'));
```

`school_report` is the SchoolViewer's entire world, and it is aggregates only — the table has
no `recipient_id` and nothing it references does (E11-03, E20-09). The absence is the control.

`notification_delivery` is safe for a customer to read because the schema forbids storing the
rendered body: a push saying "Aarav's lunch has been delivered" contains a child's name, so
only `template_code` and non-PII parameters are stored.

### 7.11 The `migration` schema

`legacy_id_map`, `migration_review`, `break_time_legacy_map`, `wallet_opening_balance`.

**No policies. None. Ever.** `0001` already revokes `USAGE` on the schema from `anon` and
`authenticated`, and RLS is on with nothing to permit. The migration schema is for the
migration tooling and for humans resolving conflicts, and it is dropped wholesale after
cutover. Q04 asserts that `authenticated` cannot even see the schema.

---

## 8. The full matrix

Read/write per persona. `service_role` bypasses RLS and is therefore not a column — the
"Writes" column of §5 Rule 4 is its specification.

Legend — **R** read, **W** write (insert/update as specified in §7), scope suffix:
`own` = rows keyed to `auth.uid()`; `kin` = via an active `guardian_link`;
`sch` = within a granted school scope (widened per §10.4); `kit` = within a granted kitchen
scope; `pub` = the publicly-listed subset; `all` = unrestricted; `—` = no access;
`sys` = `service_role` only.

| # | Table | anonymous | Customer | KitchenOperator | SchoolViewer | PlatformAdmin |
|---|---|---|---|---|---|---|
| 1 | `city` | — | R active | R active | R active | R all / W sys |
| 2 | `app_user` | — | R own, W own | — | — | R all, W `users.manage` |
| 3 | `asset` | — | R images | R images, W images | R own report PDFs | R all, W images |
| 4 | `dish_category` | — | R all | R all | R all | R/W all |
| 5 | `allergen` | — | R all | R all | R all | R/W all |
| 6 | `reason_code` | — | R customer-visible | R all | R customer-visible | R all / W sys |
| 7 | `kitchen` | — | — | — (see §7.3 finding) | — | R/W all |
| 8 | `school` | — | R pub | R sch | R sch | R/W all |
| 9 | `school_class` | — | R pub | R sch | R sch | R/W all |
| 10 | `break_time` | — | R pub | R sch | R sch | R/W all |
| 11 | `break_time_class` | — | R pub | R sch | R sch | R/W all |
| 12 | `recipient` | — | R kin, W kin | R fulfilment (§7.2) | — | R all (`users.view`) / W sys |
| 13 | `guardian_link` | — | R own + kin, W kin | — | — | R all / W sys |
| 14 | `recipient_allergen` | — | R kin, W kin | R fulfilment | — | — (sys only) |
| 15 | `dish` | — | R assigned | R kit, W kit | — | R/W all |
| 16 | `dish_allergen` | — | R assigned | R kit, W kit | — | R/W all |
| 17 | `menu` | — | R assigned active | R kit, W kit | — | R/W all |
| 18 | `menu_item` | — | R assigned active | R kit, W kit | — | R/W all |
| 19 | `menu_assignment` | — | R own schools | R kit (read only) | R sch | R all, W all |
| 20 | `menu_item_price_override` | — | R own schools | R/W kit | — | R/W all |
| 21 | `menu_item_capacity` | — | — | R kit | — | R all / W sys |
| 22 | `school_menu_version` | — | R own schools | R sch | R sch | R all / W sys |
| 23 | `platform_config` | — | — (via function) | — (via function) | — | R/W `config.platform_edit` |
| 24 | `kitchen_config` | — | — | — | — | R/W `kitchen.config_edit` |
| 25 | `school_config` | — | — | — | — | R/W `school.config_edit` |
| 26 | `config_change_log` | — | — | — | — | R `audit.view` / W sys |
| 27 | `order_group` | — | R own | R sch | — | R all / W sys |
| 28 | `"order"` | — | R own | R sch | — | R all / W sys |
| 29 | `order_line` | — | R own | R sch | — | R all / W sys |
| 30 | `order_event` | — | — `[AZ-06]` | R sch | — | R all / W sys |
| 31 | `payment` | — | R own | — | — | R all / W sys |
| 32 | `payment_webhook_event` | — | — | — | — | R `orders.view_financials` / W sys |
| 33 | `refund` | — | R own | — | — | R all / W sys |
| 34 | `refund_line` | — | R own | — | — | R all / W sys |
| 35 | `ledger_account` | — | — | — | — | R `orders.view_financials` / W sys |
| 36 | `ledger_transaction` | — | — | — | — | R `orders.view_financials` / W sys |
| 37 | `ledger_entry` | — | — | — | — | R `orders.view_financials` / W sys |
| 38 | `wallet_balance` | — | R own | — | — | R all / W sys |
| 39 | `invoice` | — | R own | — | — | R `invoices.view` / W sys |
| 40 | `invoice_line` | — | R own | — | — | R `invoices.view` / W sys |
| 41 | `invoice_sequence` | — | — | — | — | — (sys only) |
| 42 | `payout` | — | — | — | R own school, confirmed/paid | R all / W sys |
| 43 | `payout_line` | — | — | — | — `[AZ-04]` | R all / W sys |
| 44 | `permission` | — | — | — | — | R `grants.manage` / W sys |
| 45 | `role_template` | — | — | — | — | R `grants.manage` / W sys |
| 46 | `role_template_permission` | — | — | — | — | R `grants.manage` / W sys |
| 47 | `permission_grant` | — | — | R own grants | R own grants | R all / W sys |
| 48 | `policy_document` | — | R all | R all | R all | R all / W sys |
| 49 | `policy_version` | — | R published | R published | R published | R all / W sys |
| 50 | `user_policy_acceptance` | — | R own, insert own | — | — | R `consent.view` |
| 51 | `consent_purpose` | — | R active | R active | R active | R all / W sys |
| 52 | `consent_record` | — | R own, insert own | — | — | R `consent.view` |
| 53 | `data_subject_request` | — | R own, insert own | — | — | R/W `consent.view` |
| 54 | `retention_policy` | — | — | — | — | R `audit.view` / W sys |
| 55 | `purge_run` | — | — | — | — | R `audit.view` / W sys |
| 56 | `idempotency_key` | — | — | — | — | — (sys only) |
| 57 | `device_token` | — | R/W own | — | — | — (sys only) |
| 58 | `notification_preference` | — | R/W own | — | — | — (sys only) |
| 59 | `notification_delivery` | — | R own | — | — | R `audit.view` / W sys |
| 60 | `school_report` | — | — | R sch | R own school | R all / W sys |
| 61 | `audit_log` | — | — | — | — | R `audit.view` / W sys |
| 62 | `migration.*` (4 tables) | — | — | — | — | — (sys only) |
| — | `current_consent` (view) | — | R own | — | — | R `consent.view` |

Counting the `anonymous` column: **a dash on every row, with no exceptions.** That is the
single most important property in this document, and §12 asserts it mechanically rather than
by reading.

**Two caveats on how to read the persona columns.**

- They describe the **seeded role templates** (`0001` §17), not a ceiling. Someone holding
  `orders.refund` at kitchen scope *plus* the kitchen operator bundle reads `refund` too — the
  policies are keyed on permissions, and the persona columns are just the common bundles
  resolved against them. Where a cell says `—`, it means *that template's grants do not satisfy
  any policy on that table*, not that the table is unreachable in principle.
- A person is often more than one persona (§2.2). A kitchen manager who buys lunch for their own
  child reads their own orders through the Customer row and their kitchen's through the
  KitchenOperator row, because permissive policies OR together.

---

## 9. The denials that must be tested

A permission matrix is only worth what its negative cases are worth. These are the assertions
E02-09 exists for; each one corresponds to a specific legacy failure or a specific rule in the
repo.

**Against the legacy failures**

1. `anon` selects zero rows from `"order"`, `recipient`, `app_user`, `payment`, `invoice` —
   and from every other table. (Legacy: `Order` was world-readable.)
2. `anon` selects zero rows from `recipient_allergen`. (Legacy: `Child` had no rules at all.)
3. No table in `public` or `migration` has `rowsecurity = false`.
4. No policy in `public` names `anon`, or `public`, or omits `TO`.

**Customer isolation**

5. Customer A cannot select Customer B's `order`, `order_group`, `order_line`, `payment`,
   `refund`, `invoice`, `wallet_balance`, `device_token`, `consent_record`.
6. Customer A cannot select a `recipient` they have no active `guardian_link` to — including
   one they *created* (`created_by_user_id` must not authorize anything: D10).
7. A **revoked** `guardian_link` grants nothing: revoke it, re-run every recipient assertion.
8. A **disabled** user (`is_disabled = true`) sees nothing, on every table, despite valid rows
   and valid grants. Same for `deleted_at is not null`.
9. Customer A cannot insert a `consent_record` whose `subject_id` is Customer B's recipient.
10. Customer A cannot `UPDATE` their own `app_user` row to clear `is_disabled` or `deleted_at`
    (§6.1 guard trigger).
11. Customer A cannot `UPDATE` a `guardian_link` to re-point `recipient_id` at another child.

**Class 3 — the write wall**

12. `authenticated`, as a customer, cannot `INSERT` into `"order"`, `order_group`,
    `order_line`, `payment`, `refund`, `invoice`, `ledger_entry`, `wallet_balance`,
    `permission_grant`. Assert for **every** class-3 table.
13. `authenticated`, as a PlatformAdmin holding every permission, *also* cannot insert into
    those tables. Platform admin is not a database superuser; it is a set of grants that open
    reads and authorize Edge Functions.
14. `UPDATE`/`DELETE` on `order_event`, `ledger_transaction`, `ledger_entry`,
    `consent_record`, `user_policy_acceptance`, `audit_log` raises `restrict_violation` even
    for `service_role` (the append-only trigger, not just the revoke).

**Back-office scope**

15. A KitchenOperator scoped to kitchen K sees orders for every school whose `kitchen_id = K`
    and **no** order for a school served by a different kitchen. (Scope widening, both
    directions.)
16. A KitchenOperator cannot select `payment`, `refund`, `invoice`, `ledger_*`, `payout` —
    they hold neither `orders.view_financials` nor `orders.refund`. This is D3's promise and
    the only thing that makes it real.
17. A KitchenOperator cannot select `app_user` (§13.3 rule 4).
18. A SchoolViewer sees `school_report` for their school only, and selects zero rows from
    `"order"`, `order_line`, `recipient`, `recipient_allergen`, `app_user`, `payout_line`.
    (§13.3 rule 5: none of S, P or A.)
19. A SchoolViewer sees no `payout` at status `draft`.
20. A grant that has `expires_at` in the past, or `revoked_at` set, authorizes nothing.
21. A grant at `school` scope does **not** satisfy a check at `kitchen` scope. Widening is
    one-directional and asserting the reverse is how you catch an inverted comparison.
22. A `city`-scoped grant reaches every school and kitchen in that city and none outside it.

**Referential**

23. `permission_grant` with `scope_type = 'school'` and `scope_id = null` cannot be inserted
    (the biconditional check in `0001`) — otherwise it would silently mean "every school".
24. Every view in `public` has `security_invoker = true`.
25. `effective_config_public()` returns a row for a customer with a live recipient at that
    school, and zero rows for a customer with none.
26. `resolve_effective_config()` called as `authenticated` returns a null row — asserted so
    that the day someone "fixes" the config policies, the test tells them what they broke.

---

## 10. Table privileges — the layer underneath RLS

RLS is not the only gate and should not be the only gate. Supabase's default privileges give
`anon` and `authenticated` `SELECT/INSERT/UPDATE/DELETE` on new tables in `public`; RLS is
what actually stops them. Two layers is better than one, so `0002` also:

```sql
-- Layer 2 on "anon gets nothing". Now a missing policy is not the only thing
-- standing between an unauthenticated request and a table.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Class 3 tables: revoke the write privileges no policy will ever back, so an
-- accidentally-added policy still cannot write.
revoke insert, update, delete on
  order_group, "order", order_line, order_event,
  payment, payment_webhook_event, refund, refund_line,
  ledger_account, ledger_transaction, ledger_entry, wallet_balance,
  invoice, invoice_line, invoice_sequence, payout, payout_line,
  permission, role_template, role_template_permission, permission_grant,
  platform_config, kitchen_config, school_config, config_change_log,
  policy_document, policy_version, consent_purpose,
  retention_policy, purge_run, idempotency_key,
  audit_log, school_report, notification_delivery,
  school_menu_version, menu_item_capacity, reason_code
from authenticated;
```

`0001` already does the equivalent for the six append-only tables and for the whole `migration`
schema.

**`FORCE ROW LEVEL SECURITY` is deliberately not set.** It would make RLS apply to the table
owner (`postgres`), which sounds attractive but changes nothing for `service_role` — that role
holds `BYPASSRLS`, which is a role attribute and not affected by `FORCE`. It would, however,
break migrations and the dashboard. The honest statement is the one in §2.1: `service_role` is
not authorized by RLS, and `[AZ-01]` is how that is contained.

---

## 11. Storage buckets

Supabase Storage is a table (`storage.objects`) with its own RLS, and the same rules apply.

| Bucket | Contents | Policy |
|---|---|---|
| `dish-images` | `asset.kind in ('dish_image','category_image')` | **Public read** — long-cached, CDN-served, no PII. Write requires `dish.edit`, via an Edge Function. This is the only public bucket. |
| `invoices` | `asset.kind = 'invoice_pdf'` | **Private.** No policy for `anon` or `authenticated`. Access is a **signed URL** minted by an Edge Function after `auth_owns_group()` or `invoices.view`. Short expiry. |
| `reports` | `asset.kind = 'report_pdf'` | **Private.** Same pattern, gated on `reports.view` at the report's school. The monthly PDF is emailed (P6), so the signed URL is usually not even needed. |
| `imports` | `asset.kind = 'import_file'` | **Private.** `menu.import` only, via Edge Function. Uploaded spreadsheets may contain unvalidated data and are never public. |

An invoice PDF contains `buyer_name_snapshot`, `buyer_phone_snapshot` and `pickup_codes`. A
guessable public path to it would be exactly the legacy failure in a different medium.

---

## 12. Test obligations for Q04 / E02-09

`supabase/tests/authorization.test.sql` (pgTAP) must contain, at minimum:

1. **Every allow in §8.** For each non-dash cell: as that persona, select a row that should be
   visible and assert it is.
2. **Every deny in §8.** For each dash: assert zero rows. This is the larger half and it is
   the half that catches regressions.
3. **Every assertion in §9**, individually named so a failure says which rule broke.
4. **Structural invariants**, which are cheap and catch whole classes of mistake:

```sql
-- No table anywhere without RLS.
select is_empty($$ select tablename from pg_tables
                    where schemaname in ('public','migration')
                      and not rowsecurity $$, 'RLS on every table');

-- No policy reachable by anon or by PUBLIC.
select is_empty($$ select policyname from pg_policies
                    where schemaname = 'public'
                      and ('anon' = any(roles) or roles = '{public}') $$,
                'no policy grants anon or PUBLIC');

-- Every SECURITY DEFINER function pins search_path.
select is_empty($$ select p.proname from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef
                     and coalesce(array_to_string(p.proconfig,','),'')
                         not like '%search_path%' $$,
                'every SECURITY DEFINER function pins search_path');

-- Every view is invoker-rights.
select is_empty($$ select c.relname from pg_class c
                    join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'v'
                     and coalesce(array_to_string(c.reloptions,','),'')
                         not like '%security_invoker=true%' $$,
                'every view is security_invoker');

-- recipient.created_by_user_id never appears in a policy (D10).
select is_empty($$ select policyname from pg_policies
                    where schemaname = 'public'
                      and (qual like '%created_by_user_id%'
                        or with_check like '%created_by_user_id%') $$,
                'D10: created_by_user_id is never an authorization path');

-- Every class-3 table has zero policies for INSERT/UPDATE/DELETE.
-- (Driven from a literal list in the test file, so adding a table to the schema
--  without classifying it fails the suite.)
```

5. **A count assertion.** The total number of policies in `public` must equal a literal in the
   test file. Any new policy — added deliberately or by a merge — fails the suite until
   someone updates the number *and* the matrix in §8. This is the mechanism that makes
   "must fail loudly if a policy is removed" also cover "must fail loudly if a policy is
   added", which is the direction that actually leaks data.

**CI note.** `docs/learnings.md` already records that this schema cannot be applied to a bare
Postgres — `app_user.id` references `auth.users(id)`. The suite runs against `supabase start`,
not a `postgres:16` service container, and needs a real JWT per persona. The cheapest way to
impersonate a persona in pgTAP is `set local role authenticated;` plus
`set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';` — which is what
`auth.uid()` reads. Assert that setup works *before* trusting a single deny, because a broken
JWT setup makes every deny pass for the wrong reason. That is the most likely way this suite
lies to us.

---

## 13. Open decisions

All six are also in `docs/open-questions.md`. **None are decided.** Where a choice was needed
to write this document, the recommended option is what is written, and it is labelled.

### `[AZ-01]` Does an Edge Function act as the caller, or as `service_role`? — technical, expensive to reverse

A4 says writes go through Edge Functions. It does not say which database identity they use,
and the answer decides whether RLS is authorization or merely a read filter.

- **Option A — everything as `service_role`.** Simplest to write. RLS then constrains *reads
  only*; every write is authorized solely by Edge Function code, and a missing check is a
  silent privilege escalation with no second line of defence.
- **Option B (recommended, and what is written) — three classes, per Rule 4.** Customer-owned
  and back-office-catalogue writes run as the **caller**, so RLS `WITH CHECK` is the
  authorization and a bug in a function cannot escalate. Money, order state, access control
  and evidence run as `service_role`, because those rows contain values that must be
  *computed* and RLS cannot constrain a column.
- **Option C — everything as the caller.** Not viable: an `INSERT` policy on `"order"` cannot
  stop a customer supplying `total_paise = 0`.

**Recommendation: B.** It gives the maximum surface where a policy is the real gate, and it
makes the `service_role` surface a short, enumerable list that can be reviewed. The cost is
that the `api/` module must know which class each call is in — one line in the client.

Blocks `E01` (the `api/` module and its lint rule), `E02-08`, `E05`, `E06`.

### `[AZ-02]` `orders.view_pii` cannot be enforced by RLS — technical

RLS filters rows, not columns, so anyone who can see an `"order"` row can see
`recipient_name_snapshot`. §6.2.

- **Option A (recommended for v1, and what is written)** — accept it. Enforce `orders.view_pii`
  in the `api/` layer. Safe *only* while every template holding `orders.view` also holds
  `orders.view_pii`, which is true today.
- **Option B** — move the tier-P snapshot columns to a 1:1 `order_recipient_snapshot` table
  with its own policy requiring `orders.view_pii`. This is the only option that makes the
  promise enforceable in the database. It costs one join on the packing-list query and it
  edits §7.3 of the data model.
- **Option C** — column-level `GRANT SELECT (cols)`. Does not work: grants are per-role, and
  a customer and a kitchen operator are the same role (§2.1).

**Recommendation: A now, B before any grant of `orders.view` without `orders.view_pii` is
ever issued** — that is, before E20-09's analyst role. Add a test that fails if such a grant
appears, so the deadline enforces itself.

Blocks `E02-08`, `E20-09`, `E18-14`.

### `[AZ-03]` `anon` and the public privacy policy — technical, small but architectural

App stores require a publicly reachable privacy policy URL, and E12's marketing site may want
to show a sample menu. Both argue for one `anon` read policy.

- **Option A (recommended, and what is written)** — `anon` keeps **exactly zero** policies.
  The website renders policy text from its own static build or from an Edge Function using the
  service key. The invariant "no policy names `anon`" stays a one-line CI assertion, which is
  worth more than the convenience.
- **Option B** — one narrow `anon` `SELECT` on `policy_version where published_at is not
  null`. Defensible in itself, but it converts a boolean invariant into a list of approved
  exceptions, and lists grow.

**Recommendation: A.** Consequence to accept: there is no client-side "browse the menu before
you sign up". If that becomes a marketing requirement it is a public Edge Function returning a
curated sample, not a policy.

Blocks `E12`, `E20-03`.

### `[AZ-04]` What does a school see of its own payout? — needs Andy (commercial)

`payouts.view` at school scope opens the `payout` row, which carries `mdr_deduction_paise`
(M5 — the MDR on refunds comes out of the school's share), `adjustment_paise` (where an admin's
manual edit lands) and `notes`.

- **Option A (recommended, and what is written)** — schools see `payout` rows at status
  `confirmed` or `paid` only, never `draft`; `payout_line` stays platform-only; `notes` is
  treated as school-visible by rule, and the admin UI labels the field as such.
- **Option B** — schools see the computed `share_paise` and `net_payable_paise` only, through
  `school_report`, and never the `payout` table. Simpler and more private, but then a school
  querying a deduction has to email someone.

**This is a relationship question, not a technical one.** Showing the MDR deduction is
transparent and supports M5; hiding the adjustment invites disputes. Andy should say which
conversation he would rather have.

Blocks `E07-10`, `E11-01`.

### `[AZ-05]` Can a guardian see the other guardians on their child? — needs Andy (product), low stakes

Written as **yes**: any guardian who can reach a recipient sees that recipient's
`guardian_link` rows — `user_id` (a uuid), `relationship`, `can_order`, `can_manage`,
`is_primary`. They do **not** see the other guardian's name, phone or email, because
`app_user` is not opened.

The case for yes: a parent needs to see and revoke who else can order for their child, and
"someone else can order for my child and I cannot see who" is worse. The case for no: it
reveals that a second account exists, which matters in a separated-parents situation.

**Recommendation: yes, with the display name resolved server-side by an Edge Function that
returns a first name only.** Andy should confirm, because the failure mode is a family
situation and not a bug.

Blocks `E03`, `E05-01`.

### `[AZ-06]` Does a customer see `order_event`? — needs Andy (product), low stakes

Written as **no**. `order_event.note` and `.metadata` carry staff and provider text, and
`reason_code.is_customer_visible` exists because not every reason is for the parent
(`[DM-22]`). The customer timeline is built from `"order"`'s timestamps plus
`cancel_reason_code` filtered to customer-visible codes.

- **Alternative** — a `customer_order_event` view exposing `to_status`, `created_at` and the
  customer-visible reason only. Cheap to add, and nicer UX ("cancelled at 9:14am because the
  dish was unavailable"). It is a view plus one policy, and can land in E05 rather than here.

**Recommendation: no direct table access; build the view in E05 if the timeline is wanted.**

Blocks `E05-10`, `E09-08`.

---

## 14. Work this document creates

Not appended to the backlog by this run — Q15 reconciles the overnight batch against
`planning/backlog/` and should pick these up. Each is unowned build work.

| Work | Epic | Note |
|---|---|---|
| The §4 helper functions and their grants | E02-08 | Prerequisite for `0002`; 21 functions |
| The §6.1 protected-column guard triggers | E02-08 | Four tables, exhaustively listed |
| `effective_config_public()` (§7.6) | E02-10 | Without it the config resolver silently returns null for every customer |
| `auth_recipient_has_visible_order()` (§7.2) | E02-08 | The need-to-know tightening on children's data |
| The §10 privilege revokes | E02-08 | Second layer under RLS |
| Storage bucket policies (§11) | E02-08 / E04-07 | Four buckets, one public |
| The §12 structural invariants | E02-09 | Cheap, catch whole classes of mistake |
| A test that fails if `orders.view` is granted without `orders.view_pii` | E02-09 | Makes `[AZ-02]`'s deadline enforce itself |
| Last-4-phone order search as an Edge Function, never a table read | E09-07 | Follows from §13.3 rule 4 |

---

## 15. Traceability

| Requirement | Where it is satisfied |
|---|---|
| E02-07 — discrete permissions, scoped grants | §2.2, §4.3, §7.8 |
| E02-08 — RLS on every table, default deny | §5 Rule 1, §7 (61 `public` tables + 4 in `migration`), §10 |
| E02-09 — a suite that fails loudly | §9, §12 |
| D8 — default deny, cannot regress | §5 Rule 1, §12 item 5 (the policy-count assertion) |
| D10 — `guardian_link` is the only path | §4.2, §12 (the `created_by_user_id` assertion) |
| D3 / D11 — grants are the truth, templates are bundles | §2.2, §7.8 |
| §13.3 rule 4 — kitchen needs P and S, not A | §7.2 (`app_user` callout), §9 item 17 |
| §13.3 rule 5 — SchoolViewer gets none of S, P, A | §8 rows 12/14/2, §9 item 18 |
| §13.4 / D15 — deletion stops access immediately | §5 Rule 5 (the restrictive policy), §9 item 8 |
| CLAUDE.md #2 — default-deny, server-side, tested | the whole document |
| CLAUDE.md #4 — children's data is regulated | §5 Rule 8, §7.2, §11 |
