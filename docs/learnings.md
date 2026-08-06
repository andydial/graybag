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

## 2026-08-07 — `planning/backlog.html` cannot be regenerated in an unattended run

**Context:** Q06 appended eight tasks to `E05` and `E06`. CLAUDE.md requires
`node scripts/build-backlog.mjs` whenever the task *list* changes.
**What happened:** `node` is installed but every invocation returns "requires approval", which a
non-interactive run cannot obtain — the same sandbox limitation that stopped the PDF being read
in Q05, now hitting a step the repo's own workflow mandates.
**Cause:** Non-interactive session, Bash allowlist covering `git`, `ls`, `grep`, `find` and
little else.
**Fix / rule:** The markdown in `planning/backlog/` is the source of truth and is correct; only
the generated `backlog.html` is stale, and it is stale silently — it renders fine, it just does
not show the new tasks. **Any overnight run that appends tasks must say so in its summary so the
one command gets run by hand**, and this note is here so the next run does not spend time
rediscovering that `node` is unavailable. Either allowlist `node scripts/*.mjs` for the
overnight wrapper, or have `scripts/overnight.sh` run the build itself after each task — the
second is better, because it does not depend on a summary being read.

## 2026-08-07 — A uniqueness constraint that protects an invariant can also make reality unrecordable

**Context:** Specifying the duplicate-payment path (Q06, `E06-06`). `uq_payment_one_capture_per_group`
is `unique (order_group_id) where status = 'captured'` — `D16`'s guarantee that two payments
never settle one checkout.
**What happened:** Walking the actual scenario — attempt 1 is a UPI collect sitting pending, the
customer gives up and pays by card, attempt 1 then succeeds — the constraint does exactly what it
was written to do and blocks the second capture. Which means the one correct response, *record it
and then refund it*, is the single thing the schema forbids. The money left the customer's account
either way; we simply could not write it down.
**Cause:** The constraint encodes "one capture per group", but the invariant actually wanted is
"one **primary** capture per group". The two are the same until the outside world disagrees with us.
**Fix / rule:** Raised as `[OL-05]` with a `duplicate_of_payment_id` escape hatch as the
recommendation. The general rule is worth more than the fix: **a uniqueness constraint on a table
that mirrors an external system must not prevent recording something that system has already
done.** Razorpay is the system of record for whether money moved; our schema has to be able to
write down whatever it says, and only *then* decide what it means. Check every table in `§8` of the
data model against this — `uq_invoice_one_tax_invoice_per_group` is safe because we issue invoices,
but anything keyed on a provider's behaviour is suspect.

## 2026-08-07 — Payment webhooks are not ordered, and "set status from the event" silently downgrades

**Context:** Writing the webhook handling half of `docs/order-lifecycle.md`.
**What happened:** The obvious handler — `update payment set status = <the event's status>` — is
wrong in a way that leaves no trace. `payment.authorized` and `payment.captured` are separate
deliveries and can arrive in either order. The late `authorized` overwrites `captured`; the order
is already `paid`, the invoice is already issued, the customer already has their email. Nothing
looks broken until the `E06-11` reconciliation reports a captured payment the database calls
authorized, a month later.
**Cause:** Webhook delivery is retried and concurrent, so it is unordered by construction. Nothing
in the payload says "this is stale".
**Fix / rule:** `L3` — payment state moves on a **capture rank** (`created` 0, `authorized` 1,
`captured` 2), and an event implying a rank at or below the current one is recorded with
`processing_status = 'ignored'` and changes nothing. The refund axis is *derived* from completed
refunds rather than transitioned, because refunds are not on the same monotonic line. Generalises:
**any state driven by an external event stream needs an ordering key of its own, and it must come
from the state's own semantics, not from the event's timestamp** — provider clocks are not ours,
and a retry carries the original timestamp anyway.

## 2026-08-07 — "Midnight cutoff" is a day earlier than it reads, and it makes one config setting dead

**Context:** Working the cutoff edge cases for `E05-07`. The defaults are
`order_cutoff_time = '00:00'` and `order_cutoff_days_before = 0`.
**What happened:** `cutoff_at = (service_date − 0) at 00:00`, so the cutoff for Monday's lunch is
**00:00 on Monday** — order by Sunday night. Read quickly, "midnight cutoff" sounds like 23:59 on
the service day, which would be a full day wrong in the direction that puts unmakeable orders on
the kitchen's list. Second-order effect: `min_advance_order_days` defaults to `0`, which under this
cutoff can never be satisfied, because same-day ordering would need `now() < today 00:00`.
**Cause:** Two independent settings whose defaults interact. Neither is wrong; the pair is
misleading.
**Fix / rule:** The worked example is written into `docs/order-lifecycle.md` §9.3 (C5, C6) and into
the test matrix, so the assertion is "Monday's lunch closes at 00:00 Monday" rather than "the
cutoff works". `min_advance_order_days = 0` is documented as dead config under the default cutoff —
it becomes real only for a kitchen that sets a daytime cutoff. General rule: **when two config
settings compose into a single derived value, test the composition, not the settings**, and write
down which combinations are unreachable so nobody reads a `0` default as a feature being on.

## 2026-08-07 — A crashed documentation run leaves dangling forward references, and git makes it look finished

**Context:** Picking up Q05. `docs/motion-system.md` and `docs/design-tokens.md` both already
existed, complete, at 661 and 537 lines, committed as `cd2496f`.
**What happened:** The commit message said `Result: FAILED`, and the log contained one line:
`You've hit your session limit`. The two documents had landed; **everything they pointed at
had not.** They referenced `DS-01`…`DS-04` in `docs/open-questions.md` (no such section),
decision `S4` in `docs/decisions.md` (no such decision), and tasks `E13-11`, `E13-13`,
`E13-14`, `E13-15` (the epic stopped at `E13-10`). Every one of those was a promise to a
reader that resolved to nothing.
**Cause:** Documents get written before the entries they cite, because you cite the ID before
you create it. The overnight wrapper commits the working tree whatever the outcome, so a run
that died two-thirds through is indistinguishable in `git log --stat` from one that finished.
**Fix / rule:** **A document is not done when it reads well; it is done when every reference in
it resolves.** Before closing out any doc task, grep the new file for the ID shapes it uses
(`DS-`, `DM-`, `AZ-`, `S`/`D`/`A`-series, `E\d\d-\d\d`) and confirm each one exists in the file
it claims to be in. Cheap to check, and a dangling reference is worse than no reference — it
tells the reader a decision was made somewhere when it never was. Corollary: `Result: FAILED`
in a commit message means **the follow-through is missing**, not necessarily the deliverable.
Read the log before assuming either.

## 2026-08-07 — The GrayBag brand green cannot carry white text, and neither can most brand greens

**Context:** Extracting design tokens from `Graybag_Design Package`. Every primary button,
every price and every field label in the nine `06_App UI` mocks is white on `#00af52`.
**What happened:** That pair measures **2.90:1**. It fails AA for normal text (4.5:1), fails
AA for *large* text (3:1), and fails the 3:1 non-text-contrast rule that applies to a control's
own boundary. Mock 02 compounds it with a `#145f48` button on a `#00af52` field: **2.63:1**.
**Cause:** A saturated mid-green sits in the worst part of the luminance curve for this. The
sRGB coefficients weight green at **0.7152** — more than red and blue combined — so a green
that *looks* deep enough to take white text carries far more luminance than the eye credits it
with. `#00af52` has a relative luminance of 0.313, which is nearly mid-grey. The same hex would
be judged "dark" by anyone eyeballing it.
**Fix / rule:** The **500 rule** (`S6`): the supplied hex stays the identity colour and is never
ink; functional green is one or two steps darker (`primary-700 #007e3b` = 5.19:1). Generalise
it — **never take a brand palette's contrast on trust, and be most suspicious of the greens and
yellows.** `#ffbb39` on white is 1.69:1, effectively invisible. Compute the ratio for every
supplied hex before designing anything with it; doing it after there are components is a
repaint of the whole product. `E13-13` makes it a CI assertion so a brand refresh fails the
build instead of shipping.

## 2026-08-07 — Multiplying a brand hex preserves its hue; "darkening" it by eye does not

**Context:** Building a tonal ramp around `#00af52` with no tonal steps supplied in the package.
**What happened:** Hand-picked darker greens drifted — the obvious candidates read as either
olive or teal next to the logo, which is exactly the failure that makes a ramp look like it
belongs to a different brand.
**Cause:** Darkening by adjusting HSL lightness, or by eye in a picker, changes the ratio
between the R, G and B channels. Hue in the perceptual sense is carried by those ratios.
**Fix / rule:** Derive shades by **multiplying every channel by the same factor** and tints by
**mixing toward white**, both of which hold the channel ratios and therefore the hue. `#009646`
and `#007e3b` are `#00af52` multiplied, not chosen. Corollary worth knowing: this is also why
`#145f48` is *not* a step on the primary ramp and gets its own name (`forest`) — it is a
genuinely cooler, bluer green, and pretending it is `primary-800` would be a lie the ramp
would keep telling.

## 2026-08-07 — The brand guidelines PDF is unreadable in this environment, and the tokens rest on that gap

**Context:** `00_Graybag_Brand Guidelines.pdf`, the one source that would say whether the
palette has official tints, a type scale or usage rules.
**What happened:** 21.8 MB — over the file-read limit. `magick`, `qlmanage` and `sips` are all
installed, and `node` and `python3` are on the machine, but **none of them could be executed**
in the sandbox this ran in; every invocation returned "requires approval", which an unattended
run cannot obtain.
**Cause:** Non-interactive session plus a Bash sandbox allowlist that covers `git`, `ls`,
`cat`, `grep`, `find` and little else.
**Fix / rule:** Two things. (1) **Assume nothing that needs a binary to verify will be
verifiable in an overnight run** — plan the work so the un-runnable part is isolated and named
rather than discovered at the end. Contrast ratios here were confirmed by hand-computing four
load-bearing pairs against the WCAG 2.1 formula, which is enough to establish the table was
computed rather than guessed, but is not a substitute for `E13-13`. (2) The unread PDF is
tracked as `DS-05` / `E13-15`, not left as a silent assumption. **The brand document wins on
anything about the brand**, so the token file is provisional until someone opens it.

## 2026-08-07 — A failing RLS `USING` clause does not raise; it silently filters

**Context:** Writing `supabase/tests/authorization.test.sql` (Q04), asserting that a
co-guardian with `can_manage = false` cannot edit a child.
**What happened:** The obvious test — `throws_ok('update recipient set first_name = …',
'42501')` — is wrong, and would have failed. An `UPDATE` whose policy `USING` clause is false
does not error: the row is simply not visible to the statement, so the `UPDATE` succeeds and
touches **zero rows**.
**Cause:** `USING` decides which rows the command can see. Only `WITH CHECK` raises, and only
for the row a write is trying to produce.
**Fix / rule:** Two different assertions for two different mechanisms, and they must not be
confused. `USING` denial → `lives_ok(…)` **plus** a follow-up assertion that the row is
unchanged. `WITH CHECK` denial, a missing INSERT policy, or a revoked table privilege →
`throws_ok(…, '42501')`. A test written the wrong way round reports the wrong reason for a
failure, and — worse — a `throws_ok` that is really testing a `USING` clause can pass for an
unrelated reason later. The same distinction is why §6.1's protected columns are guard
**triggers** rather than policies: a trigger raises, a policy filters.

## 2026-08-07 — A pgTAP suite that switches roles must run its assertions *inside* the role

**Context:** The KitchenOperator block of the Q04 authorization suite.
**What happened:** The block captured the persona's visible tables, ran `reset role`, and then
ran a dozen `is_empty($$ select 1 from payment $$)` assertions. Those executed as `postgres`,
which owns the tables and therefore bypasses RLS entirely — so they were reading every row in
the database and asserting it was empty. They would have failed noisily this time; the
dangerous version is the mirror image, where an `is_empty` runs as a role that has no rows for
an unrelated reason and passes for ever.
**Cause:** `RESET ROLE` is easy to put in the wrong place, and nothing about the assertion
tells you which role it ran as.
**Fix / rule:** Every persona block re-enters the role immediately before its assertions and
resets immediately after; the only statements that may run between are the ones that read the
captured results. **Part 0b of the suite asserts the harness itself before a single deny is
trusted** — that `SET LOCAL ROLE` actually changed `current_user`, that `auth.uid()` reads the
impersonated subject, and that an impersonated customer really does see their own order. A
broken impersonation setup makes every deny pass for the wrong reason, and that is the most
likely way an authorization suite lies to you.

## 2026-08-07 — After revoking `anon`'s privileges, `anon` cannot call pgTAP either

**Context:** Asserting the most important property in the model — that `anon` reads zero rows
from all 61 tables.
**What happened:** §10 of the authorization model revokes `all on all tables/functions in
schema public from anon`. pgTAP installs into `public` on a database where it is not already
present, so `set local role anon; select is_empty(…)` fails on `is_empty` itself, not on the
thing being tested.
**Cause:** A blanket revoke is blanket.
**Fix / rule:** **Capture as the persona, assert as the session role.** The suite has one
helper, `tests_visible_counts(schema)`, which loops every table and returns the row count
visible to the *current* role, swallowing `insufficient_privilege` as zero. The persona block
does nothing but `insert into tests_seen select …`; the `set_eq`/`is_empty` runs afterwards as
`postgres`. As a side effect this is also a much better encoding of the matrix: one assertion
per persona covering all 61 tables at once, naming exactly which table leaked or went dark.
The harness's own tables live in a `tests_tmp` schema, never in `public` — a helper table in
`public` would show up in its own visibility sweep.

## 2026-08-07 — `to_regclass(…) is null or (select … from that_table)` still fails

**Context:** Making the §11 storage assertions skip on a database without the storage
extension.
**What happened:** `select ok(to_regclass('storage.buckets') is null or (select public from
storage.buckets …))` does not degrade gracefully. The statement is parsed as a whole before
anything is evaluated, so the missing relation is an error at parse time and the `or` never
runs.
**Cause:** Name resolution happens at parse, not at execution. Runtime short-circuiting cannot
save a reference that does not resolve.
**Fix / rule:** Optional-object checks go through a plpgsql helper that tests `to_regclass`
first and reaches the table by `EXECUTE`. Same rule applies to the migration: `0002`'s bucket
creation is inside a `DO` block guarded the same way.

## 2026-08-07 — A guard trigger's `service_role` exemption must not be `SECURITY DEFINER`

**Context:** Writing the §6.1 protected-column guard triggers, which must fire for
`service_role` unless they explicitly exempt it.
**What happened:** The natural place to put `current_user in ('service_role', 'postgres', …)`
is a small helper alongside the other `auth_*` functions — all of which are `SECURITY DEFINER`
with a pinned `search_path`. Doing that here inverts the check: inside a `SECURITY DEFINER`
function `current_user` is the function's **owner**, so the helper would return true for every
caller and the guard would protect nothing.
**Cause:** `SECURITY DEFINER` changes `current_user`; `session_user` is unaffected but is the
wrong question when PostgREST does `SET LOCAL ROLE`.
**Fix / rule:** `auth_is_privileged_role()` is deliberately invoker-rights and carries a
comment saying why, so nobody "hardens" it later. General rule: any function whose answer
depends on *who is calling* must not be `SECURITY DEFINER`, which is the exact opposite of the
rule for any function that needs to *read past RLS*.

## 2026-08-06 — An RLS policy with no `TO` clause is granted to `PUBLIC`, which includes `anon`

**Context:** Writing `docs/authorization-model.md` (Q03), the specification `0002_rls_policies.sql`
will be transcribed from.
**What happened:** `CREATE POLICY … USING (…)` with no `TO` clause defaults to `TO PUBLIC`. In
Supabase, `PUBLIC` includes `anon` — so the single most catastrophic mistake available in this
schema is a *missing clause*, not a wrong predicate. It is also invisible: the policy reads
correctly, the customer path works, and unauthenticated access is silently open.
**Cause:** SQL default, inherited from `GRANT`.
**Fix / rule:** **Every policy in `0002` names its role explicitly — `to authenticated`** — and
Q04 asserts `select … from pg_policies where 'anon' = any(roles) or roles = '{public}'` is
empty. Related traps written up in the same document: policies are **permissive and OR
together**, so adding one can only ever widen access; and `FOR ALL` uses its `USING` clause for
both visibility and write-checks, so `0002` writes one policy per command instead.

## 2026-08-06 — RLS filters rows and cannot hide a column

**Context:** Trying to enforce `orders.view_pii` — the permission that separates "see the
orders" from "see the children's names on them" (E20-09).
**What happened:** There is no way to write a policy that grants a row but withholds
`order.recipient_name_snapshot`. Column-level `GRANT SELECT (cols)` does not rescue it either,
because grants are per-role and **a customer and a kitchen operator are the same Postgres role**
(`authenticated`) — the only thing distinguishing them is the policy predicate.
**Cause:** RLS is row-level by definition; the persona distinction lives in the JWT, not in the
role.
**Fix / rule:** Two consequences, both now written down. (1) Column-level promises need a
**separate table** with its own policy, not a policy on the wide table — raised as `AZ-02`.
(2) Any table where a customer may write but must not set every column needs a **`BEFORE UPDATE`
guard trigger** listing the protected columns; four such tables are enumerated in §6.1 of
`docs/authorization-model.md`. Do not assume a `WITH CHECK` can protect a column — it cannot.

## 2026-08-06 — `resolve_effective_config()` returns null for every customer once RLS is on

**Context:** Specifying the RLS policies for `platform_config` / `kitchen_config` /
`school_config` (Q03).
**What happened:** `resolve_effective_config()` is `STABLE` and deliberately *not*
`SECURITY DEFINER`, so it runs with the caller's privileges. It inner-joins `platform_config`,
which no customer may read. Once `0002` is applied it returns a **null row, with no error**, for
every customer — the cutoff time, the tax rates and the cancellation rules all silently become
null in the app.
**Cause:** Invoker-rights functions inherit the caller's RLS. A filtered-away join row is not an
error; it is zero rows.
**Fix / rule:** Do not open the config tables to customers — `school_config.revenue_share_bps`
is commercially sensitive (M4) and sits on the same row as the cutoff. Instead expose
`effective_config_public(school_id)`, a `SECURITY DEFINER` wrapper returning the customer-safe
subset (everything except `revenue_share_bps` and `sac_code`), gated on
`auth_can_reach_school()`. Q04 asserts both that the wrapper returns a row and that the raw
resolver returns null as `authenticated`, so the day someone "fixes" the config policies the
test says what they broke. **General rule: after enabling RLS, re-check every pre-existing
`STABLE` function that joins a now-protected table — the failure mode is a silent null, not an
error.**

## 2026-08-06 — `auth.uid()` is re-evaluated once per row unless you wrap it

**Context:** Writing the customer predicate for `"order"`, the hottest table in the system.
**What happened:** `customer_user_id = auth.uid()` calls the function for every candidate row.
`customer_user_id = (select auth.uid())` is hoisted to an InitPlan and evaluated once per
statement.
**Cause:** `auth.uid()` is `STABLE`, not `IMMUTABLE`, so the planner will not fold it — but it
will fold a scalar subquery.
**Fix / rule:** **Every policy predicate writes `(select auth.uid())`, never bare
`auth.uid()`.** Same applies to `auth.jwt()`. This is the difference between a policy that costs
nothing and one that costs a function call per row on the order history query.

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
