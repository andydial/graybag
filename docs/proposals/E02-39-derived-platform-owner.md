---
title: "E02-39 — one owner account, derived rather than enumerated"
status: "Proposed 2026-08-28 by the web thread. Needs a migration number, and Andy's yes."
---

# One owner, derived

Andy, 2026-08-28:

> *"Stop granting me permissions one at a time. I want one owner account — mine — that holds
> everything by construction, so a new permission is never something I have to notice and ask for…
> my preference is that the owner is derived rather than enumerated: a single recorded account
> against which permission checks pass, not a list of grants somebody keeps in step."*

With two guards he set: **exactly one owner, changed deliberately and visibly**, and **no test may
run as the owner.**

This is the design, before any of it is built.

## The shape of it

Authorisation already has a single chokepoint. Every `auth_can`, `auth_can_platform` and
`auth_can_on_order` resolves through **`auth_has_permission(user, permission, scope_type, scope_id)`**
in `0001`. That is the only function this touches.

```sql
-- inside auth_has_permission, before the existing grant query
select
     exists (select 1
               from platform_owner o
               join app_user u on u.id = o.user_id
              where o.user_id     = p_user
                and u.is_disabled = false
                and u.deleted_at  is null)
  or exists ( … the existing permission_grant query, unchanged … );
```

The owner is subject to `is_disabled` and `deleted_at` exactly as a grant holder is. A disabled
owner holds nothing — that keeps the existing invariant and the account-deletion story true, rather
than carving out an account that cannot be switched off.

### Where the owner is recorded

```sql
create table platform_owner (
  only_one  boolean primary key default true check (only_one),
  user_id   uuid        not null references app_user(id) on delete restrict,
  reason    text        not null,
  set_by    uuid        references app_user(id) on delete restrict,
  set_at    timestamptz not null default now()
);
```

`only_one boolean primary key check (only_one)` is the single-row idiom: the primary key admits one
value and the check admits one value, so a second row is impossible at the storage layer rather
than by convention.

**A table of its own rather than a `platform_config` key.** Config is edited through a screen by
anyone holding `config.platform_edit`. If the owner lived there, a permission would be able to
grant itself everything — the exact shape of privilege escalation this is otherwise careful about.
`platform_owner` gets **no RLS write policy at all**, so there is no API path and no UI path to it;
changing it takes a migration or a deliberate `service_role` statement.

`reason` is `not null`: you cannot move ownership without writing down why.

## Guard 1 — exactly one, changed visibly

| | |
|---|---|
| More than one owner | Impossible. Single-row constraint. |
| Zero owners | Allowed, and it means "nobody is owner" — the system behaves exactly as it does today. Not a special case. |
| Changing it | Migration or `service_role` only. No screen, no endpoint, no permission that reaches it. |
| Seeing that it changed | `platform_owner_history`, append-only, written by trigger: old user, new user, reason, who, when. |

The history table is the part that makes "visible" true. Difficulty is not visibility — a change
nobody can see is not deliberate just because it was hard.

**A test asserts there is exactly one owner and that it is not a seeded fixture user.**

## Guard 2 — no test runs as the owner

This is the guard that matters, and it is worth restating why. Andy: the failure already happened
once, when he diagnosed the parent screens holding 31 grants and the screens looked fine because
his account could see everything. An implicit superuser makes that permanent and invisible.

Three layers, weakest to strongest:

**1. Structural.** Test personas are seeded with recognisable ids — `a0000000-7e57-…`, where `7e57`
is "test". The pgTAP suite asserts `platform_owner.user_id` matches no seeded fixture user. A
persona can never *become* the owner by accident.

**2. A scan.** A script test greps the pgTAP suite and the JS suites for any impersonation of the
owner's id. Cheap, and it catches the copy-paste that the structural rule cannot.

**3. The one that actually holds the line.** Every authorisation assertion continues to run as a
scoped persona, and the suite asserts that at the top: for the duration of the policy tests,
`auth.uid()` is never the owner. The short-circuit is not a mode the suite runs in.

**The short-circuit still needs its own test**, or it is untested behaviour in production — which
would be the same bug in a different coat. That test sets `platform_owner` to a **throwaway user
inside a transaction and rolls back**, so it exercises the mechanism without any test ever running
as the real owner, and without the fixture owning anything afterwards.

## What the owner is NOT

The sharpest decision in this design, and the reason it is a proposal rather than a patch.

**The short-circuit goes in `auth_has_permission` and nowhere else.** In particular it must *not*
be added to `auth_can_reach_recipient`, `auth_can_manage_recipient` or `auth_can_order_for_recipient`.

Those answer a different question. Reaching a child is a **relationship** — a live `guardian_link`
— not a permission. Extending ownership into them would silently make one account the guardian of
every child in the system: it would read every allergy note and every free-text medical detail, on
a table whose whole design is that access follows a link somebody actually created. That is a DPDP
problem dressed as a convenience, and non-negotiable #4 is the reason to say no to it explicitly
rather than to just not do it by accident.

So: **owner derives permissions, never relationships.** The owner sees every order because
`orders.view` is a permission; the owner does not see a child's record through a guardian path,
because there is no link. Where a back-office screen legitimately needs child data it already goes
through `orders.view_pii`, which is a permission and therefore does derive.

Also unchanged:

- **Integrity.** `order_event` stays append-only, the ledger still has to balance, invoice numbers
  stay gapless, `RESTRICT` foreign keys still restrict. Authorisation is not integrity, and the
  owner can no more delete a paid order than anyone else.
- **`service_role`.** Unaffected — it bypasses RLS already and Edge Functions are untouched.
- **Audit.** Every write the owner makes is recorded exactly as anyone else's is.

## The consequence that is easy to miss

**The back office would render empty for the owner.**

`fetchMyGrants` reads `permission_grant`, `nav-mount` reveals a link only when its requirements are
held, and the owner holds no grant rows. The person with everything would see a sidebar with
nothing in it — a perfect illustration of "derived" being invisible to a client that enumerates.

So the client needs to know too:

- a `auth_is_owner()` SQL function, exposed as an RPC;
- `fetchMyAccess` returns it alongside the grants;
- `visibleNav` and the shell treat owner as satisfying every requirement;
- `describeAccess` labels it **"Owner — everything, by construction"**, not "Platform admin". It is
  not the platform-admin job, and after `E10-64` this file has strong opinions about naming a job
  somebody is not.

That last point also fixes the thing that started this: a new permission never needs granting, and
the label never goes stale, because there is nothing to keep in step.

## What I would want to be honest about

**One account's production behaviour is not what any test exercises.** That is the real cost, and
the guards reduce it rather than remove it. The mitigation is that the owner path is a single
boolean `or` in front of an otherwise identical query — the smallest divergence I can construct —
and every deny test still runs as a persona, so the policies themselves stay proven.

**`auth_has_any_grant` and `auth_is_back_office` do not route through `auth_has_permission`.** They
answer "is this person back office at all" and are used to widen reference-data reads. Left alone,
the owner would hold every permission and still fail them, which would be a strange partial
experience. I would include the owner in both, and I am flagging it rather than assuming, because
each is a widening.

## What this needs

- **A migration number**, which the mobile thread holds. I would hand them the DDL rather than take
  one — the same arrangement as `E02-36`.
- **The owner's `user_id`**: `anuragdial@gmail.com`. I would not put an email in the table; the
  migration resolves it to the id at apply time and fails loudly if the account is missing.
- **Andy's yes**, particularly on "owner derives permissions, never relationships" — that is the
  line that decides whether this is a convenience or a hole.
