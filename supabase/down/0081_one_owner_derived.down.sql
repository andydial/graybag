-- Down for 0081. Removes the owner short-circuit and both tables.
--
-- Restores `auth_has_permission`, `auth_is_back_office` and `auth_has_any_grant` to their `0001`
-- and `0002` bodies — the versions without any owner term — then drops the tables the short-circuit
-- reads. Order matters: the functions must stop referencing `platform_owner` before it is dropped.
--
-- `platform_owner_history` is dropped with it. That is a deliberate loss of an audit trail and is
-- acceptable only because rolling this back means the feature never shipped; if ownership has
-- actually moved in production, export the history before running this.

begin;

create or replace function auth_has_permission(
  p_user uuid, p_permission text, p_scope_type scope_type, p_scope_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
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

create or replace function auth_is_back_office() returns boolean
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

create or replace function auth_has_any_grant(p_permission text) returns boolean
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

drop function if exists auth_is_owner();
drop trigger if exists platform_owner_history_trg on platform_owner;
drop function if exists platform_owner_record_change();
drop table if exists platform_owner_history;
drop table if exists platform_owner;

commit;
