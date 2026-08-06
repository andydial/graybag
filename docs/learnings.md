---
title: Learnings
---

# Learnings

Running record of what broke, what did not work, and non-obvious constraints. Claude Code
appends here as it builds; Andy can read it to understand why things are the way they are.

Format — newest first:

```
## YYYY-MM-DD — Short title
**Context:** what we were doing
**What happened:** the symptom
**Cause:** the actual reason
**Fix / rule:** what we do now, and what to avoid repeating
```

---

## 2026-08-06 — A Postgres view bypasses RLS unless you ask it not to

**Context:** Writing `0001_initial_schema.sql` (Q02), which creates the `current_consent`
view over the append-only `consent_record` table.
**What happened:** A view is, by default, executed with the *view owner's* privileges, not
the caller's. Since Supabase migrations create objects as `postgres`, `current_consent`
would have read straight past the RLS on `consent_record` — a hole in the default-deny
promise, in the one table that evidences consent for children's data.
**Cause:** Postgres's historical default. `security_invoker` only arrived in PG15 and is
off by default for backwards compatibility.
**Fix / rule:** **Every view in this schema is created `WITH (security_invoker = true)`.**
A view is not a security boundary here; the underlying table's RLS is. Q04's test suite
should assert this for every view in `public`, because the failure is silent — the view
simply returns rows it should not.

## 2026-08-06 — `SET search_path` on a SQL function silently blocks inlining

**Context:** Writing `resolve_effective_config()` (§9.3), which is `STABLE` specifically so
the planner can inline it into the surrounding query.
**What happened:** Adding `SET search_path = public` — the habit formed while writing
`auth_has_permission()` — makes the function un-inlinable. Postgres will not inline a
function that carries a `SET` clause, because the setting has to be established and torn
down around each call.
**Cause:** Documented planner behaviour, but it is easy to apply the `SECURITY DEFINER`
hardening reflex to every function.
**Fix / rule:** Pin `search_path` **only** on `SECURITY DEFINER` functions, where it is
mandatory and the inlining loss is irrelevant. `auth_has_permission()` has it;
`resolve_effective_config()` deliberately does not, and carries a comment saying why so
nobody "fixes" it later.

## 2026-08-06 — The schema cannot be applied to a bare Postgres

**Context:** Wanting to syntax-check `0001_initial_schema.sql` locally.
**What happened:** `app_user.id` is a foreign key to `auth.users(id)` (§4.1) — that is what
makes every customer RLS predicate a direct `auth.uid()` comparison with no join. It also
means the migration cannot be applied to a plain Postgres container; the `auth` schema does
not exist there.
**Cause:** Deliberate coupling to Supabase Auth, decided in the data model.
**Fix / rule:** The migration opens with a `DO` block that raises a readable error if
`auth.users` is missing, rather than failing three hundred lines later with a confusing
foreign-key error. CI must run schema and pgTAP tests against `supabase start`, not against
a bare `postgres:16` service container. This is a constraint on E01's CI design.

## 2026-08-06 — A future-dated menu assignment goes live on a day with no DML

**Context:** Implementing the `school_menu_version` bump triggers (§6.8) for the
`GET /menu/version` cache token.
**What happened:** The triggers fire on writes to `menu`, `menu_item`, `menu_assignment`,
`menu_item_price_override`, `dish` and `asset`. But a `menu_assignment` with a future
`valid_from` becomes effective at midnight on that date, when *nothing is written*. The
token therefore does not change, and every client keeps serving yesterday's cached menu
until some unrelated edit happens.
**Cause:** The invalidation design is write-driven; this one transition is time-driven.
**Fix / rule:** `refresh_school_menu_versions()` exists for exactly this and **must be run
by the nightly job** — it bumps any school whose effective menu today differs from the menu
recorded on its token, which is precisely the set that rolled over. General rule: any cache
token invalidated by triggers needs a sweep for the transitions that are caused by the
clock rather than by a writer.

## 2026-08-06 — Postgres SEQUENCE cannot produce gapless invoice numbers

**Context:** Designing `E07-01` (gapless sequential invoice numbers per financial year) in the
target data model.
**What happened:** The obvious implementation — a `SEQUENCE` per financial year — silently
fails the requirement.
**Cause:** Sequences are deliberately non-transactional so concurrent writers never block. A
rolled-back transaction consumes its value and leaves a permanent hole. A failed payment would
therefore burn an invoice number, which is precisely what M3 forbids.
**Fix / rule:** Use an `invoice_sequence` counter row and `UPDATE … RETURNING` inside the same
transaction that inserts the invoice, so the row lock serialises allocation. Allocate only
**after** payment capture. Serialisation is inherent to gapless numbering, not a flaw — at a
few thousand invoices a month the contention is irrelevant. Never reach for `SEQUENCE` or
`generated always as identity` for anything with a statutory numbering requirement.

## 2026-08-06 — RLS on the grants table recurses into itself

**Context:** Designing the `permission_grant` table and the `auth_has_permission()` helper the
policies call.
**What happened:** A policy on `permission_grant` that calls a function which reads
`permission_grant` re-triggers the policy — infinite recursion. Postgres surfaces this as a
confusing runtime error on an unrelated query, not as an error when the policy is defined.
**Cause:** RLS applies to functions running as the invoker, including inside policy predicates.
**Fix / rule:** The permission-check helper must be `SECURITY DEFINER`, owned by a role that
bypasses RLS, marked `STABLE`, and **must** pin `SET search_path = public` — without that pin a
`SECURITY DEFINER` function is a privilege-escalation vector. Any table whose policy needs to
consult itself gets the same treatment.

## 2026-08-06 — "Partition from day one" propagates into every child table

**Context:** Deciding how to honour D9 / `E02-11` (reporting scoped by city + kitchen).
**What happened:** Declarative partitioning of `order` turns out to be far more invasive than
"add a `PARTITION BY` clause".
**Cause:** Postgres requires the partition key to be part of every unique constraint on the
partitioned table, so `order`'s primary key becomes composite — `(id, service_date)`. Every
foreign key referencing `order` must then carry the partition column too, so `order_line`,
`order_event`, `refund` and `payout_line` all gain a column and every join gains a term.
**Fix / rule:** Partitioning is a scaling decision with a schema-wide blast radius, not a
day-one hygiene measure. Composite indexes on `(city_id, service_date)` and
`(kitchen_id, service_date)` deliver the property D9 actually wants — never scanning another
city's rows — at ~10⁶ rows. Raised as `DM-05`; revisit at ~50M order rows or a report over 2s
at p95.

## 2026-08-06 — Legacy `Dish_In_Order` already carried child and school on the line

**Context:** Deciding whether one checkout can cover two children (`DM-01`).
**What happened:** The legacy line-item type snapshots `child` and `school` per line even
though `Order` also has a single `child` pointer.
**Cause:** Most likely an abandoned move toward multi-recipient carts, left half-done — the
same pattern as `Guardian_Link` being introduced but never replacing `Child.Parent`.
**Fix / rule:** Treat this as evidence that multi-child checkout was wanted, not as a licence
to assume it. It is written up as `DM-01` for Andy. **General rule for this migration: where
the legacy schema contains two mechanisms for one thing, assume the second was started and
abandoned, and find out which one the live data actually uses before copying either.**

## 2026-08-06 — `order`, `user` and `grant` are all SQL keywords

**Context:** Naming tables for the target schema, where `E02-07` specifies a table called
`grant`.
**What happened:** `GRANT` and `USER` are reserved words; `ORDER` is reserved in `ORDER BY`
context.
**Cause:** SQL standard.
**Fix / rule:** `user` → `app_user`, `grant` → `permission_grant`. `order` is kept and quoted,
because the domain term is worth the quoting and PostgREST handles it. Decide this once, in the
model, rather than discovering it halfway through writing the DDL.

## 2026-08-06 — Bubble export contains live secrets in cleartext

**Context:** Parsing the `.bubble` app export to map the legacy schema.
**What happened:** `settings.secure` contained a live Razorpay key (`rzp_live…`), a Stripe
test secret, and two marketplace plugin app secrets, all unredacted.
**Cause:** Bubble's app export includes the secure settings block verbatim.
**Fix / rule:** `*.bubble` is in `.gitignore` and must never be committed or shared. Keys
rotated (`E00-01`, `E00-02`). Treat any Bubble export as a secret.

## 2026-08-06 — Bubble cannot export password hashes

**Context:** Planning user migration for ~400 existing accounts.
**What happened:** No export path or API exposes the password field.
**Cause:** Platform limitation, not a setting.
**Fix / rule:** Every user re-authenticates once regardless of approach. Since that cost is
unavoidable, we switched to phone + OTP rather than migrating passwords — the migration
constraint became a product improvement.

## 2026-08-06 — Firebase Phone Auth is not available in India

**Context:** Evaluating OTP providers.
**What happened:** India is not among Firebase Phone Number Verification's supported
regions (Finland, France, Germany, Indonesia, Malaysia, Pakistan, Spain).
**Cause:** Google regional availability.
**Fix / rule:** Use an Indian SMS provider (MSG91 / Gupshup) with TRAI DLT registration.
DLT has 1–2 weeks of paperwork lead time and blocks launch — started in `E00-06`.

## 2026-08-06 — Legacy break-time option values contradict their labels

**Context:** Mapping the legacy `Break-Start-Times` option set for migration.
**What happened:** db_value `10__00_am` renders as "10:40AM - 11:15AM"; `10_15_am` renders
as "11:15AM - 11:40AM".
**Cause:** Labels were edited over time without changing the stored values.
**Fix / rule:** Never migrate break times on db_value. `E16-15` builds a hand-verified
lookup table. General rule: for every legacy option set, verify label-to-value agreement
before trusting either.

## 2026-08-06 — Legacy `mobile` is a number field

**Context:** Planning OTP-based account claim for migrated users.
**What happened:** Leading zeros and `+91` country codes are already lost in the stored data.
**Cause:** Bubble field typed as number rather than text.
**Fix / rule:** Normalise to E.164 before any claim is possible, and **block auto-claim on
any ambiguous or duplicate match** — otherwise one OTP could claim the wrong account along
with its children's records (`E03-11`, `E16-14`).
