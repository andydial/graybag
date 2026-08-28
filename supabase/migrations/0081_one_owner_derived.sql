-- =============================================================================
-- `E02-41`. One owner, derived — the DDL from `E02-39`, designed by the web thread and
-- approved by Andy on 2026-08-28, landed here because migration numbers live in this block.
--
-- Andy: *"Stop granting me permissions one at a time. I want one owner account — mine — that
-- holds everything by construction, so a new permission is never something I have to notice and
-- ask for… my preference is that the owner is derived rather than enumerated."*
--
-- The short-circuit lives in `auth_has_permission`, the single function every `auth_can*` already
-- resolves through.
--
-- ## The boundary, which is the whole reason this was a proposal and not a patch
--
-- It does **NOT** go in `auth_can_reach_recipient`, `auth_can_manage_recipient` or
-- `auth_can_order_for_recipient`. Those answer whether a live `guardian_link` exists — a
-- relationship a parent created — not whether a permission is held. Extending ownership into them
-- would make one account the implicit guardian of **every child in the system**, reading every
-- allergy note and free-text medical detail, on the one table whose entire design is that access
-- follows a link somebody actually made. Non-negotiable #4, and Andy approving the boundary:
-- *"convenience is not a lawful basis."*
--
--   **Owner derives PERMISSIONS, never RELATIONSHIPS.**
--
-- `one_owner_derived.test.sql` asserts that boundary directly, with an owner installed: a child
-- who is nobody's is still unreachable. A test that only proved the short-circuit works would
-- have passed just as happily with the hole in it.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------------------------
-- 1. Where the owner is recorded
-- -----------------------------------------------------------------------------------------------

create table platform_owner (
  -- At most one row, at the storage layer rather than by convention: the primary key admits one
  -- value and the check admits one value, so a second row is impossible rather than discouraged.
  only_one  boolean primary key default true check (only_one),
  user_id   uuid        not null references app_user(id) on delete restrict,
  reason    text        not null,   -- ownership cannot move without a stated why
  set_by    uuid        references app_user(id) on delete restrict,
  set_at    timestamptz not null default now()
);

comment on table platform_owner is
  'E02-39/E02-41. The single account for which auth_has_permission returns true unconditionally. '
  'Its own table rather than a platform_config key: config is editable by anyone holding '
  'config.platform_edit, so an owner stored there would be a permission that grants itself '
  'everything. No write policy — ownership moves only by migration or service_role.';

-- Append-only, because difficulty is not visibility. A change nobody can see is not deliberate
-- just because it was hard.
create table platform_owner_history (
  id           bigint generated always as identity primary key,
  old_user_id  uuid references app_user(id) on delete restrict,
  new_user_id  uuid references app_user(id) on delete restrict,
  reason       text not null,
  changed_by   uuid references app_user(id) on delete restrict,
  changed_at   timestamptz not null default now()
);

comment on table platform_owner_history is
  'E02-41. Every change of ownership, written by trigger. The half that makes "changed visibly" '
  'true rather than merely "changed rarely".';

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

-- Readable, so a client can render for the owner at all. Writable by nobody: there is deliberately
-- no insert, update or delete policy on either table, so no API path and no UI path reaches them.
create policy platform_owner_read on platform_owner
  for select to authenticated using (auth_is_back_office());
create policy platform_owner_history_read on platform_owner_history
  for select to authenticated using (auth_can_platform('audit.view'));

-- -----------------------------------------------------------------------------------------------
-- 2. The short-circuit
--
-- One boolean OR in front of the existing query, which is otherwise character-for-character what
-- `0001` installed. The owner is subject to `is_disabled` and `deleted_at` exactly as a grant
-- holder is — no account that cannot be switched off, and the account-deletion story stays true.
-- -----------------------------------------------------------------------------------------------

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

-- `create or replace` preserves a function's ACL, but this one is `security definer` and sits in
-- front of every policy in the database. Re-applying costs nothing and means a future replace that
-- does not preserve it cannot silently open or close the door.
revoke all on function auth_has_permission(uuid, text, scope_type, uuid) from public;
do $$
declare r text;
begin
  foreach r in array array['authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'grant execute on function auth_has_permission(uuid, text, scope_type, uuid) to %I', r);
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------------------------
-- 3. The two functions that do NOT route through `auth_has_permission`
--
-- `auth_has_any_grant` and `auth_is_back_office` answer "is this person back office at all" and
-- widen reference-data reads. Left alone, the owner would hold every permission and still fail
-- them — a strange partial experience rather than a safe one. The web thread flagged this as a
-- widening rather than assuming it, and Andy approved it as part of the design.
-- -----------------------------------------------------------------------------------------------

create or replace function auth_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1
                   from platform_owner o
                   join app_user u on u.id = o.user_id
                  where o.user_id     = (select auth.uid())
                    and u.is_disabled = false
                    and u.deleted_at  is null);
$$;

comment on function auth_is_owner is
  'E02-41. Whether the CALLER is the owner. Exposed to the client because a back office that '
  'enumerates grants renders empty for an account that holds none by construction.';

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

-- -----------------------------------------------------------------------------------------------
-- 4. Who
--
-- ## Changed from the proposal, deliberately, and this is the one substantive edit
--
-- As written the proposal resolved `anuragdial@gmail.com` and raised if it was missing. That
-- account exists on production and **nowhere else**: it is not in `supabase/seed.sql`, and
-- migrations run BEFORE the seed on `db reset`. So the unconditional raise would have aborted
-- every local reset and every CI run — the migration would have been correct about production and
-- fatal everywhere it is actually exercised.
--
-- The intent survives intact by keying off `platform_config.environment`, which `0045` added for
-- exactly this class of problem and which defaults to `'local'` so that the safe direction is the
-- default. On **production** a missing account still raises, loudly, because installing nobody
-- there would be a silent typo. Anywhere else it installs nothing and says so.
--
-- Zero owners is not a special case: the proposal defines it as "nobody is owner", and the system
-- then behaves exactly as it does today. That is what CI runs against, which is the right way
-- round — the suite proves the policies, not the short-circuit around them.
-- -----------------------------------------------------------------------------------------------

do $$
declare
  v_user uuid;
  v_env  text;
begin
  select environment into v_env from platform_config limit 1;
  select id into v_user from app_user
   where email = 'anuragdial@gmail.com' and deleted_at is null;

  if v_user is null then
    if v_env = 'production' then
      raise exception
        'E02-41: no live app_user for anuragdial@gmail.com on PRODUCTION — refusing to install an owner';
    end if;
    raise notice
      'E02-41: no owner installed (environment=%). Zero owners is a defined state.', v_env;
    return;
  end if;

  insert into platform_owner (user_id, reason, set_by)
  values (v_user, 'Founder and sole operator. Approved 2026-08-28.', v_user)
  on conflict (only_one) do update
    set user_id = excluded.user_id, reason = excluded.reason,
        set_by = excluded.set_by, set_at = now();
end $$;

commit;
