---
title: "E02-39 — one owner account, derived rather than enumerated"
status: "**Approved by Andy 2026-08-28**, boundary included. The DDL at the end is the mobile thread's to land. Blocked behind `E01-31` — migrations were reaching production not at all."
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

---

# The DDL, for the mobile thread

Approved as designed, boundary included. This is the whole database change.

```sql
-- =============================================================================
-- E02-39. One owner, derived.
--
-- The short-circuit lives in auth_has_permission, the single function every auth_can* already
-- resolves through.
--
-- It does NOT go in auth_can_reach_recipient, auth_can_manage_recipient or
-- auth_can_order_for_recipient. Those answer whether a live guardian_link exists — a relationship
-- a parent created — not whether a permission is held. Extending ownership into them would make
-- one account the implicit guardian of every child, reading every allergy note and free-text
-- medical detail on the one table whose whole design is that access follows a link somebody
-- actually made. Andy, approving: "convenience is not a lawful basis."
--
-- Owner derives PERMISSIONS, never RELATIONSHIPS.
-- =============================================================================

create table platform_owner (
  -- At most one row, at the storage layer rather than by convention: the primary key admits one
  -- value and the check admits one value.
  only_one  boolean primary key default true check (only_one),
  user_id   uuid        not null references app_user(id) on delete restrict,
  reason    text        not null,   -- ownership cannot move without a stated why
  set_by    uuid        references app_user(id) on delete restrict,
  set_at    timestamptz not null default now()
);

comment on table platform_owner is
  'E02-39. The single account for which auth_has_permission returns true unconditionally. Its own table rather than a platform_config key: config is editable by anyone holding config.platform_edit, so an owner stored there would be a permission that grants itself everything. No write policy — ownership moves only by migration or service_role.';

-- Append-only, because difficulty is not visibility.
create table platform_owner_history (
  id           bigint generated always as identity primary key,
  old_user_id  uuid references app_user(id) on delete restrict,
  new_user_id  uuid references app_user(id) on delete restrict,
  reason       text not null,
  changed_by   uuid references app_user(id) on delete restrict,
  changed_at   timestamptz not null default now()
);

create function platform_owner_record_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into platform_owner_history (old_user_id, new_user_id, reason, changed_by)
  values (
    case when tg_op = 'INSERT' then null else old.user_id end,
    case when tg_op = 'DELETE' then null else new.user_id end,
    case when tg_op = 'DELETE' then 'ownership removed' else new.reason end,
    case when tg_op = 'DELETE' then null else new.set_by end
  );
  return null;
end;
$$;

create trigger platform_owner_history_trg
  after insert or update or delete on platform_owner
  for each row execute function platform_owner_record_change();

alter table platform_owner         enable row level security;
alter table platform_owner_history enable row level security;

-- Readable, so the client can render for the owner at all. Writable by nobody.
create policy platform_owner_read on platform_owner
  for select to authenticated using (auth_is_back_office());
create policy platform_owner_history_read on platform_owner_history
  for select to authenticated using (auth_can_platform('audit.view'));

-- ── the short-circuit ────────────────────────────────────────────────────────────────────────
-- One boolean OR in front of the existing query, which is otherwise unchanged. The owner is
-- subject to is_disabled and deleted_at exactly as a grant holder is: no account that cannot be
-- switched off.
create or replace function auth_has_permission(
  p_user uuid, p_permission text, p_scope_type scope_type, p_scope_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
       exists (select 1
                 from platform_owner o
                 join app_user u on u.id = o.user_id
                where o.user_id     = p_user
                  and u.is_disabled = false
                  and u.deleted_at  is null)
    or exists (
      select 1
        from permission_grant g
        join app_user u on u.id = g.user_id
       where g.user_id         = p_user
         and g.permission_code = p_permission
         and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
         and u.is_disabled = false
         and u.deleted_at is null
         and (
              g.scope_type = 'platform'
           or (g.scope_type = p_scope_type and g.scope_id = p_scope_id)
           or (g.scope_type = 'city'    and p_scope_type = 'kitchen'
               and exists (select 1 from kitchen k where k.id = p_scope_id and k.city_id    = g.scope_id))
           or (g.scope_type = 'city'    and p_scope_type = 'school'
               and exists (select 1 from school  s where s.id = p_scope_id and s.city_id    = g.scope_id))
           or (g.scope_type = 'kitchen' and p_scope_type = 'school'
               and exists (select 1 from school  s where s.id = p_scope_id and s.kitchen_id = g.scope_id))
         )
    );
$$;

-- `auth_has_any_grant` and `auth_is_back_office` do not route through the function above and are
-- used to widen reference-data reads. Without the owner in them, the owner would hold every
-- permission and still fail them — a strange partial experience rather than a safe one.
create or replace function auth_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1
                   from platform_owner o
                   join app_user u on u.id = o.user_id
                  where o.user_id     = (select auth.uid())
                    and u.is_disabled = false
                    and u.deleted_at  is null);
$$;

grant execute on function auth_is_owner() to authenticated;

create or replace function auth_is_back_office() returns boolean
language sql stable security definer set search_path = public as $$
  select auth_is_owner() or exists (
    select 1 from permission_grant g join app_user u on u.id = g.user_id
     where g.user_id = (select auth.uid())
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

create or replace function auth_has_any_grant(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth_is_owner() or exists (
    select 1 from permission_grant g join app_user u on u.id = g.user_id
     where g.user_id         = (select auth.uid())
       and g.permission_code = p_permission
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and u.is_disabled = false
       and u.deleted_at is null
  );
$$;

-- ── who ──────────────────────────────────────────────────────────────────────────────────────
-- Resolved from the email at apply time and loud if the account is missing, so no address is
-- stored in the table and a typo cannot silently install nobody.
do $$
declare v_user uuid;
begin
  select id into v_user from app_user where email = 'anuragdial@gmail.com' and deleted_at is null;
  if v_user is null then
    raise exception 'E02-39: no live app_user for anuragdial@gmail.com — refusing to install an owner';
  end if;

  insert into platform_owner (user_id, reason, set_by)
  values (v_user, 'Founder and sole operator. Approved 2026-08-28.', v_user)
  on conflict (only_one) do update
    set user_id = excluded.user_id, reason = excluded.reason,
        set_by = excluded.set_by, set_at = now();
end $$;
```

## The pgTAP the migration should bring with it

Guard 2 is not optional and belongs beside the DDL rather than in a follow-up:

```sql
-- The owner is never a seeded persona. Fixture users carry `-7e57-` ("test") in their id.
select ok(
  (select user_id::text !~ '-7e57-' from platform_owner),
  'the platform owner is not a seeded test persona'
);

-- Exactly one.
select is((select count(*)::int from platform_owner), 1, 'exactly one owner row');

-- The short-circuit works — proved with a THROWAWAY owner, inside a transaction that rolls back,
-- so no test ever runs as the real one.
savepoint owner_probe;
  insert into platform_owner (only_one, user_id, reason)
  values (true, '<a fixture user with no grants>', 'probe')
  on conflict (only_one) do update set user_id = excluded.user_id;
  -- ... assert a permission check that would otherwise deny now passes ...
rollback to savepoint owner_probe;
```

Every other authorisation assertion keeps running as a scoped persona. The short-circuit is not a
mode the suite runs in.

## Sequencing

Blocked behind **`E01-31`**, which fixed the production deploy workflow — it had been failing its
own credential guard since 2026-08-25 because a required secret was never created, *and* would then
have authenticated with staging's password. This migration lands behind that, with `0068`–`0075`
and `E02-36`.

The **client half is built and merged already**, and is inert until this lands: `auth_is_owner()`
is called through a wrapper that treats "function does not exist" as `false`. That is the `E02-36`
sequencing lesson applied in advance — the client works before and after, so neither half can break
the other.
